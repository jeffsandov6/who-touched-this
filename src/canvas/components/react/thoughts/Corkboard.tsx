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
  'LEBANON HANOVER - GALLOWDANCE',
  'zillakami - frailty',
  '(dont let the dragon) draag on',
  'EYEDRESS - JEALOUS',
];

export default function Corkboard() {
  return (
    <section className="thoughts-corkboard-section" aria-label="Notes with no context">
      <div className="thoughts-corkboard" aria-label="A corkboard covered with saved artifacts and notes">
        <figure className="cork-item cork-photo cork-pinned cork-on-day">
          <img src={onDayCapture.src} alt="On Day Capture Invitational Series poster" />
        </figure>

        <figure className="cork-item cork-cutout cork-pinned cork-nintendo">
          <img src={nintendoSouvenir.src} alt="Super Nintendo World souvenir from Universal Studios Hollywood" />
        </figure>

        <figure className="cork-item cork-cutout cork-pinned cork-tickets">
          <img src={garciaDuarteTickets.src} alt="Two Garcia versus Duarte keepsake tickets" />
        </figure>

        {/* <figure className="cork-item cork-cutout cork-pinned cork-petlink">
          <div className="cork-petlink-crop">
            <img src={petlink.src} alt="PetLink tags belonging to Gianna and Scouty" />
          </div>
          <figcaption>gianna + scouty</figcaption>
        </figure> */}
        <figure className="cork-item cork-cutout cork-pinned cork-petlink">
          <img src={petlink.src} alt="PetLink cards and tags belonging to Gianna and Scouty" />
        </figure>

        <figure className="cork-item cork-cutout cork-pinned cork-kunigami">
          <img src={kunigami.src} alt="Kunigami Rensuke character art" />
        </figure>

        <button
          type="button"
          className="cork-item cork-blueprint cork-pinned"
          aria-label="Shift the context lost vellum over a Gemini-era engineering drawing"
        >
          <img src={geminiBlueprint.src} alt="Gemini-era seat stirrup engineering drawing" />
          <span className="cork-vellum">context lost</span>
        </button>

        <figure className="cork-item cork-cutout cork-tesla cork-pinned">
          <img
            src={teslaCongratulations.src}
            alt="Tesla congratulations sheet for Jeff S. with a tiny waving hedgehog"
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
          <h3>songs</h3>
          <ul>{songs.map((song) => <li key={song}>{song}</li>)}</ul>
        </article>

        <article className="cork-item cork-sticky cork-ideathon cork-pinned">
          <h3>IDEATHON</h3>
          <p>sharing/building ideas</p>
          <p>while we all get</p>
          <p>fucked up &amp; just chill</p>
        </article>

        <p className="cork-item cork-scrap cork-sneaker">SNEAKER BOT</p>

        <article className="cork-item cork-paper cork-ddos cork-pinned">
          <pre>{String.raw`DDOS Attack
-> attack through auth/
sign up/login? are there
rate limiters on these?

---

use fake emails w/ all email
components but in a bad order?
me.com\@gmail ?

if the validator is on FE, no way this
works`}</pre>
        </article>

        <article className="cork-item cork-scrap cork-command">
          <pre>{`Current directiories & subdirectories
ordered by size

du -h | sort -n`}</pre>
        </article>

        <p className="cork-item cork-scrap cork-drink">
          strawberry jarrito, pesch minute maid &amp; malibu
        </p>
        <p className="cork-item cork-scrap cork-traffic">
          create a ton of traffic around your activities to obfuscate it. internet traffic
        </p>
        <p className="cork-item cork-scrap cork-gamification">gamification of things</p>
        <p className="cork-item cork-scrap cork-perspective">1 event from the perspective of many</p>
        <p className="cork-item cork-scrap cork-mints">sports mints</p>
        <p className="cork-item cork-scrap cork-context">notes with no context</p>

        <span className="cork-item cork-blank cork-blank-one" aria-hidden="true" />
        <span className="cork-item cork-blank cork-blank-two" aria-hidden="true" />
      </div>
    </section>
  );
}
