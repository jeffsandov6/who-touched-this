/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import { formatCountdown, getCountdownState } from '../turn-state';

interface CountdownProps {
  dueAtMillis: number;
}

export default function Countdown({ dueAtMillis }: CountdownProps) {
  const [nowMillis, setNowMillis] = useState(() => Date.now());

  useEffect(() => {
    setNowMillis(Date.now());
    const timer = window.setInterval(() => setNowMillis(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dueAtMillis]);

  return <span>{formatCountdown(getCountdownState(dueAtMillis, nowMillis))}</span>;
}
