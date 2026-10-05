/** @jsxImportSource react */

import { useState } from 'react';

import catAliveImage from '../../../../assets/random/big-randomizer/cat-alive.png';
import catDeadImage from '../../../../assets/random/big-randomizer/cat-dead.png';

type CatState = 'alive' | 'dead' | 'unresolved' | null;

export default function SchrodingersCatOutcome() {
  const [catState, setCatState] = useState<CatState>(null);

  const moveOn = () => {
    if (catState !== null) {
      return;
    }

    setCatState('unresolved');
  };

  const openBox = () => {
    if (catState !== null) {
      return;
    }

    setCatState(Math.random() < 0.5 ? 'alive' : 'dead');
  };

  return (
    <div className="big-randomizer-cat">
      <p className="big-randomizer-cat-title">
        schrödinger&apos;s cat
      </p>

      {catState === null && (
        <div className="big-randomizer-cat-intro">
          <button
            className="big-randomizer-cat-box"
            type="button"
            onClick={openBox}
            aria-label="Open the box"
          >
            <span
              className="big-randomizer-cat-lid"
              aria-hidden="true"
            />

            <span
              className="big-randomizer-cat-box-label"
              aria-hidden="true"
            >
              ?
            </span>
          </button>

          <div className="big-randomizer-cat-copy">
            <p>
              there is a cat in this box.
            </p>

            <p>
              right now, until you look, the cat is currently in a
              superposition of alive and dead.
            </p>
          </div>

          <div className="big-randomizer-cat-actions">
            <button
              className="big-randomizer-cat-action"
              type="button"
              onClick={moveOn}
            >
              move on. leave the cat alone.
            </button>

            <button
              className="big-randomizer-cat-action"
              type="button"
              onClick={openBox}
            >
              take the chance. open the box.
            </button>
          </div>
        </div>
      )}

      {catState === 'unresolved' && (
        <div className="big-randomizer-cat-result">
          <strong>you chose not to look.</strong>

          <div className="big-randomizer-cat-result-copy">
            <p>the cat remains in superposition.</p>
            <p>probably for the best.</p>
          </div>
        </div>
      )}

      {catState === 'alive' && (
        <div className="big-randomizer-cat-result">
          <img
            className="big-randomizer-cat-image"
            src={catAliveImage.src}
            alt="A cute alive cat"
            draggable="false"
          />

          <strong>you opened the box</strong>

          <div className="big-randomizer-cat-result-copy">
            <p>now we know the cat is alive</p>
            <p>you got lucky</p>
          </div>
        </div>
      )}

      {catState === 'dead' && (
        <div className="big-randomizer-cat-result">
          <img
            className="big-randomizer-cat-image"
            src={catDeadImage.src}
            alt="A cute cat with red Xs over its eyes"
            draggable="false"
          />

          <strong>you opened the box</strong>

          <div className="big-randomizer-cat-result-copy">
            <p>now we know the cat is dead</p>
            <p>in a sense, you killed the cat</p>
          </div>
        </div>
      )}
    </div>
  );
}