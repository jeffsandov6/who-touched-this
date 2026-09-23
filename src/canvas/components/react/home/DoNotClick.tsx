/** @jsxImportSource react */

/** @jsxImportSource react */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import brian01 from '../../../assets/home/do-not-click/brian/brian-01.png';
import brian02 from '../../../assets/home/do-not-click/brian/brian-02.png';
import brian03 from '../../../assets/home/do-not-click/brian/brian-03.png';
import brian04 from '../../../assets/home/do-not-click/brian/brian-04.png';
import brian05 from '../../../assets/home/do-not-click/brian/brian-05.png';
import brian06 from '../../../assets/home/do-not-click/brian/brian-06.png';
import brian07 from '../../../assets/home/do-not-click/brian/brian-07.png';
import brian08 from '../../../assets/home/do-not-click/brian/brian-08.png';
import brian09 from '../../../assets/home/do-not-click/brian/brian-09.png';
import brian10 from '../../../assets/home/do-not-click/brian/brian-10.png';
import brian11 from '../../../assets/home/do-not-click/brian/brian-11.png';
import brian12 from '../../../assets/home/do-not-click/brian/brian-12.png';

import './DoNotClick.css';

const brianFrames = [
    brian01.src,
    brian02.src,
    brian03.src,
    brian04.src,
    brian05.src,
    brian06.src,
    brian07.src,
    brian08.src,
    brian09.src,
    brian10.src,
    brian11.src,
    brian12.src,
];

type BrianBurstItem = {
    id: number;
    src: string;
    startX: number;
    startY: number;
    travelX: number;
    travelY: number;
    width: number;
    duration: number;
    delay: number;
    rotation: number;
    endScale: number;
};

type BrianStyle = CSSProperties & {
    '--brian-x': string;
    '--brian-y': string;
    '--brian-rotation': string;
    '--brian-scale': string;
};

export default function DoNotClick() {
    const panelRef = useRef<HTMLElement | null>(null);
    const cursorRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const brianTimeoutRef = useRef<number | null>(null);

    const targetPosition = useRef({ x: 0, y: 0 });
    const currentPosition = useRef({ x: 0, y: 0 });

    const [isPointerInside, setIsPointerInside] = useState(false);
    const [wasClicked, setWasClicked] = useState(false);
    const [brianSwarm, setBrianSwarm] = useState<BrianBurstItem[]>([]);

    useEffect(() => {
        let animationFrameId = 0;

        const animate = () => {
            const cursor = cursorRef.current;

            // Controls how quickly the giant cursor catches up to the real pointer.
            // Lower = slower/more lag, higher = faster.
            const followSpeed = 0.08;

            if (cursor) {
                currentPosition.current.x +=
                    (targetPosition.current.x - currentPosition.current.x) * followSpeed;

                currentPosition.current.y +=
                    (targetPosition.current.y - currentPosition.current.y) * followSpeed;

                cursor.style.transform = `translate3d(
          ${currentPosition.current.x}px,
          ${currentPosition.current.y}px,
          0
        ) rotate(-18deg)`;
            }

            animationFrameId = window.requestAnimationFrame(animate);
        };

        animationFrameId = window.requestAnimationFrame(animate);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (brianTimeoutRef.current !== null) {
                window.clearTimeout(brianTimeoutRef.current);
            }
        };
    }, []);

    const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
        const panel = panelRef.current;

        if (!panel) {
            return;
        }

        const bounds = panel.getBoundingClientRect();

        const position = {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
        };

        if (!isPointerInside) {
            currentPosition.current = position;
            setIsPointerInside(true);
        }

        targetPosition.current = position;
    };

    const handlePointerEnter = (event: React.PointerEvent<HTMLElement>) => {
        const panel = panelRef.current;

        if (!panel) {
            return;
        }

        const bounds = panel.getBoundingClientRect();

        const position = {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
        };

        targetPosition.current = position;
        currentPosition.current = position;

        setIsPointerInside(true);
    };

    const handleButtonClick = () => {
        if (wasClicked) {
            return;
        }

        setWasClicked(true);

        const button = buttonRef.current;

        if (!button) {
            return;
        }

        const bounds = button.getBoundingClientRect();

        const startX = bounds.left + bounds.width / 2;
        const startY = bounds.top + bounds.height / 2;

        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

        const brianCount = isTouchDevice ? 18 : 40;
        const viewportDistance = Math.max(window.innerWidth, window.innerHeight);

        const swarm = Array.from({ length: brianCount }, (_, index) => {
            const angle = Math.random() * Math.PI * 2;

            const distance =
                viewportDistance * (0.35 + Math.random() * 0.55);

            return {
                id: index,
                src: brianFrames[
                    Math.floor(Math.random() * brianFrames.length)
                ],
                startX,
                startY,
                travelX: Math.cos(angle) * distance,
                travelY: Math.sin(angle) * distance,
                width: 60 + Math.random() * 55,
                duration: 1800 + Math.random() * 1200,
                delay: Math.random() * 250,
                rotation: -18 + Math.random() * 36,
                endScale: 2.2 + Math.random() * 2.3,
            };
        });

        setBrianSwarm(swarm);

        brianTimeoutRef.current = window.setTimeout(() => {
            setBrianSwarm([]);
        }, 2600);
    };

    return (
        <>
            <section
                ref={panelRef}
                className="do-not-click"
                onPointerEnter={handlePointerEnter}
                onPointerLeave={() => setIsPointerInside(false)}
                onPointerMove={handlePointerMove}
            >
                <div className="do-not-click-content">
                    <p className="do-not-click-title">
                        DON'T CLICK THIS BUTTON
                    </p>

                    <button
                        ref={buttonRef}
                        type="button"
                        className="do-not-click-button"
                        onClick={handleButtonClick}
                    >
                        {wasClicked ? 'you clicked it' : "don't"}
                    </button>

                    {wasClicked && (
                        <p className="do-not-click-result">
                            i gave you one instruction
                        </p>
                    )}
                </div>

                <div
                    ref={cursorRef}
                    className={`do-not-click-cursor ${isPointerInside ? 'do-not-click-cursor--visible' : ''
                        }`}
                    aria-hidden="true"
                >
                    <svg
                        viewBox="0 0 120 160"
                        role="presentation"
                    >
                        <path
                            d="M12 8 L105 87 L68 94 L91 143 L64 155 L42 105 L15 132 Z"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="8"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
            </section>

            {typeof document !== 'undefined' &&
                brianSwarm.length > 0 &&
                createPortal(
                    <div
                        className="do-not-click-brian-layer"
                        aria-hidden="true"
                    >
                        {brianSwarm.map((brian) => {
                            const style: BrianStyle = {
                                left: `${brian.startX}px`,
                                top: `${brian.startY}px`,
                                width: `${brian.width}px`,
                                animationDuration: `${brian.duration}ms`,
                                animationDelay: `${brian.delay}ms`,
                                '--brian-x': `${brian.travelX}px`,
                                '--brian-y': `${brian.travelY}px`,
                                '--brian-rotation': `${brian.rotation}deg`,
                                '--brian-scale': `${brian.endScale}`,
                            };

                            return (
                                <img
                                    key={brian.id}
                                    src={brian.src}
                                    alt=""
                                    className="do-not-click-brian"
                                    style={style}
                                />
                            );
                        })}
                    </div>,
                    document.body,
                )}
        </>
    );
}