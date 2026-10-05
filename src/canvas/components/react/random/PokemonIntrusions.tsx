/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import slowpoke from '../../../assets/random/pokemon-intrusions/slowpoke.png';
import abra from '../../../assets/random/pokemon-intrusions/abra.png';
import snorlax from '../../../assets/random/pokemon-intrusions/snorlax.png';

import './PokemonIntrusions.css';

type Intrusion = {
  id: string;
  asset: string;
  delayMs: number;
  durationMs: number;
  direction: 'left-to-right' | 'right-to-left';
  verticalPosition: number;
  width: number;
  bobAmount: number;
};

export const POKEMON_INTRUSIONS: Intrusion[] = [
  {
    id: 'slowpoke',
    asset: slowpoke.src,
    delayMs: 5000,
    durationMs: 19000,
    direction: 'left-to-right',
    verticalPosition: 38,
    width: 190,
    bobAmount: 12,
  },
 {
  id: 'snorlax',
  asset: snorlax.src,
  delayMs: 30000,
  durationMs: 22000,
  direction: 'right-to-left',
  verticalPosition: 38,
  width: 720,
  bobAmount: 18,
},
  {
    id: 'abra',
    asset: abra.src,
    delayMs: 55000,
    durationMs: 19000,
    direction: 'left-to-right',
    verticalPosition: 52,
    width: 170,
    bobAmount: 10,
  },
];

type IntrusionStyle = CSSProperties & {
  '--intrusion-duration': string;
  '--intrusion-top': string;
  '--intrusion-width': string;
  '--intrusion-bob': string;
};

export default function PokemonIntrusions() {
  const [activeIds, setActiveIds] = useState<string[]>([]);

  useEffect(() => {
    const timers = POKEMON_INTRUSIONS.map((intrusion) => window.setTimeout(() => {
      setActiveIds((current) => [...current, intrusion.id]);
    }, intrusion.delayMs));

    return () => timers.forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  return (
    <div className="pokemon-intrusions" aria-hidden="true">
      {POKEMON_INTRUSIONS.filter(({ id }) => activeIds.includes(id)).map((intrusion) => {
        const style: IntrusionStyle = {
          '--intrusion-duration': `${intrusion.durationMs}ms`,
          '--intrusion-top': `${intrusion.verticalPosition}vh`,
          '--intrusion-width': `${intrusion.width}px`,
          '--intrusion-bob': `${intrusion.bobAmount}px`,
        };

        return (
          <div
            key={intrusion.id}
            className={`pokemon-intrusions-runner pokemon-intrusions-runner--${intrusion.direction}`}
            style={style}
            onAnimationEnd={() => setActiveIds((current) => current.filter((id) => id !== intrusion.id))}
          >
            <img src={intrusion.asset} alt="" />
          </div>
        );
      })}
    </div>
  );
}
