/** @jsxImportSource react */

import { useEffect, useState } from 'react';

import hotelHallway from '../../../../../assets/random/view-master/hotel/hotel-hallway-main.jpg';

import './HotelScene.css';

export default function HotelScene() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setStage(1), 2600),
      window.setTimeout(() => setStage(2), 2850),
      window.setTimeout(() => setStage(1), 3050),
      window.setTimeout(() => setStage(3), 3300),
      window.setTimeout(() => setStage(4), 3900),
      window.setTimeout(() => setStage(3), 5100),
      window.setTimeout(() => setStage(5), 5600),
    ];

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  return (
    <div
      className={`view-master-static-scene view-master-hotel-scene view-master-hotel-scene--stage-${stage}`}
    >
      <img
        src={hotelHallway.src}
        alt="An empty hotel hallway"
        draggable="false"
      />

      <div className="view-master-hotel-darkness" aria-hidden="true" />

      <div className="view-master-hotel-twins" aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}
