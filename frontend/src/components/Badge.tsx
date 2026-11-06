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
import {useId, type CSSProperties} from 'react';
import {Award, Crown, Flame, Gem, Medal, Shield, Sparkles, Star, Sun, Trophy, Zap} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {BaseTier, Tier} from '../lib/tiers';
import {TIER_ORDER, TIER_PALETTES, tierDivision, tierFamily} from '../lib/tiers';

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

/** Sculpted colours shared by achievement and lifetime medals. */
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

/** All achievement metals and the 25 lifetime-rank palettes. */
export const TIER_METALS: Record<Tier, BadgePalette> = TIER_PALETTES;
export {TIER_ORDER};

/** How far up the 25-medal lifetime ladder a tier sits. */
export function tierRank(tier: Tier | string): number {
  const index = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  return index < 0 ? 0 : index;
}

/** Each metal family has its own readable centre emblem. */
const TIER_ICONS: Record<BaseTier | 'genesis', LucideIcon> = {
  bronze: Shield,
  silver: Star,
  gold: Trophy,
  platinum: Gem,
  diamond: Sparkles,
  obsidian: Flame,
  mythril: Zap,
  aurora: Sun,
  genesis: Crown,
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

/** Each family has its own shield contour, even before colour and emblem. */
const CREST_SHIELDS: Record<BaseTier | 'genesis', string> = {
  bronze: 'm60 31 40 15-4 48q-5 22-36 39-31-17-36-39l-4-48Z',
  silver: 'm60 29 42 17-7 46q-7 23-35 42-28-19-35-42l-7-46Z',
  gold: 'm60 30 43 14-3 48q-4 24-40 42-36-18-40-42l-3-48Z',
  platinum: 'm60 28 42 18-5 47-37 41-37-41-5-47Z',
  diamond: 'm60 27 43 20-9 45-34 42-34-42-9-45Z',
  obsidian: 'm60 27 44 18-8 49-36 40-36-40-8-49Z',
  mythril: 'm60 27 39 17 5 12-10 40-34 38-34-38-10-40 5-12Z',
  aurora: 'm60 26 41 17 4 14-9 38q-7 22-36 39-29-17-36-39l-9-38 4-14Z',
  genesis: 'm60 24 45 18-3 50q-4 25-42 43-38-18-42-43l-3-50Z',
};

/** Premium metalwork contained within the crown, shield and folded ribbon. */
export function HeraldicCrest({tier, className = ''}: {tier: Tier; className?: string}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const metal = TIER_METALS[tier] ?? TIER_METALS.bronze;
  const family = tierFamily(tier);
  const Icon = TIER_ICONS[family];
  const stars = tierDivision(tier);
  const genesis = family === 'genesis';
  const accent = metal.accent ?? metal.light;
  const shield = CREST_SHIELDS[family];
  const innerShield = 'translate(60 80) scale(.865) translate(-60 -80)';

  return (
    <svg className={`rank-crest ${className}`} data-tier={tier} data-division={stars} viewBox="0 0 120 140" aria-hidden="true" focusable="false"
      style={{'--crest-glow': `${metal.bright}b8`} as CSSProperties}>
      <defs>
        <linearGradient id={`${uid}-metal`} x1=".05" y1="0" x2=".9" y2="1">
          <stop stopColor={metal.deep} /><stop offset=".12" stopColor={metal.bright} /><stop offset=".27" stopColor={metal.light} />
          <stop offset=".38" stopColor={metal.bright} /><stop offset=".49" stopColor="#ffffff" /><stop offset=".535" stopColor={metal.light} />
          <stop offset=".7" stopColor={metal.bright} /><stop offset="1" stopColor={metal.deep} />
        </linearGradient>
        <linearGradient id={`${uid}-bevel`} x1="0" y1="0" x2=".85" y2="1">
          <stop stopColor="#ffffff" stopOpacity=".95" /><stop offset=".24" stopColor={metal.light} stopOpacity=".7" />
          <stop offset=".52" stopColor={metal.deep} stopOpacity=".25" /><stop offset="1" stopColor={metal.deep} stopOpacity=".9" />
        </linearGradient>
        <radialGradient id={`${uid}-core`} cx=".38" cy=".2" r=".95">
          <stop stopColor={mix(metal.core, metal.bright, .22)} /><stop offset=".5" stopColor={metal.core} /><stop offset="1" stopColor="#050713" />
        </radialGradient>
        <linearGradient id={`${uid}-gem`} x1=".15" y1="0" x2=".85" y2="1">
          <stop stopColor="#ffffff" /><stop offset=".25" stopColor={accent} /><stop offset=".52" stopColor={metal.bright} /><stop offset="1" stopColor={metal.deep} />
        </linearGradient>
        <linearGradient id={`${uid}-ribbon`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={metal.light} /><stop offset=".18" stopColor={metal.bright} />
          <stop offset=".55" stopColor={mix(metal.bright, metal.deep, .35)} /><stop offset="1" stopColor={metal.deep} />
        </linearGradient>
        <filter id={`${uid}-relief`} x="-35%" y="-35%" width="170%" height="180%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.1" floodColor="#000000" floodOpacity=".85" />
        </filter>
        <clipPath id={`${uid}-face-clip`}><path d={shield} transform={innerShield} /></clipPath>
      </defs>

      {/* Raised five-point crown with a dark casting and cut gemstones. */}
      <path d={genesis ? 'm25 40 5-29 20 15 10-23 10 23 20-15 5 29-10 12H35Z' : 'm31 39 4-25 16 13 9-21 9 21 16-13 4 25-9 11H40Z'}
        fill={metal.deep} stroke="#050713" strokeWidth="2.2" strokeLinejoin="round" />
      <path d={genesis ? 'm28 37 4-22 19 14 9-22 9 22 19-14 4 22-9 9H37Z' : 'm34 36 3-18 15 12 8-19 8 19 15-12 3 18-8 9H42Z'}
        fill={`url(#${uid}-metal)`} stroke={metal.light} strokeOpacity=".55" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M36 36q24 8 48 0l-3 9H39Z" fill={`url(#${uid}-ribbon)`} stroke={metal.deep} strokeWidth="1" />
      <path d="M39 37q21 5 42 0" fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth="1.2" />
      <path d="m60 13 5.5 9-5.5 10-5.5-10Z" fill={`url(#${uid}-gem)`} stroke={metal.light} strokeWidth=".8" filter={`url(#${uid}-relief)`} />
      <path d="m60 15 2.8 7-2.8 7-2.8-7Z" fill="#fff" opacity=".42" />
      {[43, 77].map((x) => <path key={x} d={`m${x} 25 3 4-3 5-3-5Z`} fill={accent} stroke={metal.light} strokeWidth=".55" />)}
      {[40, 50, 70, 80].map((x) => <circle key={x} cx={x} cy="39" r="1.45" fill={metal.light} stroke={metal.deep} strokeWidth=".5" />)}

      {/* Deep casting, raised outer metal and recessed enamel. */}
      <path d={shield} transform="translate(0 2)" fill="#03040b" stroke="#03040b" strokeWidth="3" strokeLinejoin="round" opacity=".85" />
      <path d={shield} fill={`url(#${uid}-metal)`} stroke={metal.deep} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={shield} transform="translate(60 80) scale(.95) translate(-60 -80)" fill="none" stroke={`url(#${uid}-bevel)`} strokeWidth="2.1" strokeLinejoin="round" />
      <path d={shield} transform={innerShield} fill={`url(#${uid}-core)`} stroke={metal.deep} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={shield} transform={innerShield} fill="none" stroke={metal.light} strokeOpacity=".55" strokeWidth=".85" strokeLinejoin="round" />
      <g clipPath={`url(#${uid}-face-clip)`}>
        <path d="M20 47 60 32l40 17-12 25-28-19-28 19Z" fill={metal.light} opacity=".09" />
        <path d="M29 45 52 36 35 111 22 92Z" fill="#ffffff" opacity=".075" />
        <path d="M87 48 94 64 80 112 72 119Z" fill={metal.bright} opacity=".08" />
      </g>
      <path d="M29 50 60 38l31 13" fill="none" stroke="#ffffff" strokeOpacity=".7" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M31 57q8 1 14 8M31 64q7 1 11 6M89 57q-8 1-14 8M89 64q-7 1-11 6" fill="none" stroke={metal.bright} strokeOpacity=".62" strokeWidth="1" strokeLinecap="round" />
      <path d="M31 76q1 19 12 31M89 76q-1 19-12 31" fill="none" stroke={metal.light} strokeOpacity=".25" strokeWidth="1.1" strokeLinecap="round" />
      <path d="m34 96 8 4-5 5M86 96l-8 4 5 5" fill="none" stroke={accent} strokeOpacity=".6" strokeWidth=".9" />

      {/* Jewelled octagonal centre setting, not an outer decorative ring. */}
      <path d="m60 49 18 6 8 18-8 19-18 7-18-7-8-19 8-18Z" fill="#03050e" opacity=".8" transform="translate(0 1.5)" />
      <path d="m60 48 18 6 8 19-8 19-18 7-18-7-8-19 8-19Z" fill={`url(#${uid}-metal)`} stroke={metal.deep} strokeWidth="1.2" filter={`url(#${uid}-relief)`} />
      <path d="m60 53 14 5 6 15-6 14-14 6-14-6-6-14 6-15Z" fill={`url(#${uid}-core)`} stroke={metal.light} strokeOpacity=".72" strokeWidth=".9" />
      <path d="m60 53 14 5-14 7-14-7ZM40 73l6-15 6 15-6 14ZM80 73l-6-15-6 15 6 14ZM60 93l-14-6 14-6 14 6Z" fill={metal.bright} opacity=".16" />
      <path d="M46 59 60 54l14 5" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1" />
      <Icon x="47" y="60" width="26" height="26" color={metal.light} strokeWidth={1.75} filter={`url(#${uid}-relief)`} />
      <path d="m60 45 2.2 3.4L60 51l-2.2-2.6Z" fill={accent} />

      {/* Folded, engraved rank ribbon with raised division stars. */}
      <path d="m30 108-10 8 13 5 8-9ZM90 108l10 8-13 5-8-9Z" fill={metal.deep} stroke={metal.bright} strokeOpacity=".45" strokeWidth=".8" />
      <path d="m30 105 30 12 30-12-4 20-26 12-26-12Z" fill="#03050d" opacity=".8" transform="translate(0 1.5)" />
      <path d="m30 104 30 12 30-12-4 20-26 12-26-12Z" fill={`url(#${uid}-ribbon)`} stroke={metal.deep} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m34 107 26 10 26-10-1 4-25 10-25-10Z" fill="#ffffff" opacity=".22" />
      <path d="m36 124 24 10 24-10" fill="none" stroke={metal.light} strokeOpacity=".38" strokeWidth=".8" />
      {Array.from({length: stars}, (_, i) => {
        const x = 60 + (i - (stars - 1) / 2) * 15;
        return <path key={i} d={starPath(x, 120, 4.6)} fill={`url(#${uid}-gem)`} stroke={metal.light} strokeWidth=".55" filter={`url(#${uid}-relief)`} />;
      })}
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
 * Past platinum (realm 41) a restrained specular sweep travels across the
 * metal. The animation stays clipped to the badge — no floating aura or orbit.
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
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="48%" stopColor={palette.light} stopOpacity="0.7" />
            <stop offset="52%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${uid}-clip`}>
            <path d={silhouette} transform={inner} />
          </clipPath>
        </defs>

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

        {/* An occasional polished-metal sweep, clipped to the badge itself.
            No floating aura, orbiting circle or perpetual pulsing. */}
        {mystical ? (
          <g clipPath={`url(#${uid}-clip)`} aria-hidden="true">
            <rect className="realm-badge__sheen" x="-45" y="-35" width="42" height="185" fill={`url(#${uid}-sheen)`} />
          </g>
        ) : null}

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
