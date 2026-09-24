/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import './LiveCodeBreakdown.css';

type SourceLine = {
  number: number;
  content: React.ReactNode;
  eatenAt?: number;
};

export const LIVE_CODE_VISIBILITY_THRESHOLD = 0.6;

/*
 * Incremental delays after the component becomes visible.
 *
 * stage 1: border
 * stage 2: border-radius
 * stage 3: background
 * stage 4: shape element
 * stage 5: grid layout
 */
export const LIVE_CODE_STAGE_DELAYS_MS = [
  4200,
  2400,
  2400,
  2600,
  2600,
] as const;

const sourceLines: SourceLine[] = [
  {
    number: 1,
    content: (
      <>
        <span className="live-code-keyword">function</span> Card() {'{'}
      </>
    ),
  },
  {
    number: 2,
    content: (
      <>
        {'  '}
        <span className="live-code-keyword">return</span> (
      </>
    ),
  },
  {
    number: 3,
    content: (
      <>
        {'    '}&lt;<span className="live-code-tag">article</span>{' '}
        className=
        <span className="live-code-string">&quot;card&quot;</span>&gt;
      </>
    ),
  },
  {
    number: 4,
    content: (
      <>
        {'      '}&lt;<span className="live-code-tag">div</span>{' '}
        className=
        <span className="live-code-string">&quot;card__shape&quot;</span>{' '}
        /&gt;
      </>
    ),
    eatenAt: 4,
  },
  {
    number: 5,
    content: (
      <>
        {'      '}&lt;<span className="live-code-tag">h3</span>&gt;
        everything
        &lt;/<span className="live-code-tag">h3</span>&gt;
      </>
    ),
  },
  {
    number: 6,
    content: (
      <>
        {'      '}&lt;<span className="live-code-tag">p</span>&gt;
        is fine
        &lt;/<span className="live-code-tag">p</span>&gt;
      </>
    ),
  },
  {
    number: 7,
    content: (
      <>
        {'    '}&lt;/<span className="live-code-tag">article</span>&gt;
      </>
    ),
  },
  {
    number: 8,
    content: <>  );</>,
  },
  {
    number: 9,
    content: <>{'}'}</>,
  },
  {
    number: 10,
    content: <>&nbsp;</>,
  },
  {
    number: 11,
    content: (
      <>
        <span className="live-code-selector">.card</span> {'{'}
      </>
    ),
  },
  {
    number: 12,
    content: <>  border: 1px solid #202227;</>,
    eatenAt: 1,
  },
  {
    number: 13,
    content: <>  border-radius: 24px;</>,
    eatenAt: 2,
  },
  {
    number: 14,
    content: <>  background: #fffef8;</>,
    eatenAt: 3,
  },
  {
    number: 15,
    content: <>  display: grid;</>,
    eatenAt: 5,
  },
  {
    number: 16,
    content: <>  place-items: center;</>,
  },
  {
    number: 17,
    content: <>{'}'}</>,
  },
];

export default function LiveCodeBreakdown() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const hasTriggeredRef = useRef(false);

  const [bugStage, setBugStage] = useState(0);
  const [eatenStage, setEatenStage] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;

    if (!section) {
      return;
    }

    const startSequence = () => {
      if (hasTriggeredRef.current) {
        return;
      }

      hasTriggeredRef.current = true;

      if (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        setBugStage(5);
        setEatenStage(5);
        return;
      }

      let elapsed = 0;

      LIVE_CODE_STAGE_DELAYS_MS.forEach((delay, index) => {
        const nextStage = index + 1;

        elapsed += delay;

        // First: move the termite toward its target.
        timersRef.current.push(
          window.setTimeout(() => {
            setBugStage(nextStage);
          }, elapsed),
        );

        // Then: once it has arrived, actually eat the code.
        timersRef.current.push(
          window.setTimeout(() => {
            setEatenStage(nextStage);
          }, elapsed + 1150),
        );
      });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          entry.intersectionRatio >= LIVE_CODE_VISIBILITY_THRESHOLD
        ) {
          startSequence();
          observer.disconnect();
        }
      },
      {
        threshold: LIVE_CODE_VISIBILITY_THRESHOLD,
      },
    );

    observer.observe(section);

    return () => {
      observer.disconnect();

      timersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });

      timersRef.current = [];
    };
  }, []);

  const cardClassName = [
  'live-code-card',
  eatenStage >= 1 && 'live-code-card--no-border',
  eatenStage >= 2 && 'live-code-card--no-radius',
  eatenStage >= 3 && 'live-code-card--no-background',
  eatenStage >= 5 && 'live-code-card--no-grid',
]
  .filter(Boolean)
  .join(' ');

  return (
    <section
      ref={sectionRef}
      className="live-code-breakdown"
      data-stage={eatenStage}
    >
      <div
        className="live-code-editor"
        aria-label="Fake source code breaking down over time"
      >
        <div
          className="live-code-editor-bar"
          aria-hidden="true"
        >
          <span />
          <span />
          <span />

          <small>Card.tsx</small>
        </div>

        <pre className="live-code-source">
          <code>
            {sourceLines.map((line) => {
              const isEaten =
                line.eatenAt !== undefined &&
                eatenStage >= line.eatenAt;

              return (
                <span
                  key={line.number}
                  className={`live-code-line ${isEaten
                    ? 'live-code-line--eaten'
                    : ''
                    }`}
                >
                  <span className="live-code-line-number">
                    {line.number}
                  </span>

                  <span className="live-code-line-content">
                    {line.content}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>

        <div
          className={`live-code-bug live-code-bug--stage-${bugStage}`}
          aria-hidden="true"
        >
          <span className="live-code-bug-head" />
          <span className="live-code-bug-body" />
        </div>
      </div>

      <div
        className="live-code-preview"
        aria-label="Preview of the breaking component"
      >
        <div className={cardClassName}>
          {eatenStage < 4 && (
            <div
              className="live-code-card-shape"
              aria-hidden="true"
            />
          )}

          <div className="live-code-card-copy">
            <h2>everything</h2>
            <p>is fine</p>
          </div>
        </div>
      </div>
    </section>
  );
}