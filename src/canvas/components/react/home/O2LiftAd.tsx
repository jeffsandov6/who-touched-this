/** @jsxImportSource react */

import o2LiftImage from '../../../assets/home/o2lift/o2Lift.jpg';

import './O2LiftAd.css';

export default function O2LiftAd() {
  return (
    <section className="o2lift-ad">
      <div className="o2lift-ad-image-wrap">
        <img
          className="o2lift-ad-image"
          src={o2LiftImage.src}
          alt="O2Lift aromatherapy inhalers."
          loading="lazy"
        />
      </div>

      <div className="o2lift-ad-copy">
        <p className="o2lift-ad-title">
          pls buy these inhalers pls
        </p>
        <p className="o2lift-ad-subtitle">
          (i am broke)
        </p>

        <a
          className="o2lift-ad-link"
          href="https://o2liftco.com/shop"
          target="_blank"
          rel="noreferrer"
        >
          fine i'll look
        </a>
      </div>
    </section>
  );
}