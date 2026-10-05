/** @jsxImportSource react */

import './JustBuild.css';


export default function JustBuild() {
  return (
    <section className="thoughts-build" aria-labelledby="just-build">
      <header className="thoughts-build-heading">
        <span aria-hidden="true">01</span>
        <h2 id="just-build">just build</h2>
      </header>

      <section
        className="thoughts-build-possibility"
        aria-labelledby="just-do-things"
      >
        <h3 id="just-do-things">
          you can just do things. you should just do things
        </h3>

        <div className="thoughts-build-note">
          <p>
            some things get built because somebody thinks they should exist
          </p>

          <p>
            some get built because somebody thinks they can make money
          </p>

          <p className="thoughts-build-note-conclusion">
            just build
          </p>
        </div>
      </section>

      <section
        className="thoughts-build-counterpoint"
        aria-labelledby="lose-money"
      >
        <h3 id="lose-money">
          you can also lose money doing things
        </h3>

        <a
          className="thoughts-loot-drop"
          href="https://www.loot-drop.io/"
          target="_blank"
          rel="noreferrer"
          aria-label="visit Loot Drop at loot-drop.io (opens in a new tab)"
        >
          <span className="thoughts-loot-drop-file">
            case file / 001
          </span>

          <span className="thoughts-loot-drop-name">
            Loot Drop
          </span>

          <span className="thoughts-loot-drop-kind">
            startup graveyard · click to explore
          </span>

          <span className="thoughts-loot-drop-domain">
            loot-drop.io ↗
          </span>

          <span className="thoughts-loot-drop-metrics">
            <span>
              <strong>1,700+</strong>
              dead startups
            </span>

            <span>
              <strong>$500B+</strong>
              capital burned
            </span>
          </span>

          <span className="thoughts-loot-drop-context">
            a database of startups that got built, raised money, and still
            failed. a lot of things do.
          </span>

          <span className="thoughts-loot-drop-finding">
            you should still do things
          </span>
        </a>
      </section>
    </section>
  );
}