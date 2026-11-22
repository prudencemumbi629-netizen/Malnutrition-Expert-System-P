import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import './ModelEvaluation.css'

const counts = new Intl.NumberFormat()
const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const classLabels = {
  Normal: 'Normal',
  MAM: 'Moderate acute malnutrition',
  SAM: 'Severe acute malnutrition',
}

const metrics = [
  ['Precision', (result) => result.precision],
  ['Recall', (result) => result.recall],
  ['F1 score', (result) => result['f1-score']],
  ['ROC AUC', (_, curve) => curve.roc_auc],
  ['Average precision', (_, curve) => curve.average_precision],
]

async function loadEvaluation(hosted, signal) {
  if (hosted) {
    const { data, error } = await supabase.from('model_evaluations')
      .select('report').abortSignal(signal).maybeSingle()
    if (error) throw error
    return data?.report ?? null
  }
  const response = await fetch('/api/evaluation', { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Evaluation service unavailable.')
  return response.json()
}

function EvaluationSummary({ report }) {
  const { training } = report
  return (
    <section className="panel evaluation-panel" aria-labelledby="model-training">
      <div className="panel-heading">
        <h2 id="model-training">Model and training</h2>
        <p>{training.algorithm} trained on the processed Kenya Demographic and Health Survey (KDHS) cohort.</p>
      </div>
      <div className="form-body evaluation-body">
        <dl className="evaluation-facts">
          <div><dt>Model version</dt><dd>{report.model_version}</dd></div>
          <div><dt>Training records</dt><dd>{counts.format(report.train_rows)}</dd></div>
          <div><dt>Held-out test records</dt><dd>{counts.format(report.test_rows)}</dd></div>
          <div><dt>Implementation</dt><dd>scikit-learn {report.sklearn_version}</dd></div>
          <div><dt>Predictors</dt><dd>{counts.format(training.predictors)}</dd></div>
          <div><dt>Trees</dt><dd>{counts.format(training.trees)}</dd></div>
          <div><dt>Minimum samples per leaf</dt><dd>{training.minimum_leaf_samples}</dd></div>
          <div><dt>Class weighting</dt><dd>{training.class_weight}</dd></div>
          <div><dt>Random seed</dt><dd>{training.random_seed}</dd></div>
        </dl>
        <p>Training and test records came from separate survey clusters. Numeric missing values were filled with the training median. Categorical missing values used the most frequent training category, and categories were one-hot encoded.</p>
      </div>
    </section>
  )
}

function TestResults({ report }) {
  const classes = report.confusion_matrix_class_order
  const samIndex = classes.indexOf('SAM')
  const sam = report.classification_report.SAM
  return (
    <section className="panel evaluation-panel" aria-labelledby="model-test-results">
      <div className="panel-heading">
        <h2 id="model-test-results">Held-out test results</h2>
        <p>{counts.format(report.test_rows)} records from survey clusters reserved for testing.</p>
      </div>
      <div className="form-body evaluation-body">
        <dl className="evaluation-facts evaluation-metrics">
          <div><dt>Model accuracy</dt><dd>{percent.format(report.accuracy)}</dd></div>
          <div><dt>Always predict Normal</dt><dd>{percent.format(report.all_normal_accuracy)}</dd></div>
          <div><dt>Macro F1 score</dt><dd>{percent.format(report.classification_report['macro avg']['f1-score'])}</dd></div>
        </dl>
        <p>Normal was the most common class in the test set. The model correctly identified {counts.format(report.confusion_matrix[samIndex][samIndex])} of {counts.format(sam.support)} severe acute malnutrition cases.</p>
      </div>
      <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Performance by class">
        <table className="decision-table evaluation-table">
          <caption>Performance by class</caption>
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col">Test records</th>
              {metrics.map(([label]) => <th scope="col" key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {classes.map(label => {
              const result = report.classification_report[label]
              return (
                <tr key={label}>
                  <th scope="row">{classLabels[label]}</th>
                  <td>{counts.format(result.support)}</td>
                  {metrics.map(([name, value]) => (
                    <td key={name}>{percent.format(value(result, report.curves[label]))}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Confusion matrix">
        <table className="decision-table evaluation-table evaluation-matrix">
          <caption>Confusion matrix</caption>
          <thead>
            <tr>
              <th scope="col">Actual class</th>
              {classes.map(label => <th key={label} scope="col">Predicted {label}</th>)}
            </tr>
          </thead>
          <tbody>
            {classes.map((label, row) => (
              <tr key={label}>
                <th scope="row">{classLabels[label]}</th>
                {classes.map((prediction, column) => (
                  <td key={prediction} className={row === column ? 'evaluation-correct' : undefined}>
                    {counts.format(report.confusion_matrix[row][column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const comparisonMetrics = [
  ['ROC AUC', result => result.roc_auc.toFixed(4)],
  ['Average precision', result => percent.format(result.average_precision)],
  ['Brier score (lower is better)', result => result.brier_score.toFixed(4)],
  ['Sensitivity', result => percent.format(result.sensitivity)],
  ['Specificity', result => percent.format(result.specificity)],
  ['Precision', result => result.precision === null ? '—' : percent.format(result.precision)],
  ['Moderate cases flagged', result => flaggedCases(result.flagged_by_class.MAM)],
  ['Severe cases flagged', result => flaggedCases(result.flagged_by_class.SAM)],
  ['Normal cases flagged', result => flaggedCases(result.flagged_by_class.Normal)],
]

function flaggedCases({ flagged, total }) {
  return `${counts.format(flagged)} of ${counts.format(total)}`
}

const runLabels = {
  original: 'Original fitted model',
  retrained: 'Retrained model',
}

function ModelComparison({ comparisons }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { baseline, candidate, test_rows: testRows, threshold } = comparisons[selectedIndex]

  return (
    <section className="panel evaluation-panel" aria-labelledby="model-comparison">
      <div className="panel-heading">
        <h2 id="model-comparison">Model comparison</h2>
        <p>Both models scored the same {counts.format(testRows)} held-out records with moderate and severe acute malnutrition combined as one outcome.</p>
      </div>
      <div className="form-body evaluation-body">
        {comparisons.length > 1 && (
          <div className="field evaluation-select">
            <label htmlFor="calibrated-run">Calibrated model run</label>
            <select id="calibrated-run" value={selectedIndex} onChange={event => setSelectedIndex(Number(event.target.value))}>
              {comparisons.map(({ candidate: run }, index) => (
                <option key={run.model_version} value={index}>{runLabels[run.fit]}</option>
              ))}
            </select>
          </div>
        )}
        <p>{runLabels[candidate.fit]} · {candidate.model_version} · {candidate.trees} trees · {candidate.calibration} calibration · scikit-learn {candidate.sklearn_version}</p>
        <p>Sensitivity, specificity, precision, and flagged counts use a shared {percent.format(threshold)} research threshold. The current model’s binary risk is its MAM probability plus its SAM probability.</p>
      </div>
      <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Binary risk performance by model">
        <table className="decision-table evaluation-table evaluation-comparison">
          <caption>Binary risk performance by model</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Current Random Forest</th>
              <th scope="col">Calibrated Random Forest</th>
            </tr>
          </thead>
          <tbody>
            {comparisonMetrics.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value(baseline)}</td>
                <td>{value(candidate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function ModelEvaluation({ hosted }) {
  const [report, setReport] = useState(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    loadEvaluation(hosted, controller.signal).then(data => {
      if (!controller.signal.aborted) setReport(data)
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => controller.abort()
  }, [hosted, attempt])

  return (
    <>
      <div className="intro">
        <h1>Model evaluation</h1>
        <p>Training details and held-out test results for the acute malnutrition screening model.</p>
      </div>
      {failed ? (
        <div className="panel form-body">
          <p className="error" role="alert">Could not load the model evaluation.</p>
          <button className="button-secondary" type="button" onClick={() => {
            setFailed(false)
            setAttempt(current => current + 1)
          }}>Retry</button>
        </div>
      ) : report === undefined ? (
        <p className="panel form-body" role="status">Loading model evaluation…</p>
      ) : report === null ? (
        <p className="panel form-body">No evaluation report is available for the active model.</p>
      ) : (
        <>
          <EvaluationSummary report={report} />
          <TestResults report={report} />
          {report.comparisons?.length > 0 && <ModelComparison comparisons={report.comparisons} />}
          <p className="evaluation-note">Research evaluation on held-out survey data. The prototype requires clinical validation before use in care.</p>
        </>
      )}
    </>
  )
}
