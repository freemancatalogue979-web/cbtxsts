/**
 * HeroReel — the animated picture reel on the landing page.
 *
 * Behaves like a short looping clip: slides cross-fade while the active frame
 * drifts (Ken Burns), each caption slides in, and a progress bar fills under the
 * active dot. Players can swipe, tap a dot, or let it play. Reduced-motion users
 * get a calm, manual gallery instead.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {useMediaQuery} from '../lib/responsive';
import {EASE} from '../lib/motion';

export type HeroSlide = {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  caption: string;
  accent: string;
  pos?: string;
};

const INTERVAL = 6200;

export default function HeroReel({slides}: {slides: HeroSlide[]}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const touchX = useRef<number | null>(null);
  const count = slides.length;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  /* Autoplay: paused while hidden, while the pointer is down, and for
     reduced-motion users. */
  useEffect(() => {
    if (reduced || paused || count < 2) return undefined;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), INTERVAL);
    return () => window.clearTimeout(timer);
  }, [index, paused, reduced, count]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const slide = slides[index];

  return (
    <div
      className="group relative overflow-hidden rounded-[1.4rem] border border-white/12 bg-ink-900 shadow-[0_40px_90px_-45px_rgba(168,85,247,0.55)] sm:rounded-[1.9rem]"
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerLeave={() => setPaused(false)}
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchX.current;
        touchX.current = null;
        if (startX === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? startX) - startX;
        if (Math.abs(delta) > 42) go(index + (delta < 0 ? 1 : -1));
      }}
      aria-roledescription="carousel"
      aria-label="What the arena feels like"
    >
      {/* ------------------------------------------------ frames */}
      <div className="relative aspect-[4/5] w-full sm:aspect-[16/9] lg:aspect-[21/9]">
        {slides.map((frame, frameIndex) => (
          <img
            key={`${frame.src}-${frame.pos ?? frameIndex}`}
            src={frame.src}
            alt={frame.alt}
            loading={frameIndex === 0 ? 'eager' : 'lazy'}
            decoding="async"
            style={{objectPosition: frame.pos ?? 'center'}}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-[900ms] ${
              frameIndex === index ? 'opacity-100' : 'opacity-0'
            } ${frameIndex === index && !reduced ? 'hero-kenburns' : ''}`}
          />
        ))}

        {/* scrims keep captions legible on any frame */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950/70 via-transparent to-transparent" />

        {/* frame counter */}
        <p className="absolute top-3 right-3.5 rounded-full border border-white/15 bg-ink-950/55 px-2.5 py-1 text-[0.6rem] font-black tracking-[0.18em] text-mist-300 tabular backdrop-blur-md sm:top-4 sm:right-4 sm:text-[0.66rem]">
          {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
        </p>

        {/* caption */}
        <motion.div
          key={index}
          initial={reduced ? false : {opacity: 0, y: 26}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.55, ease: EASE}}
          className="absolute inset-x-0 bottom-0 p-4 pr-16 pb-5 sm:p-7 sm:pb-7"
        >
 <p className={`text-[0.62rem] font-black tracking-[0.22em] sm:text-[0.7rem] ${slide.accent}`}>
            {slide.eyebrow}
          </p>
          <h2 className="game-title mt-1.5 max-w-xl font-display text-[1.32rem] leading-[1.12] font-black italic tracking-tight sm:mt-2 sm:text-[1.95rem] lg:text-[2.4rem]">
            {slide.title}
          </h2>
          <p className="mt-1.5 max-w-md text-[0.8rem] leading-relaxed font-semibold text-mist-300 sm:mt-2.5 sm:text-[0.9rem]">
            {slide.caption}
          </p>
        </motion.div>
      </div>

      {/* ------------------------------------------------ controls */}
      <div className="absolute right-3.5 bottom-4 flex items-center gap-1.5 sm:right-7 sm:bottom-7">
        {slides.map((frame, frameIndex) => {
          const active = frameIndex === index;
          return (
            <button
              key={`${frame.src}-${frame.pos ?? frameIndex}`}
              onClick={() => go(frameIndex)}
              aria-label={`Show slide ${frameIndex + 1}: ${frame.eyebrow}`}
              aria-current={active}
              className={`relative h-2 overflow-hidden rounded-full transition-all duration-300 touch-manipulation ${
                active ? 'w-9 bg-white/25' : 'w-2 bg-white/35 hover:bg-white/60'
              }`}
            >
              {active && !reduced && !paused && (
                <motion.span
                  key={`bar-${index}`}
                  initial={{width: 0}}
                  animate={{width: '100%'}}
                  transition={{duration: INTERVAL / 1000, ease: 'linear'}}
                  className="absolute inset-y-0 left-0 rounded-full bg-white"
                />
              )}
              {active && (reduced || paused) && <span className="absolute inset-0 rounded-full bg-white" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
