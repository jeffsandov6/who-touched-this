/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';
import bartenderNote from '../../../assets/thoughts/old-ideas/bartender.png';
import carAlarmNote from '../../../assets/thoughts/old-ideas/car-alarm-keys.png';
import dynamicUiNote from '../../../assets/thoughts/old-ideas/dynamic-ui.png';
import stairCleanerNote from '../../../assets/thoughts/old-ideas/robot-stair-cleaner.png';

const ideas = [
  {
    id: 'bartender',
    title: 'bartender marketplace',
    image: bartenderNote,
    alt: 'Original iPhone note for a bartender marketplace idea',
    outcomeLabel: 'did this take off?',
    outcome: 'yeah, turns out a lot of people had this idea',
    linkLabel: 'see a version →',
    linkUrl: 'https://www.findbartenders.com/',
  },
  {
    id: 'car-alarm',
    title: 'car alarm → keys',
    image: carAlarmNote,
    alt: 'Original iPhone note about connecting car alarms to keys',
    outcomeLabel: 'did this take off?',
    outcome: 'yeah, way before i wrote this down',
    linkLabel: "see Viper's latest version →",
    linkUrl: 'https://www.viper.com/our-products/5906V',
  },
  {
    id: 'stairs',
    title: 'stair-cleaning robot',
    image: stairCleanerNote,
    alt: 'Original iPhone note for a stair-cleaning robot idea',
    outcomeLabel: 'did this take off?',
    outcome: 'still being worked on. stairs are apparently hard',
    linkLabel: "see who's working on it →",
    linkUrl: 'https://www.robo.lab.uec.ac.jp/en/project/stairs-cleaning/',
  },
  {
    id: 'dynamic',
    title: 'dynamic UI',
    image: dynamicUiNote,
    alt: 'Original iPhone note about generating interfaces from database schemas',
    outcomeLabel: 'did this take off?',
    outcome: 'yes. apparently this was already a whole thing',
    linkLabel: 'see an implementation →',
    linkUrl: 'https://rjsf-team.github.io/react-jsonschema-form/',
  },
] as const;

type Idea = (typeof ideas)[number];

export default function ShouldTheseExist() {
  const [cardsPerPage, setCardsPerPage] = useState(2);
  const [startIndex, setStartIndex] = useState(0);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 40rem)');
    const updateCardsPerPage = () => setCardsPerPage(media.matches ? 1 : 2);

    updateCardsPerPage();
    media.addEventListener('change', updateCardsPerPage);
    return () => media.removeEventListener('change', updateCardsPerPage);
  }, []);

  useEffect(() => {
    setStartIndex((current) => Math.floor(current / cardsPerPage) * cardsPerPage);
  }, [cardsPerPage]);

  useEffect(() => {
    if (selectedIdea && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selectedIdea]);

  const endIndex = Math.min(startIndex + cardsPerPage, ideas.length);
  const lastStartIndex = Math.floor((ideas.length - 1) / cardsPerPage) * cardsPerPage;
  const visibleIdeas = ideas.slice(startIndex, endIndex);
  const position = cardsPerPage === 1
    ? `${startIndex + 1} / ${ideas.length}`
    : `${startIndex + 1}–${endIndex} / ${ideas.length}`;

  const move = (direction: -1 | 1) => {
    setStartIndex((current) => {
      const next = current + direction * cardsPerPage;
      return Math.max(0, Math.min(next, lastStartIndex));
    });
  };

  const closeDialog = () => dialogRef.current?.close();

  return (
    <section
      className="thoughts-section thoughts-found-ideas"
      aria-labelledby="should-these-exist"
    >
      <header className="thoughts-found-ideas-heading">
        <div className="thoughts-found-ideas-meta">
          <span>old ideas we forgot about / what happened to them</span>
          <span>add your own!</span>
        </div>
        <h2 id="should-these-exist">should these exist?</h2>
      </header>

      <div className="thoughts-idea-carousel-controls" aria-label="idea carousel controls">
        <span aria-live="polite">{position}</span>
        <div>
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={startIndex === 0}
            aria-label="show previous ideas"
          >
            ← prev
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={endIndex === ideas.length}
            aria-label="show next ideas"
          >
            next →
          </button>
        </div>
      </div>

      <div className="thoughts-idea-carousel" aria-live="polite">
        {visibleIdeas.map((idea) => (
          <article className={`thoughts-idea-card thoughts-idea-card-${idea.id}`} key={idea.id}>
            <button
              className="thoughts-idea-preview"
              type="button"
              onClick={() => setSelectedIdea(idea)}
              aria-label={`view the full original note for ${idea.title}`}
            >
              <img
                src={idea.image.src}
                width={idea.image.width}
                height={idea.image.height}
                alt={idea.alt}
              />
              <span aria-hidden="true">open original ↗</span>
            </button>

            <div className="thoughts-idea-card-body">
              <h3>{idea.title}</h3>
              <div className="thoughts-idea-outcome">
                <p className="thoughts-idea-outcome-label">{idea.outcomeLabel}</p>
                <p>{idea.outcome}</p>
              </div>

              <a
                className="thoughts-idea-secondary-link"
                href={idea.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {idea.linkLabel}
              </a>
            </div>
          </article>
        ))}
      </div>

      <dialog
        className="thoughts-idea-dialog"
        ref={dialogRef}
        onClose={() => setSelectedIdea(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        {selectedIdea && (
          <div className="thoughts-idea-dialog-content">
            <header>
              <span>{selectedIdea.title}</span>
              <button type="button" onClick={closeDialog}>close ×</button>
            </header>
            <img
              src={selectedIdea.image.src}
              width={selectedIdea.image.width}
              height={selectedIdea.image.height}
              alt={selectedIdea.alt}
            />
          </div>
        )}
      </dialog>
    </section>
  );
}
