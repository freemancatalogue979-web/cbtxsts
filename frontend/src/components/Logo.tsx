/**
 * The Absolute Genesis sigil.
 *
 * The old mark was a raster: the wordmark was baked into the artwork, so at the
 * size it actually appears in the app — 40px beside the nav — it turned into an
 * unreadable smear of light-on-dark and read as washed out.
 *
 * This one is drawn, not photographed:
 *
 *   - a heater shield in deep violet with a gold bevel,
 *   - a four-point radiant star at its heart (the "first light"),
 *   - a halo of twelve seed-dots around the field (a genesis ring),
 *   - an open book at the base, the "written beginning".
 *
 * It has no white halo and no baked lettering, so it stays crisp from a 16px
 * favicon to a 512px store icon and reads on both skins without a second asset.
 */
import {useId} from 'react';

export type GenesisCrestProps = {
  /** A fixed pixel size, or null to size it with utility classes. */
  size?: number | null;
  className?: string;
  /** Decorative by default — pass a title to expose the mark as an image. */
  title?: string;
};

/** The shield silhouette, shared by the art and its maskable variant. */
const SHIELD = 'M60 2 112 18.5c0 46.5-21 78.5-52 99.5C29 97 8 65 8 18.5Z';
/** The inner face of the shield. */
const FIELD = 'M60 12 102 25.5c0 39.5-18 67.5-42 85.5C36 93 18 65 18 25.5Z';
/** The four-point star at the heart of the mark. */
const STAR = 'M60 21c2.1 16.4 6 20.4 17.5 22.6C66 46.2 62.1 50.2 60 66.6 57.9 50.2 54 46.2 42.5 43.6 54 41.4 57.9 37.4 60 21Z';

/** Twelve seed-dots on a ring — the genesis ring. */
const RING = Array.from({length: 12}, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
  const x = 60 + Math.cos(angle) * 41;
  const y = 52 + Math.sin(angle) * 41;
  return {x, y, r: index % 3 === 0 ? 2.4 : 1.5};
});


export function GenesisCrest({size = 42, className = '', title}: GenesisCrestProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const px = (name: string) => `${uid}-${name}`;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size ?? undefined}
      height={size ?? undefined}
      className={`shrink-0 ${className}`}
      style={size ? {width: size, height: size} : undefined}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={px('shield')} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="34%" stopColor="#5b21b6" />
          <stop offset="66%" stopColor="#3b1580" />
          <stop offset="100%" stopColor="#1e0b47" />
        </linearGradient>
        <linearGradient id={px('field')} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#2a0f5e" />
          <stop offset="55%" stopColor="#17073a" />
          <stop offset="100%" stopColor="#0d0425" />
        </linearGradient>
        <linearGradient id={px('gold')} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#fff6cf" />
          <stop offset="38%" stopColor="#f7d070" />
          <stop offset="72%" stopColor="#e0a12c" />
          <stop offset="100%" stopColor="#a86a12" />
        </linearGradient>
        <linearGradient id={px('star')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#fffdf2" />
          <stop offset="42%" stopColor="#ffe9a8" />
          <stop offset="100%" stopColor="#f0b73c" />
        </linearGradient>
        <radialGradient id={px('halo')} cx="50%" cy="42%" r="52%">
          <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#a855f7" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={px('bloom')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3c4" stopOpacity="0.5" />
          <stop offset="38%" stopColor="#ffd98a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffd98a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={px('aura')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.42" />
          <stop offset="70%" stopColor="#6d28d9" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the aura behind the shield — soft, never a hard halo */}
      <circle cx="60" cy="58" r="58" fill={`url(#${px('aura')})`} />

      {/* the shield */}
      <path d={SHIELD} fill={`url(#${px('shield')})`} stroke={`url(#${px('gold')})`} strokeWidth="3" strokeLinejoin="round" />
      <path d={FIELD} fill={`url(#${px('field')})`} stroke="#f7d070" strokeOpacity="0.35" strokeWidth="1.2" />

      {/* the light that lives inside the shield */}
      <circle cx="60" cy="48" r="38" fill={`url(#${px('halo')})`} />

      {/* the genesis ring */}
      <g>
        {RING.map((dot, index) => (
          <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} fill="#f7d070" fillOpacity={dot.r > 2 ? 0.95 : 0.55} />
        ))}
      </g>

      {/* the star at the heart — a white-hot core inside a gold spark */}
      <circle cx="60" cy="46" r="27" fill={`url(#${px('bloom')})`} />
      <path d={STAR} fill={`url(#${px('star')})`} />
      <path d={STAR} fill="#fffdf4" fillOpacity="0.85" transform="translate(60 46) scale(0.34) translate(-60 -46)" />

      {/* the rising chevron — the "A" of Absolute, and the way up */}
      <path d="M45 93 60 78l15 15" fill="none" stroke={`url(#${px('gold')})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />

      {/* the bevel along the top edge — the one highlight that sells the metal */}
      <path d="M60 2 112 18.5 60 12 8 18.5Z" fill="#ffffff" fillOpacity="0.13" />
      <path d="M18 25.5 60 12l42 13.5" fill="none" stroke="#fff8dd" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" />
      {/* the shadow that pools at the foot of the shield */}
      <path d="M60 111c31-21 52-53 52-92.5V18.5L60 2Z" fill="#08021a" fillOpacity="0.22" />
    </svg>
  );
}

export default GenesisCrest;
