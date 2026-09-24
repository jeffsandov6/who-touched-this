/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import './WrongPerspectiveObject.css';

type PerspectiveStage = 0 | 1 | 2;

export const WRONG_PERSPECTIVE_VISIBILITY_THRESHOLD = 0.6;
export const WRONG_PERSPECTIVE_HOLD_MS = 2000;
export const WRONG_PERSPECTIVE_ENTRY_MS = 3500;
export const WRONG_PERSPECTIVE_ALIGNMENT_MS = 1500;

type PerspectiveStyle = CSSProperties & {
  '--wrong-perspective-entry-duration': string;
  '--wrong-perspective-alignment-duration': string;
};

export default function WrongPerspectiveObject() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const hasTriggeredRef = useRef(false);
  const [stage, setStage] = useState<PerspectiveStage>(0);
  const style: PerspectiveStyle = {
    '--wrong-perspective-entry-duration': `${WRONG_PERSPECTIVE_ENTRY_MS}ms`,
    '--wrong-perspective-alignment-duration': `${WRONG_PERSPECTIVE_ALIGNMENT_MS}ms`,
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const startSequence = () => {
      if (hasTriggeredRef.current) return;
      hasTriggeredRef.current = true;

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        setStage(2);
        return;
      }

      timersRef.current.push(
        window.setTimeout(() => setStage(1), WRONG_PERSPECTIVE_HOLD_MS),
        window.setTimeout(
          () => setStage(2),
          WRONG_PERSPECTIVE_HOLD_MS + WRONG_PERSPECTIVE_ENTRY_MS,
        ),
      );
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting
          && entry.intersectionRatio >= WRONG_PERSPECTIVE_VISIBILITY_THRESHOLD
        ) {
          startSequence();
          observer.disconnect();
        }
      },
      { threshold: WRONG_PERSPECTIVE_VISIBILITY_THRESHOLD },
    );

    observer.observe(section);

    return () => {
      observer.disconnect();
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timersRef.current = [];
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`wrong-perspective-object wrong-perspective-object--stage-${stage}`}
      aria-label="An isometric staircase closes into an impossible loop"
      style={style}
    >
      <svg
        className="wrong-perspective-drawing"
        viewBox="0 0 800 650"
        role="presentation"
        aria-hidden="true"
      >

        <defs>
          <pattern id="wrong-perspective-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" className="wrong-perspective-grid-line" />
          </pattern>
        </defs>

        <rect className="wrong-perspective-paper" width="800" height="650" />
        <rect className="wrong-perspective-grid" x="28" y="28" width="744" height="594" />

        {/* The moving flight sits below the original structure so its lower
            connection can use one controlled Penrose-style occlusion. */}
        <g className="wrong-perspective-fourth-flight">
          <path className="wrong-perspective-stair-body" d="M595 297 400 410 400 500 675 263Z" />
          <path className="wrong-perspective-riser-face" d="M675 263 400 500 400 485 658 263Z" />
          <g className="wrong-perspective-step-lines">
            <path d="m575.5 308.3 72-21.6" />
            <path d="m556 319.6 64-9.2" />
            <path d="m536.5 330.9 56 3.2" />
            <path d="m517 342.2 48 15.6" />
            <path d="m497.5 353.5 40 28" />
            <path d="m478 364.8 32 40.4" />
            <path d="m458.5 376.1 24 52.8" />
            <path d="m439 387.4 16 65.2" />
            <path d="m419.5 398.7 8 77.6" />
          </g>
          <g className="wrong-perspective-risers">
            <path d="M556 319.6 620 310.4 647.5 286.7 575.5 308.3Z" />
            <path d="M517 342.2 565 357.8 592.5 334.1 536.5 330.9Z" />
            <path d="M478 364.8 510 405.2 537.5 381.5 497.5 353.5Z" />
            <path d="M439 387.4 455 452.6 482.5 428.9 458.5 376.1Z" />
          </g>
        </g>

        {/* Flight one: lower corner to left corner. */}
        <g className="wrong-perspective-static-flight">
          <path className="wrong-perspective-stair-body" d="M400 410 205 297 125 342 400 500Z" />
          <path className="wrong-perspective-riser-face" d="M125 342 400 500 400 485 142 337Z" />
          <g className="wrong-perspective-step-lines">
            <path d="m380.5 398.7-8 85.5" />
            <path d="m361 387.4-16 81" />
            <path d="m341.5 376.1-24 76.5" />
            <path d="m322 364.8-32 72" />
            <path d="m302.5 353.5-40 67.5" />
            <path d="m283 342.2-48 63" />
            <path d="m263.5 330.9-56 58.5" />
            <path d="m244 319.6-64 54" />
            <path d="m224.5 308.3-72 49.5" />
          </g>
          <g className="wrong-perspective-risers">
            <path d="m361 387.4-16 81 27.5 15.8 8-85.5Z" />
            <path d="m322 364.8-32 72 27.5 15.8 24-76.5Z" />
            <path d="m283 342.2-48 63 27.5 15.8 40-67.5Z" />
            <path d="m244 319.6-64 54 27.5 15.8 56-58.5Z" />
          </g>
        </g>

        {/* Flight two: left corner to upper corner. */}
        <g className="wrong-perspective-static-flight">
          <path className="wrong-perspective-stair-body wrong-perspective-stair-body--light" d="M205 297 400 185 400 105 125 342Z" />
          <path className="wrong-perspective-riser-face" d="M125 342 400 105 400 122 142 337Z" />
          <g className="wrong-perspective-step-lines">
            <path d="m224.5 285.8-72 32.5" />
            <path d="m244 274.6-64 20" />
            <path d="m263.5 263.4-56 7.5" />
            <path d="m283 252.2-48-5" />
            <path d="m302.5 241-40-17.5" />
            <path d="m322 229.8-32-30" />
            <path d="m341.5 218.6-24-42.5" />
            <path d="m361 207.4-16-55" />
            <path d="m380.5 196.2-8-67.5" />
          </g>
          <g className="wrong-perspective-risers">
            <path d="m244 274.6-64 20-27.5 23.7 72-32.5Z" />
            <path d="m283 252.2-48-5-27.5 23.7 56-7.5Z" />
            <path d="m322 229.8-32-30-27.5 23.7 40 17.5Z" />
            <path d="m361 207.4-16-55-27.5 23.7 24 42.5Z" />
          </g>
        </g>

        {/* Flight three: upper corner to right corner. */}
        <g className="wrong-perspective-static-flight">
          <path className="wrong-perspective-stair-body" d="M400 185 595 297 675 263 400 105Z" />
          <path className="wrong-perspective-riser-face" d="M400 105 675 263 658 268 400 122Z" />
          <g className="wrong-perspective-step-lines">
            <path d="m419.5 196.2 8-75.4" />
            <path d="m439 207.4 16-70.8" />
            <path d="m458.5 218.6 24-66.2" />
            <path d="m478 229.8 32-61.6" />
            <path d="m497.5 241 40-57" />
            <path d="m517 252.2 48-52.4" />
            <path d="m536.5 263.4 56-47.8" />
            <path d="m556 274.6 64-43.2" />
            <path d="m575.5 285.8 72-38.6" />
          </g>
          <g className="wrong-perspective-risers">
            <path d="m439 207.4 16-70.8-27.5-15.8-8 75.4Z" />
            <path d="m478 229.8 32-61.6-27.5-15.8-24 66.2Z" />
            <path d="m517 252.2 48-52.4-27.5-15.8-40 57Z" />
            <path d="m556 274.6 64-43.2-27.5-15.8-56 47.8Z" />
          </g>
        </g>

        {/* Three stable landings make the original U-shaped route explicit. */}
        <g className="wrong-perspective-landings">
          <path d="M176 287 205 270 234 287 205 304Z" />
          <path d="M371 185 400 168 429 185 400 202Z" />
          <path d="M566 297 595 280 624 297 595 314Z" />
        </g>

        {/* This cap appears last and hides the incompatible closing elevation. */}
        <g className="wrong-perspective-impossible-seam">
          <path className="wrong-perspective-seam-top" d="M371 410 400 393 429 410 400 427Z" />
          <path className="wrong-perspective-seam-edge" d="M400 427 429 410 429 421 400 438Z" />
        </g>

      </svg>
    </section>
  );
}
