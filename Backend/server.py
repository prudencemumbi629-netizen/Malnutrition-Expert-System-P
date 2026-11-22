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


def optional_object(payload, key, fields):
    values = payload.get(key, {})
    if not isinstance(values, dict) or values.keys() - fields:
        raise ValueError(f"Invalid {key} fields.")
    return values


def assess(artifact, payload):
    fields = {"screeningInputs", "clinicalInputs", "medicationContext"}
    if not isinstance(payload, dict) or payload.keys() - fields:
        raise ValueError("Invalid assessment fields.")
    row = screening_row(payload.get("screeningInputs"))
    clinical = optional_object(payload, "clinicalInputs", {"whz", "muacCm", "oedema"})
    for field in ("whz", "muacCm"):
        if field in clinical:
            value = clinical[field]
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError("Clinical measurements must be finite numbers.")
    if "muacCm" in clinical and clinical["muacCm"] <= 0:
        raise ValueError("Arm circumference must be positive.")
    if "oedema" in clinical and type(clinical["oedema"]) is not bool:
        raise ValueError("Specify whether oedema was recorded.")
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
        "screening": {"predictedClass": str(max(probabilities, key=probabilities.get)), "scores": scores},
        "clinicalAssessment": {
            "status": "pending_rule_review" if clinical else "assessment_pending",
            "message": (
                "Clinical rules are awaiting review." if clinical
                else "No clinical findings were supplied."
            ),
        },
        "pharmacyGuidance": {
            "status": "pending_rule_review",
            "message": "Pharmacy guidance is pending review of the clinical rules.",
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
            return self.send_json(200, {"features": FEATURES, "modelVersion": artifact["version"]})
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
        server.inference_token = f"Bearer {token}".encode() if token else b""
        print(f"FYM inference listening on http://{host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
