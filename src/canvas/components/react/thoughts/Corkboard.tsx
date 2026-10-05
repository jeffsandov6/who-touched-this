/** @jsxImportSource react */

import garciaDuarteTickets from '../../../assets/thoughts/corkboard/garcia-duarte-tickets.png';
import geminiBlueprint from '../../../assets/thoughts/corkboard/gemini_seat_stirrup.jpg';
import kunigami from '../../../assets/thoughts/corkboard/kunigami.png';
import nintendoSouvenir from '../../../assets/thoughts/corkboard/nintendo-world-souvenir.png';
import onDayCapture from '../../../assets/thoughts/corkboard/on-day-capture.jpg';
import petlink from '../../../assets/thoughts/corkboard/petlink-gianna-scouty.png';
import teslaCongratulations from '../../../assets/thoughts/corkboard/tesla-congratulations.png';

import './Corkboard.css';

const movies = [
  'ex machima',
  'casino de niro',
  'the revenant',
  'battle royal japanese movie',
];

const songs = [
  'doves - black and white town (fifa06)',
  'speed living - the grwlers',
  'LEBANON HANOVER - gallowdance',
  'zillakami - frailty',
  '(dont let the dragon) draag on',
  'EYEDRESS - JEALOUS',
  'tiene espinosas el rosal',
  'minyo cumbiero - ccumbia del monte fuji (japanese cumbia?)',
];

export default function Corkboard() {
  return (
    <section className="thoughts-corkboard-section" aria-label="Notes with no context">
      <p className="cork-mobile-hint">
        again, this website is <strong>MUCH</strong> better on a computer :) but you
        didn't listen. for this part, lock your phone orientation &amp; tilt it to
        the right →
      </p>
      <div className="thoughts-corkboard-rotation">
        <div className="thoughts-corkboard" aria-label="corkboard covered with saved artifacts and notes">
          <figure className="cork-item cork-photo cork-pinned cork-on-day">
            <img src={onDayCapture.src} alt="on day capture Invitational Series poster" />
          </figure>

          <figure className="cork-item cork-cutout cork-pinned cork-nintendo">
            <img src={nintendoSouvenir.src} alt="super nintendo world souvenir from Universal Studios Hollywood" />
          </figure>

          <figure className="cork-item cork-cutout cork-pinned cork-tickets">
            <img src={garciaDuarteTickets.src} alt="two garcia versus duarte keepsake tickets" />
          </figure>

          <figure className="cork-item cork-cutout cork-petlink">
            <img src={petlink.src} alt="petlink cards and tags belonging to gianna and scouty" />
          </figure>

          <figure className="cork-item cork-cutout cork-pinned cork-kunigami">
            <img src={kunigami.src} alt="kunigami rensuke character art" />
          </figure>

          <button
            type="button"
            className="cork-item cork-blueprint cork-pinned"
            aria-label="shift the context lost vellum over a gemini-era engineering drawing"
          >
            <img src={geminiBlueprint.src} alt="gemini-era seat stirrup engineering drawing" />
            <span className="cork-vellum">context lost</span>
          </button>

          <figure className="cork-item cork-cutout cork-tesla ">
            <img
              src={teslaCongratulations.src}
              alt="tesla congratulations sheet for jeff s. with a tiny waving hedgehog"
            />
          </figure>

          <article className="cork-item cork-sticky cork-bills cork-pinned">
            <pre>{`Rent          - 1st
Electricity - 11th
Discover    - 15th
Savor One - 22nd
Wifi           - 27th
Phone        - 28th`}</pre>
          </article>

          <article className="cork-item cork-sticky cork-movies cork-pinned">
            <h3>movies</h3>
            <ul>{movies.map((movie) => <li key={movie}>{movie}</li>)}</ul>
          </article>

          <article className="cork-item cork-sticky cork-songs cork-pinned">
            <h3>just some songs</h3>
            <ul>{songs.map((song) => <li key={song}>{song}</li>)}</ul>
          </article>

          <article className="cork-item cork-sticky cork-ideathon cork-pinned">
            <h3>IDEATHON</h3>
            <p>sharing/building ideas while we all get fucked up &amp; just chill</p>
          </article>

          <p className="cork-item cork-scrap cork-sneaker cork-taped">SNEAKER BOT</p>

          <article className="cork-item cork-paper cork-ddos cork-pinned">
            <pre>{String.raw`DDOS Attack
-> attack through auth/
sign up/login? are there
rate limiters on these?
________________________
use fake emails w/ all email
components but in a bad order?
me.com@gmail ?
if the validator is on FE,
no way this works`}</pre>
            <span className="cork-ddos-scribble" aria-hidden="true">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M4 8 C 22 2, 38 18, 56 14 S 83 9, 97 6" />
                <path d="M6 19 C 28 13, 48 28, 70 20 S 87 15, 96 18" />
                <path d="M3 31 C 18 26, 35 38, 54 35 S 80 29, 96 32" />
                <path d="M8 43 C 26 37, 44 49, 61 46 S 86 40, 96 44" />
                <path d="M5 57 C 23 51, 41 62, 59 59 S 82 54, 95 58" />
                <path d="M7 71 C 25 65, 43 76, 63 73 S 86 68, 97 72" />
                <path d="M5 85 C 24 78, 45 90, 67 87 S 87 83, 96 88" />

                <path d="M18 5 C 12 24, 32 41, 24 59 S 17 81, 28 96" />
                <path d="M63 6 C 58 24, 73 39, 67 57 S 63 78, 75 94" />
                <path d="M90 9 C 79 23, 92 39, 84 57 S 79 80, 88 96" />

                <path d="M2 14 C 15 27, 32 33, 51 44 S 74 67, 98 79" />
                <path d="M7 92 C 28 77, 50 64, 69 49 S 83 32, 96 16" />
                <path d="M10 52 C 30 50, 40 55, 55 50 S 75 48, 88 53" />
                <path d="M37 11 C 44 29, 31 45, 40 61 S 47 84, 42 95" />
              </svg>
            </span>
          </article>

          <article className="cork-item cork-scrap cork-command cork-pinned">
            <pre>{`current directiories & subdirectories
ordered by size

du -h | sort -n`}</pre>
          </article>

          <p className="cork-item cork-scrap cork-drink cork-taped">
            strawberry jarrito, pesch minute maid &amp; malibu
          </p>
          <p className="cork-item cork-scrap cork-traffic">
            create a ton of traffic around your activities to obfuscate it. internet traffic
          </p>
          <p className="cork-item cork-scrap cork-gamification cork-taped">gamification of things</p>
          <p className="cork-item cork-scrap cork-perspective">1 event from the perspective of many</p>
          <p className="cork-item cork-scrap cork-mints">sports mints</p>
          <p className="cork-item cork-scrap cork-context">notes with no context</p>

          <span className="cork-item cork-blank cork-blank-one cork-pinned" aria-hidden="true" />
          <span className="cork-item cork-blank cork-blank-two cork-pinned" aria-hidden="true" />
        </div>
        <p className="cork-scrap cork-todo cork-pinned">TODO</p>
      </div>
    </section>
  );
}
