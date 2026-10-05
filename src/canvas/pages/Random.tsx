/** @jsxImportSource react */

import CanvasPageNavigation from '../components/react/CanvasPageNavigation';
import GravityGlitch from '../components/react/random/GravityGlitch';
import LiveCodeBreakdown from '../components/react/random/LiveCodeBreakdown';
import PokemonIntrusions from '../components/react/random/PokemonIntrusions';
import RareAlternateReality from '../components/react/random/RareAlternateReality';
import ViewMasterPeephole from '../components/react/random/view-master/ViewMasterPeephole';
import WrongPerspectiveObject from '../components/react/random/WrongPerspectiveObject';
import BigRandomizer from '../components/react/random/big-randomizer/BigRandomizer';
import ThingsOnTheInternet from '../components/react/random/things-on-the-internet/ThingsOnTheInternet';

import './Random.css';

/** Founder Contribution #000 random canvas. */
export default function Random() {
  return (
    <div className="canvas-random">
      <CanvasPageNavigation currentPath="/random" />

      <p className="canvas-random-desktop-note">
        this is best experienced on a computer. get off your phone
      </p>

      <RareAlternateReality>
        <main className="canvas-random-content">
          <GravityGlitch />
          <LiveCodeBreakdown />
          <WrongPerspectiveObject />
          <div className="canvas-random-toy-row">
            <ThingsOnTheInternet />
            <BigRandomizer />
          </div>
        </main>
      </RareAlternateReality>

      <PokemonIntrusions />
      <ViewMasterPeephole />
    </div>
  );
}
