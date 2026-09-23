/** @jsxImportSource react */

import './Home.css';
import DoNotClick from '../components/react/home/DoNotClick';
import WttCoin from '../components/react/home/WttCoin';
import GameSection from '../components/react/home/GameSection';
import UndertakerSequence from '../components/react/home/UndertakerSequence';
import O2LiftAd from '../components/react/home/O2LiftAd';

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
          <WttCoin />
        </section>

        <section className="canvas-home-game">
          <GameSection />
        </section>

        <section className="canvas-home-undertaker">
          <UndertakerSequence />
        </section>

        <section className="canvas-home-o2lift">
          <O2LiftAd />
        </section>
      </main>
    </div>
  );
}
