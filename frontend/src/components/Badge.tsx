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
import {Award, Crown, Flame, Gem, Medal, Shield, Sparkles, Star, Sun, Trophy, Zap} from 'lucide-react';
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

/** The lifetime ladder's metals. */
export const TIER_METALS: Record<Tier, BadgePalette> = {
  bronze: {light: '#ffe1b0', bright: '#ce8b55', deep: '#563322', core: '#472c29'},
  silver: {light: '#f2f8ff', bright: '#b6cce3', deep: '#455974', core: '#24334c'},
  gold: {light: '#fff4ba', bright: '#efbf54', deep: '#81531b', core: '#4c351b'},
  platinum: {light: '#e4ffff', bright: '#80e2ef', deep: '#34768a', core: '#162f4e'},
};

/** The emblem each lifetime metal carries. */
const TIER_ICONS: Record<Tier, LucideIcon> = {
  bronze: Shield,
  silver: Star,
  gold: Crown,
  platinum: Gem,
};

/** How many stars each lifetime metal is worth. */
const TIER_STARS: Record<Tier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 3,
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

/**
 * The lifetime crest — the big heraldic ornament on a player's profile.
 *
 * Unlike the tier badges this one is not server-coloured: the four lifetime
 * metals are the ladder the profile screen shows, so their colours are baked
 * into the art.
 */
export function HeraldicCrest({tier, className = ''}: {tier: Tier; className?: string}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const metal = TIER_METALS[tier] ?? TIER_METALS.bronze;
  const Icon = TIER_ICONS[tier] ?? Shield;
  return (
    <svg className={`rank-crest ${className}`} viewBox="0 0 144 152" aria-hidden="true" focusable="false">
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
      </defs>
      <circle cx="72" cy="74" r="65" fill={`url(#${uid}-glow)`} />
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
      <Icon x="59" y="62" width="26" height="26" color={metal.light} strokeWidth={1.65} />
      <path d="m42 111 30 14 30-14-5 17-25 13-25-13Z" fill={`url(#${uid}-metal)`} stroke={metal.deep} />
      {Array.from({length: TIER_STARS[tier] ?? 3}, (_, i) => {
        const x = 72 + (i - ((TIER_STARS[tier] ?? 3) - 1) / 2) * 12;
        return <path key={i} d={`m${x} 111 1.5 3.3 3.6.4-2.7 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.5-2.7-2.4 3.6-.4Z`} fill={metal.light} />;
      })}
      <path d="m37 47 2 21M46 37l26-10 28 11" fill="none" stroke={metal.light} strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
      <circle cx="72" cy="27" r="3" fill={metal.light} />
    </svg>
  );
}
