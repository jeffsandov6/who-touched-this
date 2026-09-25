/** @jsxImportSource react */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import hotelHallway from '../../../assets/random/view-master/hotel/hotel-hallway-main.jpg';

import calvinHobbesStars from '../../../assets/random/view-master/picture-window/calvin-hobbes-stars.jpeg';
import cannotCenterPlaceholder from '../../../assets/random/view-master/cannot-center/panorama-placeholder.svg';
import idyllicPlaceholder from '../../../assets/random/view-master/idyllic-decay/landscape-placeholder.svg';

import './ViewMasterPeephole.css';

export const VIEW_MASTER_SCENE_COUNT = 4;
export const VIEW_MASTER_CHANGE_DURATION_MS = 260;
export const PAN_EDGE_PADDING_PX = 18;
export const CANNOT_CENTER_THRESHOLD_PX = 72;
export const CANNOT_CENTER_RESISTANCE_PX = 22;
export const CANNOT_CENTER_TARGET_X = 0.64;
export const IDYLLIC_DECAY_STAGE_MS = 5200;

type Point = { x: number; y: number };

type PannableSceneProps = {
  src: string;
  alt: string;
  initialX: number;
  initialY?: number;
  resistCenter?: boolean;
  sceneClassName?: string;
  children?: ReactNode;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function PannableScene({
  src,
  alt,
  initialX,
  initialY = 0.5,
  resistCenter = false,
  sceneClassName,
  children,
}: PannableSceneProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; pointer: Point; offset: Point } | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const getBounds = useCallback(() => {
    const viewport = viewportRef.current;
    const scene = sceneRef.current;
    if (!viewport || !scene) return null;

    return {
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      sceneWidth: scene.offsetWidth,
      sceneHeight: scene.offsetHeight,
      minX: Math.min(PAN_EDGE_PADDING_PX, viewport.clientWidth - scene.offsetWidth - PAN_EDGE_PADDING_PX),
      maxX: PAN_EDGE_PADDING_PX,
      minY: Math.min(PAN_EDGE_PADDING_PX, viewport.clientHeight - scene.offsetHeight - PAN_EDGE_PADDING_PX),
      maxY: PAN_EDGE_PADDING_PX,
    };
  }, []);

  const resetOffset = useCallback(() => {
    const bounds = getBounds();
    if (!bounds) return;

    setOffset({
      x: bounds.maxX + (bounds.minX - bounds.maxX) * initialX,
      y: bounds.maxY + (bounds.minY - bounds.maxY) * initialY,
    });
  }, [getBounds, initialX, initialY]);

  useEffect(() => {
    resetOffset();
    window.addEventListener('resize', resetOffset);
    return () => window.removeEventListener('resize', resetOffset);
  }, [resetOffset]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      pointer: { x: event.clientX, y: event.clientY },
      offset,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bounds = getBounds();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;

    let nextX = clamp(
      drag.offset.x + event.clientX - drag.pointer.x,
      bounds.minX,
      bounds.maxX,
    );
    const nextY = clamp(
      drag.offset.y + event.clientY - drag.pointer.y,
      bounds.minY,
      bounds.maxY,
    );

    if (resistCenter) {
      const targetInViewport = nextX + bounds.sceneWidth * CANNOT_CENTER_TARGET_X;
      const distanceFromCenter = targetInViewport - bounds.viewportWidth / 2;

      if (Math.abs(distanceFromCenter) < CANNOT_CENTER_THRESHOLD_PX) {
        const side = distanceFromCenter === 0
          ? (event.clientX - drag.pointer.x > 0 ? 1 : -1)
          : Math.sign(distanceFromCenter);
        const proximity = 1 - Math.abs(distanceFromCenter) / CANNOT_CENTER_THRESHOLD_PX;
        nextX = clamp(
          nextX + side * CANNOT_CENTER_RESISTANCE_PX * proximity,
          bounds.minX,
          bounds.maxX,
        );
      }
    }

    setOffset({ x: nextX, y: nextY });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div
      ref={viewportRef}
      className={`view-master-pan-viewport ${isDragging ? 'view-master-pan-viewport--dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={sceneRef}
        className={`view-master-pan-scene ${sceneClassName ?? ''}`}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      >
        <img src={src} alt={alt} draggable="false" onLoad={resetOffset} />
        {children}
      </div>
    </div>
  );
}

function HotelScene() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 2600),
      window.setTimeout(() => setStage(2), 2850),
      window.setTimeout(() => setStage(1), 3050),
      window.setTimeout(() => setStage(3), 3300),
      window.setTimeout(() => setStage(4), 3900),
      window.setTimeout(() => setStage(3), 5100),
      window.setTimeout(() => setStage(5), 5600),
    ];

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  return (
    <div
      className={`view-master-static-scene view-master-hotel-scene view-master-hotel-scene--stage-${stage}`}
    >
      <img
        src={hotelHallway.src}
        alt="An empty hotel hallway"
        draggable="false"
      />

      <div className="view-master-hotel-darkness" aria-hidden="true" />

      <div className="view-master-hotel-twins" aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}

function PictureWindowScene() {
  return (
    <PannableScene
      src={calvinHobbesStars.src}
      alt="A starry Calvin and Hobbes scene with a quote"
      initialX={0.1}
      initialY={0.18}
      sceneClassName="view-master-pan-scene--picture-window"
    />
  );
}

function CannotCenterScene() {
  return (
    <PannableScene
      src={cannotCenterPlaceholder.src}
      alt="A dim panorama containing a distant doorway"
      initialX={0.66}
      initialY={0.52}
      resistCenter
    >
      <div className="view-master-resistant-target" aria-hidden="true">
        <span />
      </div>
    </PannableScene>
  );
}

function IdyllicDecayScene() {
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

const scenes = [HotelScene, PictureWindowScene, CannotCenterScene, IdyllicDecayScene];

export default function ViewMasterPeephole() {
  const [isOpen, setIsOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [isChanging, setIsChanging] = useState(false);
  const changeTimerRef = useRef<number | null>(null);
  const Scene = scenes[sceneIndex];

  useEffect(() => () => {
    if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
  }, []);

  const advanceScene = () => {
    if (isChanging) return;
    setIsChanging(true);
    changeTimerRef.current = window.setTimeout(() => {
      setSceneIndex((current) => (current + 1) % VIEW_MASTER_SCENE_COUNT);
      setIsChanging(false);
      changeTimerRef.current = null;
    }, VIEW_MASTER_CHANGE_DURATION_MS);
  };

  return (
    <aside className={`view-master ${isOpen ? 'view-master--open' : ''}`}>
      {!isOpen ? (
        <button
          type="button"
          className="view-master-launcher"
          aria-label="Open viewer"
          onClick={() => setIsOpen(true)}
        >
          <span aria-hidden="true" />
        </button>
      ) : (
        <div className="view-master-body" role="dialog" aria-label="Small scene viewer">
          <div className={`view-master-aperture ${isChanging ? 'view-master-aperture--changing' : ''}`}>
            <Scene />
          </div>

          <button
            type="button"
            className="view-master-close"
            aria-label="Close viewer"
            onClick={() => setIsOpen(false)}
          >
            ×
          </button>

          <button
            type="button"
            className="view-master-advance"
            aria-label="Change view"
            onClick={advanceScene}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
