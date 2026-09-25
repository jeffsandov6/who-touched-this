/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import nightCampfirePanorama from '../../../../../assets/random/view-master/peripheral/night-campfire-panorama.png';
import peripheralFigure from '../../../../../assets/random/view-master/peripheral/peripheral-figure.png';
import PannableScene from '../PannableScene';
import type { Point } from '../PannableScene';

import './PeripheralScene.css';

export default function PeripheralScene() {
  const [figureSide, setFigureSide] = useState<'left' | 'right'>('right');
  const [figurePhase, setFigurePhase] = useState<'watching' | 'slipping' | 'hidden'>('watching');
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current !== null) {
        window.clearTimeout(switchTimerRef.current);
      }
    };
  }, []);

  const handlePan = (_offset: Point, deltaX: number) => {
    if (figurePhase !== 'watching') return;

    const draggingTowardFigure =
      (figureSide === 'right' && deltaX < -45) ||
      (figureSide === 'left' && deltaX > 45);

    if (!draggingTowardFigure) return;

    setFigurePhase('slipping');

    switchTimerRef.current = window.setTimeout(() => {
      setFigurePhase('hidden');

      switchTimerRef.current = window.setTimeout(() => {
        setFigureSide((current) => (current === 'right' ? 'left' : 'right'));
        setFigurePhase('watching');
        switchTimerRef.current = null;
      }, 220);
    }, 240);
  };

  return (
    <div className="view-master-peripheral-scene">
      <PannableScene
        src={nightCampfirePanorama.src}
        alt="A moonlit forest campsite beside a lake"
        initialX={0.08}
        initialY={0.5}
        sceneClassName="view-master-pan-scene--peripheral"
        onPan={handlePan}>
        <span className="view-master-peripheral-caption" aria-hidden="true">
          me &amp; who?
        </span>
      </PannableScene>


      <div
        className={[
          'view-master-peripheral-figure',
          `view-master-peripheral-figure--${figureSide}`,
          `view-master-peripheral-figure--${figurePhase}`,
        ].join(' ')}
        aria-hidden="true"
      >
        <img src={peripheralFigure.src} alt="" draggable="false" />
      </div>
    </div>
  );
}
