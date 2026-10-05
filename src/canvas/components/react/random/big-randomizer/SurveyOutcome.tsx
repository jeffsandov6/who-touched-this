/** @jsxImportSource react */

import { useState } from 'react';

export default function SurveyOutcome() {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);

  return (
    <div className="big-randomizer-survey">
      {answer === null ? (
        <>
          <p>are you enjoying yourself?</p>

          <div className="big-randomizer-survey-actions">
            <button
              type="button"
              onClick={() => setAnswer('yes')}
            >
              yes
            </button>

            <button
              type="button"
              onClick={() => setAnswer('no')}
            >
              hell nah
            </button>
          </div>
        </>
      ) : (
        <p>
          {answer === 'yes'
            ? 'concerning'
            : 'reasonable'}
        </p>
      )}
    </div>
  );
}