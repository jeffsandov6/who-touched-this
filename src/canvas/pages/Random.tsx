/** @jsxImportSource react */

import CanvasPageNavigation from '../components/react/CanvasPageNavigation';
import GravityGlitch from '../components/react/random/GravityGlitch';
import LiveCodeBreakdown from '../components/react/random/LiveCodeBreakdown';
import PokemonIntrusions from '../components/react/random/PokemonIntrusions';
import RareAlternateReality from '../components/react/random/RareAlternateReality';
import ViewMasterPeephole from '../components/react/random/view-master/ViewMasterPeephole';
import WrongPerspectiveObject from '../components/react/random/WrongPerspectiveObject';

import './Random.css';

/** Founder Contribution #000 random canvas. */
export default function Random() {
  return (
    <div className="canvas-random">
      <CanvasPageNavigation currentPath="/random" />

      <RareAlternateReality>
        <main className="canvas-random-content">
          <GravityGlitch />
          <LiveCodeBreakdown />
          <WrongPerspectiveObject />
        </main>
      </RareAlternateReality>

      <PokemonIntrusions />
      <ViewMasterPeephole />
    </div>
  );
}
