/** @jsxImportSource react */

const funQuestions = [
  {
    question: 'what is who touched this?',
    answer:
      'who touched this is a collaborative coding experiment where one public website is changed sequentially by different contributors. each person gets one turn to make an update on the site. i\'m really just curious to see where this goes. the possibilities are endless.',

  },
  {
    question: 'what should i make?',
    answer:
      'honestly whatever you want, as long as it fits the rules & the scope of one contribution. it can be useful, useless, weird, funny, beautiful, ugly, interactive, confusing, or something nobody would have thought to put there. that\'s kind of the point. i think we forget how fun developing can be once it just becomes something we do at our job. there was never a more fun time for me than when i participated in hackathons with my buddies. writing software can be a lot more fun as a social activity.',
  },
  {
    question: 'do i have to be an amazing developer?',
    answer:
      'nah. this isn\'t a coding competition. if you can follow the contributor instructions, make your change, & get the checks to pass, you\'re welcome to contribute. a simple idea can be just as interesting as a technically complicated one. people at different experience levels tend to bring completely different ideas to the table. juniors can have a ton of fresh creativity, while seniors can bring years of weird knowledge & perspective (i\'m a senior myself, so no senior slander here 😭). mixing ideas from developers of all backgrounds, experiences, & generations should make this even more fun. since it\'s all small contributions & no huge deliverables, i\'m hoping the mix turns into something dope.',
  },
  {
    question: 'is there anything not allowed?',
    answer:
      'of course. but i\'m not going to be the fun police. weird, political, dark, or mildly controversial humor is not automatically off limits. but use common sense. hate speech, targeted harassment, racist or dehumanizing content, threats, doxing, sexual exploitation or any sexual content involving minors, & content whose purpose is to make a person or group feel unwelcome will be rejected. when in doubt, ask first.',
  },
]

const boringQuestions = [
  {
    question: 'how does a turn work?',
    answer:
      'when your turn comes up, you receive an invitation. after you accept, your turn becomes active & the site shows a countdown. you fork the canonical repository, make one small, coherent contribution inside the editable canvas, run the contribution checks, & open a non-draft pull request for review.',
  },
  {
    question: 'can everyone change the site at once?',
    answer: 'no. only one community contributor has an active turn at a time. this keeps the project sequential. each contributor starts from the version left by the person before them.',
  },
  {
    question: 'how many times can i contribute?',
    answer:
      'each GitHub account may make one ordinary contribution per season.',
  },
  {
    question: 'is the contribution queue public?',
    answer: 'no. the queue is private. the public site may show the current contributor & who is next, but the queue itself is not visible to the public.',
  },
  {
    question: 'how do i contribute?',
    answer:
      'join with GitHub & enter the private queue. if you\'re invited, accept the invitation & follow the contributor workflow for your active turn. the complete fork, local-development, validation, & pull-request walkthrough is in CONTRIBUTING.md. if you have any questions, you can reach the maintainer at hello@whotouchedthis.website.',
  },
  {
    question: 'do i get write access to the main repository?',
    answer: 'no. contributors will work from their own forks & submit pull requests to the canonical repository. direct write access is not required.',
  },
  {
    question: 'can i update my pull request after submitting it?',
    answer: 'yes. you get one submission pull request for your turn, but you can continue pushing fixes & requested revisions to that same pull request while it is being reviewed. opening additional pull requests does not give you additional contributions.',
  },
  {
    question: 'what am i allowed to change?',
    answer:
      'ordinary contributions are limited to the editable canvas. the surrounding platform is maintained separately, including authentication, contributor lifecycle, queue management, history, rules, deployment infrastructure, & other protected systems.',
  },
  {
    question: 'can i add a new page?',
    answer:
      'not as part of a normal contribution. ordinary turns are meant to modify the existing editable site. if your idea requires an entirely new page, reach out to the maintainer first. there are plans to make additional pages available in the future.',
  },
  {
    question: 'how big can my contribution be?',
    answer:
      'keep it to one main idea. a contribution should affect one limited area of the editable site, plus whatever supporting canvas components or assets that idea reasonably needs. if you\'re making several unrelated changes across the site, it\'s probably too large for one turn. leave something for the next person.',
  },
  {
    question: 'can i change something another contributor added?',
    answer:
      'yes, eventually. work introduced by another contributor is protected from being intentionally removed, hidden, or substantially replaced until 5 later community contributions have been merged. you can still build around it or interact with it. necessary safety, security, compatibility, or platform fixes are exempt.',
  },
  {
    question: 'do i need Firebase credentials or production access?',
    answer:
      'no. the development environment is intentionally isolated from private production systems. you can run the contributor preview locally without Firebase credentials or project secrets.',
  },
  {
    question: 'can i add images, audio, or video?',
    answer:
      'yes. smaller media can be included directly in your contribution. if your idea needs a large video, audio file, or other unusually large asset, reach out to the maintainer first so we can figure out the best way to host it. don\'t commit huge files or pick an external host without checking first.',
  },
  {
    question: 'what if i cannot take my turn?',
    answer:
      'contact the maintainer as soon as possible. turns may be skipped or withdrawn rather than leaving the project indefinitely blocked.',
  },
  {
    question: 'can a contribution be rejected?',
    answer:
      'yes, but i\'m not looking for reasons to reject people. every pull request is reviewed, & if something can reasonably be fixed or brought back into scope, you\'ll have a chance to update the same pull request. changes that break the rules, go way beyond the allowed scope, modify protected systems, expose secrets, or introduce unsafe or malicious behavior may still be rejected.',
  },
  {
    question: 'how can i contact the project?',
    answer:
      'email hello@whotouchedthis.website.',
  },
] as const;

export default function FaqPage() {
  return (
    <section className="page-content" aria-labelledby="faq-heading">
      <h1 id="faq-heading">frequently asked questions</h1>

      <h2>the fun stuff</h2>
      <dl className="faq-list">
        {funQuestions.map(({ question, answer }) => (
          <div key={question}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>

      <h2>the boring but important stuff</h2>
      <div className="faq-accordion">
        {boringQuestions.map(({ question, answer }) => (
          <details key={question} className="faq-item">
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
