import { useEffect, useState } from 'react'
import Access from './Access.jsx'
import { hostedMode, publishableKey, supabaseUrl } from './supabase.js'
import './App.css'

const clinicalFields = [
  { key: 'whz', label: 'Weight-for-height z-score', step: 'any' },
  { key: 'muacCm', label: 'Mid-upper arm circumference (cm)', step: 'any' },
]

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

function AssessmentResults({ result, busy }) {
  const screening = result?.screening

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
            <OutputSection title="Clinical assessment" data={result.clinicalAssessment}>
              {result.clinicalAssessment?.status && <span className="status-label">{formatStatus(result.clinicalAssessment.status)}</span>}
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

function ScreeningWorkspace({ accessToken, signOut, signOutError }) {
  const [schema, setSchema] = useState(null)
  const [schemaError, setSchemaError] = useState('')
  const [schemaAttempt, setSchemaAttempt] = useState(0)
  const [inputs, setInputs] = useState({})
  const [clinical, setClinical] = useState({})
  const [medications, setMedications] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api('schema', { signal: controller.signal }, accessToken).then(data => {
      if (!Array.isArray(data.features) || data.features.length === 0) {
        throw new Error('The service did not provide a screening input schema.')
      }
      if (!controller.signal.aborted) {
        setSchema(data)
        setSchemaError('')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setSchemaError(failure.message)
    })
    return () => controller.abort()
  }, [accessToken, schemaAttempt])

  function reset() {
    setInputs({})
    setClinical({})
    setMedications('')
    setResult(null)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !schema) return
    const screeningInputs = Object.fromEntries(
      schema.features.filter(({ key }) => inputs[key] !== undefined && inputs[key] !== '')
        .map(({ key }) => [key, Number(inputs[key])]),
    )
    const clinicalInputs = Object.fromEntries(
      clinicalFields.filter(({ key }) => clinical[key] !== undefined && clinical[key] !== '')
        .map(({ key }) => [key, Number(clinical[key])]),
    )
    if (clinical.oedema) clinicalInputs.oedema = clinical.oedema === 'yes'
    const medicationList = medications.split(',').map(name => name.trim()).filter(Boolean)
    const payload = { screeningInputs }
    if (Object.keys(clinicalInputs).length) payload.clinicalInputs = clinicalInputs
    if (medicationList.length) payload.medicationContext = { medications: medicationList }

    setBusy(true)
    setError('')
    setResult(null)
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
            <span className="service-state">{schemaError ? 'Service unavailable' : schema ? 'Screening service ready' : 'Connecting to service'}</span>
            {signOut && <button className="button-secondary" onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </header>
      <main className="workspace" id="main-content">
        {signOutError && <p className="error" role="alert">{signOutError}</p>}
        <div className="intro">
          <p className="kicker">Kenya · Under five</p>
          <h1>Acute malnutrition screening</h1>
          <p>Review model screening and available clinical context for a research case.</p>
        </div>
        <div className="workspace-grid">
          <section className="panel" aria-labelledby="case-title">
            <div className="panel-heading">
              <p className="kicker">Case information</p>
              <h2 id="case-title">Screening inputs</h2>
              <p>Use values from an approved research case. Fields marked * are required.</p>
            </div>
            {schemaError ? (
              <div className="form-body">
                <p className="error" role="alert">{schemaError}</p>
                <button className="button-secondary" onClick={() => { setSchemaError(''); setSchemaAttempt(attempt => attempt + 1) }}>Retry connection</button>
              </div>
            ) : !schema ? (
              <p className="form-body" role="status">Loading screening inputs…</p>
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
                      {clinicalFields.map(({ key, label, step }) => (
                        <div className="field" key={key}>
                          <label htmlFor={key}>{label}</label>
                          <input type="number" step={step} id={key} disabled={busy} value={clinical[key] ?? ''} onChange={event => setClinical(current => ({ ...current, [key]: event.target.value }))} />
                        </div>
                      ))}
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
                  <button className="button-primary" type="submit" disabled={busy}>{busy ? 'Running screening…' : 'Run screening'}</button>
                  <button className="button-secondary" type="button" onClick={reset} disabled={busy}>Clear form</button>
                </div>
              </form>
            )}
          </section>
          <AssessmentResults result={result} busy={busy} />
        </div>
        <footer>Project FYM · Research prototype · Clinical decisions require qualified review.</footer>
      </main>
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
