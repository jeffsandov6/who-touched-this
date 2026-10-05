import BitcoinThought from "./BitcoinThought";
import EmptyThought from "./EmptyThought";
import "./DrunkThoughts.css";

export default function DrunkThoughts() {
  return (
    <section className="drunk-thoughts">
      <header className="drunk-thoughts__header">
        <p className="drunk-thoughts__number">04</p>

        <div>
          <h2>drunk thoughts</h2>
          <p className="drunk-thoughts__subtitle">
            things i wrote while drunk (absolutely 0 need to read this)
          </p>
        </div>
      </header>

      <BitcoinThought />

      <details className="drunk-thought">
        <summary className="drunk-thought__summary">
          a quick thought on the cowboys
        </summary>

        <div className="drunk-thought__simple-content">
          <p>these mfs let me down every year</p>
        </div>
      </details>

      <EmptyThought label="a quick thought on love" />
      <EmptyThought label="a quick thought on friendship" />
      <EmptyThought label="a quick thought on identity" />
      <EmptyThought label="a quick thought on ______" />
    </section>
  );
}