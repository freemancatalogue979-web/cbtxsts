/**
 * The badge kit.
 *
 * Every badge in Absolute Genesis is drawn from this one file, so a badge
 * looks the same wherever a player meets it: sculpted vector metal, a bevelled
 * rim, a lit core and the tier's own colours.
 *
 *   TierBadge        — the shield plaque. Ranked tiers, season ranks, anything
 *                      that says "this is the ladder you are standing on".
 *   AchievementBadge — the medallion. Earned achievements and badges.
 *   HeraldicCrest    — the lifetime crest. The big heraldic ornament that sits
 *                      on a player's profile.
 *   TierPill         — the inline tag for rows and headers.
 *
 * Colours come from the API (`/api/ranked/meta`, `/api/arena/season`, the
 * badge catalogue), so the art on screen is the ladder the server actually
 * scores you against — never a guess made in the browser.
 */
import {useId} from 'react';
import {Award, Crown, Flame, Gem, Medal, Orbit, Shield, Sparkles, Star, Sun, Trophy, Zap} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {Tier} from '../lib/types';

/** The glyphs a badge can carry. Mapped to lucide icons. */
export type BadgeGlyph =
  | 'medal'
  | 'shield'
  | 'gem'
  | 'star'
  | 'crown'
  | 'flame'
  | 'trophy'
  | 'sparkles'
  | 'zap'
  | 'sun'
  | 'award';

/** The four metals of the lifetime ladder. */
export type BadgePalette = {
  /** The highlight stop — near-white, used for bevels and the glyph. */
  light: string;
  /** The accent — the tier's own colour. */
  bright: string;
  /** The shadow stop — the tier's own colour, darkened. */
  deep: string;
  /** The core — the dark plate the glyph sits on. */
  core: string;
  /**
   * A second colour, for the tiers that are more than one hue — the aurora
   * crown carries a violet and a teal, obsidian a violet inside a black.
   */
  accent?: string;
};

export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const GLYPHS: Record<BadgeGlyph, LucideIcon> = {
  medal: Medal,
  shield: Shield,
  gem: Gem,
  star: Star,
  crown: Crown,
  flame: Flame,
  trophy: Trophy,
  sparkles: Sparkles,
  zap: Zap,
  sun: Sun,
  award: Award,
};

/**
 * Badge geometry, in fractions of the badge's box. The crest is drawn once in
 * a 120×120 viewBox and scaled to the box, so these numbers line up with the
 * art rather than fighting it.
 */
const SIZES = {
  xs: {box: 26, glyph: 0.3, level: 0.2},
  sm: {box: 34, glyph: 0.32, level: 0.2},
  md: {box: 48, glyph: 0.34, level: 0.21},
  lg: {box: 72, glyph: 0.34, level: 0.2},
  xl: {box: 104, glyph: 0.34, level: 0.19},
} as const;

/**
 * The lifetime metals, lowest to highest.
 *
 * Platinum is not the ceiling. Above it the ladder keeps climbing — diamond,
 * obsidian, mythril and finally aurora, which is light itself.
 */
export const TIER_METALS: Record<Tier, BadgePalette> = {
  bronze: {light: '#ffe1b0', bright: '#ce8b55', deep: '#563322', core: '#472c29'},
  silver: {light: '#f2f8ff', bright: '#b6cce3', deep: '#455974', core: '#24334c'},
  gold: {light: '#fff4ba', bright: '#efbf54', deep: '#81531b', core: '#4c351b'},
  platinum: {light: '#e4ffff', bright: '#80e2ef', deep: '#34768a', core: '#162f4e'},
  diamond: {light: '#f4fdff', bright: '#7de3f4', deep: '#0e5f7d', core: '#08304a', accent: '#e9d5ff'},
  obsidian: {light: '#efe3ff', bright: '#9d7cf5', deep: '#2b0f5e', core: '#100723', accent: '#38bdf8'},
  mythril: {light: '#f0f9ff', bright: '#5cc8f8', deep: '#0b4a72', core: '#0a2440', accent: '#a5f3fc'},
  aurora: {light: '#ffffff', bright: '#b39cfb', deep: '#4b1d95', core: '#170a33', accent: '#5eead4'},
};

/** The lifetime metals in order — the index is how far up the ladder a tier is. */
export const TIER_ORDER: Tier[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'obsidian',
  'mythril',
  'aurora',
];

/** How far up the lifetime ladder a tier sits. Unknown tiers sit at the floor. */
export function tierRank(tier: Tier | string): number {
  const index = TIER_ORDER.indexOf(tier as Tier);
  return index < 0 ? 0 : index;
}

/** The emblem each lifetime metal carries. */
const TIER_ICONS: Record<Tier, LucideIcon> = {
  bronze: Shield,
  silver: Star,
  gold: Crown,
  platinum: Gem,
  diamond: Sparkles,
  obsidian: Flame,
  mythril: Zap,
  aurora: Orbit,
};

/**
 * How many stars each lifetime metal is worth — one more with every step up.
 * The crest draws them along the banner, so the count is also the score.
 */
const TIER_STARS: Record<Tier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
  diamond: 5,
  obsidian: 6,
  mythril: 7,
  aurora: 8,
};

/* ------------------------------------------------------------------ colour */

function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length !== 6) return null;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Blend two hex colours; `amount` is how much of `b` ends up in the result. */
export function mix(a: string, b: string, amount: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const channel = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * amount);
  return `#${[channel(0), channel(1), channel(2)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Build a full palette from the two colours the API ships for a tier. The
 * highlight and core are derived so every tier gets the same sculpted read.
 */
export function paletteFrom(deep: string, bright: string): BadgePalette {
  return {
    light: mix(bright, '#ffffff', 0.5),
    bright,
    deep,
    core: mix(deep, '#1a1230', 0.55),
  };
}

/* ------------------------------------------------------------------- crest */

export type TierBadgeProps = {
  /** The tier's dark colour. */
  deep: string;
  /** The tier's bright colour. */
  bright: string;
  /** The emblem carried by the badge. */
  glyph?: BadgeGlyph;
  size?: BadgeSize;
  /** The level carved into the ribbon. */
  level?: number;
  /** Set false to hide the level even when one is supplied. */
  showLevel?: boolean;
  /** Dimmed for badges that are still out of reach. */
  locked?: boolean;
  /** Rings the badge the player is standing on. */
  current?: boolean;
  /** Accessible name; defaults to the tier name. */
  label?: string;
  className?: string;
};

/**
 * The shield plaque — the badge you meet on the ranked ladder, the season
 * ladder and every header that names a tier.
 *
 * It is drawn, not styled: a bevelled metal shield, a dark core with an
 * engraved frame, a jewel in the crown, and a ribbon across the base that
 * carries the level. Because it is vector it stays crisp from a 26px chip
 * beside a name to a 104px hero, and it costs the page nothing to paint.
 */
export function TierBadge({
  deep,
  bright,
  glyph = 'medal',
  size = 'md',
  level,
  showLevel = true,
  locked = false,
  current = false,
  label,
  className = '',
}: TierBadgeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dims = SIZES[size];
  const Glyph = GLYPHS[glyph] ?? Medal;
  const palette = paletteFrom(deep, bright);
  const withLevel = showLevel && typeof level === 'number';
  const box = dims.box;
  /* The ribbon eats the lower third, so the emblem sits higher and a touch
     smaller whenever a level is carved into the badge. */
  const glyphSize = box * (withLevel ? dims.glyph : dims.glyph + 0.07);
  const glyphTop = withLevel ? 24 : 26;
  const glyphHeight = withLevel ? 36 : 46;
  const levelSize = box * dims.level;

  return (
    <span
      className={`tier-badge ${locked ? 'tier-badge-locked' : ''} ${current ? 'tier-badge-current' : ''} ${className}`}
      style={{width: box, height: box}}
      data-badge={glyph}
      role="img"
      aria-label={label ?? (withLevel ? `Level ${level}` : 'Badge')}
      title={label}
    >
      <svg className="tier-badge__art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${uid}-metal`} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor={palette.light} />
            <stop offset="20%" stopColor={palette.bright} />
            <stop offset="44%" stopColor={palette.light} />
            <stop offset="56%" stopColor={palette.bright} />
            <stop offset="100%" stopColor={palette.deep} />
          </linearGradient>
          <linearGradient id={`${uid}-core`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor={palette.core} />
            <stop offset="100%" stopColor="#080512" />
          </linearGradient>
          <linearGradient id={`${uid}-ribbon`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.light} />
            <stop offset="38%" stopColor={palette.bright} />
            <stop offset="100%" stopColor={palette.deep} />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="36%" r="56%">
            <stop offset="0%" stopColor={palette.bright} stopOpacity="0.42" />
            <stop offset="100%" stopColor={palette.bright} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="60" cy="56" r="56" fill={`url(#${uid}-glow)`} />

        {/* the shield */}
        <path
          d="M60 3 113 19c0 48-22 79-53 98C29 98 7 67 7 19Z"
          fill={`url(#${uid}-metal)`}
          stroke={palette.deep}
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        {/* the inner face */}
        <path
          d="M60 12 105 26c0 42-19 69-45 86C35 95 15 68 15 26Z"
          fill={`url(#${uid}-core)`}
          stroke={palette.light}
          strokeOpacity="0.5"
          strokeWidth="1.1"
        />
        {/* the bevel catching the light along the top edge */}
        <path d="M15 26 60 12 105 26" fill="none" stroke="#ffffff" strokeOpacity="0.34" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M22 34c-2 26-2 44 2 58 3 17 17 29 36 37"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.18"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        {/* the engraved frame around the emblem */}
        <path d="M60 29 92 39c0 33-14 55-32 67C42 94 28 72 28 39Z" fill="none" stroke={palette.bright} strokeOpacity="0.42" strokeWidth="1.1" />
        {/* the jewel in the crown */}
        <circle cx="60" cy="21" r="3.6" fill={palette.bright} />
        <circle cx="60" cy="21" r="1.6" fill="#ffffff" fillOpacity="0.9" />

        {/* the ribbon that carries the level */}
        {withLevel ? (
          <>
            <path d="M30 79 90 79 85 103 35 103Z" fill={`url(#${uid}-ribbon)`} stroke={palette.deep} strokeWidth="1" strokeLinejoin="round" />
            <path d="M30 79 90 79 88.5 84 31.5 84Z" fill="#ffffff" fillOpacity="0.22" />
          </>
        ) : null}
      </svg>

      <span className="tier-badge__glyph" style={{top: `${glyphTop}%`, height: `${glyphHeight}%`}}>
        <Glyph style={{width: glyphSize, height: glyphSize}} strokeWidth={2.2} color={palette.light} />
      </span>

      {withLevel ? (
        <span className="tier-badge__level" style={{top: '66%', height: '20%', fontSize: levelSize}}>
          {level}
        </span>
      ) : null}
    </span>
  );
}

/* --------------------------------------------------------------- medallion */

export type AchievementBadgeProps = {
  /**
   * The badge's metal — bronze, silver, gold or platinum. Server data is
   * trusted but not assumed: an unknown tier falls back to gold.
   */
  tier: Tier | string;
  /** The emblem the badge was earned with. */
  icon: LucideIcon;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Locked badges keep their shape but read as "not yet earned". */
  locked?: boolean;
  label?: string;
  className?: string;
};

const MEDALLION_SIZES = {
  xs: {box: 26, glyph: 12},
  sm: {box: 34, glyph: 16},
  md: {box: 44, glyph: 20},
  lg: {box: 64, glyph: 29},
} as const;

/**
 * The medallion — what an earned badge looks like. A metal bezel around a
 * dark disc, four studs on the cardinal points and the emblem in the middle.
 */
export function AchievementBadge({
  tier,
  icon: Icon,
  size = 'md',
  locked = false,
  label,
  className = '',
}: AchievementBadgeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dims = MEDALLION_SIZES[size];
  const palette = TIER_METALS[tier as Tier] ?? TIER_METALS.gold;

  return (
    <span
      className={`achievement-badge ${locked ? 'achievement-badge-locked' : ''} ${className}`}
      style={{width: dims.box, height: dims.box}}
      role="img"
      aria-label={label ?? 'Badge'}
      title={label}
    >
      <svg className="tier-badge__art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${uid}-bezel`} x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor={palette.light} />
            <stop offset="18%" stopColor={palette.bright} />
            <stop offset="40%" stopColor={palette.light} />
            <stop offset="52%" stopColor={palette.bright} />
            <stop offset="100%" stopColor={palette.deep} />
          </linearGradient>
          <radialGradient id={`${uid}-disc`} cx="36%" cy="26%" r="84%">
            <stop offset="0%" stopColor={palette.core} />
            <stop offset="100%" stopColor="#080512" />
          </radialGradient>
        </defs>

        <circle cx="60" cy="60" r="55" fill={`url(#${uid}-bezel)`} stroke={palette.deep} strokeWidth="1.2" />
        <circle cx="60" cy="60" r="45" fill={`url(#${uid}-disc)`} />
        <circle cx="60" cy="60" r="45" fill="none" stroke={palette.bright} strokeOpacity="0.5" strokeWidth="1" />
        <circle cx="60" cy="60" r="37" fill="none" stroke={palette.light} strokeOpacity="0.22" strokeWidth="0.9" strokeDasharray="2.5 4.5" />
        <circle cx="60" cy="9" r="3.4" fill={palette.light} />
        <circle cx="111" cy="60" r="3.4" fill={palette.light} />
        <circle cx="60" cy="111" r="3.4" fill={palette.light} />
        <circle cx="9" cy="60" r="3.4" fill={palette.light} />
      </svg>

      <span className="tier-badge__glyph" style={{top: '24%', height: '52%'}}>
        <Icon style={{width: dims.glyph, height: dims.glyph}} strokeWidth={2.2} color={palette.light} />
      </span>
    </span>
  );
}

/* --------------------------------------------------------------- tier pill */

/**
 * The inline tag for rows and headers: a small badge beside the tier name,
 * tinted with the tier's own metal.
 */
export function TierPill({
  deep,
  bright,
  label,
  glyph = 'medal',
  size = 'xs',
  current = false,
  className = '',
}: {
  deep: string;
  bright: string;
  label: string;
  glyph?: BadgeGlyph;
  size?: BadgeSize;
  current?: boolean;
  className?: string;
}) {
  const palette = paletteFrom(deep, bright);
  return (
    <span
      className={`tier-pill ${current ? 'tier-pill-current' : ''} ${className}`}
      style={{
        borderColor: `${palette.bright}66`,
        background: `linear-gradient(135deg, ${palette.bright}2b, ${palette.deep}55)`,
      }}
      title={label}
    >
      <TierBadge deep={deep} bright={bright} glyph={glyph} size={size} showLevel={false} current={current} label={label} />
      <span className="truncate font-extrabold tracking-wide whitespace-nowrap">{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------- position medal */

/**
 * The plate a leaderboard row wears for its place.
 *
 * First place is gold, second silver, third bronze, and everything below is
 * a quiet steel number that lets the name stay the loudest thing on the row.
 */
export function PositionMedal({position, className = ''}: {position: number; className?: string}) {
  const metal =
    position === 1 ? TIER_METALS.gold : position === 2 ? TIER_METALS.silver : position === 3 ? TIER_METALS.bronze : null;

  if (!metal) {
    return (
      <span className={`grid size-7 shrink-0 place-items-center rounded-xl text-[0.78rem] font-black tabular text-mist-500 ${className}`}>
        {position}
      </span>
    );
  }

  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-xl text-[0.78rem] font-black tabular text-ink-950 ${className}`}
      style={{
        background: `linear-gradient(150deg, ${metal.light}, ${metal.bright} 45%, ${metal.deep})`,
        boxShadow: `inset 0 1px 0 ${metal.light}, inset 0 -2px 4px -2px rgba(0,0,0,0.7), 0 4px 10px -6px ${metal.deep}`,
      }}
    >
      {position}
    </span>
  );
}

/* ------------------------------------------------------------ heraldic crest */

/** A five-pointed star, drawn from its radius so it can shrink with the count. */
function starPath(cx: number, cy: number, r: number): string {
  let d = '';
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Points along a quadratic curve, each with the angle of the curve there. */
function curvePoints(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, count: number) {
  const points: {x: number; y: number; angle: number}[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const it = 1 - t;
    const x = it * it * x0 + 2 * it * t * cx + t * t * x1;
    const y = it * it * y0 + 2 * it * t * cy + t * t * y1;
    const dx = 2 * it * (cx - x0) + 2 * t * (x1 - cx);
    const dy = 2 * it * (cy - y0) + 2 * t * (y1 - cy);
    points.push({x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI});
  }
  return points;
}

/** A closed polygon of `sides` points on a circle — the faceted rim. */
function facetPath(r: number, sides: number, cx = 72, cy = 74): string {
  const points = Array.from({length: sides}, (_, i) => {
    const angle = ((i * 360) / sides - 90) * (Math.PI / 180);
    return `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join('L')}Z`;
}

/**
 * The lifetime crest — the big heraldic ornament on a player's profile.
 *
 * Unlike the tier badges this one is not server-coloured: the lifetime metals
 * are the ladder the profile screen shows, so their colours are baked into the
 * art.
 *
 * The crest is also where the ladder is *felt*. Platinum is no longer the
 * ceiling, and every step up adds another layer of ornament, so a mythril
 * crest is unmistakably more than a platinum one without reading a word:
 *
 *   bronze   — the crest on its own
 *   silver   — + the ring of the order
 *   gold     — + the laurel wreath
 *   platinum — + rays behind the shield
 *   diamond  — + a faceted rim and a prismatic seal
 *   obsidian — + a dark halo and drifting motes
 *   mythril  — + an orbiting ring
 *   aurora   — + the aurora veil and a burning core
 */
export function HeraldicCrest({tier, className = ''}: {tier: Tier; className?: string}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const metal = TIER_METALS[tier] ?? TIER_METALS.bronze;
  const Icon = TIER_ICONS[tier] ?? Shield;
  const rank = tierRank(tier);
  const accent = metal.accent ?? metal.bright;
  const stars = TIER_STARS[tier] ?? 3;
  const starGap = Math.min(13, 54 / stars);
  const starR = stars > 6 ? 2.9 : stars > 4 ? 3.2 : 3.6;
  const wreaths = rank >= 2
    ? [
        {x0: 38, y0: 126, cx: 14, cy: 86, x1: 26, y1: 42, side: -1},
        {x0: 106, y0: 126, cx: 130, cy: 86, x1: 118, y1: 42, side: 1},
      ]
    : [];

  return (
    <svg className={`rank-crest ${className}`} data-tier={tier} viewBox="0 0 144 152" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2=".9" y2="1">
          <stop stopColor={metal.light} />
          <stop offset=".25" stopColor={metal.bright} />
          <stop offset=".47" stopColor={metal.light} />
          <stop offset=".52" stopColor={metal.bright} />
          <stop offset="1" stopColor={metal.deep} />
        </linearGradient>
        <linearGradient id={`${uid}-core`} x2="0" y2="1">
          <stop stopColor={metal.core} />
          <stop offset="1" stopColor="#0b1024" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop stopColor={metal.light} stopOpacity=".32" />
          <stop offset="1" stopColor={metal.bright} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-veil`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor={accent} />
          <stop offset=".5" stopColor={metal.bright} />
          <stop offset="1" stopColor={metal.light} />
        </linearGradient>
        <linearGradient id={`${uid}-ray`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={metal.light} stopOpacity=".9" />
          <stop offset="1" stopColor={metal.bright} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop stopColor={metal.bright} stopOpacity=".42" />
          <stop offset="1" stopColor={metal.deep} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the aurora veil — the top tier alone wears it */}
      {rank >= 7 && (
        <g>
          <path d="M4 106C32 32 112 32 140 106" fill="none" stroke={`url(#${uid}-veil)`} strokeWidth="11" strokeLinecap="round" opacity=".4" />
          <path d="M16 118C40 58 104 58 128 118" fill="none" stroke={`url(#${uid}-veil)`} strokeWidth="5" strokeLinecap="round" opacity=".32" />
        </g>
      )}

      {/* rays behind the shield */}
      {rank >= 3 && (
        <g fill={`url(#${uid}-ray)`}>
          {Array.from({length: 16}, (_, i) => {
            const a = (i * 22.5 - 90) * (Math.PI / 180);
            const w = 2.2 * (Math.PI / 180);
            const r0 = 34;
            const r1 = 70;
            const x0 = 72 + r0 * Math.cos(a - w);
            const y0 = 74 + r0 * Math.sin(a - w);
            const x1 = 72 + r1 * Math.cos(a);
            const y1 = 74 + r1 * Math.sin(a);
            const x2 = 72 + r0 * Math.cos(a + w);
            const y2 = 74 + r0 * Math.sin(a + w);
            return <path key={i} d={`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}Z`} />;
          })}
        </g>
      )}

      <circle cx="72" cy="74" r="65" fill={`url(#${uid}-glow)`} />

      {/* the dark halo — obsidian and up */}
      {rank >= 5 && <circle cx="72" cy="74" r="60" fill={`url(#${uid}-halo)`} />}

      {/* the ring of the order */}
      {rank >= 1 && (
        <circle cx="72" cy="74" r="69" fill="none" stroke={metal.bright} strokeWidth="1" strokeDasharray="1.5 5" opacity=".7" />
      )}

      {/* the faceted rim — diamond and up */}
      {rank >= 4 && (
        <g>
          <path d={facetPath(64, 12)} fill="none" stroke={accent} strokeWidth="1.1" opacity=".75" />
          {Array.from({length: 12}, (_, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return <circle key={i} cx={72 + 64 * Math.cos(a)} cy={74 + 64 * Math.sin(a)} r="1.7" fill={metal.light} opacity=".9" />;
          })}
        </g>
      )}

      {/* the laurel wreath */}
      {wreaths.map((w) => (
        <g key={w.side}>
          <path
            d={`M${w.x0} ${w.y0} Q${w.cx} ${w.cy} ${w.x1} ${w.y1}`}
            fill="none"
            stroke={metal.deep}
            strokeWidth="1.1"
            opacity=".65"
          />
          {curvePoints(w.x0, w.y0, w.cx, w.cy, w.x1, w.y1, 7).map((p, i) => (
            <ellipse
              key={i}
              cx={p.x}
              cy={p.y}
              rx="5.2"
              ry="2.3"
              fill={metal.bright}
              opacity={0.5 + (i % 2) * 0.32}
              transform={`rotate(${(p.angle + w.side * 90).toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            />
          ))}
        </g>
      ))}

      {/* drifting motes */}
      {rank >= 5 && (
        <g fill={metal.light}>
          {[[26, 52, 1.7], [118, 44, 1.4], [16, 96, 1.5], [130, 104, 1.8], [40, 20, 1.2], [104, 16, 1.6], [20, 72, 1.1], [128, 74, 1.3]].map(
            ([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} opacity={0.45 + (i % 3) * 0.18} />
            ),
          )}
        </g>
      )}

      {/* the orbit — mythril and up */}
      {rank >= 6 && (
        <g>
          <ellipse cx="72" cy="74" rx="60" ry="19" fill="none" stroke={accent} strokeWidth="1.2" opacity=".6" transform="rotate(-20 72 74)" />
          <circle cx="132" cy="74" r="2.6" fill={metal.light} transform="rotate(-20 72 74)" />
        </g>
      )}

      <g fill={`url(#${uid}-metal)`} stroke={metal.deep} strokeWidth="1.2" strokeLinejoin="round">
        <path d="M46 50 9 35l11 27 20 12-26-9 10 22 20 10-23-3 13 19 20 5 11-24Z" />
        <path d="m98 50 37-15-11 27-20 12 26-9-10 22-20 10 23-3-13 19-20 5-11-24Z" />
        <path d="m47 29 5-15 13 10 7-18 7 18 13-10 5 15-6 13H53Z" />
        <path d="m72 28 42 17-6 54q-7 25-36 44-29-19-36-44l-6-54Z" />
      </g>
      <path d="m72 37 32 13-5 45q-5 21-27 37-22-16-27-37l-5-45Z" fill={`url(#${uid}-core)`} stroke={metal.light} strokeWidth="1.2" />
      <path d="M43 51 72 39l29 12-4 33-25-17-25 17Z" fill={metal.light} opacity=".08" />
      <path d="m72 44 25 10-4 38q-3 18-21 32-18-14-21-32l-4-38Z" fill="none" stroke={metal.bright} strokeWidth=".8" opacity=".65" />
      <circle cx="72" cy="77" r="22" fill={metal.deep} stroke={metal.bright} strokeWidth="1.5" />
      <circle cx="72" cy="76" r="18" fill={`url(#${uid}-core)`} stroke={metal.light} strokeWidth=".5" />
      {/* the prismatic seal — diamond and up */}
      {rank >= 4 && (
        <circle cx="72" cy="77" r="26.5" fill="none" stroke={accent} strokeWidth="1" strokeDasharray="2.5 4.5" opacity=".85" />
      )}
      {/* the burning core — aurora alone */}
      {rank >= 7 && (
        <g>
          <circle cx="72" cy="76" r="14" fill={accent} opacity=".22" />
          <circle cx="72" cy="76" r="7" fill={metal.light} opacity=".9" />
          {[0, 90, 180, 270].map((a) => {
            const r = ((a - 90) * Math.PI) / 180;
            return (
              <path
                key={a}
                d={starPath(72 + 24 * Math.cos(r), 77 + 24 * Math.sin(r), 3.2)}
                fill={metal.light}
                opacity=".85"
              />
            );
          })}
        </g>
      )}
      <Icon x="59" y="62" width="26" height="26" color={metal.light} strokeWidth={1.65} />
      <path d="m42 111 30 14 30-14-5 17-25 13-25-13Z" fill={`url(#${uid}-metal)`} stroke={metal.deep} />
      {Array.from({length: stars}, (_, i) => {
        const x = 72 + (i - (stars - 1) / 2) * starGap;
        return <path key={i} d={starPath(x, 111, starR)} fill={metal.light} />;
      })}
      <path d="m37 47 2 21M46 37l26-10 28 11" fill="none" stroke={metal.light} strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
      {rank >= 3 && (
        <path d="m30 39 3 24M114 39l-3 24" fill="none" stroke={accent} strokeWidth="1" strokeLinecap="round" opacity=".55" />
      )}
      <circle cx="72" cy="27" r="3" fill={metal.light} />
      {rank >= 7 && <circle cx="72" cy="27" r="7" fill={accent} opacity=".3" />}
    </svg>
  );
}

/* --------------------------------------------------------------- realm badge */

/**
 * The realm badge — the mark a player carries for the realm they stand on.
 *
 * The season ladder is a hundred realms, so a badge cannot be "a tier colour
 * with a number on it": every realm has to look like its own object. Three
 * things do that work.
 *
 *   1. The **frame**. Ten silhouettes — shield, seal, kite, orb, rhomb, spire,
 *      lotus, astrolabe, blade, wing — cycle up the ladder, so neighbours never
 *      share a shape.
 *   2. The **rune ring**. A ring of ticks around the emblem, one tick for every
 *      level of the realm. Realm 1 has one tick; realm 100 has a hundred. The
 *      number is legible as a texture long before it is legible as a digit.
 *   3. The **colour**. Each realm carries its own pair, so no two neighbours
 *      match.
 *
 * Past platinum (realm 41) the badge stops being a medal and starts being an
 * entity: it gets a corona, a slow-turning outer ring of light and a pulse.
 */
export type RealmShape =
  | 'shield'
  | 'seal'
  | 'kite'
  | 'orb'
  | 'rhomb'
  | 'spire'
  | 'lotus'
  | 'astrolabe'
  | 'blade'
  | 'mandorle';

/** The ten silhouettes, drawn in a 120x120 box centred on 60,60. */
const REALM_SHAPES: Record<RealmShape, string> = {
  shield: 'M60 5 111 21c0 45-21 76-51 94C30 97 9 66 9 21Z',
  seal: 'M60 4 108 32v56L60 116 12 88V32Z',
  kite: 'M60 5 106 44 60 115 14 44Z',
  orb: 'M60 8a52 52 0 1 1 0 104 52 52 0 1 1 0-104Z',
  rhomb: 'M60 3 110 60 60 117 10 60Z',
  spire: 'M60 3 84 19l26 5c0 43-20 73-50 93C30 97 10 67 10 24l26-5Z',
  lotus: 'M60 4c26 14 40 34 40 58 0 28-18 46-40 54C38 108 20 90 20 62 20 38 34 18 60 4Z',
  astrolabe:
    'M60 6l10 18 21-4 4 21 19 9-11 18 11 18-19 9-4 21-21-4-10 18-10-18-21 4-4-21-19-9 11-18-11-18 19-9 4-21 21 4Z',
  blade: 'M60 4 82 38 96 60 82 82 60 116 38 82 24 60 38 38Z',
  mandorle:
    'M60 3c31 26 44 47 44 66 0 25-17 41-44 51-27-10-44-26-44-51 0-19 13-40 44-66Z',
};

/**
 * Where the emblem sits in each frame. The badge box is square but a frame is
 * not, so the emblem has to know where its own field is — otherwise the number
 * collides with the glyph on the shapes that sit low.
 */
const REALM_FOCUS: Record<RealmShape, number> = {
  shield: 52,
  seal: 56,
  kite: 52,
  orb: 56,
  rhomb: 56,
  spire: 54,
  lotus: 54,
  astrolabe: 56,
  blade: 58,
  mandorle: 56,
};

/**
 * How wide the field is at the focus point, in viewBox units. The emblem is
 * clamped to it, so a narrow frame (the blade) gets a smaller emblem instead
 * of an emblem that spills over the edge.
 */
const REALM_WIDTH: Record<RealmShape, number> = {
  shield: 62,
  seal: 70,
  kite: 64,
  orb: 78,
  rhomb: 72,
  spire: 66,
  lotus: 60,
  astrolabe: 74,
  blade: 46,
  mandorle: 62,
};

/** The rune ring: one tick for every level of the realm. */
function runeRing(realm: number, radius: number) {
  const count = Math.max(1, Math.min(100, realm));
  return Array.from({length: count}, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const long = index % 5 === 0;
    const inner = radius - (long ? 9 : 5);
    return {
      x1: 60 + Math.cos(angle) * inner,
      y1: 56 + Math.sin(angle) * inner,
      x2: 60 + Math.cos(angle) * radius,
      y2: 56 + Math.sin(angle) * radius,
      long,
    };
  });
}

export type RealmBadgeProps = {
  /** The realm number, 1-100. */
  realm: number;
  /** The realm's name. */
  label: string;
  /** The realm's dark colour. */
  deep: string;
  /** The realm's bright colour. */
  bright: string;
  /** The emblem the realm carries. */
  glyph?: BadgeGlyph | string;
  /** The outer silhouette. */
  shape?: RealmShape | string;
  /** True past platinum — the badge glows. */
  mystical?: boolean;
  size?: BadgeSize;
  /** Dimmed for realms that are still out of reach. */
  locked?: boolean;
  /** Rings the realm the player is standing on. */
  current?: boolean;
  /** Engrave the realm number into the face. */
  showNumber?: boolean;
  /** Overrides the accessible name and the tooltip. */
  title?: string;
  className?: string;
};

const REALM_SIZES = {
  xs: {box: 26, glyph: 11, number: 7},
  sm: {box: 34, glyph: 14, number: 9},
  md: {box: 46, glyph: 19, number: 11},
  lg: {box: 70, glyph: 29, number: 16},
  xl: {box: 102, glyph: 42, number: 22},
} as const;

export function RealmBadge({
  realm,
  label,
  deep,
  bright,
  glyph = 'sparkles',
  shape = 'shield',
  mystical = false,
  size = 'md',
  locked = false,
  current = false,
  showNumber = false,
  title,
  className = '',
}: RealmBadgeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dims = REALM_SIZES[size];
  const Glyph = GLYPHS[glyph as BadgeGlyph] ?? Sparkles;
  const frame: RealmShape = (shape as RealmShape) in REALM_SHAPES ? (shape as RealmShape) : 'shield';
  const silhouette = REALM_SHAPES[frame];
  const focus = REALM_FOCUS[frame];
  // The emblem is clamped to the width of the frame it sits in.
  const glyphPx = Math.min(dims.glyph, (REALM_WIDTH[frame] * (dims.box / 120)) * 0.66);
  const palette = paletteFrom(deep, bright);
  const runes = runeRing(realm, 36);
  const inner = 'translate(60 56) scale(0.84) translate(-60 -56)';

  return (
    <span
      className={`realm-badge ${mystical ? 'realm-badge--mystical' : ''} ${locked ? 'realm-badge--locked' : ''} ${
        current ? 'realm-badge--current' : ''
      } ${className}`}
      style={{width: dims.box, height: dims.box}}
      data-realm={realm}
      data-mystical={mystical ? 'true' : 'false'}
      role="img"
      aria-label={title ?? `${label} — realm ${realm}`}
      title={title ?? `${label} · realm ${realm}`}
    >
      <svg className="tier-badge__art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${uid}-metal`} x1="0.12" y1="0" x2="0.88" y2="1">
            <stop offset="0%" stopColor={palette.light} />
            <stop offset="18%" stopColor={palette.bright} />
            <stop offset="42%" stopColor={palette.light} />
            <stop offset="54%" stopColor={palette.bright} />
            <stop offset="100%" stopColor={palette.deep} />
          </linearGradient>
          <linearGradient id={`${uid}-core`} x1="0.2" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor={palette.core} />
            <stop offset="60%" stopColor={mix(palette.core, '#0b0620', 0.5)} />
            <stop offset="100%" stopColor="#070312" />
          </linearGradient>
          <radialGradient id={`${uid}-aura`} cx="50%" cy="44%" r="52%">
            <stop offset="0%" stopColor={palette.bright} stopOpacity={mystical ? 0.55 : 0.24} />
            <stop offset="55%" stopColor={palette.bright} stopOpacity={mystical ? 0.18 : 0.06} />
            <stop offset="100%" stopColor={palette.bright} stopOpacity="0" />
          </radialGradient>
          {mystical ? (
            <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={palette.light} stopOpacity="0.9" />
              <stop offset="50%" stopColor={palette.bright} stopOpacity="0.35" />
              <stop offset="100%" stopColor={palette.light} stopOpacity="0.9" />
            </linearGradient>
          ) : null}
          <clipPath id={`${uid}-clip`}>
            <path d={silhouette} transform={inner} />
          </clipPath>
        </defs>

        {/* the aura — a realm past platinum breathes light */}
        <circle cx="60" cy="56" r="58" fill={`url(#${uid}-aura)`} />

        {/* the outer ring of light, only for the mystical realms */}
        {mystical ? (
          <g className="realm-badge__orbit">
            <circle
              cx="60"
              cy="56"
              r="55"
              fill="none"
              stroke={`url(#${uid}-ring)`}
              strokeWidth="1.6"
              strokeDasharray="3 11"
              strokeLinecap="round"
            />
            <circle cx="60" cy="56" r="51" fill="none" stroke={palette.bright} strokeOpacity="0.28" strokeWidth="0.8" />
          </g>
        ) : null}

        {/* the frame */}
        <path d={silhouette} fill={`url(#${uid}-metal)`} stroke={palette.deep} strokeWidth="1.4" strokeLinejoin="round" />
        {/* the face */}
        <path d={silhouette} transform={inner} fill={`url(#${uid}-core)`} />
        <path
          d={silhouette}
          transform={inner}
          fill="none"
          stroke={palette.light}
          strokeOpacity="0.42"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* the rune ring, clipped to the face */}
        <g clipPath={`url(#${uid}-clip)`}>
          <g stroke={palette.bright} strokeOpacity="0.5" strokeWidth={mystical ? 1.2 : 0.9} strokeLinecap="round">
            {runes.map((tick, index) => (
              <line key={index} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} strokeOpacity={tick.long ? 0.85 : 0.42} />
            ))}
          </g>
        </g>

        {/* the bevel that catches the light along the top edge */}
        <path
          d={silhouette}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.22"
          strokeWidth="1.6"
          strokeLinejoin="round"
          transform="translate(60 56) scale(0.93) translate(-60 -56)"
        />
      </svg>

      {/* the emblem */}
      <span
        className="tier-badge__glyph"
        style={{top: `${((focus - (showNumber ? 24 : 24)) / 120) * 100}%`, height: `${(showNumber ? 24 : 34) / 1.2}%`}}
      >
        <Glyph style={{width: glyphPx, height: glyphPx}} strokeWidth={2.1} color={palette.light} />
      </span>

      {/* the realm number, engraved */}
      {showNumber ? (
        <span className="realm-badge__number" style={{top: `${((focus + 18) / 120) * 100}%`, fontSize: dims.number}}>
          {realm}
        </span>
      ) : null}
    </span>
  );
}
