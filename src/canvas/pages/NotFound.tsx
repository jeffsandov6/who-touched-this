/** @jsxImportSource react */

import './NotFound.css';

export default function NotFound() {
  return (
    <section className="canvas-not-found" aria-labelledby="not-found-title">
      <div className="not-found-map">
        <div className="not-found-map__heading">
          <p className="not-found-map__code">404</p>
          <h1 id="not-found-title">you are not here</h1>
          <p>you found somewhere that doesn&apos;t exist</p>
        </div>

        <svg
          className="not-found-map__drawing"
          viewBox="0 0 640 360"
          role="img"
          aria-label="a useless treasure map leading to nowhere"
        >
          <path
            className="not-found-map__land"
            d="M76 83
              C124 50 190 61 226 90
              C262 119 294 112 327 80
              C369 39 432 55 453 91
              C472 123 519 119 552 103
              C578 90 601 112 589 139
              C571 180 590 209 606 237
              C621 264 591 292 555 285
              C506 276 478 292 451 316
              C421 342 374 324 350 299
              C319 267 280 273 245 307
              C214 337 168 326 158 294
              C147 258 111 254 81 268
              C48 283 27 246 47 218
              C70 185 69 158 53 129
              C39 104 50 91 76 83Z"
          />

          <path
            className="not-found-map__contour"
            d="M113 133 C170 100 216 124 250 151"
          />
          <path
            className="not-found-map__contour"
            d="M391 247 C441 213 493 220 537 250"
          />

          <path
            className="not-found-map__trail"
            d="M118 273
              C153 237 197 267 225 224
              C252 183 218 154 260 131
              C303 108 328 166 369 169
              C418 173 420 118 466 109
              C493 104 507 92 520 79"
          />

          <circle className="not-found-map__start" cx="117" cy="273" r="7" />

          <g className="not-found-map__x" transform="translate(520 79)">
            <path d="M-15 -15 L15 15" />
            <path d="M15 -15 L-15 15" />
          </g>

          <g
            className="not-found-map__compass"
            transform="translate(92 91)"
            aria-hidden="true"
          >
            <circle cx="0" cy="0" r="25" />
            <path d="M0 -18 L6 0 L0 18 L-6 0Z" />
            <text x="0" y="-32" textAnchor="middle">
              n
            </text>
          </g>

          <text className="not-found-map__label" x="454" y="51">
            you are not here
          </text>
        </svg>

        <a className="not-found-map__home" href="/">
          ← go back home
        </a>
      </div>
    </section>
  );
}