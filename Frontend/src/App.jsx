import { useEffect, useEffectEvent, useState } from 'react'
import Access from './Access.jsx'
import ClinicalRuleTable from './ClinicalRuleTable.jsx'
import { hostedMode, publishableKey, supabaseUrl } from './supabase.js'
import './App.css'

const clinicalMeasurements = ['whz', 'muacCm']
const whzOptions = Array.from({ length: 121 }, (_, index) => ((index - 60) / 10).toFixed(1))

const classes = [
  ['Normal', 'Normal'],
  ['MAM', 'Moderate acute malnutrition'],
  ['SAM', 'Severe acute malnutrition'],
]

async function api(path, options, accessToken) {
  const url = accessToken ? new URL('/functions/v1/assess', supabaseUrl) : '/api/' + path
  const headers = new Headers(options?.headers)
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
    headers.set('apikey', publishableKey)
  }
  const response = await fetch(url, { ...options, headers })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) {
    const detail = [body?.error, body?.message, body?.detail].find(value => typeof value === 'string')
    throw new Error(detail || 'The assessment service is unavailable. Try again in a moment.')
  }
  return body
}

function Predictor({ feature, value, onChange, disabled }) {
  const id = 'predictor-' + feature.key
  const shared = {
    id, value, onChange: event => onChange(event.target.value),
    required: feature.required, disabled,
  }

  return (
    <div className="field">
      <label htmlFor={id}>{feature.label}{feature.required && <span className="required" aria-hidden="true"> *</span>}</label>
      {feature.type === 'category' ? (
        <select {...shared}>
          <option value="">Select an option</option>
          {feature.options?.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input {...shared} type="number" step="1" min={feature.min ?? undefined} max={feature.max ?? undefined} inputMode="numeric" placeholder="Enter a value" />
      )}
    </div>
  )
}

function OutputSection({ title, data, children }) {
  return (
    <section className="output-section">
      <div className="output-section-heading">
        <h3>{title}</h3>
      </div>
      {children}
      {data?.message && <p>{data.message}</p>}
    </section>
  )
}

function AssessmentResults({ result, findings, busy }) {
  const screening = result?.screening
  const assessment = result?.clinicalAssessment
  const { MAM, SAM } = screening?.scores ?? {}
  const malnutritionScore = Number.isFinite(MAM) && Number.isFinite(SAM) ? MAM + SAM : null

  return (
    <aside className="panel results" aria-labelledby="results-title" aria-busy={busy}>
      <div className="panel-heading">
        <p className="kicker">Assessment output</p>
        <h2 id="results-title">Case results</h2>
        <p>Model screening, clinical assessment, and pharmacy guidance are shown separately.</p>
      </div>
      <div aria-live="polite">
        {!result ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true"><i /><i /><i /></div>
            <h3>{busy ? 'Running screening' : 'No assessment yet'}</h3>
            <p>{busy ? 'Waiting for the assessment service.' : 'Complete the screening inputs and submit the form to see the result here.'}</p>
          </div>
        ) : (
          <>
            <OutputSection title="Model screening">
              <p className="prediction">{classes.find(([key]) => key === screening?.predictedClass)?.[1] || 'Screening result unavailable'}</p>
              {malnutritionScore !== null && (
                <p>Acute malnutrition model score (MAM + SAM) <strong>{(malnutritionScore * 100).toFixed(1)}%</strong></p>
              )}
              {screening?.scores && (
                <ul className="score-list" aria-label="Model scores">
                  {classes.map(([key, label]) => {
                    const score = screening.scores[key]
                    return Number.isFinite(score) && score >= 0 && score <= 1 && (
                      <li key={key}>
                        <div><span>{label}</span><strong>{(score * 100).toFixed(1)}%</strong></div>
                        <meter min={0} max={1} value={score} aria-label={label} />
                      </li>
                    )
                  })}
                </ul>
              )}
              <p>Research model scores are uncalibrated.</p>
              {result.versions?.model && <p className="version">Model {result.versions.model}</p>}
            </OutputSection>
            <OutputSection title="Clinical assessment" data={assessment}>
              {assessment?.status && <span className="status-label">{formatStatus(assessment.status)}</span>}
              <p><strong>Assessment priority</strong> · {assessment?.priority || (assessment?.status === 'assessment_pending'
                ? 'Assessment pending' : 'Pending clinical rule review')}</p>
              <h4>Recorded clinical findings</h4>
              <ul className="clinical-findings">
                <li>Weight-for-height z-score · {findings?.whz ?? 'Not recorded'}</li>
                <li>Mid-upper arm circumference · {findings?.muacCm == null ? 'Not recorded' : `${findings.muacCm} cm`}</li>
                <li>Nutritional oedema · {findings?.oedema == null ? 'Not recorded' : findings.oedema ? 'Recorded present' : 'Recorded absent'}</li>
              </ul>
              <p><strong>Recommendations</strong> · {assessment?.recommendation || 'Pending clinical rule review'}</p>
              {assessment?.ruleVersion && <p className="version">Clinical rules {assessment.ruleVersion}</p>}
            </OutputSection>
            <OutputSection title="Pharmacy guidance" data={result.pharmacyGuidance}>
              {result.pharmacyGuidance?.status && <span className="status-label">{formatStatus(result.pharmacyGuidance.status)}</span>}
              {Array.isArray(result.pharmacyGuidance?.alerts) && result.pharmacyGuidance.alerts.length > 0 && (
                <ul className="alerts">
                  {result.pharmacyGuidance.alerts.map((alert, index) => (
                    <li key={alert?.id || index}>
                      {typeof alert === 'string' ? alert : [alert?.message, alert?.rationale, alert?.nextStep].filter(value => typeof value === 'string').join(' ')}
                    </li>
                  ))}
                </ul>
              )}
            </OutputSection>
          </>
        )}
      </div>
    </aside>
  )
}

function formatStatus(status) {
  return typeof status === 'string' ? status.replace(/[_-]/g, ' ') : ''
}

function WorkspaceOverview({ hosted, checking, checkedAt, schema, schemaError, result, busy, onWake }) {
  const serviceStatus = checking ? (hosted ? 'Waking or checking' : 'Connecting')
    : schemaError ? 'Unavailable' : schema ? 'Ready at last check' : 'Not checked'
  const statusTone = checking ? 'pending' : schemaError ? 'error' : schema ? 'ready' : 'idle'

  return (
    <section className="overview" aria-label="Workspace overview">
      <div className="panel overview-card">
        <h2>{hosted ? 'Render inference' : 'Local inference'}</h2>
        <div aria-live="polite">
          <p className={`service-badge service-badge--${statusTone}`}>{serviceStatus}</p>
          {checkedAt && <p className="overview-detail">Last checked at {checkedAt.toLocaleTimeString()}</p>}
          {schemaError && <p className="overview-detail">{schemaError}</p>}
        </div>
        {hosted && <p className="overview-detail">Render Free can sleep when idle. Starting it can take about a minute.</p>}
        <button className="button-secondary" type="button" onClick={onWake} disabled={checking || busy}>
          {checking ? 'Checking service…' : hosted ? 'Wake Render' : 'Check connection'}
        </button>
      </div>
      <div className="panel overview-card">
        <h2>Screening model</h2>
        <p className="overview-value">{schema?.modelVersion || 'Awaiting service check'}</p>
        {schema && <p className="overview-detail">{schema.features.length} screening inputs</p>}
      </div>
      <div className="panel overview-card">
        <h2>Current case</h2>
        <p className="overview-value">{busy ? 'Screening in progress' : result ? 'Assessment complete' : 'No assessment yet'}</p>
        <a href={result ? '#results-title' : '#case-title'}>{result ? 'View case results' : 'Go to screening inputs'}</a>
      </div>
    </section>
  )
}

function ScreeningWorkspace({ accessToken, signOut, signOutError }) {
  const hosted = Boolean(accessToken)
  const [clinicalPage, setClinicalPage] = useState(() => window.location.hash === '#clinical-rules')
  const [schema, setSchema] = useState(null)
  const [schemaError, setSchemaError] = useState('')
  const [schemaAttempt, setSchemaAttempt] = useState(hosted ? 0 : 1)
  const [checking, setChecking] = useState(!hosted)
  const [checkedAt, setCheckedAt] = useState(null)
  const [inputs, setInputs] = useState({})
  const [clinical, setClinical] = useState({})
  const [medications, setMedications] = useState('')
  const [result, setResult] = useState(null)
  const [submittedFindings, setSubmittedFindings] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loadSchema = useEffectEvent(signal => api('schema', { signal }, accessToken))

  useEffect(() => {
    function onNavigation() {
      if (window.location.hash === '#main-content') return
      setClinicalPage(window.location.hash === '#clinical-rules')
    }
    window.addEventListener('hashchange', onNavigation)
    return () => window.removeEventListener('hashchange', onNavigation)
  }, [])

  useEffect(() => {
    if (!schemaAttempt) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)])
    loadSchema(signal).then(data => {
      if (!Array.isArray(data.features) || data.features.length === 0) {
        throw new Error('The service did not provide a screening input schema.')
      }
      if (!controller.signal.aborted) {
        setSchema(data)
        setSchemaError('')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setSchemaError(signal.aborted ? 'The service did not respond in time.' : failure.message)
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setCheckedAt(new Date())
        setChecking(false)
      }
    })
    return () => controller.abort()
  }, [schemaAttempt])

  function checkService() {
    setChecking(true)
    setSchemaError('')
    setSchemaAttempt(attempt => attempt + 1)
  }

  function reset() {
    setInputs({})
    setClinical({})
    setMedications('')
    setResult(null)
    setSubmittedFindings(null)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || checking || schemaError || !schema) return
    const screeningInputs = Object.fromEntries(
      schema.features.filter(({ key }) => inputs[key] !== undefined && inputs[key] !== '')
        .map(({ key }) => [key, Number(inputs[key])]),
    )
    const clinicalInputs = Object.fromEntries(
      clinicalMeasurements.filter(key => clinical[key] !== undefined && clinical[key] !== '')
        .map(key => [key, Number(clinical[key])]),
    )
    if (clinical.oedema) clinicalInputs.oedema = clinical.oedema === 'yes'
    const medicationList = medications.split(',').map(name => name.trim()).filter(Boolean)
    const payload = { screeningInputs }
    if (Object.keys(clinicalInputs).length) payload.clinicalInputs = clinicalInputs
    if (medicationList.length) payload.medicationContext = { medications: medicationList }

    setBusy(true)
    setError('')
    setResult(null)
    setSubmittedFindings(clinicalInputs)
    try {
      setResult(await api('assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, accessToken))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand"><span className="brand-mark" aria-hidden="true">+</span> Project FYM</div>
          <div className="header-actions">
            {signOut && <button className="button-secondary" onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </header>
      <div className="workspace-shell">
        <nav className="workspace-nav" aria-label="Workspace">
          <a href="#screening" aria-current={!clinicalPage ? 'page' : undefined}>Screening</a>
          <a href="#clinical-rules" aria-current={clinicalPage ? 'page' : undefined}>Clinical decision table</a>
        </nav>
      <main className="workspace" id="main-content" tabIndex={-1}>
        {signOutError && <p className="error" role="alert">{signOutError}</p>}
        {clinicalPage ? <ClinicalRuleTable /> : <>
        <div className="intro" id="screening">
          <p className="kicker">Kenya · Under five</p>
          <h1>Acute malnutrition screening</h1>
          <p>Review model screening and available clinical context for a research case.</p>
        </div>
        <WorkspaceOverview hosted={hosted} checking={checking} checkedAt={checkedAt}
          schema={schemaError ? null : schema} schemaError={schemaError} result={result} busy={busy} onWake={checkService} />
        <div className="workspace-grid">
          <section className="panel" aria-labelledby="case-title">
            <div className="panel-heading">
              <p className="kicker">Case information</p>
              <h2 id="case-title">Screening inputs</h2>
              <p>Use values from an approved research case. Fields marked * are required.</p>
            </div>
            {!schema ? (
              <p className="form-body" role="status">{checking ? 'Waiting for screening inputs…'
                : hosted ? 'Use Wake Render to load the screening inputs.' : 'Check the local service to load the screening inputs.'}</p>
            ) : (
              <form onSubmit={submit}>
                <div className="form-body">
                  <div className="fields">
                    {schema.features.map(feature => (
                      <Predictor feature={feature} key={feature.key} value={inputs[feature.key] ?? ''} disabled={busy}
                        onChange={value => setInputs(current => ({ ...current, [feature.key]: value }))} />
                    ))}
                  </div>
                  <details className="context">
                    <summary>Clinical findings <span>Optional</span></summary>
                    <div className="fields context-fields">
                      <div className="field">
                        <label htmlFor="whz-choice">Weight-for-height z-score</label>
                        <select id="whz-choice" disabled={busy} value={clinical.whzChoice ?? ''} onChange={event => {
                          const choice = event.target.value
                          setClinical(current => ({ ...current, whzChoice: choice, whz: choice === 'exact' ? '' : choice }))
                        }}>
                          <option value="">Not recorded</option>
                          <option value="exact">Enter exact score</option>
                          {whzOptions.map(score => <option key={score} value={score}>{score}</option>)}
                        </select>
                      </div>
                      {clinical.whzChoice === 'exact' && (
                        <div className="field">
                          <label htmlFor="whz-exact">Exact weight-for-height z-score</label>
                          <input id="whz-exact" type="number" step="any" required disabled={busy} value={clinical.whz}
                            onChange={event => setClinical(current => ({ ...current, whz: event.target.value }))} />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor="muacCm">Mid-upper arm circumference (cm)</label>
                        <input id="muacCm" type="number" step="any" disabled={busy} value={clinical.muacCm ?? ''}
                          onChange={event => setClinical(current => ({ ...current, muacCm: event.target.value }))} />
                      </div>
                      <div className="field">
                        <label htmlFor="oedema">Nutritional oedema recorded</label>
                        <select id="oedema" disabled={busy} value={clinical.oedema ?? ''} onChange={event => setClinical(current => ({ ...current, oedema: event.target.value }))}>
                          <option value="">Not recorded</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>
                    </div>
                  </details>
                  <details className="context">
                    <summary>Medication context <span>Optional</span></summary>
                    <div className="field context-fields">
                      <label htmlFor="medications">Recorded medications</label>
                      <input id="medications" disabled={busy} value={medications} onChange={event => setMedications(event.target.value)} aria-describedby="medication-help" />
                      <p id="medication-help">Separate medication names with commas.</p>
                    </div>
                  </details>
                  {error && <p className="error" role="alert">{error}</p>}
                </div>
                <div className="form-actions">
                  <button className="button-primary" type="submit" disabled={busy || checking || Boolean(schemaError)}>{busy ? 'Running screening…' : 'Run screening'}</button>
                  <button className="button-secondary" type="button" onClick={reset} disabled={busy}>Clear form</button>
                </div>
              </form>
            )}
          </section>
          <AssessmentResults result={result} findings={submittedFindings} busy={busy} />
        </div>
        </>}
        <footer>Project FYM · Research prototype · Clinical decisions require qualified review.</footer>
      </main>
      </div>
    </>
  )
}

export default function App() {
  if (!hostedMode) return <ScreeningWorkspace />
  return (
    <Access>
      {(session, signOut, signOutError) => (
        <ScreeningWorkspace key={session.user.id} accessToken={session.access_token}
          signOut={signOut} signOutError={signOutError} />
      )}
    </Access>
  )
}
