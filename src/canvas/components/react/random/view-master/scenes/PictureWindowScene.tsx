/** @jsxImportSource react */

import calvinHobbesStars from '../../../../../assets/random/view-master/picture-window/calvin-hobbes-stars.jpeg';
import PannableScene from '../PannableScene';

import './PictureWindowScene.css';

export default function PictureWindowScene() {
  return (
    <PannableScene
      src={calvinHobbesStars.src}
      alt="A starry Calvin and Hobbes scene with a quote"
      initialX={0.1}
      initialY={0.18}
      sceneClassName="view-master-pan-scene--picture-window"
    />
  );
}
