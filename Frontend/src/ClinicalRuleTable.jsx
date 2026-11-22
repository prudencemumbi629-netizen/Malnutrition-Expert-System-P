import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Bump this version when the criteria, decisions, or sources change.
const rulesetVersion = 'draft-v1'
const validationFields = 'rule_id, validated_at'

const sources = {
  who: {
    label: 'WHO guideline, 2023',
    url: 'https://www.who.int/publications/i/item/9789240082830',
  },
  implementation: {
    label: 'WHO implementation guidance, 2026',
    url: 'https://www.who.int/publications/i/item/9789240122840',
  },
}

const rules = [
  {
    id: 'infants-under-six-months',
    pathway: 'Infants under 6 months',
    criteria: 'Risk of poor growth or development. Review growth history, feeding, oedema, and clinical signs.',
    decision: 'Define infant-specific assessment and referral criteria.',
    source: sources.implementation,
  },
  {
    id: 'wasting-or-oedema',
    pathway: 'Wasting or nutritional oedema, 6–59 months',
    criteria: 'Verified weight-for-height or weight-for-length, mid-upper arm circumference, and bilateral pitting oedema.',
    decision: 'Approve measurement boundaries, eligibility, and how to resolve discordant findings.',
    source: sources.who,
  },
  {
    id: 'referral-and-care-setting',
    pathway: 'Referral and care setting, 6–59 months',
    criteria: 'Review danger signs, medical complications, oedema severity, and appetite when applicable.',
    decision: 'Approve escalation precedence and the findings required to distinguish referral pathways.',
    source: sources.implementation,
  },
  {
    id: 'incomplete-observations',
    pathway: 'Missing or conflicting findings',
    criteria: 'A required observation is missing, unverified, outside eligibility, or conflicts with another finding.',
    decision: 'Define when priority stays pending and which findings require verification.',
    source: sources.who,
  },
]

export default function ClinicalRuleTable() {
  const [review, setReview] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [savingRuleId, setSavingRuleId] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [feedback, setFeedback] = useState('')
  const canValidate = review?.member?.can_validate_clinical_rules === true

  useEffect(() => {
    if (!supabase) return
    const controller = new AbortController()
    const { signal } = controller

    async function loadReview() {
      try {
        const [membership, validations] = await Promise.all([
          supabase.from('demo_members').select('can_validate_clinical_rules').abortSignal(signal).maybeSingle(),
          supabase.from('clinical_rule_validations').select(validationFields)
            .eq('ruleset_version', rulesetVersion).abortSignal(signal),
        ])
        if (membership.error || validations.error) throw membership.error || validations.error
        if (!signal.aborted) setReview({
          member: membership.data,
          validations: Object.fromEntries(validations.data.map(row => [row.rule_id, row.validated_at])),
        })
      } catch {
        if (!signal.aborted) setLoadError(true)
      }
    }

    loadReview()
    return () => controller.abort()
  }, [attempt])

  async function validateRule(rule) {
    if (!canValidate || savingRuleId || review.validations[rule.id]) return
    setSavingRuleId(rule.id)
    setSaveError('')
    setFeedback('')
    try {
      let { data, error } = await supabase.from('clinical_rule_validations')
        .insert({ ruleset_version: rulesetVersion, rule_id: rule.id })
        .select(validationFields).single()
      if (error?.code === '23505') {
        ({ data, error } = await supabase.from('clinical_rule_validations').select(validationFields)
          .eq('ruleset_version', rulesetVersion).eq('rule_id', rule.id).single())
      }
      if (error) throw error
      setReview(current => ({
        ...current,
        validations: { ...current.validations, [rule.id]: data.validated_at },
      }))
      setFeedback(`Validation recorded for ${rule.pathway}.`)
    } catch {
      setSaveError(`Could not record validation for ${rule.pathway}. Check your access and try again.`)
    } finally {
      setSavingRuleId(null)
    }
  }

  return (
    <>
      <div className="intro">
        <h1>Clinical decision table</h1>
        <p>Review the proposed criteria and responses for the research prototype.</p>
      </div>
      <section className="panel" aria-labelledby="clinical-review-heading">
        <div className="panel-heading">
          <h2 id="clinical-review-heading">Rules for review</h2>
          <p>Draft rules are inactive.</p>
          <p>Validation records an admin’s review of this rule version. Clinical validation of the research system requires a separate evaluation.</p>
          {canValidate && <p>Check the criteria, response, and reference before validating a rule.</p>}
          {!supabase && <p>Sign in to the hosted workspace to view validation records.</p>}
          {supabase && !review && !loadError && <p role="status">Loading validation records…</p>}
          {review && !review.member && <p>Validation records are available to research workspace members.</p>}
          {loadError && (
            <div>
              <p className="error" role="alert">Could not load validation records.</p>
              <button className="button-secondary" type="button" onClick={() => {
                setLoadError(false)
                setAttempt(current => current + 1)
              }}>Retry</button>
            </div>
          )}
          {saveError && <p className="error" role="alert">{saveError}</p>}
          {feedback && <p role="status">{feedback}</p>}
        </div>
        <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Research clinical decision table">
          <table className="decision-table">
            <thead>
              <tr>
                <th scope="col">Pathway</th>
                <th scope="col">Findings to review</th>
                <th scope="col">Proposed response</th>
                <th scope="col">Clinical reference</th>
                <th scope="col">Validation · {rulesetVersion}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => {
                const validatedAt = review?.validations[rule.id]
                return (
                  <tr key={rule.id}>
                    <th scope="row">{rule.pathway}</th>
                    <td>{rule.criteria}</td>
                    <td>{rule.decision}</td>
                    <td><a href={rule.source.url}>{rule.source.label}</a></td>
                    <td>
                      {validatedAt ? (
                        <>Validated <time dateTime={validatedAt}>{new Date(validatedAt).toLocaleDateString()}</time></>
                      ) : (
                        <>
                          <span>{review?.member ? 'Awaiting validation' : '—'}</span>
                          {canValidate && (
                            <div className="rule-validation-action">
                              <button className="button-secondary" type="button" disabled={Boolean(savingRuleId)}
                                aria-label={`Validate rule for ${rule.pathway}`} onClick={() => validateRule(rule)}>
                                {savingRuleId === rule.id ? 'Saving…' : 'Validate rule'}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
