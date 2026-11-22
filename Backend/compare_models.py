import argparse
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
import warnings

import joblib
import numpy as np
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import InconsistentVersionWarning
from sklearn.impute import SimpleImputer
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

from schema import CLASSES
from train import HERE, SEED, load_dataset, load_split, read_rows

DEFAULT_DATA = HERE.parent / "Docs" / "processed data"
DEFAULT_ARTIFACT = HERE / "artifacts" / "model.joblib"
DATA_FILES = (
    "model_dataset.csv", "group_train_indices.csv", "group_test_indices.csv", "model_cluster_ids.csv",
)
CATEGORICAL = ("b4", "v404", "v106", "v190", "v113", "v116", "h11", "h22", "h31", "v024", "v025")
NUMERIC = ("b19", "bord", "v137")
THRESHOLD = 0.05


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def data_identity(data):
    return {name: sha256(data / name) for name in DATA_FILES}


def load_fitted_model(path):
    with warnings.catch_warnings():
        warnings.simplefilter("error", InconsistentVersionWarning)
        return joblib.load(path)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temp_path = Path(temporary.name)
        json.dump(payload, temporary, indent=2, allow_nan=False)
        temporary.write("\n")
    temp_path.replace(path)


def fit_calibrated_model(inputs, labels, groups):
    preprocess = ColumnTransformer([
        ("categorical", make_pipeline(
            SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore"),
        ), list(CATEGORICAL)),
        ("numeric", SimpleImputer(strategy="median"), list(NUMERIC)),
    ])
    forest = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=SEED, n_jobs=1)
    folds = list(StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=123).split(inputs, labels, groups))
    calibrated = CalibratedClassifierCV(
        make_pipeline(preprocess, forest), method="sigmoid", cv=folds, ensemble=False,
    )
    return calibrated.fit(inputs, labels)


def score_legacy(args):
    import pandas as pd

    original_identity = data_identity(args.original_data) if args.original_data else None
    identity = data_identity(args.data)
    if not args.retrain and original_identity != identity:
        raise ValueError("Scoring the original artifact requires matching its original data and split files.")

    dataset = pd.read_csv(args.data / "model_dataset.csv")
    train, test = load_split(args.data, len(dataset))
    inputs = dataset[list(CATEGORICAL + NUMERIC)]
    positive = dataset["nutrition_status"].isin(["MAM", "SAM"])
    if args.retrain:
        if args.model.exists():
            raise FileExistsError("Choose a new path for the retrained model.")
        clusters = np.asarray([row["v021"] for row in read_rows(args.data / "model_cluster_ids.csv")])
        # Use integers as the legacy training script did so cluster ordering is preserved.
        model = fit_calibrated_model(inputs.iloc[train], positive.iloc[train].astype(int), clusters[train].astype(int))
        args.model.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, args.model, compress=3)
    else:
        model = load_fitted_model(args.model)

    if (not isinstance(model, CalibratedClassifierCV) or list(model.classes_) != [0, 1]
            or tuple(model.feature_names_in_) != CATEGORICAL + NUMERIC):
        raise ValueError("The candidate is not the expected binary calibrated classifier.")
    forest = model.calibrated_classifiers_[0].estimator.steps[-1][1]
    scores = model.predict_proba(inputs.iloc[test])[:, 1]
    write_json(args.scores, {
        "source_sha256": identity,
        "test_indices": test,
        "probabilities": scores.tolist(),
        "candidate": {
            "model_version": "kdhs-calibrated-rf-" + sha256(args.model)[:16],
            "fit": "retrained" if args.retrain else "original",
            "sklearn_version": sklearn.__version__,
            "trees": forest.n_estimators,
            "calibration": model.method,
        },
    })
    print(f"Scored the calibrated model on {len(test):,} held-out records.")


def binary_metrics(status, scores):
    if scores.shape != status.shape or not np.all(np.isfinite(scores) & (0 <= scores) & (scores <= 1)):
        raise ValueError("Expected one finite probability per held-out record.")
    actual = np.isin(status, ["MAM", "SAM"])
    flagged = scores >= THRESHOLD
    tn, fp, fn, tp = map(int, confusion_matrix(actual, flagged, labels=[False, True]).ravel())
    return {
        "roc_auc": float(roc_auc_score(actual, scores)),
        "average_precision": float(average_precision_score(actual, scores)),
        "brier_score": float(brier_score_loss(actual, scores)),
        "sensitivity": tp / (tp + fn),
        "specificity": tn / (tn + fp),
        "precision": tp / (tp + fp) if tp + fp else None,
        "confusion_matrix": [[tn, fp], [fn, tp]],
        "flagged_by_class": {
            label: {"flagged": int(flagged[status == label].sum()), "total": int((status == label).sum())}
            for label in CLASSES
        },
    }


def compare(args):
    inputs, status = load_dataset(args.data)
    train, test = load_split(args.data, len(status))
    identity = data_identity(args.data)
    baseline = json.loads(args.artifact.with_name("evaluation.json").read_text(encoding="utf-8"))
    candidate = json.loads(args.scores.read_text(encoding="utf-8"))
    if (baseline["source_sha256"] != identity or candidate["source_sha256"] != identity
            or candidate["test_indices"] != test or baseline["artifact_sha256"] != sha256(args.artifact)):
        raise ValueError("Both models must be evaluated on the same verified data and split.")

    artifact = load_fitted_model(args.artifact)
    model = artifact["model"]
    classes = list(model.classes_)
    current_scores = model.predict_proba(inputs[test])[:, [classes.index("MAM"), classes.index("SAM")]].sum(axis=1)
    status = status[test]
    current = binary_metrics(status, current_scores)
    alternative = binary_metrics(status, np.asarray(candidate["probabilities"], dtype=float))
    write_json(args.report, {
        "baseline_model_version": artifact["version"],
        "train_rows": len(train),
        "test_rows": len(test),
        "threshold": THRESHOLD,
        "baseline": current,
        "candidate": {**candidate["candidate"], **alternative},
    })
    print(f"Compared both models on {len(test):,} held-out records.")
    print(f"ROC AUC: current {current['roc_auc']:.4f}, calibrated {alternative['roc_auc']:.4f}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate the current and calibrated malnutrition models.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    commands = parser.add_subparsers(required=True)
    scoring = commands.add_parser("score-calibrated", help="Score or retrain the earlier calibrated model.")
    scoring.add_argument("--model", type=Path, required=True)
    scoring.add_argument("--scores", type=Path, required=True)
    scoring.add_argument("--original-data", type=Path)
    scoring.add_argument("--retrain", action="store_true")
    scoring.set_defaults(run=score_legacy)

    comparison = commands.add_parser("compare", help="Score the current model and export aggregate comparisons.")
    comparison.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    comparison.add_argument("--scores", type=Path, required=True)
    comparison.add_argument("--report", type=Path, required=True)
    comparison.set_defaults(run=compare)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
