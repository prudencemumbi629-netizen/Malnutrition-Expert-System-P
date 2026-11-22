# Project FYM screening API

The local Python API serves a class-weighted Random Forest trained on the cleaned KDHS cohort. It uses the existing cluster-grouped train and test files. Keep the dataset, local artifacts, and evaluation outputs in the approved research environment.

## Run locally on Windows

From the project root, run `.\api.cmd` to start the API and run `.\dev.cmd` in a second terminal. For a fresh checkout, use Python 3.12 to install the dependencies and train the model before starting the API. Training produces `Backend/artifacts/model.joblib` and the held-out evaluation report.

```powershell
py -3.12 -m venv Backend/.venv
.\Backend\.venv\Scripts\python.exe -m pip install -r Backend/requirements.txt
.\Backend\.venv\Scripts\python.exe Backend/train.py
.\api.cmd
```

Leave the API running on port 8000. In a second terminal at the project root, run `.\dev.cmd` and open the URL printed by Vite.

## API

| Route | Response |
| --- | --- |
| `GET /health` | Readiness of the loaded model |
| `GET /api/schema` | Screening fields, accepted category codes and model version |
| `POST /api/assess` | Screening class and scores, assessment and pharmacy status, and version |

Age and sex are required. Other predictors may be omitted. Preprocessing learns the imputation values from the training partition. The clinical and pharmacy endpoints return pending states until approved rules are available. The model scores are research classifier outputs and have not been calibrated as clinical probabilities.

The training report includes a majority-class baseline, a held-out confusion matrix, per-class metrics and a training-set permutation importance ranking. Treat the initial result as a research baseline. The training script accepts `--data` and `--output` for approved alternate locations. The server accepts `FYM_MODEL_ARTIFACT`, `HOST`, and `PORT`.
