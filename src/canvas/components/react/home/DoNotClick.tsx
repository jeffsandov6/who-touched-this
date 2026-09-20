/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import './DoNotClick.css';

export default function DoNotClick() {
  const panelRef = useRef<HTMLElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);

  const targetPosition = useRef({ x: 0, y: 0 });
  const currentPosition = useRef({ x: 0, y: 0 });

  const [isPointerInside, setIsPointerInside] = useState(false);
  const [wasClicked, setWasClicked] = useState(false);

  useEffect(() => {
    let animationFrameId = 0;

    const animate = () => {
      const cursor = cursorRef.current;

      if (cursor) {
        currentPosition.current.x +=
          (targetPosition.current.x - currentPosition.current.x) * 0.14;

        currentPosition.current.y +=
          (targetPosition.current.y - currentPosition.current.y) * 0.14;

        cursor.style.transform = `translate3d(
          ${currentPosition.current.x}px,
          ${currentPosition.current.y}px,
          0
        ) rotate(-18deg)`;
      }

      animationFrameId = window.requestAnimationFrame(animate);
    };

    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    const bounds = panel.getBoundingClientRect();

    targetPosition.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };

  const handlePointerEnter = (event: React.PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    const bounds = panel.getBoundingClientRect();

    const position = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };

    targetPosition.current = position;
    currentPosition.current = position;

    setIsPointerInside(true);
  };

  return (
    <section
      ref={panelRef}
      className="do-not-click"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={() => setIsPointerInside(false)}
      onPointerMove={handlePointerMove}
    >
      <div className="do-not-click-content">
        <p className="do-not-click-title">
          DON'T CLICK THIS BUTTON
        </p>

        <button
          type="button"
          className="do-not-click-button"
          onClick={() => setWasClicked(true)}
        >
          {wasClicked ? 'you clicked it' : "don't"}
        </button>

        {wasClicked && (
          <p className="do-not-click-result">
            i gave you one instruction
          </p>
        )}
      </div>

      <div
        ref={cursorRef}
        className={`do-not-click-cursor ${
          isPointerInside ? 'do-not-click-cursor--visible' : ''
        }`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 120 160"
          role="presentation"
        >
          <path
            d="M12 8 L105 87 L68 94 L91 143 L64 155 L42 105 L15 132 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </section>
  );
}