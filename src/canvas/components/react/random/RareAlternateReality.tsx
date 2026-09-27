/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import ViewSourceReality from './alternate-realities/ViewSourceReality';
import './RareAlternateReality.css';

type Reality = 'normal' | 'upside-down' | 'view-source';
const TEST_REALITY: Reality | null = null;

// Cumulative weights total 1. Keep rare states uncommon.
export const REALITY_PROBABILITIES: Array<{ reality: Reality; probability: number }> = [
  { reality: 'normal', probability: 0.975 },
  { reality: 'upside-down', probability: 0.015 },
  { reality: 'view-source', probability: 0.01 },
];

function pickReality(): Reality {
  const draw = Math.random();
  let boundary = 0;

  for (const option of REALITY_PROBABILITIES) {
    boundary += option.probability;
    if (draw < boundary) return option.reality;
  }

  return 'normal';
}

export default function RareAlternateReality({ children }: { children: ReactNode }) {
  // The server and first client render are normal; the one-time draw happens after
  // mount to avoid a hydration mismatch and remains stable for this page visit.
  const [reality, setReality] = useState<Reality>('normal');

  // useEffect(() => setReality(pickReality()), []);
  useEffect(() => {
    setReality(TEST_REALITY ?? pickReality());
  }, []);

  if (reality === 'view-source') {
    return <ViewSourceReality />;
  }

  return (
    <div className={`rare-alternate-reality rare-alternate-reality--${reality}`}>
      {children}
    </div>
  );
}
