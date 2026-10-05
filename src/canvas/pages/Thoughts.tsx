/** @jsxImportSource react */

import CanvasPageNavigation from '../components/react/CanvasPageNavigation';
import Corkboard from '../components/react/thoughts/Corkboard';
import HitchhikerTerminal from '../components/react/thoughts/HitchhikerTerminal';
import JustBuild from '../components/react/thoughts/JustBuild';
import ShouldTheseExist from '../components/react/thoughts/ShouldTheseExist';
import DrunkThoughts from "../components/react/thoughts/DrunkThoughts";

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

        <p className="thoughts-fragment thoughts-fragment-indent">
          software should be allowed to be pointless sometimes
        </p>

        <ShouldTheseExist />

        <Corkboard />

        <p className="thoughts-fragment">
          does every idea have to become a business?
        </p>

        <DrunkThoughts />

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
