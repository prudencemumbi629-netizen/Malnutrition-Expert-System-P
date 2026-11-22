import argparse
import json
from pathlib import Path

import joblib

from server import DEFAULT_ARTIFACT, evaluation_summary


def main():
    parser = argparse.ArgumentParser(description="Export aggregate model evaluation results.")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    args = parser.parse_args()
    artifact = joblib.load(args.artifact)
    print(json.dumps(evaluation_summary(args.artifact, artifact), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
