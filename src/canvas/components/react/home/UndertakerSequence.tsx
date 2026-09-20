/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import undertakerImage from '../../../assets/home/undertaker/undertaker.jpeg';
import teddyAudio from '../../../assets/home/undertaker/one-on-one-undertaker.mp3';
import undertakerTheme from '../../../assets/home/undertaker/undertaker-theme.mp3';

import './UndertakerSequence.css';

type SequencePhase =
  | 'idle'
  | 'teddy'
  | 'blackout'
  | 'flash'
  | 'undertaker'
  | 'sliding'
  | 'done';

export default function UndertakerSequence() {
  const teddyRef = useRef<HTMLAudioElement | null>(null);
  const themeRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<number[]>([]);

  const [phase, setPhase] = useState<SequencePhase>('idle');

  const addTimer = (callback: () => void, delay: number) => {
    const timerId = window.setTimeout(callback, delay);
    timersRef.current.push(timerId);
  };

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });

      teddyRef.current?.pause();
      themeRef.current?.pause();
    };
  }, []);

  const startUndertaker = () => {
    const theme = themeRef.current;

    // First gong: lights out.
    setPhase('blackout');

    if (theme) {
      theme.currentTime = 0;
      theme.volume = 1;

      void theme.play().catch(() => {
        // The visual sequence should still continue if audio fails.
      });
    }

    // Second gong is around 5 seconds into the edited theme.
    // Flash immediately before revealing Undertaker.
    addTimer(() => {
      setPhase('flash');
    }, 4850);

    addTimer(() => {
      setPhase('undertaker');
    }, 5100);

    // Entrance music begins around 8 seconds.
    // Give him ~2 seconds of legitimate menace before ruining it.
    addTimer(() => {
      setPhase('sliding');
    }, 10000);

    // The slide lasts 5.5 seconds.
    addTimer(() => {
      if (theme) {
        theme.pause();
        theme.currentTime = 0;
      }

      setPhase('done');
    }, 15750);
  };

  const handleTrigger = () => {
    if (phase !== 'idle') {
      return;
    }

    setPhase('teddy');

    const teddy = teddyRef.current;

    if (!teddy) {
      startUndertaker();
      return;
    }

    teddy.currentTime = 0;

    void teddy.play().catch(() => {
      // If Teddy's clip fails, still continue with the Undertaker sequence.
      startUndertaker();
    });
  };

  const overlayVisible =
    phase === 'blackout' ||
    phase === 'flash' ||
    phase === 'undertaker' ||
    phase === 'sliding';

  return (
    <div className="undertaker-sequence">
      <button
        type="button"
        className="undertaker-sequence-trigger"
        onClick={handleTrigger}
        disabled={phase !== 'idle'}
      >
        {phase === 'done' ? "he's gone" : '?'}
      </button>

      <audio
        ref={teddyRef}
        src={teddyAudio}
        preload="auto"
        onEnded={startUndertaker}
      />

      <audio
        ref={themeRef}
        src={undertakerTheme}
        preload="auto"
      />

      {overlayVisible && (
        <div
          className={`undertaker-sequence-overlay undertaker-sequence-overlay--${phase}`}
          aria-hidden="true"
        >
          {(phase === 'undertaker' || phase === 'sliding') && (
            <img
              className="undertaker-sequence-image"
              src={undertakerImage.src}
              alt=""
            />
          )}
        </div>
      )}
    </div>
  );
}