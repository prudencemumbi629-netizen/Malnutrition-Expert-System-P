import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Access from './Access.jsx'
import BatchScreening from './BatchScreening.jsx'
import ClinicalRuleTable from './ClinicalRuleTable.jsx'
import ModelEvaluation from './ModelEvaluation.jsx'
import { hostedMode, publishableKey, supabase, supabaseUrl } from './supabase.js'
import './App.css'

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
    throw Object.assign(new Error(detail || 'The assessment service is unavailable. Try again in a moment.'), {
      status: response.status,
      retryAfter: Number(response.headers.get('Retry-After')),
    })
  }
  return body
}

async function requestBatch(body, signal) {
  let token
  if (hostedMode) {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session?.access_token) throw new Error('Sign in to resume the batch.')
    token = data.session.access_token
  }
  return api('batch-assess', {
    method: 'POST', body, signal, headers: { 'Content-Type': 'application/json' },
  }, token)
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

const priorities = {
  EMERGENCY_REFERRAL: { tone: 'red', label: 'Emergency referral', step: 2 },
  PROMPT_ASSESSMENT: { tone: 'amber', label: 'Prompt assessment', step: 1 },
  ROUTINE_ASSESSMENT: { tone: 'green', label: 'Routine assessment', step: 0 },
}

// MUAC bands follow the research ruleset on the Clinical decision table (6–59 months).
const tapeMin = 90
const tapeMax = 150
const tapePosition = mm => `${Math.min(100, Math.max(0, ((mm - tapeMin) / (tapeMax - tapeMin)) * 100))}%`

function MuacTape({ value }) {
  const mm = Number(value)
  const hasValue = value !== '' && Number.isFinite(mm) && mm > 0
  return (
    <div className="muac-tape" aria-hidden="true">
      <div className="muac-tape-band">
        <i className="muac-red" style={{ width: tapePosition(115) }} />
        <i className="muac-amber" style={{ width: `calc(${tapePosition(125)} - ${tapePosition(115)})` }} />
        <i className="muac-green" />
        {hasValue && <b className="muac-marker" style={{ left: tapePosition(mm) }} />}
      </div>
      <div className="muac-scale">
        <span style={{ left: tapePosition(115) }}>115</span>
        <span style={{ left: tapePosition(125) }}>125</span>
      </div>
    </div>
  )
}

function PriorityTape({ step }) {
  return (
    <div className="priority-tape" aria-hidden="true">
      {['green', 'amber', 'red'].map((tone, index) => (
        <i key={tone} className={`priority-${tone}${step === index ? ' is-active' : ''}`} />
      ))}
    </div>
  )
}

function ResultSection({ title, children }) {
  return (
    <section className="result-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function AssessmentResults({ result, busy, resultsRef }) {
  const screening = result?.screening
  const assessment = result?.clinicalAssessment
  const { MAM, SAM } = screening?.scores ?? {}
  const malnutritionScore = screening?.malnutritionProbability ??
    (Number.isFinite(MAM) && Number.isFinite(SAM) ? MAM + SAM : null)
  const findings = assessment?.findings
  const clinicalRulesAvailable = Boolean(assessment?.ruleVersion)
  const priority = priorities[assessment?.priority]
  const priorityLabel = priority?.label ||
    (clinicalRulesAvailable ? 'Assessment incomplete' : 'Clinical assessment unavailable')

  return (
    <aside className="results" id="case-results" aria-labelledby="results-title" aria-busy={busy} ref={resultsRef} tabIndex={-1}>
      <h2 id="results-title" className="results-title">Case results</h2>
      <div aria-live="polite">
        {!result ? (
          <div className="empty-state">
            <PriorityTape step={-1} />
            <h3>{busy ? 'Running screening' : 'No result yet'}</h3>
            <p>{busy ? 'Waiting for the assessment service.' : 'Record danger signs and measurements, then run the screening. The priority appears here.'}</p>
          </div>
        ) : (
          <>
            <section className={`priority priority--${priority?.tone ?? 'pending'}`}>
              <PriorityTape step={priority?.step ?? -1} />
              <p className="priority-label">{priorityLabel}</p>
              <p className="priority-action">{assessment?.recommendation || 'Clinical recommendation unavailable.'}</p>
            </section>
            <ResultSection title="What was recorded">
              <dl className="findings">
                <div><dt>MUAC</dt><dd>{findings?.muac ?? 'Interpretation unavailable.'}</dd></div>
                <div><dt>Weight-for-height</dt><dd>{findings?.whz ?? 'Interpretation unavailable.'}</dd></div>
                <div><dt>Oedema</dt><dd>{findings?.oedema ?? 'Interpretation unavailable.'}</dd></div>
                <div><dt>Danger signs</dt><dd>{findings?.dangerSigns ?? 'Interpretation unavailable.'}</dd></div>
              </dl>
              {assessment?.ruleVersion && <p className="version">Clinical rules {assessment.ruleVersion}</p>}
            </ResultSection>
            <ResultSection title="Model score">
              <p className="model-score">{malnutritionScore === null ? 'Screening result unavailable' : `${(malnutritionScore * 100).toFixed(1)}%`}</p>
              <p className="muted">Random Forest score for moderate or severe acute malnutrition. Research scores are uncalibrated, so use them for study only, not to decide care.</p>
              {screening?.scores && (
                <ul className="score-list" aria-label="Model scores">
                  {classes.map(([key, label]) => {
                    const score = screening.scores[key]
                    return Number.isFinite(score) && score >= 0 && score <= 1 && (
                      <li key={key}>
                        <div><span>{label}</span><strong>{(score * 100).toFixed(1)}%</strong></div>
                        <span className="score-bar" aria-hidden="true"><i style={{ width: `${score * 100}%` }} /></span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {result.versions?.model && <p className="version">Model {result.versions.model}</p>}
            </ResultSection>
            <p className="disclaimer">{result.researchDisclaimer || 'Research prototype only. Not clinically validated. This system does not replace professional assessment.'}</p>
          </>
        )}
      </div>
    </aside>
  )
}

function ServiceStatus({ hosted, checking, checkedAt, schema, schemaError, busy, onWake }) {
  const status = checking ? (hosted ? 'Waking service' : 'Connecting')
    : schemaError ? 'Service unavailable' : schema ? 'Service ready' : 'Service not checked'
  const tone = checking ? 'pending' : schemaError ? 'error' : schema ? 'ready' : 'idle'
  const title = schemaError || (checkedAt ? `Last checked at ${checkedAt.toLocaleTimeString()}` : undefined)

  return (
    <div className="service-status">
      <p className={`service-chip service-chip--${tone}`} role="status" title={title}>{status}</p>
      <button className="button-quiet" type="button" onClick={onWake} disabled={checking || busy}>
        {checking ? 'Checking…' : hosted ? 'Wake service' : 'Check connection'}
      </button>
    </div>
  )
}

function ScreeningWorkspace({ accessToken, signOut, signOutError }) {
  const hosted = Boolean(accessToken)
  const [page, setPage] = useState(() => workspacePage(window.location.hash))
  const [schema, setSchema] = useState(null)
  const [schemaError, setSchemaError] = useState('')
  const [schemaAttempt, setSchemaAttempt] = useState(hosted ? 0 : 1)
  const [checking, setChecking] = useState(!hosted)
  const [checkedAt, setCheckedAt] = useState(null)
  const [inputs, setInputs] = useState({})
  const [clinical, setClinical] = useState({})
  const [medications, setMedications] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loadSchema = useEffectEvent(signal => api('schema', { signal }, accessToken))
  const resultsRef = useRef(null)

  useEffect(() => {
    // When the layout is one column, the result is far below the form: bring it into view.
    if (!result || !window.matchMedia('(max-width: 900px)').matches) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultsRef.current?.focus({ preventScroll: true })
    resultsRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }, [result])

  useEffect(() => {
    function onNavigation() {
      if (window.location.hash === '#main-content') return
      setPage(workspacePage(window.location.hash))
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
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || checking || schemaError || !schema) return
    const screeningInputs = Object.fromEntries(
      schema.features.filter(({ key }) => inputs[key] !== undefined && inputs[key] !== '')
        .map(({ key }) => [key, Number(inputs[key])]),
    )
    const clinicalInputs = {}
    if (clinical.whz) clinicalInputs.whz = Number(clinical.whz)
    if (clinical.muacMm) clinicalInputs.muacCm = Number(clinical.muacMm) / 10
    if (clinical.oedema) clinicalInputs.oedema = clinical.oedema === 'yes'
    if (clinical.dangerSigns?.length || clinical.noDangerSigns) {
      clinicalInputs.dangerSigns = clinical.dangerSigns ?? []
    }
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

  const dangerReported = (clinical.dangerSigns?.length ?? 0) > 0
  const ageMonths = inputs.b19
  const tapeApplies = ageMonths === undefined || ageMonths === '' || (Number(ageMonths) >= 6 && Number(ageMonths) <= 59)
  const contextFeatures = schema?.features ?? []

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">Project FYM</div>
          <nav className="workspace-nav" aria-label="Workspace">
            <a href="#screening" aria-current={page === 'screening' ? 'page' : undefined}>Screening</a>
            <a href="#batch-screening" aria-current={page === 'batch-screening' ? 'page' : undefined}>Batch screening</a>
            <a href="#clinical-rules" aria-current={page === 'clinical-rules' ? 'page' : undefined}>Decision table</a>
            <a href="#model-evaluation" aria-current={page === 'model-evaluation' ? 'page' : undefined}>Model evaluation</a>
          </nav>
          <div className="header-actions">
            <ServiceStatus hosted={hosted} checking={checking} checkedAt={checkedAt} schema={schemaError ? null : schema}
              schemaError={schemaError} busy={busy} onWake={checkService} />
            {signOut && <button className="button-quiet" onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </header>
      <main className="workspace" id="main-content" tabIndex={-1}>
        {signOutError && <p className="error" role="alert">{signOutError}</p>}
        <div hidden={page !== 'batch-screening'}>
          <BatchScreening schema={schema} checking={checking} schemaError={schemaError}
            onCheck={checkService} requestBatch={requestBatch} />
        </div>
        {page === 'clinical-rules' && <ClinicalRuleTable />}
        {page === 'model-evaluation' && <ModelEvaluation hosted={hosted} />}
        {page === 'screening' && <>
        <div className="intro" id="screening">
          <h1>Screen a child under five</h1>
          <p>Record danger signs and measurements first. The priority comes from these clinical findings, and the model score is shown separately for research.</p>
        </div>
        <div className="workspace-grid">
          <section className="sheet" aria-labelledby="case-title">
            <h2 id="case-title" className="visually-hidden">Screening inputs</h2>
            {!schema ? (
              <div className="form-body" role="status">
                <p>{checking ? 'Waiting for screening inputs…'
                  : hosted ? 'Use Wake service to load the screening inputs.' : 'Check the connection to load the screening inputs.'}</p>
                {hosted && <p className="muted">Render Free can sleep when idle. Starting it can take about a minute.</p>}
                {schemaError && <p className="error" role="alert">{schemaError}</p>}
              </div>
            ) : (
              <form onSubmit={submit}>
                {schema.dangerSigns?.length > 0 && (
                  <fieldset className={`form-section danger-signs${dangerReported ? ' is-reported' : ''}`} disabled={busy}>
                    <legend>Emergency danger signs</legend>
                    <p className="section-hint">Ask about these first. Any danger sign means emergency care, whatever the measurements show.</p>
                    <div className="checks">
                      {schema.dangerSigns.map(({ key, label }) => (
                        <label className="check" key={key}>
                          <input type="checkbox" checked={clinical.dangerSigns?.includes(key) ?? false} onChange={event => {
                            const checked = event.target.checked
                            setClinical(current => {
                              const signs = current.dangerSigns ?? []
                              return {
                                ...current,
                                noDangerSigns: false,
                                dangerSigns: checked ? [...signs, key] : signs.filter(sign => sign !== key),
                              }
                            })
                          }} /> <span>{label}</span>
                        </label>
                      ))}
                      <label className="check check-none">
                        <input type="checkbox" checked={clinical.noDangerSigns ?? false} onChange={event => {
                          const checked = event.target.checked
                          setClinical(current => ({ ...current, noDangerSigns: checked, dangerSigns: [] }))
                        }} /> <span>None reported</span>
                      </label>
                    </div>
                    {dangerReported && (
                      <p className="danger-notice" role="status">Danger sign reported. Send the child for emergency care now; don’t wait for the screening result.</p>
                    )}
                  </fieldset>
                )}
                <fieldset className="form-section" disabled={busy}>
                  <legend>Measurements</legend>
                  <p className="section-hint">Optional, but the priority is incomplete without them.</p>
                  <div className="fields">
                    <div className="field field-wide">
                      <label htmlFor="muacMm">Mid-upper arm circumference (MUAC), mm</label>
                      <input id="muacMm" type="number" step="any" min="0.01" inputMode="decimal" value={clinical.muacMm ?? ''}
                        onChange={event => setClinical(current => ({ ...current, muacMm: event.target.value }))} />
                      {tapeApplies ? <MuacTape value={clinical.muacMm ?? ''} /> : <p className="hint">MUAC bands apply at 6–59 months.</p>}
                    </div>
                    <div className="field">
                      <label htmlFor="whz-choice">Weight-for-height z-score</label>
                      <select id="whz-choice" value={clinical.whzChoice ?? ''} onChange={event => {
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
                        <input id="whz-exact" type="number" step="any" required value={clinical.whz}
                          onChange={event => setClinical(current => ({ ...current, whz: event.target.value }))} />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="oedema">Bilateral pitting oedema</label>
                      <select id="oedema" value={clinical.oedema ?? ''} onChange={event => setClinical(current => ({ ...current, oedema: event.target.value }))}>
                        <option value="">Not recorded</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>
                </fieldset>
                <fieldset className="form-section" disabled={busy}>
                  <legend>Child and household</legend>
                  <p className="section-hint">The model uses these. Fields marked * are required.</p>
                  <div className="fields">
                    {contextFeatures.map(feature => (
                      <Predictor feature={feature} key={feature.key} value={inputs[feature.key] ?? ''} disabled={busy}
                        onChange={value => setInputs(current => ({ ...current, [feature.key]: value }))} />
                    ))}
                  </div>
                </fieldset>
                <details className="form-section context">
                  <summary>Medication context <span>Optional</span></summary>
                  <div className="field context-fields">
                    <label htmlFor="medications">Recorded medications</label>
                    <input id="medications" disabled={busy} value={medications} onChange={event => setMedications(event.target.value)} aria-describedby="medication-help" />
                    <p id="medication-help" className="hint">Separate medication names with commas.</p>
                  </div>
                </details>
                {error && <p className="error" role="alert">{error}</p>}
                <div className="form-actions">
                  <button className="button-primary" type="submit" disabled={busy || checking || Boolean(schemaError)}>{busy ? 'Running screening…' : 'Run screening'}</button>
                  <button className="button-secondary" type="button" onClick={reset} disabled={busy}>Clear form</button>
                </div>
              </form>
            )}
          </section>
          <AssessmentResults result={result} busy={busy} resultsRef={resultsRef} />
        </div>
        </>}
        <footer>Project FYM is a research prototype. Clinical decisions require qualified review.</footer>
      </main>
    </>
  )
}

function workspacePage(hash) {
  if (['#batch-screening', '#clinical-rules', '#model-evaluation'].includes(hash)) return hash.slice(1)
  return 'screening'
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
