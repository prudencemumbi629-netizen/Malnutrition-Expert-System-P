import hashlib
import os
import re
from pathlib import Path
from urllib.request import urlopen


def main():
    expected = os.environ.get("FYM_MODEL_SHA256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise SystemExit("Set FYM_MODEL_SHA256 to the approved model digest.")
    url = Path("/run/secrets/fym_model_url").read_text().strip()
    if not url.startswith("https://"):
        raise SystemExit("The model download URL must use HTTPS.")

    limit = 32 * 1024 * 1024
    try:
        with urlopen(url, timeout=60) as response:
            model = response.read(limit + 1)
    except OSError:
        raise SystemExit("Could not download the private model artifact.") from None
    if len(model) > limit or hashlib.sha256(model).hexdigest() != expected:
        raise SystemExit("The downloaded model does not match the approved artifact.")

    target = Path("artifacts/model.joblib")
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(model)


if __name__ == "__main__":
    main()
