/** @jsxImportSource react */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

/*
 * <ParticleLogo src="/uh-logo.png" />
 *
 * Draws particles in the shape of an image and scatters them away from the
 * pointer. The image is whatever you pass as `src`: a URL on your own site, a
 * host that sends CORS headers, or a data: URI. Nothing is embedded here.
 *
 * The parent sets the size, either through `className` / `style` or by
 * wrapping the component in a sized element. With no height it falls back to
 * a square.
 */

export type ParticleLogoProps = {
  /** URL, blob: URL or base64 data URI of the image to turn into particles. */
  src: string;
  /** px between particles */
  spacing?: number;
  /** explosion radius in px */
  radius?: number;
  /** share of the container the logo fills */
  fit?: number;
  /** explosion strength */
  kick?: number;
  /** pull back toward the logo (lower is slower) */
  spring?: number;
  /** velocity kept per frame */
  damping?: number;
  maxParticles?: number;
  restColor?: string;
  activeColor?: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** Called when the image fails to load. */
  onError?: () => void;
};

type Config = {
  spacing: number;
  radius: number;
  fit: number;
  kick: number;
  spring: number;
  damping: number;
  maxParticles: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  armed: boolean;
};

const REST_COLOR = '#231F20';
const ACTIVE_COLOR = '#C8102E';

function hexToRgb(s: string): [number, number, number] {
  let h = s.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makePalette(rest: string, active: string): string[] {
  const a = hexToRgb(rest);
  const b = hexToRgb(active);
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const rgb = a.map((v, j) => Math.round(v + ((b[j] ?? v) - v) * t));
    out.push(`rgb(${rgb.join(',')})`);
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

export default function ParticleLogo({
  src,
  spacing = 3,
  radius = 20,
  fit = 0.72,
  kick = 20,
  spring = 0.03,
  damping = 0.87,
  maxParticles = 9000,
  restColor = REST_COLOR,
  activeColor = ACTIVE_COLOR,
  className,
  style,
  ariaLabel = 'Logo made of particles',
  onError,
}: ParticleLogoProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live settings are read from refs so changing them does not restart the effect
  // (and re-scatter the particles). Only src and colors rebuild everything.
  const cfgRef = useRef<Config>({ spacing, radius, fit, kick, spring, damping, maxParticles });
  cfgRef.current = { spacing, radius, fit, kick, spring, damping, maxParticles };
  const onErrorRef = useRef<(() => void) | undefined>(onError);
  onErrorRef.current = onError;
  const applyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const hostEl = hostRef.current;
    const cvEl = canvasRef.current;
    if (!hostEl || !cvEl || !src) return undefined;
    const host: HTMLDivElement = hostEl;
    const cv: HTMLCanvasElement = cvEl;

    const ctx2d = cv.getContext('2d');
    if (!ctx2d) return undefined;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const palette = makePalette(restColor, activeColor);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0;
    let H = 0;
    const parts: Particle[] = [];
    const img = new Image();
    let loaded = false;
    let first = true;
    let visible = true;
    let looping = false;
    let rafId = 0;
    let resizeRaf = 0;
    let disposed = false;
    let last = performance.now();
    let io: IntersectionObserver | null = null;
    const ptr = { x: -9999, y: -9999, vx: 0, vy: 0, on: false };

    function buildTargets(): [number, number][] {
      const { spacing: gap, fit: fitNow, maxParticles: cap } = cfgRef.current;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const o = off.getContext('2d', { willReadFrequently: true });
      if (!o) return [];

      const iw = img.naturalWidth || 300;
      const ih = img.naturalHeight || 300;
      const s = Math.min((W * fitNow) / iw, (H * fitNow) / ih);
      o.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);

      const d = o.getImageData(0, 0, W, H).data;
      let transparent = false;
      for (let k = 3; k < d.length; k += 4) {
        if ((d[k] ?? 255) < 250) { transparent = true; break; }
      }
      const b0 = d[0] ?? 0;
      const b1 = d[1] ?? 0;
      const b2 = d[2] ?? 0;
      // Sample by grid cell instead of by single points. A thin stroke can slip
      // between point samples when the spacing is large, leaving gaps. Instead,
      // every pixel votes for its cell, and a cell with enough ink gets one
      // particle at the center of that ink.
      const cols = Math.ceil(W / gap);
      const rows = Math.ceil(H / gap);
      const hits = new Uint32Array(cols * rows);
      const sumX = new Float32Array(cols * rows);
      const sumY = new Float32Array(cols * rows);
      for (let y = 0; y < H; y++) {
        const rowStart = Math.floor(y / gap) * cols;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = d[i] ?? 0;
          const g = d[i + 1] ?? 0;
          const b = d[i + 2] ?? 0;
          const a = d[i + 3] ?? 0;
          const hit = transparent
            ? a > 128 && r + g + b < 690
            : Math.abs(r - b0) + Math.abs(g - b1) + Math.abs(b - b2) > 90;
          if (!hit) continue;
          const c = rowStart + Math.floor(x / gap);
          hits[c] = (hits[c] ?? 0) + 1;
          sumX[c] = (sumX[c] ?? 0) + x + 0.5;
          sumY[c] = (sumY[c] ?? 0) + y + 0.5;
        }
      }
      const minHits = Math.max(1, Math.round(gap * gap * 0.15));
      const pts: [number, number][] = [];
      for (let c = 0; c < hits.length; c++) {
        const n = hits[c] ?? 0;
        if (n < minHits) continue;
        pts.push([(sumX[c] ?? 0) / n, (sumY[c] ?? 0) / n]);
      }
      shuffle(pts);
      if (pts.length > cap) pts.length = cap;
      return pts;
    }

    function applyTargets() {
      const pts = buildTargets();
      const n = pts.length;
      if (parts.length > n) parts.length = n;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const t = pts[i];
        if (p && t) {
          p.tx = t[0];
          p.ty = t[1];
        }
      }
      for (let j = parts.length; j < n; j++) {
        const t = pts[j];
        if (!t) continue;
        const scatter = first && !reduced;
        parts.push({
          x: scatter ? Math.random() * W : t[0],
          y: scatter ? Math.random() * H : t[1],
          vx: 0,
          vy: 0,
          tx: t[0],
          ty: t[1],
          armed: true,
        });
      }
      first = false;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(host.clientWidth));
      H = Math.max(1, Math.round(host.clientHeight));
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      applyTargets();
    }

    function setPtr(e: PointerEvent) {
      const r = cv.getBoundingClientRect();
      const nx = e.clientX - r.left;
      const ny = e.clientY - r.top;
      if (ptr.on) { ptr.vx = nx - ptr.x; ptr.vy = ny - ptr.y; } else { ptr.vx = 0; ptr.vy = 0; }
      ptr.x = nx;
      ptr.y = ny;
      ptr.on = true;
    }
    const onLeave = () => { ptr.on = false; };
    const onUp = (e: PointerEvent) => { if (e.pointerType === 'touch') ptr.on = false; };
    cv.addEventListener('pointermove', setPtr);
    cv.addEventListener('pointerdown', setPtr);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('pointercancel', onLeave);
    cv.addEventListener('pointerup', onUp);

    function frame(now: number) {
      if (disposed || !visible) { looping = false; return; }
      const dt = Math.min(2, (now - last) / 16.67);
      last = now;
      const { radius: R, kick: kickNow, spring: springNow, damping: dampNow, spacing: gap } = cfgRef.current;
      const R2 = R * R;
      const boost = 0.6 + (Math.min(30, Math.hypot(ptr.vx, ptr.vy)) / 30) * 0.8;
      ptr.vx *= 0.8;
      ptr.vy *= 0.8;
      const damp = Math.pow(dampNow, dt);
      const sz = Math.max(1.5, gap * 0.42);
      ctx.clearRect(0, 0, W, H);
      let lastB = -1;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p) continue;
        const ax = (p.tx - p.x) * springNow;
        const ay = (p.ty - p.y) * springNow;
        if (ptr.on) {
          const dx = p.x - ptr.x;
          const dy = p.y - ptr.y;
          const d2 = dx * dx + dy * dy;
          if (p.armed) {
            if (d2 < R2) {
              // One kick per visit, so particles drift home even if the pointer stays put.
              p.armed = false;
              const d = Math.sqrt(d2) || 1;
              const f = (1 - (d / R) * 0.6) * kickNow * boost * (0.5 + Math.random() * 1.1);
              const a = Math.random() * 6.283;
              p.vx += (dx / d + Math.cos(a) * 0.15) * f;
              p.vy += (dy / d + Math.sin(a) * 0.15) * f;
            }
          } else {
            const tx2 = p.tx - ptr.x;
            const ty2 = p.ty - ptr.y;
            if (tx2 * tx2 + ty2 * ty2 > R2 * 1.5) p.armed = true;
          }
        } else {
          p.armed = true;
        }
        p.vx = (p.vx + ax * dt) * damp;
        p.vy = (p.vy + ay * dt) * damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const m = Math.hypot(p.tx - p.x, p.ty - p.y) / 70;
        const b = m >= 1 ? 7 : (m * 7) | 0;
        if (b !== lastB) { ctx.fillStyle = palette[b] ?? restColor; lastB = b; }
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      rafId = requestAnimationFrame(frame);
    }

    function startLoop() {
      if (looping || disposed) return;
      looping = true;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }

    applyRef.current = () => {
      if (loaded && W > 0 && !disposed) applyTargets();
    };

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { if (loaded && !disposed) resize(); });
    });

    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (disposed) return;
      loaded = true;
      resize();
      ro.observe(host);
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible) startLoop();
        });
        io.observe(host);
      }
      startLoop();
    };
    img.onerror = () => {
      if (onErrorRef.current) onErrorRef.current();
      console.error(
        `ParticleLogo: could not load ${src.slice(0, 60)}. Check the path, and that the file is on the same site or served with CORS headers.`,
      );
    };
    img.src = src;

    return () => {
      disposed = true;
      applyRef.current = null;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      if (io) io.disconnect();
      cv.removeEventListener('pointermove', setPtr);
      cv.removeEventListener('pointerdown', setPtr);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('pointercancel', onLeave);
      cv.removeEventListener('pointerup', onUp);
      img.onload = null;
      img.onerror = null;
    };
  }, [src, restColor, activeColor]);

  // A spacing change re-samples the logo in place, keeping the particles where they are.
  useEffect(() => {
    if (applyRef.current) applyRef.current();
  }, [spacing, fit, maxParticles]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 200,
        aspectRatio: '1 / 1',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'pan-y' }}
      />
    </div>
  );
}
