import argparse
import csv
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score, average_precision_score, classification_report,
    confusion_matrix, recall_score, roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

from schema import CLASSES, FEATURES, ILLNESS_CODES, screening_row

HERE = Path(__file__).resolve().parent
SEED = 42


def read_rows(path):
    with path.open(newline="", encoding="utf-8-sig") as source:
        yield from csv.DictReader(source)


def load_dataset(data):
    inputs, labels = [], []
    for record in read_rows(data / "model_dataset.csv"):
        values = {}
        for feature in FEATURES:
            key = feature["key"]
            raw = record[key].strip()
            if raw:
                values[key] = ILLNESS_CODES[raw] if key in ("h11", "h22", "h31") else int(raw)
        inputs.append(screening_row(values))
        labels.append(record["nutrition_status"])
    return np.asarray(inputs), np.asarray(labels)


def load_split(data, size):
    train = [int(row["row_index"]) for row in read_rows(data / "group_train_indices.csv")]
    test = [int(row["row_index"]) for row in read_rows(data / "group_test_indices.csv")]
    clusters = [row["v021"] for row in read_rows(data / "model_cluster_ids.csv")]
    if len(clusters) != size or sorted(train + test) != list(range(size)):
        raise ValueError("The group split must cover each model row exactly once.")
    if {clusters[i] for i in train} & {clusters[i] for i in test}:
        raise ValueError("A survey cluster occurs in both parts of the split.")
    return train, test


def fit_model(inputs, labels):
    numeric = [i for i, feature in enumerate(FEATURES) if feature["type"] == "integer"]
    categorical = [i for i, feature in enumerate(FEATURES) if feature["type"] == "category"]
    preprocess = ColumnTransformer([
        ("numeric", SimpleImputer(strategy="median"), numeric),
        ("categorical", make_pipeline(
            SimpleImputer(strategy="most_frequent"),
            OneHotEncoder(handle_unknown="ignore"),
        ), categorical),
    ])
    forest = RandomForestClassifier(
        n_estimators=128, class_weight="balanced", random_state=SEED,
        min_samples_leaf=3, n_jobs=1,
    )
    return make_pipeline(preprocess, forest).fit(inputs, labels)


def evaluation(model, inputs, labels):
    predictions = model.predict(inputs)
    probabilities = model.predict_proba(inputs)
    matrix = confusion_matrix(labels, predictions, labels=CLASSES)
    details = classification_report(labels, predictions, labels=CLASSES,
                                    output_dict=True, zero_division=0)
    curves = {}
    for index, label in enumerate(CLASSES):
        positive = labels == label
        scores = probabilities[:, list(model.classes_).index(label)]
        negatives = len(labels) - matrix[index].sum()
        false_positive = matrix[:, index].sum() - matrix[index, index]
        curves[label] = {
            "roc_auc": float(roc_auc_score(positive, scores)),
            "average_precision": float(average_precision_score(positive, scores)),
            "prevalence": float(positive.mean()),
            "specificity": float((negatives - false_positive) / negatives),
        }
    return {
        "accuracy": accuracy_score(labels, predictions),
        "all_normal_accuracy": float((labels == "Normal").mean()),
        "confusion_matrix_class_order": CLASSES,
        "confusion_matrix": matrix.tolist(),
        "classification_report": details,
        "curves": curves,
    }


def importance(model, inputs, labels):
    def minority_recall(estimator, values, actual):
        return recall_score(actual, estimator.predict(values), labels=["MAM", "SAM"],
                            average="macro", zero_division=0)

    measured = permutation_importance(model, inputs, labels, scoring=minority_recall,
                                      n_repeats=3, random_state=SEED, n_jobs=1)
    ranked = [
        {"feature": feature["key"], "label": feature["label"],
         "mean": float(mean), "std": float(std)}
        for feature, mean, std in zip(FEATURES, measured.importances_mean, measured.importances_std)
    ]
    return sorted(ranked, key=lambda item: item["mean"], reverse=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=HERE.parent / "Docs" / "processed data")
    parser.add_argument("--output", type=Path, default=HERE / "artifacts")
    args = parser.parse_args()
    inputs, labels = load_dataset(args.data)
    train, test = load_split(args.data, len(labels))
    if any(set(labels[part]) != set(CLASSES) for part in (train, test)):
        raise ValueError("Training and test sets must both contain all three classes.")

    model = fit_model(inputs[train], labels[train])
    # The final holdout is evaluation-only. Use the training partition for rankings.
    report = evaluation(model, inputs[test], labels[test])
    report["feature_importance"] = {
        "scoring": "Training-set permutation decrease in mean MAM and SAM recall",
        "random_seed": SEED,
        "ranking": importance(model, inputs[train], labels[train]),
    }
    inputs_sha256 = {
        name: hashlib.sha256((args.data / name).read_bytes()).hexdigest()
        for name in ("model_dataset.csv", "group_train_indices.csv",
                     "group_test_indices.csv", "model_cluster_ids.csv")
    }
    source = Path(__file__).read_bytes() + (HERE / "schema.py").read_bytes()
    identity = repr((inputs_sha256, sklearn.__version__)).encode() + source
    version = "kdhs-rf-" + hashlib.sha256(identity).hexdigest()[:16]
    report.update({
        "model_version": version, "sklearn_version": sklearn.__version__,
        "train_rows": len(train), "test_rows": len(test), "source_sha256": inputs_sha256,
    })
    args.output.mkdir(parents=True, exist_ok=True)
    artifact = args.output / "model.joblib"
    staging = artifact.with_suffix(".tmp")
    joblib.dump({"model": model, "version": version, "features": FEATURES}, staging, compress=3)
    staging.replace(artifact)
    report["artifact_sha256"] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Trained {version} on {len(train):,} rows. Evaluated on {len(test):,} held-out rows.")
    print(f"Reports and local model: {args.output}")


if __name__ == "__main__":
    main()
