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
        <h2 id="model-training">{report.comparisons?.length ? 'Current model training details' : 'Model and training'}</h2>
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
        <h2 id="model-test-results">{report.comparisons?.length ? 'Current model three-class results' : 'Held-out test results'}</h2>
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

function flaggedCases({ flagged, total }) {
  return `${counts.format(flagged)} of ${counts.format(total)}`
}

const runLabels = {
  original: 'Original fitted model',
  retrained: 'Retrained model',
}

function ModelProfile({ title, version, trees, library, outcome, calibration }) {
  return (
    <article className="evaluation-profile">
      <h3>{title}</h3>
      <p className="evaluation-model-version">{version}</p>
      <dl className="evaluation-profile-facts">
        <div><dt>Trees</dt><dd>{counts.format(trees)}</dd></div>
        <div><dt>scikit-learn</dt><dd>{library}</dd></div>
        <div><dt>Training outcome</dt><dd>{outcome}</dd></div>
        <div><dt>Calibration</dt><dd>{calibration}</dd></div>
      </dl>
    </article>
  )
}

const formatPercent = value => percent.format(value)
const formatDecimal = value => value.toFixed(4)

function ComparisonResults({ report, baseline, candidate, testRows }) {
  const prevalence = (baseline.flagged_by_class.MAM.total + baseline.flagged_by_class.SAM.total) / testRows
  const classification = report.classification_report
  const rows = [
    ['ROC AUC', '≥ 0.80', baseline.roc_auc, candidate.roc_auc, formatDecimal, value => value >= 0.80],
    ['Average precision', `Above ${formatPercent(prevalence)} prevalence`, baseline.average_precision,
      candidate.average_precision, formatPercent, value => value > prevalence, 'Above baseline'],
    ['MAM recall (three-class)', '≥ 75%', classification.MAM.recall, null, formatPercent, value => value >= 0.75],
    ['SAM recall (three-class)', '≥ 75%', classification.SAM.recall, null, formatPercent, value => value >= 0.75],
    ['Accuracy (three-class)', '> 86%', report.accuracy, null, formatPercent, value => value > 0.86],
    ['Brier score (lower is better)', null, baseline.brier_score, candidate.brier_score, formatDecimal],
    ['Sensitivity (binary)', null, baseline.sensitivity, candidate.sensitivity, formatPercent],
    ['Specificity (binary)', null, baseline.specificity, candidate.specificity, formatPercent],
    ['Precision (binary)', null, baseline.precision, candidate.precision, formatPercent],
    ...['MAM', 'SAM', 'Normal'].map(label => [
      `${label} cases flagged (binary)`, null, baseline.flagged_by_class[label],
      candidate.flagged_by_class[label], flaggedCases,
    ]),
  ]

  return (
    <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Model scores and proposal targets">
      <table className="decision-table evaluation-table">
        <caption>Model scores and proposal targets</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Proposal target</th>
            <th scope="col">Current Random Forest</th>
            <th scope="col">Calibrated Random Forest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, target, current, calibrated, format, meetsTarget, metLabel = 'Target met']) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{target ?? '—'}</td>
              {[current, calibrated].map((value, index) => (
                <td key={index}>
                  {value == null ? (target ? 'Not applicable' : '—') : format(value)}
                  {value != null && meetsTarget && (
                    <span className="evaluation-target-status">
                      {meetsTarget(value) ? metLabel : 'Target missed'}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModelComparison({ report }) {
  const { comparisons } = report
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
        <div className="evaluation-models">
          <ModelProfile title="Current Random Forest" version={report.model_version}
            trees={report.training.trees} library={report.sklearn_version} outcome="Normal, MAM, or SAM"
            calibration="Uncalibrated" />
          <ModelProfile title="Calibrated Random Forest" version={candidate.model_version}
            trees={candidate.trees} library={candidate.sklearn_version} outcome="Normal or acute malnutrition"
            calibration={candidate.calibration} />
        </div>
        <ComparisonResults report={report} baseline={baseline} candidate={candidate} testRows={testRows} />
        <p>Sensitivity, specificity, precision, and flagged counts use a shared {percent.format(threshold)} research threshold. The current model’s binary risk is its MAM probability plus its SAM probability.</p>
        <p>The calibrated model produces a binary result, so three-class recall and accuracy do not apply. The accuracy check uses Specific Objective 3’s strict cutoff. Other sections of the proposal use ≥ 86%.</p>
        <p>Average precision summarizes the precision–recall curve. Its status compares the point estimate with the held-out prevalence. The proposal also calls for statistical evidence of improvement over prevalence, which this report does not assess.</p>
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
          {report.comparisons?.length > 0 && <ModelComparison report={report} />}
          <EvaluationSummary report={report} />
          <TestResults report={report} />
          <p className="evaluation-note">Research evaluation on held-out survey data. The prototype requires clinical validation before use in care.</p>
        </>
      )}
    </>
  )
}
