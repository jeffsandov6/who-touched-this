/** @jsxImportSource react */

const rules = [
  'One community contributor has a turn at a time.',
  'Each GitHub account may make one contribution per season.',
  'Each contribution must be one small, coherent change.',
  'Every pull request is reviewed before acceptance.',
  'Contributors do not receive direct write access to the canonical repository.',
  'Protected platform infrastructure may not be changed.',
  'Malicious or unsafe contributions are rejected.',
] as const;

export default function RulesPage() {
  return (
    <section className="page-content" aria-labelledby="rules-heading">
      <h1 id="rules-heading">Temporary rules</h1>
      <p>Detailed scope rules will be finalized before public contributions begin.</p>
      <ul>
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <p>
        Platform maintenance by the project owner is separate from community contributions. Rare
        creative founder interventions may occur later; they will be clearly labeled and will not
        consume ordinary community turns.
      </p>
    </section>
  );
}
