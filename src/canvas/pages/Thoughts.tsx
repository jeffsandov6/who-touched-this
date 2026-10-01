/** @jsxImportSource react */

import CanvasPageNavigation from '../components/react/CanvasPageNavigation';
import HitchhikerTerminal from '../components/react/thoughts/HitchhikerTerminal';
import JustBuild from '../components/react/thoughts/JustBuild';
import ShouldTheseExist from '../components/react/thoughts/ShouldTheseExist';

import './Thoughts.css';

export default function Thoughts() {
  return (
    <div className="canvas-thoughts">
      <CanvasPageNavigation currentPath="/thoughts" />

      <article className="thoughts-notebook">
        <header className="thoughts-intro">
          <h1>
            i am an expert at nothing, these are just some thoughts
          </h1>
        </header>

        <JustBuild />

        <HitchhikerTerminal />

        <p className="thoughts-fragment">
          websites usually have a purpose. this one has a queue.
        </p>

        <p className="thoughts-fragment thoughts-fragment-indent">
          software should be allowed to be pointless sometimes.
        </p>

        <ShouldTheseExist />

        <p className="thoughts-fragment">
          not every website needs to become a company.
        </p>

        <div className="thoughts-section thoughts-expandable">
          <details>
            <summary>i still like the original idea</summary>

            <div className="thoughts-note-body">
              <p>
                take away the charts, speculation, influencers &amp;
                number-go-up culture and decentralized digital money is still
                an incredibly interesting idea to me.
              </p>

              <p>
                i think that's the part i've always liked.
              </p>
            </div>
          </details>

          <details>
            <summary>one person and a lot of software</summary>

            <div className="thoughts-note-body">
              <p>
                maybe the interesting ai question is not whether it gets cheap
                enough to replace five people, but whether it makes one person
                productive enough that paying for it costs less than keeping
                five people. i do not know if that is what happens.
              </p>
            </div>
          </details>
        </div>

        <section
          className="thoughts-section thoughts-contextless"
          aria-labelledby="no-context"
        >
          <h2 id="no-context">
            notes with no context
          </h2>

          <ul>
            <li>onerhofer the man</li>
            <li>the avalanches going home</li>
            <li>ObservePoint - w/ James Tillman</li>
          </ul>
        </section>

        <aside
          className="thoughts-quotes"
          aria-label="quotes"
        >
          <blockquote>
            “you can just do things”
          </blockquote>

          <blockquote>
            “move fast and break things”
          </blockquote>
        </aside>

        <p className="thoughts-fragment thoughts-fragment-indent">
          eventually somebody is going to delete this sentence
        </p>

        <footer className="thoughts-ending">
          <p>
            i think the person after me should
          </p>
        </footer>
      </article>
    </div>
  );
}
