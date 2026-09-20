/** @jsxImportSource react */

import './Home.css';
import DoNotClick from '../components/react/home/DoNotClick';
import GameSection from '../components/react/home/GameSection';
import UndertakerSequence from '../components/react/home/UndertakerSequence';

import CanvasPageNavigation from '../components/react/CanvasPageNavigation';

/** Founder Contribution #000 home canvas. */
export default function Home() {
  return (
    <div className="canvas-home">
      <CanvasPageNavigation currentPath="/" />

      <p className="canvas-home-desktop-note">
        this is best experienced on a computer. get off your phone
      </p>

      <main className="canvas-home-content">
        <section className="canvas-home-intro">
          <DoNotClick/>

          <div className="canvas-home-placeholder">
            DON'T BUY THIS COIN
          </div>
        </section>

        <section className="canvas-home-game">
          <GameSection />
        </section>

        <section className="canvas-home-undertaker">
          <UndertakerSequence />
        </section>

        <section className="canvas-home-o2lift">
          <div className="canvas-home-placeholder">
            pls buy these inhalers pls
          </div>
        </section>
      </main>
    </div>
  );
}
