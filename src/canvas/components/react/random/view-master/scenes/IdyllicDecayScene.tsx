/** @jsxImportSource react */

import { useEffect, useState } from 'react';

import stage0Clean from '../../../../../assets/random/view-master/idyllic-decay/stage-0-clean.png';
import stage1TwoSuns from '../../../../../assets/random/view-master/idyllic-decay/stage-1-two-suns.png';
import stage2RepeatedTrees from '../../../../../assets/random/view-master/idyllic-decay/stage-2-repeated-trees.png';
import stage3OrangeSky from '../../../../../assets/random/view-master/idyllic-decay/stage-3-orange-sky.png';
import stage4BrokenParadise from '../../../../../assets/random/view-master/idyllic-decay/stage-4-broken-paradise.png';

import './IdyllicDecayScene.css';

export const IDYLLIC_DECAY_STAGE_MS = 5200;

const stages = [
  stage0Clean,
  stage1TwoSuns,
  stage2RepeatedTrees,
  stage3OrangeSky,
  stage4BrokenParadise,
];

export default function IdyllicDecayScene() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = stages.slice(1).map((_, index) => {
      const nextStage = index + 1;

      return window.setTimeout(
        () => setStage(nextStage),
        IDYLLIC_DECAY_STAGE_MS * nextStage,
      );
    });

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  return (
    <div className="view-master-static-scene view-master-idyllic">
      {stages.map((image, index) => (
        <img
          key={image.src}
          src={image.src}
          alt={index === 0 ? 'A peaceful alpine lake beneath snowy mountains' : ''}
          draggable="false"
          aria-hidden={index === 0 ? undefined : true}
          className={`view-master-idyllic-image ${
            stage === index ? 'view-master-idyllic-image--active' : ''
          }`}
        />
      ))}
    </div>
  );
}