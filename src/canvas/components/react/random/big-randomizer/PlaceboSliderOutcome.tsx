/** @jsxImportSource react */

import { useState } from 'react';

export default function PlaceboSliderOutcome() {
  const [values, setValues] = useState({
    quantum: 73,
    stochastic: 12,
    entropy: 89,
  });

  return (
    <div className="big-randomizer-placebo">
      <div className="big-randomizer-placebo-row">
        <label htmlFor="quantum-alignment">
          <span>quantum alignment</span>
          <output>{values.quantum}</output>
        </label>

        <input
          id="quantum-alignment"
          type="range"
          min="0"
          max="100"
          value={values.quantum}
          onChange={(event) => {
            setValues((current) => ({
              ...current,
              quantum: Number(event.target.value),
            }));
          }}
        />
      </div>

      <div className="big-randomizer-placebo-row">
        <label htmlFor="stochastic-resonance">
          <span>stochastic resonance</span>
          <output>{values.stochastic}</output>
        </label>

        <input
          id="stochastic-resonance"
          type="range"
          min="0"
          max="100"
          value={values.stochastic}
          onChange={(event) => {
            setValues((current) => ({
              ...current,
              stochastic: Number(event.target.value),
            }));
          }}
        />
      </div>

      <div className="big-randomizer-placebo-row">
        <label htmlFor="entropic-uncertainty">
          <span>entropic uncertainty</span>
          <output>{values.entropy}</output>
        </label>

        <input
          id="entropic-uncertainty"
          type="range"
          min="0"
          max="100"
          value={values.entropy}
          onChange={(event) => {
            setValues((current) => ({
              ...current,
              entropy: Number(event.target.value),
            }));
          }}
        />
      </div>

      <p className="big-randomizer-placebo-note">
        changes applied immediately.
      </p>
    </div>
  );
}