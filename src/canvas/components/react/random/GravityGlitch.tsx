/** @jsxImportSource react */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import './GravityGlitch.css';

// Primary timing controls for the gravity failure.
export const GRAVITY_DELAY_MS = 3000;
export const GRAVITY_FALL_DURATION_MS = 1650;

const copy = 'conceptually, stability rarely lasts';
const words = copy.split(' ');

type LetterStyle = CSSProperties & {
  '--gravity-x': string;
  '--gravity-y': string;
  '--gravity-rotation': string;
  '--gravity-delay': string;
  '--gravity-duration': string;
};

function seededValue(index: number, salt: number) {
  const value = Math.sin((index + 1) * 91.73 + salt * 47.11) * 10000;
  // Quantizing keeps server-rendered and browser-rendered style strings identical.
  return Number((value - Math.floor(value)).toFixed(5));
}

export default function GravityGlitch() {
  const [hasDropped, setHasDropped] = useState(false);
  const letters = useMemo(() => Array.from(copy), []);

  useEffect(() => {
    const timerId = window.setTimeout(() => setHasDropped(true), GRAVITY_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, []);

  return (
    <section className="gravity-glitch" aria-label={copy}>
      <p
        className={`gravity-glitch-copy ${hasDropped ? 'gravity-glitch-copy--dropped' : ''
          }`}
        aria-hidden="true"
      >
        {words.map((word, wordIndex) => (
          <span className="gravity-glitch-word" key={`${word}-${wordIndex}`}>
            {Array.from(word).map((letter, letterIndex) => {
              const index =
                words
                  .slice(0, wordIndex)
                  .reduce((total, currentWord) => total + currentWord.length, 0) +
                wordIndex +
                letterIndex;

              const style: LetterStyle = {
                '--gravity-x': `${-34 + seededValue(index, 1) * 68}px`,
                '--gravity-y': `${150 + seededValue(index, 2) * 62}px`,
                '--gravity-rotation': `${-105 + seededValue(index, 3) * 210}deg`,
                '--gravity-delay': `${seededValue(index, 4) * 420}ms`,
                '--gravity-duration': `${GRAVITY_FALL_DURATION_MS + seededValue(index, 5) * 650
                  }ms`,
              };

              return (
                <span
                  key={`${letter}-${letterIndex}`}
                  className="gravity-glitch-letter"
                  style={style}
                >
                  {letter}
                </span>
              );
            })}

            {wordIndex < words.length - 1 && '\u00a0'}
          </span>
        ))}
      </p>
    </section>
  );
}
