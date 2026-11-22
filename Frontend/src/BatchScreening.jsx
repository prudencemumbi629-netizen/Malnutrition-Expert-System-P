import { useEffect, useMemo, useRef, useState } from 'react'
import { batchColumns, csvCell, MAX_BATCH_FILE_BYTES, MAX_BATCH_ROWS } from './batchCsv.js'
import './BatchScreening.css'

const counts = new Intl.NumberFormat()
const pageSize = 50
const outcomes = {
  EMERGENCY_REFERRAL: 'Emergency referral',
  PROMPT_ASSESSMENT: 'Prompt assessment',
  ROUTINE_ASSESSMENT: 'Routine assessment',
  incomplete: 'Assessment incomplete',
  error: 'Input error',
}

function downloadCsv(name, headings, rows) {
  const contents = [headings, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', contents, '\r\n'], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadResults(rows, version) {
  downloadCsv('fym-batch-results.csv', [
    'record_id', 'csv_line', 'model_version', 'malnutrition_risk_percent', 'predicted_class',
    'clinical_priority', 'muac', 'whz', 'bilateral_pitting_oedema', 'danger_signs',
    'recommendation', 'known_outcome', 'input_error', 'research_disclaimer',
  ], rows.map(row => [
    row.recordId, row.line, version, row.risk, row.predicted,
    row.priority, row.findings?.muac, row.findings?.whz, row.findings?.oedema,
    row.findings?.dangerSigns, row.recommendation, row.actual, row.error,
    'Research prototype only. Not clinically validated. Does not replace professional assessment.',
  ]))
}

function resultRow(row, assessment) {
  const { recordId, line, actual } = row
  const error = row.error || assessment?.error
  if (error) return { recordId, line, priority: 'error', error }
  const clinical = assessment.clinicalAssessment
  return {
    recordId, line, actual,
    risk: Number((assessment.screening.malnutritionProbability * 100).toFixed(2)),
    predicted: assessment.screening.predictedClass,
    priority: clinical.priority ?? 'incomplete',
    findings: clinical.findings,
    recommendation: clinical.recommendation,
  }
}

function summarize(rows) {
  const priorities = Object.fromEntries(Object.keys(outcomes).map(key => [key, 0]))
  const labels = { caught: 0, missed: 0, falseFlags: 0, correctlyUnflagged: 0 }
  for (const row of rows) {
    priorities[row.priority] += 1
    if (!row.actual) continue
    const actual = row.actual !== 'Normal'
    const flagged = row.predicted !== 'Normal'
    if (actual) labels[flagged ? 'caught' : 'missed'] += 1
    else labels[flagged ? 'falseFlags' : 'correctlyUnflagged'] += 1
  }
  return { priorities, labels }
}

function waitForRetry(seconds, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, seconds * 1000)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function ResultTable({ rows, version }) {
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)
  const { priorities, labels } = useMemo(() => summarize(rows), [rows])
  const filtered = useMemo(() => filter ? rows.filter(row => row.priority === filter) : rows, [rows, filter])
  const labelCount = Object.values(labels).reduce((total, value) => total + value, 0)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const displayed = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  return (
    <div className="batch-results">
      <section className="panel" aria-labelledby="batch-summary">
        <div className="panel-heading">
          <h2 id="batch-summary">Batch summary</h2>
          <p>{counts.format(rows.length - priorities.error)} screened · {counts.format(priorities.error)} input errors · Model {version}</p>
        </div>
        <div className="form-body">
          <dl className="batch-counts">
            {Object.entries(outcomes).map(([key, label]) => (
              <div key={key}><dt>{label}</dt><dd>{counts.format(priorities[key])}</dd></div>
            ))}
          </dl>
          {labelCount > 0 && (
            <div className="batch-labels">
              <h3>Known-outcome evaluation</h3>
              <p>{counts.format(labelCount)} screened records with known labels. A MAM or SAM model prediction counts as a flag.</p>
              <dl className="batch-counts">
                <div><dt>Malnutrition caught</dt><dd>{counts.format(labels.caught)}</dd></div>
                <div><dt>Malnutrition missed</dt><dd>{counts.format(labels.missed)}</dd></div>
                <div><dt>Normal cases flagged</dt><dd>{counts.format(labels.falseFlags)}</dd></div>
                <div><dt>Normal cases correctly unflagged</dt><dd>{counts.format(labels.correctlyUnflagged)}</dd></div>
              </dl>
            </div>
          )}
        </div>
      </section>
      <section className="panel" aria-labelledby="batch-rows">
        <div className="panel-heading"><h2 id="batch-rows">Individual results</h2></div>
        <div className="form-body batch-toolbar">
          <div className="field">
            <label htmlFor="batch-filter">Filter by priority</label>
            <select id="batch-filter" value={filter} onChange={event => {
              setFilter(event.target.value)
              setPage(0)
              setSelected(null)
            }}>
              <option value="">All results</option>
              {Object.entries(outcomes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <button type="button" className="button-secondary" onClick={() => downloadResults(rows, version)}>Download results CSV</button>
        </div>
        {selected && (
          <div className="form-body batch-detail" aria-live="polite">
            <h3>Record {selected.recordId || 'without an ID'} · CSV line {selected.line}</h3>
            <p>{selected.recommendation}</p>
            <ul className="clinical-findings">
              <li>MUAC · {selected.findings?.muac}</li>
              <li>WHZ · {selected.findings?.whz}</li>
              <li>Bilateral pitting oedema · {selected.findings?.oedema}</li>
              <li>Danger signs · {selected.findings?.dangerSigns}</li>
            </ul>
            <button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close details</button>
          </div>
        )}
        {displayed.length ? (
          <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Batch result rows">
            <table className="decision-table">
              <thead><tr><th scope="col">Record ID</th><th scope="col">CSV line</th><th scope="col">Model risk</th><th scope="col">Clinical priority</th><th scope="col">Recommendation or error</th></tr></thead>
              <tbody>
                {displayed.map(row => (
                  <tr key={row.line}>
                    <th scope="row">{row.recordId || '—'}</th>
                    <td>{row.line}</td>
                    <td>{row.risk === undefined ? '—' : `${row.risk.toFixed(2)}%`}</td>
                    <td>{outcomes[row.priority]}</td>
                    <td>{row.error || row.recommendation}
                      {!row.error && <button type="button" className="batch-details-button"
                        aria-label={`View findings for CSV line ${row.line}`} onClick={() => setSelected(row)}>View findings</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="form-body">No results match this filter.</p>}
        {pageCount > 1 && (
          <div className="form-actions batch-pages">
            <button className="button-secondary" type="button" disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span>Page {currentPage + 1} of {pageCount}</span>
            <button className="button-secondary" type="button" disabled={currentPage + 1 === pageCount}
              onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        )}
      </section>
    </div>
  )
}

export default function BatchScreening({ schema, checking, schemaError, onCheck, requestBatch }) {
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [snapshot, setSnapshot] = useState(null)
  const job = useRef(null)
  const worker = useRef(null)
  const controller = useRef(null)
  const inProgress = status === 'preparing' || status === 'running' || status === 'waiting'
  const ready = Boolean(Number.isInteger(schema?.batchMaxCases) && schema.batchMaxCases > 0 &&
    schema.modelVersion && Array.isArray(schema.dangerSigns) && !checking && !schemaError)

  useEffect(() => () => {
    worker.current?.terminate()
    controller.current?.abort()
    controller.current = null
  }, [])

  async function runBatch(current) {
    const request = new AbortController()
    controller.current = request
    const { signal } = request
    setStatus('running')
    setError('')
    try {
      while (current.next < current.rows.length) {
        signal.throwIfAborted()
        const chunk = current.rows.slice(current.next, current.next + current.limit)
        const cases = chunk.filter(row => !row.error).map(row => row.payload)
        let results = []
        if (cases.length) {
          const body = JSON.stringify({ modelVersion: current.version, cases })
          let response
          try {
            response = await requestBatch(body, signal)
          } catch (failure) {
            if (failure.status !== 429) throw failure
            const seconds = Math.min(120, Math.max(1, failure.retryAfter || 60))
            setStatus('waiting')
            await waitForRetry(seconds, signal)
            setStatus('running')
            response = await requestBatch(body, signal)
          }
          if (response.versions?.model !== current.version || !Array.isArray(response.results) ||
              response.results.length !== cases.length) {
            throw new Error('The assessment service returned an incomplete batch response.')
          }
          results = response.results
        }
        signal.throwIfAborted()
        let resultIndex = 0
        current.results.push(...chunk.map(row => resultRow(row, row.error ? null : results[resultIndex++])))
        current.next += chunk.length
        setProgress({ done: current.next, total: current.rows.length })
      }
      if (controller.current === request) setStatus('complete')
    } catch (failure) {
      if (controller.current === request) {
        setStatus(failure.status === 409 ? 'stale' : 'paused')
        if (!signal.aborted) setError(failure.message)
      }
    } finally {
      if (controller.current === request) {
        setSnapshot({ rows: [...current.results], version: current.version })
        controller.current = null
      }
    }
  }

  function startBatch(event) {
    event.preventDefault()
    if (!file || !ready || inProgress || controller.current || worker.current) return
    if (file.size > MAX_BATCH_FILE_BYTES) {
      setError('Choose a CSV file of 10 MB or less.')
      return
    }
    job.current = null
    setSnapshot(null)
    setProgress({ done: 0, total: 0 })
    setError('')
    setStatus('preparing')
    const parser = new Worker(new URL('./batchCsv.worker.js', import.meta.url), { type: 'module' })
    worker.current = parser
    function parsed({ rows, error: parseError }) {
      if (worker.current !== parser) return
      parser.terminate()
      worker.current = null
      if (parseError) {
        setError(parseError)
        setStatus('idle')
        return
      }
      const current = { rows, results: [], next: 0, version: schema.modelVersion, limit: schema.batchMaxCases }
      job.current = current
      setProgress({ done: 0, total: rows.length })
      runBatch(current)
    }
    parser.onmessage = event => parsed(event.data)
    parser.onerror = () => parsed({ error: 'The CSV could not be read.' })
    parser.postMessage({ file, schema })
  }

  return (
    <>
      <div className="intro">
        <h1>Batch screening</h1>
        <p>Upload a CSV to screen multiple research records and download the results.</p>
      </div>
      <section className="panel" aria-labelledby="batch-upload">
        <div className="panel-heading">
          <h2 id="batch-upload">Upload a dataset</h2>
          <p>Use approved research data and non-identifying record IDs. Keep this tab open. The file and results are held in memory until you close or refresh it.</p>
        </div>
        <form className="form-body batch-upload" onSubmit={startBatch}>
          {(!ready && !inProgress) && (
            <div>
              <p>{schemaError || (schema ? 'The service does not yet support batch screening.' : 'Check the assessment service to load the CSV template.')}</p>
              <button className="button-secondary" type="button" disabled={checking} onClick={onCheck}>
                {checking ? 'Checking service…' : 'Check service'}
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor="batch-file">CSV file</label>
            <input id="batch-file" type="file" accept=".csv,text/csv" required disabled={inProgress}
              onChange={event => setFile(event.target.files[0] ?? null)} />
            <p>Up to {counts.format(MAX_BATCH_ROWS)} records and 10 MB. Use <code>record_id</code>, <code>b19</code> for age in months, and <code>b4</code> for sex. Other model inputs and clinical findings are optional.</p>
          </div>
          {ready && (
            <details className="batch-format">
              <summary>CSV field instructions</summary>
              <p>Use model field codes as column names and numeric survey codes or the displayed labels as values. Use millimetres for <code>muac_mm</code>, a number for <code>whz</code>, and yes or no for <code>oedema</code>.</p>
              <p>In <code>danger_signs</code>, use <code>none</code> when none were reported, or separate these codes with semicolons: {schema.dangerSigns.map(sign => sign.key).join(', ')}. Leave the field blank when unrecorded.</p>
              <p>For optional known-outcome evaluation, use <code>Normal</code>, <code>MAM</code>, or <code>SAM</code> in <code>nutrition_status</code>.</p>
            </details>
          )}
          <div className="batch-actions">
            <button className="button-primary" type="submit" disabled={!ready || !file || inProgress}>Run batch</button>
            <button className="button-secondary" type="button" disabled={!ready}
              onClick={() => downloadCsv('fym-batch-template.csv', batchColumns(schema), [])}>Download CSV template</button>
            {(status === 'running' || status === 'waiting') &&
              <button className="button-secondary" type="button" onClick={() => controller.current?.abort()}>Pause</button>}
            {status === 'paused' && (
              <button className="button-secondary" type="button" disabled={checking}
                onClick={() => { if (job.current && !controller.current) runBatch(job.current) }}>Resume batch</button>
            )}
          </div>
          {status === 'preparing' && <p role="status">Checking CSV rows…</p>}
          {progress.total > 0 && (
            <div className="batch-progress">
              <label htmlFor="batch-progress">Processed {counts.format(progress.done)} of {counts.format(progress.total)} records</label>
              <progress id="batch-progress" max={progress.total} value={progress.done} />
            </div>
          )}
          {status === 'waiting' && <p role="status">Waiting for the service limit to reset. The batch will resume automatically.</p>}
          {status === 'paused' && <p role="status">Batch paused. Resume to process the remaining records.</p>}
          {status === 'complete' && <p role="status">Batch complete.</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      </section>
      {snapshot?.rows.length > 0 && <ResultTable rows={snapshot.rows} version={snapshot.version} />}
      <p className="batch-note">Research prototype only. Not clinically validated. Does not replace professional assessment.</p>
    </>
  )
}
