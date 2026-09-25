/** @jsxImportSource react */

import { useEffect, useState } from 'react';

import idyllicPlaceholder from '../../../../../assets/random/view-master/idyllic-decay/landscape-placeholder.svg';

import './IdyllicDecayScene.css';

export const IDYLLIC_DECAY_STAGE_MS = 5200;

export default function IdyllicDecayScene() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [1, 2, 3, 4].map((nextStage) => window.setTimeout(
      () => setStage(nextStage),
      IDYLLIC_DECAY_STAGE_MS * nextStage,
    ));
    return () => timers.forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  return (
    <div className={`view-master-static-scene view-master-idyllic view-master-idyllic--stage-${stage}`}>
      <img src={idyllicPlaceholder.src} alt="A peaceful illustrated landscape" draggable="false" />
      <span className="view-master-idyllic-tree-copy" aria-hidden="true" />
      <span className="view-master-idyllic-second-sun" aria-hidden="true" />
      <span className="view-master-idyllic-false-horizon" aria-hidden="true" />
      <span className="view-master-idyllic-repeat" aria-hidden="true" />
    </div>
  );
}
