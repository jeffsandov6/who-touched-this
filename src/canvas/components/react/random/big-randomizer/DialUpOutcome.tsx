/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import dialUpSound from '../../../../assets/random/big-randomizer/dial-up.mp3';

type DialUpStage =
  | 'dialing'
  | 'verifying'
  | 'registering'
  | 'connected';

export default function DialUpOutcome() {
  const [stage, setStage] = useState<DialUpStage>('dialing');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const audio = new Audio(dialUpSound);

    audio.volume = 0.22;
    audioRef.current = audio;

    void audio.play().catch(() => {
      // If the browser blocks playback for some reason,
      // the visual outcome can still continue normally.
    });

    timersRef.current.push(
      window.setTimeout(() => {
        setStage('verifying');
      }, 2000),

      window.setTimeout(() => {
        setStage('registering');
      }, 4500),

      window.setTimeout(() => {
        setStage('connected');
      }, 9500),
    );

    return () => {
      timersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });

      timersRef.current = [];

      audio.pause();
      audio.currentTime = 0;

      audioRef.current = null;
    };
  }, []);

  const statusText = {
    dialing: 'Dialing...',
    verifying: 'Verifying username and password...',
    registering: 'Registering your computer on the network...',
    connected: 'Connected at 56.0 Kbps',
  }[stage];

  return (
    <div className="big-randomizer-dial-up">
      <div className="big-randomizer-dial-up-titlebar">
        <span>Connecting to Randomizer</span>
        <span aria-hidden="true">×</span>
      </div>

      <div className="big-randomizer-dial-up-body">
        <p>{statusText}</p>

        {stage !== 'connected' ? (
          <>
            <span className="big-randomizer-dial-up-destination">
              randomizer.website
            </span>

            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
            >
              Cancel
            </button>
          </>
        ) : (
          <span className="big-randomizer-dial-up-connected">
            nice.
          </span>
        )}
      </div>
    </div>
  );
}