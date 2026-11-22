import hmac
import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib

from schema import CLASSES, FEATURES, screening_row

MAX_REQUEST_BYTES = 16_384
DEFAULT_ARTIFACT = Path(__file__).resolve().parent / "artifacts" / "model.joblib"
DANGER_SIGNS = {
    "convulsions": "Convulsions now or recently",
    "unable_to_drink": "Unable to drink or breastfeed",
    "vomits_everything": "Vomits everything",
    "lethargic_or_unconscious": "Lethargic or unconscious",
}
RESEARCH_DISCLAIMER = (
    "Research prototype only. Not clinically validated. "
    "This system does not replace professional assessment."
)


def assess_clinical(age_months, clinical):
    age_eligible = 6 <= age_months <= 59
    muac = clinical.get("muacCm")
    whz = clinical.get("whz")
    oedema = clinical.get("oedema")
    danger_signs = clinical.get("dangerSigns")
    findings = {"muac": "Not recorded.", "whz": "Not recorded.",
                "oedema": "Not recorded.", "dangerSigns": "Not recorded."}
    if muac is not None:
        if not age_eligible:
            interpretation = "The prototype MUAC thresholds apply at ages 6–59 months."
        elif muac < 11.5:
            interpretation = "Severe acute malnutrition range."
        elif muac < 12.5:
            interpretation = "Moderate acute malnutrition range for children aged 6–59 months."
        else:
            interpretation = "At or above the wasting threshold of 125 mm."
        findings["muac"] = f"{muac * 10:g} mm. {interpretation}"
    if whz is not None:
        if not age_eligible:
            interpretation = "Use an age-appropriate professional assessment."
        elif whz < -3:
            interpretation = "Severe wasting range."
        elif whz < -2:
            interpretation = "Moderate wasting range."
        else:
            interpretation = "At or above the wasting threshold of −2."
        findings["whz"] = f"{whz:g}. {interpretation}"
    if oedema is not None:
        findings["oedema"] = "Present. Requires professional evaluation." if oedema else "Absent."
    if danger_signs is not None:
        findings["dangerSigns"] = (
            ", ".join(DANGER_SIGNS[sign] for sign in danger_signs) if danger_signs else "None reported."
        )

    severe_wasting = age_eligible and (
        (muac is not None and muac < 11.5) or (whz is not None and whz < -3)
    )
    moderate_wasting = age_eligible and (
        (muac is not None and muac < 12.5) or (whz is not None and whz < -2)
    )
    if danger_signs:
        priority = "EMERGENCY_REFERRAL"
        recommendation = "Seek emergency care immediately for the reported danger signs."
    elif oedema or severe_wasting:
        priority = "PROMPT_ASSESSMENT"
        recommendation = "Arrange prompt assessment at a facility that can evaluate and manage severe acute malnutrition."
    elif moderate_wasting:
        priority = "PROMPT_ASSESSMENT"
        recommendation = "Arrange prompt assessment by a qualified healthcare professional for nutritional evaluation and management."
    elif age_eligible and all(value is not None for value in (muac, whz, oedema, danger_signs)):
        priority = "ROUTINE_ASSESSMENT"
        recommendation = "Continue routine growth monitoring and nutritional assessment with a qualified healthcare professional."
    else:
        priority = None
        recommendation = (
            "Arrange an age-appropriate professional assessment." if not age_eligible
            else "Complete the missing clinical observations with a qualified healthcare professional."
        )
    return {
        "status": "assessed" if priority else "assessment_pending",
        "priority": priority,
        "findings": findings,
        "recommendation": recommendation,
        "ruleVersion": "research-v1",
    }


def optional_object(payload, key, fields):
    values = payload.get(key, {})
    if not isinstance(values, dict) or values.keys() - fields:
        raise ValueError(f"Invalid {key} fields.")
    return values


def evaluation_summary(artifact_path, artifact):
    report = json.loads(artifact_path.with_name("evaluation.json").read_text(encoding="utf-8"))
    if report["model_version"] != artifact["version"]:
        raise ValueError("Evaluation report does not match the loaded model.")

    forest = artifact["model"].steps[-1][1]
    summary = {key: report[key] for key in (
        "model_version", "sklearn_version", "train_rows", "test_rows", "accuracy",
        "all_normal_accuracy", "classification_report", "confusion_matrix",
        "confusion_matrix_class_order", "curves",
    )}
    summary["training"] = {
        "algorithm": "Random Forest",
        "predictors": len(artifact["features"]),
        "trees": forest.n_estimators,
        "minimum_leaf_samples": forest.min_samples_leaf,
        "class_weight": forest.class_weight,
        "random_seed": forest.random_state,
    }
    comparisons = []
    for path in sorted((artifact_path.parent / "comparisons").glob("*.json")):
        try:
            comparison = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (isinstance(comparison, dict)
                and comparison.get("baseline_model_version") == artifact["version"]
                and comparison.get("train_rows") == report["train_rows"]
                and comparison.get("test_rows") == report["test_rows"]):
            comparisons.append(comparison)
    if comparisons:
        summary["comparisons"] = comparisons
    return summary


def assess(artifact, payload):
    fields = {"screeningInputs", "clinicalInputs", "medicationContext"}
    if not isinstance(payload, dict) or payload.keys() - fields:
        raise ValueError("Invalid assessment fields.")
    row = screening_row(payload.get("screeningInputs"))
    clinical = optional_object(payload, "clinicalInputs", {"whz", "muacCm", "oedema", "dangerSigns"})
    for field in ("whz", "muacCm"):
        if field in clinical:
            value = clinical[field]
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError("Clinical measurements must be finite numbers.")
    if "muacCm" in clinical and clinical["muacCm"] <= 0:
        raise ValueError("Arm circumference must be positive.")
    if "oedema" in clinical and type(clinical["oedema"]) is not bool:
        raise ValueError("Specify whether oedema was recorded.")
    if "dangerSigns" in clinical:
        signs = clinical["dangerSigns"]
        if (not isinstance(signs, list) or len(signs) > len(DANGER_SIGNS)
                or any(not isinstance(sign, str) or sign not in DANGER_SIGNS for sign in signs)
                or len(set(signs)) != len(signs)):
            raise ValueError("Provide a list of distinct, recognized danger signs.")
    medications = optional_object(payload, "medicationContext", {"medications"})
    entries = medications.get("medications", [])
    if not isinstance(entries, list) or len(entries) > 20 or any(
        not isinstance(item, str) or not 1 <= len(item.strip()) <= 120 for item in entries
    ):
        raise ValueError("Provide up to 20 medication names.")

    model = artifact["model"]
    probabilities = dict(zip(model.classes_, model.predict_proba([row])[0]))
    scores = {name: float(probabilities[name]) for name in CLASSES}
    return {
        "screening": {
            "predictedClass": str(max(probabilities, key=probabilities.get)),
            "scores": scores,
            "malnutritionProbability": scores["MAM"] + scores["SAM"],
        },
        "clinicalAssessment": assess_clinical(payload["screeningInputs"]["b19"], clinical),
        "researchDisclaimer": RESEARCH_DISCLAIMER,
        "pharmacyGuidance": {
            "status": "unavailable",
            "message": "Pharmacy guidance is unavailable in this research prototype.",
            "alerts": [],
        },
        "versions": {"model": artifact["version"]},
    }


class AssessmentHandler(BaseHTTPRequestHandler):
    def authorized(self):
        token = self.server.inference_token
        authorization = self.headers.get("Authorization", "").encode()
        return not token or hmac.compare_digest(authorization, token)

    def send_json(self, status, payload):
        encoded = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_):
        # Request paths and error details can contain user-supplied data.
        return

    def do_GET(self):
        artifact = self.server.artifact
        if self.path == "/health":
            return self.send_json(200, {"status": "ok"})
        if self.path == "/api/schema":
            if not self.authorized():
                return self.send_json(401, {"error": "Unauthorized."})
            return self.send_json(200, {
                "features": FEATURES,
                "modelVersion": artifact["version"],
                "dangerSigns": [{"key": key, "label": label} for key, label in DANGER_SIGNS.items()],
            })
        if self.path == "/api/evaluation":
            if not self.authorized():
                return self.send_json(401, {"error": "Unauthorized."})
            try:
                return self.send_json(200, evaluation_summary(self.server.artifact_path, artifact))
            except FileNotFoundError:
                return self.send_json(404, {"error": "No evaluation report is available for this model."})
            except (OSError, ValueError, KeyError, TypeError):
                return self.send_json(503, {"error": "The evaluation report could not be loaded."})
        return self.send_json(404, {"error": "Route not found."})

    def do_POST(self):
        if self.path != "/api/assess":
            return self.send_json(404, {"error": "Route not found."})
        if not self.authorized():
            return self.send_json(401, {"error": "Unauthorized."})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(415, {"error": "Send an application/json request."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_REQUEST_BYTES:
            return self.send_json(413 if size > MAX_REQUEST_BYTES else 400,
                                  {"error": "Invalid request body size."})
        try:
            payload = json.loads(self.rfile.read(size))
        except (UnicodeError, ValueError, RecursionError):
            return self.send_json(400, {"error": "The request contains invalid JSON."})
        try:
            result = assess(self.server.artifact, payload)
        except (ValueError, OverflowError) as error:
            return self.send_json(422, {"error": str(error)})
        return self.send_json(200, result)


def main():
    token = os.environ.get("FYM_INFERENCE_TOKEN")
    if os.environ.get("RENDER") == "true" and not token:
        raise SystemExit("Set FYM_INFERENCE_TOKEN before serving inference on Render.")
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    artifact_path = Path(os.environ.get("FYM_MODEL_ARTIFACT", DEFAULT_ARTIFACT))
    if not artifact_path.is_file():
        raise SystemExit("Model artifact missing. Run Backend/train.py before starting inference.")
    artifact = joblib.load(artifact_path)
    if artifact["features"] != FEATURES or set(artifact["model"].classes_) != set(CLASSES):
        raise SystemExit("Model schema mismatch. Train a compatible model artifact.")
    with ThreadingHTTPServer((host, port), AssessmentHandler) as server:
        server.artifact = artifact
        server.artifact_path = artifact_path
        server.inference_token = f"Bearer {token}".encode() if token else b""
        print(f"FYM inference listening on http://{host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
