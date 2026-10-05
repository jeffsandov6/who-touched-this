/** @jsxImportSource react */

import { useState } from 'react';

import deweyImage from '../../../../assets/random/things-on-the-internet/dewey.jpeg';
import exploreBearsImage from '../../../../assets/random/things-on-the-internet/explore-bears.jpeg';
import linuxAnnouncementImage from '../../../../assets/random/things-on-the-internet/linux-announcement.png';
import windowSwapImage from '../../../../assets/random/things-on-the-internet/window-swap.png';
import bicycleDayImage from '../../../../assets/random/things-on-the-internet/bicycle-day.jpeg';
import sitesWeLostImage from '../../../../assets/random/things-on-the-internet/sites-we-lost.png';
import tailsImage from '../../../../assets/random/things-on-the-internet/tails.webp';
import spaceJamImage from '../../../../assets/random/things-on-the-internet/space-jam.png';
import cypherpunkManifestoImage from '../../../../assets/random/things-on-the-internet/cypherpunk-manifesto.png';
import oldYoutubeImage from '../../../../assets/random/things-on-the-internet/old-youtube.png';
import btcAnnouncementImage from '../../../../assets/random/things-on-the-internet/btc-announcement.png';
import silkRoadImage from '../../../../assets/random/things-on-the-internet/silk-road.png';


import './ThingsOnTheInternet.css';

type InternetThing = {
  id: string;
  title: string;
  caption: string;
  image?: string;
  imageAlt?: string;
  imageFit?: 'cover' | 'contain';
  href?: string;
  linkLabel?: string;
};

const THINGS: InternetThing[] = [
  {
    id: 'dewey-with-lean',
    title: 'dewey with lean',
    caption: 'relevant',
    image: deweyImage.src,
    imageAlt: 'dewey from malcolm in the middle holding a purple drink',
    imageFit: 'cover'
  },
  {
    id: 'explore-livecams',
    title: 'explore.org live cams',
    caption: 'random cameras pointed at animals around the world',
    image: exploreBearsImage.src,
    imageAlt: 'brown bear',
    imageFit: 'cover',
    href: 'https://explore.org/livecams',
    linkLabel: 'watch something live ↗',
  },
  {
    id: 'linux-announcement',
    title: 'linux, 1991',
    caption: '"just a hobby, won’t be big and professional like gnu" - linus torvalds',
    image: linuxAnnouncementImage.src,
    imageAlt: 'linus torvalds announcing his new operating system project in 1991',
    imageFit: 'contain',
    href: 'https://www.cs.cmu.edu/~awb/linux.history.html',
    linkLabel: 'read the post ↗',
  },
  {
    id: 'window-swap',
    title: 'window swap',
    caption: 'look out somebody else’s window for a while',
    image: windowSwapImage.src,
    imageAlt: 'a view through a window shared on WindowSwap',
    href: 'https://www.window-swap.com/Window',
    imageFit: 'cover',
    linkLabel: 'look outside ↗',
  },
  {
    id: 'bicycle-day',
    title: 'bicycle day',
    caption: 'april 19, 1943. albert hofmann rode home through basel after taking lsd-25',
    image: bicycleDayImage.src,
    imageAlt: 'bicycle day blotter artwork depicting Albert Hofmann riding a bicycle beneath a mountain, moon, and sun',
    imageFit: 'contain',
  },
  {
    id: 'sites-we-lost',
    title: 'the sites we lost',
    caption: 'tim holman (legend) keeps pieces of the weird web from disappearing',
    image: sitesWeLostImage.src,
    imageAlt: 'the sites we lost archive page for leekspin.com',
    imageFit: 'contain',
    href: 'https://theuselessweb.com/sites-we-lost/leekspin-com/',
    linkLabel: 'visit leekspin ↗',
  },
  {
    id: 'tails',
    title: 'tails',
    caption: 'for the men of culture. privacy via usb stick, iykyk',
    image: tailsImage.src,
    imageAlt: 'tails operating system startup screen',
    imageFit: 'contain',
    href: 'https://tails.net/',
    linkLabel: 'tails.net ↗',
  },
  {
    id: 'space-jam',
    title: 'space jam, 1996',
    caption: 'a classic. the original site is still basically still untouched',
    image: spaceJamImage.src,
    imageAlt: 'the original 1996 Space Jam website homepage with a starfield background and colorful planet navigation',
    imageFit: 'contain',
    href: 'https://www.spacejam.com/1996/',
    linkLabel: 'enter 1996 ↗',
  },
  {
    id: 'cypherpunk-manifesto',
    title: 'a cypherpunk’s manifesto',
    caption: '1993. privacy, cryptography, anonymous systems & electronic money',
    image: cypherpunkManifestoImage.src,
    imageAlt: 'a cypherpunk’s manifesto by eric hughes',
    imageFit: 'contain',
    href: 'https://www.activism.net/cypherpunk/manifesto.html',
    linkLabel: 'read it ↗',
  },
  {
    id: 'old-youtube',
    title: 'IMG_0708.MOV',
    caption: 'millions of mundane little videos like this still sit on youtube. a bygone internet',
    image: oldYoutubeImage.src,
    imageAlt: 'grainy old YouTube video showing an SUV driving through a rural hillside',
    imageFit: 'cover',
    href: 'https://www.youtube.com/watch?v=Oca_XZOLUIU',
    linkLabel: 'watch it ↗',
  },
  {
    id: 'bitcoin-announcement',
    title: 'bitcoin p2p e-cash paper',
    caption: 'october 31, 2008. the announcement, before the speculation',
    image: btcAnnouncementImage.src,
    imageAlt: 'excerpt from Satoshi Nakamoto’s original 2008 bitcoin mailing-list announcement',
    imageFit: 'contain',
    href: 'https://satoshi.nakamotoinstitute.org/emails/cryptography/1/',
    linkLabel: 'read the email ↗',
  },
  {
    id: 'silk-road',
    title: 'silk road, 2011',
    caption: 'one of the defining artifacts of the early darknet',
    image: silkRoadImage.src,
    imageAlt: 'silk road anonymous marketplace shown in an old Opera browser with its onion address visible',
    imageFit: 'contain',
  },
];

export default function ThingsOnTheInternet() {
  const [index, setIndex] = useState(0);

  const thing = THINGS[index];

  const previous = () => {
    setIndex((current) => (
      current === 0
        ? THINGS.length - 1
        : current - 1
    ));
  };

  const next = () => {
    setIndex((current) => (
      current === THINGS.length - 1
        ? 0
        : current + 1
    ));
  };

  return (
    <section
      className="things-on-the-internet"
      aria-labelledby="things-on-the-internet-title"
    >
      <div className="things-on-the-internet-header">
        <p className="things-on-the-internet-kicker">
          important
        </p>

        <h2 id="things-on-the-internet-title">
          things on the internet
        </h2>
      </div>

      <div className="things-on-the-internet-viewport">
        {thing.image ? (
          <img
            className={`things-on-the-internet-image things-on-the-internet-image--${thing.imageFit ?? 'cover'}`}
            src={thing.image}
            alt={thing.imageAlt ?? ''}
            draggable="false"
          />
        ) : (
          <div
            className="things-on-the-internet-placeholder"
            aria-hidden="true"
          >

          </div>
        )}

        <div className="things-on-the-internet-copy">
          <strong>{thing.title}</strong>

          {thing.caption && (
            <span>{thing.caption}</span>
          )}

          {thing.href && (
            <a
              href={thing.href}
              target="_blank"
              rel="noopener"
            >
              {thing.linkLabel ?? 'open it ↗'}
            </a>
          )}
        </div>
      </div>

      <div className="things-on-the-internet-controls">
        <button
          type="button"
          onClick={previous}
          aria-label="Previous thing"
        >
          ←
        </button>

        <span>
          {index + 1} / {THINGS.length}
        </span>

        <button
          type="button"
          onClick={next}
          aria-label="Next thing"
        >
          →
        </button>
      </div>
    </section>
  );
}