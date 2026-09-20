/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import flounderImage from '../../../assets/home/game/flounder.jpg';
import almostHadItVideo from '../../../assets/home/game/almost-had-it.mp4';

import './GameSection.css';

type BugLevel = {
  label: string;
  size: number;
  moveIntervalMs: number | null;
};

const bugLevels: BugLevel[] = [
  {
    label: 'bug 1/5',
    size: 4.25,
    moveIntervalMs: null,
  },
  {
    label: 'bug 2/5',
    size: 3.75,
    moveIntervalMs: 1500,
  },
  {
    label: 'bug 3/5',
    size: 3.1,
    moveIntervalMs: 1000,
  },
  {
    label: 'bug 4/5',
    size: 2.5,
    moveIntervalMs: 700,
  },
  {
    label: "codex can't help you here",
    size: 2.1,
    moveIntervalMs: 600,
  },
];

function getRandomPosition() {
  return {
    x: 12 + Math.random() * 76,
    y: 18 + Math.random() * 62,
  };
}

export default function GameSection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [currentLevelIndex, setCurrentLevelIndex] = useState(0);
  const [bugPosition, setBugPosition] = useState(getRandomPosition);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTaunting, setIsTaunting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isMouseInside, setIsMouseInside] = useState(true);

  const currentLevel = bugLevels[currentLevelIndex];

  useEffect(() => {
    if (isComplete || isTaunting || !isMouseInside) {
      return;
    }

    setBugPosition(getRandomPosition());

    if (!currentLevel.moveIntervalMs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setBugPosition(getRandomPosition());
    }, currentLevel.moveIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentLevel, isComplete, isTaunting, isMouseInside]);

  const startTaunt = () => {
    if (!hasStarted || isComplete || isTaunting) {
      return;
    }

    const video = videoRef.current;

    setIsTaunting(true);

    if (!video) {
      setIsTaunting(false);
      return;
    }

    video.currentTime = 0;

    void video.play().catch(() => {
      // If the browser blocks audio playback, don't trap the game
      // in the taunt state.
      setIsTaunting(false);
    });
  };

  const handleBugClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();

    if (isComplete || isTaunting) {
      return;
    }

    setHasStarted(true);

    if (currentLevelIndex === bugLevels.length - 1) {
      setIsComplete(true);
      return;
    }

    setCurrentLevelIndex(
      (previousLevelIndex) => previousLevelIndex + 1,
    );

    setBugPosition(getRandomPosition());
  };

  const handlePointerEnter = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === 'mouse') {
      setIsMouseInside(true);
    }
  };

  const handlePointerLeave = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType !== 'mouse') {
      return;
    }

    setIsMouseInside(false);
    startTaunt();
  };

  const handlePlayAreaPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    // On touch devices, tapping empty space means you missed the bug.
    if (
      event.pointerType !== 'mouse' &&
      event.target === event.currentTarget
    ) {
      startTaunt();
    }
  };

  return (
    <section className="game-section">
      {!isComplete ? (
        <>
          <div className="game-section-copy">
            <p className="game-section-title">get rid of the bug</p>

            <p className="game-section-level">
              {currentLevel.label}
            </p>
          </div>

          <div
            className="game-section-play-area"
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            onPointerDown={handlePlayAreaPointerDown}
          >
            {!isTaunting && (
              <button
                type="button"
                className="game-section-bug"
                onClick={handleBugClick}
                aria-label={
                  currentLevelIndex === bugLevels.length - 1
                    ? 'final bug'
                    : 'bug'
                }
                style={{
                  left: `${bugPosition.x}%`,
                  top: `${bugPosition.y}%`,
                  fontSize: `${currentLevel.size}rem`,
                }}
              >
                🪲
              </button>
            )}

            <video
              ref={videoRef}
              className={`game-section-taunt ${isTaunting
                ? 'game-section-taunt--visible'
                : ''
                }`}
              src={almostHadItVideo}
              preload="auto"
              playsInline
              onEnded={() => setIsTaunting(false)}
            />
          </div>
        </>
      ) : (
        <div className="game-section-reward">
          <div className="game-section-copy game-section-copy--reward">
            <p className="game-section-title">
              you got rid of the bug
            </p>

            <p className="game-section-reward-text">
              eventually this might be worth something. not yet.
            </p>

            <p className="game-section-reward-text">
              here's a fish.
            </p>
          </div>

          <img
            className="game-section-flounder"
            src={flounderImage.src}
            alt="A flounder lying on the sand."
            loading="lazy"
          />
        </div>
      )}
    </section>
  );
}