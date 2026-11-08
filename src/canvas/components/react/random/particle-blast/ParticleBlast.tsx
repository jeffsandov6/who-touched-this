/** @jsxImportSource react */

import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import ParticleLogo from './ParticleLogo';

import './ParticleBlast.css';

const DEFAULT_SPACING = 3;
const DEFAULT_RADIUS = 20;

type ParticleBlastProps = {
  /** Default logo: a URL or base64 data URI. Reset returns to this. */
  src: string;
};

export default function ParticleBlast({ src }: ParticleBlastProps) {
  const uid = useId();
  const spacingId = `${uid}-spacing`;
  const radiusId = `${uid}-radius`;
  const fileId = `${uid}-file`;

  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [customSrc, setCustomSrc] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const objectUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => revokeObjectUrl, []);

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage('that file is not an image.');
      return;
    }

    revokeObjectUrl();
    objectUrlRef.current = URL.createObjectURL(file);
    setCustomSrc(objectUrlRef.current);
    setMessage('');
  };

  const handleReset = () => {
    revokeObjectUrl();
    setCustomSrc(null);
    setSpacing(DEFAULT_SPACING);
    setRadius(DEFAULT_RADIUS);
    setMessage('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleImageError = () => {
    if (!customSrc) return;
    revokeObjectUrl();
    setCustomSrc(null);
    setMessage('could not read that image, so the default is back.');
  };

  return (
    <section
      className="particle-blast"
      aria-labelledby="particle-blast-title"
    >
      <div className="particle-blast-header">
        <p className="particle-blast-kicker">particle blast</p>

        <h2 id="particle-blast-title">
          hover
        </h2>
      </div>

      <div className="particle-blast-stage">
        <ParticleLogo
          src={customSrc ?? src}
          spacing={spacing}
          radius={radius}
          restColor="#302f2a"
          activeColor="#c8102e"
          onError={handleImageError}
          ariaLabel="Logo made of particles that scatter away from your pointer"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            minHeight: 0,
            aspectRatio: 'auto',
          }}
        />
      </div>

      <div className="particle-blast-controls">
        <div className="particle-blast-row">
          <label htmlFor={radiusId}>
            explosion radius
            <output htmlFor={radiusId}>{radius} px</output>
          </label>
          <input
            id={radiusId}
            type="range"
            min={5}
            max={120}
            step={5}
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value))}
          />
        </div>

        <div className="particle-blast-row">
          <label htmlFor={spacingId}>
            spacing
            <output htmlFor={spacingId}>{spacing} px</output>
          </label>
          <input
            id={spacingId}
            type="range"
            min={2}
            max={8}
            step={1}
            value={spacing}
            onChange={(event) => setSpacing(Number(event.target.value))}
          />
        </div>

        <div className="particle-blast-actions">
          <label className="particle-blast-button" htmlFor={fileId}>
            upload image
          </label>
          <input
            ref={fileRef}
            id={fileId}
            className="particle-blast-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            onChange={handleUpload}
          />

          <button
            className="particle-blast-button"
            type="button"
            onClick={handleReset}
          >
            reset
          </button>
        </div>

        <p className="particle-blast-note" aria-live="polite">
          {message || 'a transparent png works best. uploads stay in your browser.'}
        </p>
      </div>
    </section>
  );
}
