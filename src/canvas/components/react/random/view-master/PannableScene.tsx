/** @jsxImportSource react */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import './PannableScene.css';

export const PAN_EDGE_PADDING_PX = 18;

export type Point = { x: number; y: number };

type PannableSceneProps = {
  src: string;
  alt: string;
  initialX: number;
  initialY?: number;
  sceneClassName?: string;
  children?: ReactNode;
  onPan?: (offset: Point, deltaX: number) => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function PannableScene({
  src,
  alt,
  initialX,
  initialY = 0.5,
  sceneClassName,
  children,
  onPan,
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

    const nextOffset = { x: nextX, y: nextY };

    setOffset(nextOffset);
    onPan?.(nextOffset, event.clientX - drag.pointer.x);
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
