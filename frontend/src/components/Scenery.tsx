/**
 * Environmental motion for the game world.
 *
 * Three cheap layers — drifting clouds, twinkling stars and floating props —
 * rendered as plain divs (no canvas, no images) and offset by scroll to give a
 * small parallax. Everything is decorative, `pointer-events: none`, aria-hidden,
 * and disappears entirely under the low-effects profile or reduced motion, so it
 * can never cost a slow device frames or a screen reader context.
 */
import {useEffect, useMemo, useRef} from 'react';
import {fxProfile} from '../lib/fx';

type Layer = 'sky' | 'map' | 'arena';

/** Deterministic pseudo-random so a re-render never reshuffles the scenery. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

export default function Scenery({
  layer = 'sky',
  className = '',
}: {
  layer?: Layer;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  const props = useMemo(() => {
    const random = seeded(layer === 'map' ? 7331 : layer === 'arena' ? 4242 : 909);
    const clouds = Array.from({length: 5}, () => ({
      top: `${4 + random() * 46}%`,
      size: 60 + random() * 130,
      duration: 44 + random() * 40,
      delay: -random() * 60,
      opacity: 0.05 + random() * 0.07,
    }));
    const stars = Array.from({length: layer === 'map' ? 16 : 10}, () => ({
      top: `${random() * 90}%`,
      left: `${random() * 96}%`,
      size: 2 + random() * 3,
      duration: 2.6 + random() * 3,
      delay: -random() * 5,
    }));
    const floaters = Array.from({length: layer === 'map' ? 7 : 4}, () => ({
      top: `${10 + random() * 76}%`,
      left: `${4 + random() * 90}%`,
      glyph: ['✦', '◆', '●', '✧', '✚'][Math.floor(random() * 5)],
      duration: 5 + random() * 5,
      delay: -random() * 6,
      size: 9 + random() * 9,
    }));
    return {clouds, stars, floaters};
  }, [layer]);

  /* Parallax: one rAF-throttled scroll handler moving the layers by a few px. */
  useEffect(() => {
    if (fxProfile() === 'low' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const offset = Math.min(window.scrollY, 900);
        host.style.transform = `translate3d(0, ${-offset * 0.05}px, 0)`;
      });
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  if (fxProfile() === 'low') return null;

  return (
    <div ref={hostRef} aria-hidden="true" className={`scenery ${className}`}>
      {props.clouds.map((cloud, index) => (
        <span
          key={`c${index}`}
          className="cloud"
          style={{
            top: cloud.top,
            width: cloud.size,
            height: cloud.size * 0.44,
            opacity: cloud.opacity,
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        />
      ))}
      {props.stars.map((star, index) => (
        <span
          key={`s${index}`}
          className="twinkle"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            animationDuration: `${star.duration}s`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}
      {props.floaters.map((floater, index) => (
        <span
          key={`f${index}`}
          className="float-prop"
          style={{
            top: floater.top,
            left: floater.left,
            fontSize: floater.size,
            color: 'var(--qa-scenery-pop)',
            animationDuration: `${floater.duration}s`,
            animationDelay: `${floater.delay}s`,
          }}
        >
          {floater.glyph}
        </span>
      ))}
    </div>
  );
}
