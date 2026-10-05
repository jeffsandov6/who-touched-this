/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';

import HotelScene from './scenes/HotelScene';
import IdyllicDecayScene from './scenes/IdyllicDecayScene';
import PeripheralScene from './scenes/PeripheralScene';
import PictureWindowScene from './scenes/PictureWindowScene';

import './ViewMasterPeephole.css';

export const VIEW_MASTER_SCENE_COUNT = 4;
export const VIEW_MASTER_CHANGE_DURATION_MS = 260;

const scenes = [HotelScene, PictureWindowScene, PeripheralScene, IdyllicDecayScene];

export default function ViewMasterPeephole() {
  const [isOpen, setIsOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [isChanging, setIsChanging] = useState(false);
  const changeTimerRef = useRef<number | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpenedRef = useRef(false);
  const Scene = scenes[sceneIndex];

  useEffect(() => () => {
    if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
  }, []);

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      closeButtonRef.current?.focus();
    } else if (hasOpenedRef.current) {
      launcherRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

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
          ref={launcherRef}
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
            ref={closeButtonRef}
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
