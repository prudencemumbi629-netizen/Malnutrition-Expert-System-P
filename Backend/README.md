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

## Compare the calibrated model

The earlier project fitted a 300-tree Random Forest with sigmoid calibration and a binary outcome that combines MAM and SAM. Use the earlier project's Python environment to score its fitted model or refit it. That environment needs pandas and the scikit-learn version used to save the original artifact. Run the comparison itself with this project's Python environment so it can load the current model with its pinned scikit-learn version.

Run the following from the project root. Replace `<legacy-python>` and the earlier-project paths with the actual paths.

```text
<legacy-python> Backend/compare_models.py score-calibrated --model "<earlier-project>/results/group_calibrated_model.joblib" --original-data "<earlier-project>/Data/processed" --scores Backend/artifacts/calibrated/original-scores.json
python Backend/compare_models.py compare --scores Backend/artifacts/calibrated/original-scores.json --report Backend/artifacts/comparisons/original.json
```

To train and test a fresh instance of the calibrated model, use a new artifact path. Calibration uses grouped folds within the training partition. The two models are scored on the same test rows with a shared 5% research threshold.

```text
<legacy-python> Backend/compare_models.py score-calibrated --retrain --model Backend/artifacts/calibrated/retrained.joblib --scores Backend/artifacts/calibrated/retrained-scores.json
python Backend/compare_models.py compare --scores Backend/artifacts/calibrated/retrained-scores.json --report Backend/artifacts/comparisons/retrained.json
```

Open **Model evaluation** to view the aggregate comparison. These test results reuse the same held-out survey split and do not constitute independent validation. Keep fitted candidate artifacts and per-record score files in the approved research environment. The evaluation export includes only the aggregate comparison for the matching active model version.
