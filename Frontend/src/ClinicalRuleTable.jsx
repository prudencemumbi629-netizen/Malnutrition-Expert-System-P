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

const draftRules = [
  {
    pathway: 'Infants under 6 months',
    criteria: 'Risk of poor growth or development. Review growth history, feeding, oedema, and clinical signs.',
    decision: 'Define infant-specific assessment and referral criteria.',
    source: sources.implementation,
  },
  {
    pathway: 'Wasting or nutritional oedema, 6–59 months',
    criteria: 'Verified weight-for-height or weight-for-length, mid-upper arm circumference, and bilateral pitting oedema.',
    decision: 'Approve measurement boundaries, eligibility, and how to resolve discordant findings.',
    source: sources.who,
  },
  {
    pathway: 'Referral and care setting, 6–59 months',
    criteria: 'Review danger signs, medical complications, oedema severity, and appetite when applicable.',
    decision: 'Approve escalation precedence and the findings required to distinguish referral pathways.',
    source: sources.implementation,
  },
  {
    pathway: 'Missing or conflicting findings',
    criteria: 'A required observation is missing, unverified, outside eligibility, or conflicts with another finding.',
    decision: 'Define when priority stays pending and which findings require verification.',
    source: sources.who,
  },
]

export default function ClinicalRuleTable() {
  return (
    <>
      <div className="intro">
        <h1>Clinical decision table</h1>
        <p>Review the findings and decisions that need to be defined before the app can assign a clinical priority.</p>
      </div>
      <section className="panel" aria-labelledby="clinical-review-heading">
        <div className="panel-heading">
          <h2 id="clinical-review-heading">Rules for review</h2>
          <p>Draft rules are inactive. A clinical reviewer must approve priorities, triggering criteria, and recommended actions before release.</p>
        </div>
        <div className="decision-table-scroll" tabIndex={0} role="region" aria-label="Draft clinical decision table">
          <table className="decision-table">
            <thead>
              <tr>
                <th scope="col">Pathway</th>
                <th scope="col">Findings to review</th>
                <th scope="col">Decision to approve</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {draftRules.map(rule => (
                <tr key={rule.pathway}>
                  <th scope="row">{rule.pathway}</th>
                  <td>{rule.criteria}</td>
                  <td>{rule.decision}</td>
                  <td><a href={rule.source.url}>{rule.source.label}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
