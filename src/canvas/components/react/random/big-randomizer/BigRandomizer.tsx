/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import './BigRandomizer.css';

type OutcomeId =
  | 'worse-website'
  | 'fish'
  | 'no'
  | 'successful-error'
  | 'thoughts'
  | 'nevermind'
  | 'nothing'
  | 'one-pixel';

type Outcome = {
  id: OutcomeId;
};

const OUTCOMES: Outcome[] = [
  { id: 'worse-website' },
  { id: 'fish' },
  { id: 'no' },
  { id: 'successful-error' },
  { id: 'thoughts' },
  { id: 'nevermind' },
  { id: 'nothing' },
  { id: 'one-pixel' },
];

const TEMPORARY_OUTCOME_MS = 2600;

function pickOutcome(previousOutcome: OutcomeId | null): OutcomeId {
  const available = previousOutcome
    ? OUTCOMES.filter((outcome) => outcome.id !== previousOutcome)
    : OUTCOMES;

  const choice = available[Math.floor(Math.random() * available.length)];

  return choice?.id ?? 'nothing';
}

export default function BigRandomizer() {
  const [outcome, setOutcome] = useState<OutcomeId | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSorry, setShowSorry] = useState(false);

  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  };

  useEffect(() => {
    return clearTimers;
  }, []);

  const runRandomizer = () => {
    clearTimers();

    setIsLoading(false);
    setShowSorry(false);

    const nextOutcome = pickOutcome(outcome);
    setOutcome(nextOutcome);

    if (nextOutcome === 'nevermind') {
      setIsLoading(true);

      timersRef.current.push(
        window.setTimeout(() => {
          setIsLoading(false);
        }, 1500),
      );
    }

    if (nextOutcome === 'nothing') {
      timersRef.current.push(
        window.setTimeout(() => {
          setShowSorry(true);
        }, 1200),
      );
    }
  };

  const buttonLabel = outcome === 'no'
    ? 'no'
    : 'give me something';

  return (
    <section
      className={[
        'big-randomizer',
        outcome ? `big-randomizer--${outcome}` : '',
      ].filter(Boolean).join(' ')}
      aria-labelledby="big-randomizer-title"
    >
      <div className="big-randomizer-header">
        <p className="big-randomizer-kicker">big randomizer</p>

        <h2 id="big-randomizer-title">
          something
        </h2>
      </div>

      <div
        className="big-randomizer-result"
        aria-live="polite"
      >
        {!outcome && (
          <p className="big-randomizer-placeholder">
            results may vary.
          </p>
        )}

        {outcome === 'worse-website' && (
          <p>
            you got: a slightly worse website
          </p>
        )}

        {outcome === 'fish' && (
          <div className="big-randomizer-fish" aria-label="A fish">
            &gt;&lt;(((°&gt;
          </div>
        )}

        {outcome === 'no' && (
          <p>
            okay.
          </p>
        )}

        {outcome === 'successful-error' && (
          <div className="big-randomizer-error">
            <strong>error</strong>
            <span>something went wrong successfully.</span>
          </div>
        )}

        {outcome === 'thoughts' && (
          <a
            className="big-randomizer-thoughts-link"
            href="/thoughts"
          >
            go think about it →
          </a>
        )}

        {outcome === 'nevermind' && (
          <p>
            {isLoading ? 'loading...' : 'nevermind'}
          </p>
        )}

        {outcome === 'nothing' && (
          <p className="big-randomizer-nothing">
            {showSorry ? 'sorry' : '\u00A0'}
          </p>
        )}

        {outcome === 'one-pixel' && (
          <div className="big-randomizer-pixel-result">
            <span>you found 1 px</span>
            <span
              className="big-randomizer-pixel"
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      <button
        className="big-randomizer-button"
        type="button"
        onClick={runRandomizer}
      >
        {buttonLabel}
      </button>
    </section>
  );
}