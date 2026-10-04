/** @jsxImportSource react */

const rules = [
  'one community contributor has an active turn at a time.',
  'each GitHub account may make one ordinary contribution per season.',
  'each contribution should contain one small, coherent main idea & affect a limited part of the editable site (within reason).',
  'ordinary contributions may change only the editable canvas & must pass the project contribution checks.',
  'adding an entirely new page is not part of an ordinary contribution. if your idea requires a new page, reach out to the maintainer first.',
  'protected platform code, infrastructure, authentication, contributor data, queue systems, deployment configuration, & other protected files may not be changed.',
  'contributors work from forks & do not receive direct write access to the canonical repository.',
  'submit your contribution as a non-draft pull request from your fork during your active turn.',
  'every pull request is reviewed before it is accepted or merged.',
  'you get one submission pull request per turn. fixes & requested revisions should be pushed to that same pull request.',
  'do not include secrets, credentials, private contributor information, malicious code, destructive behavior, or intentionally unsafe content.',
  'weird, political, dark, or mildly controversial humor is not automatically off limits, but hate speech, targeted harassment, racist or dehumanizing content, threats, doxing, sexual exploitation & any sexual content involving minors will be rejected.',
  'reasonable promotion & external links are allowed, but promotional content may be limited or require maintainer approval.',
  'do not add analytics, tracking pixels, persistent visitor tracking, or collect or transmit visitor data without maintainer approval.',
  'work introduced by another contributor may not be intentionally removed, hidden, or substantially replaced until 5 later community contributions have been merged, except when a safety, security, legal, privacy, compatibility, or platform fix requires it.',
  'large media or unusual external dependencies must be discussed with the maintainer before submission.',
  'only include code, media, & other material that you created or have the right to use.',
  'if you cannot complete your turn, contact the maintainer rather than attempting to transfer the turn or access to another person.',
  'the maintainer has final say on whether a contribution fits the rules, scope, & spirit of the project.',
] as const;

export default function RulesPage() {
  return (
    <section className="page-content" aria-labelledby="rules-heading">
      <h1 id="rules-heading">rules</h1>

      <p>
        who touched this works because each contributor gets a limited turn while the platform
        around the editable site remains protected. there's really not too many rules to what you can do, code-wise.
        but be reasonable. when in doubt, read the rules below. 
      </p>

      <ul>
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <p>
        platform maintenance is separate from community contributions & may happen whenever it is
        needed. rare creative founder interventions may also occur, but they will be clearly
        labeled, will not interrupt an active community contributor, & do not count as additional
        community contributions.
      </p>
      <p>
        these rules may evolve as the project does. if people find new ways to break things, we may
        have to write new ones.
      </p>

      <p>
        questions about the rules or an active contribution can be sent to
        {' '}
        <a href="mailto:hello@whotouchedthis.website">
          hello@whotouchedthis.website
        </a>
        .
      </p>
    </section>
  );
}