/** @jsxImportSource react */

const questions = [
  {
    question: 'What is Who Touched This?',
    answer:
      'A social coding experiment in which contributors sequentially modify one public website.',
  },
  {
    question: 'How does a turn work?',
    answer:
      'A selected contributor forks the repository, makes one small change, and opens a pull request for review.',
  },
  {
    question: 'Can everyone change the site at once?',
    answer: 'No. Only one community contributor has an active turn at a time.',
  },
  {
    question: 'Is the full queue public?',
    answer: 'No. The contribution queue will be private.',
  },
  {
    question: 'Does contributing require repository write access?',
    answer: 'No. Contributors will work from forks and will not receive direct write access.',
  },
  {
    question: 'How do I contribute?',
    answer:
      'Join the queue, wait for an invitation, and accept your turn before opening a pull request from your own fork. The full technical walkthrough is in CONTRIBUTING.md.',
  },
  {
    question: 'Do I need Firebase credentials to work locally?',
    answer:
      'No. The contributor preview runs the site shell and canvas locally without access to private production systems or credentials.',
  },
  {
    question: 'Can I add images, audio, or video?',
    answer:
      'Yes. Smaller media can be included directly in your contribution. If your idea needs a large video, audio file, or other large asset, contact the maintainer before submitting your pull request. The maintainer can host it and provide a public download URL that works in the contributor preview without Firebase credentials. Do not commit unusually large media or choose an external host without checking first.',
  },
] as const;

export default function FaqPage() {
  return (
    <section className="page-content" aria-labelledby="faq-heading">
      <h1 id="faq-heading">Frequently asked questions</h1>
      <dl className="faq-list">
        {questions.map(({ question, answer }) => (
          <div key={question}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
