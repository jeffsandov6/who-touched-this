/** @jsxImportSource react */

import { useEffect, useState } from 'react';

export default function LowBatteryOutcome() {
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    document.body.classList.add('wtt-low-battery-active');

    const timer = window.setTimeout(() => {
      document.body.classList.remove('wtt-low-battery-active');
      setRestored(true);
    }, 3800);

    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('wtt-low-battery-active');
    };
  }, []);

  return (
    <div className="big-randomizer-low-battery">
      <div
        className="big-randomizer-low-battery-icon"
        aria-hidden="true"
      >
        <span />
      </div>

      {!restored ? (
        <>
          <strong>battery critically low</strong>
          <span>1% remaining</span>
          <small>entering emergency power-save mode...</small>
        </>
      ) : (
        <>
          <strong>false alarm.</strong>
          <small>carry on.</small>
        </>
      )}
    </div>
  );
}