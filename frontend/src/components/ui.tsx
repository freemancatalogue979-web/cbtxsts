/** Shared UI primitives — buttons, cards, fields, progress, modals, skeletons. */
import {CheckCircle2, Loader2, Phone, X} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import type {ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, SVGProps, TextareaHTMLAttributes} from 'react';
import {createElement, isValidElement, useEffect} from 'react';
import {avatarStyle, clamp} from '../lib/format';
import {auraOf, frameOf, portraitOf} from '../lib/cosmetics';
import type {CosmeticsRef} from '../lib/cosmetics';
import {usePlayerPhoto} from '../lib/photos';
import {EASE, overlayVariants, popIn, sheetVariants} from '../lib/motion';
import {uiClick} from '../lib/sfx';

/* ------------------------------------------------------------------ card */
export function Card({
  children,
  className = '',
  glow = false,
  raised = false,
  press = false,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  /** One step up the depth ladder — for the card the eye should land on. */
  raised?: boolean;
  /** Adds hover-lift on desktop and press-down on touch. */
  press?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag className={`card ${raised ? 'card-raised ' : ''}${press ? 'gpress ' : ''}${glow ? 'glow-brand ' : ''}${className}`}>
      {children}
    </Tag>
  );
}

/**
 * Round icon orb — the illustrated "sticker" behind an icon. Used in headers,
 * empty states, stat tiles and map nodes so icons read as game objects rather
 * than as glyphs.
 */
export function IconOrb({
  children,
  tone = 'nova',
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  tone?: 'nova' | 'flare' | 'pulse' | 'mint' | 'gold' | 'ink';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tones: Record<string, string> = {
    nova: 'from-nova-300 to-nova-600 text-ink-950',
    flare: 'from-flare-300 to-flare-600 text-ink-950',
    pulse: 'from-pulse-300 to-pulse-600 text-ink-950',
    mint: 'from-mint-300 to-mint-600 text-ink-950',
    gold: 'from-gold-300 to-gold-600 text-ink-950',
    ink: 'from-ink-500 to-ink-800 text-mist-100',
  };
  const sizes = {sm: 'size-8 text-[0.85rem]', md: 'size-11', lg: 'size-14'};
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br shadow-[inset_0_2px_0_rgba(255,255,255,0.45),0_3px_0_rgba(0,0,0,0.4)] ${tones[tone]} ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Floating "+20 XP" style number. Renders once, rises and fades — the visual
 * half of every reward (sound is optional, the number never is).
 */
export function XpFloat({
  amount,
  label = 'XP',
  tone = 'mint',
  className = '',
}: {
  amount: number;
  label?: string;
  tone?: 'mint' | 'gold' | 'nova';
  className?: string;
}) {
  const tones = {mint: 'text-mint-300', gold: 'text-gold-300', nova: 'text-nova-200'};
  return (
    <span
      className={`anim-xp pointer-events-none absolute z-20 font-display text-[0.95rem] font-black drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] ${tones[tone]} ${className}`}
    >
      +{amount} {label}
    </span>
  );
}

/* ---------------------------------------------------------------- button */
type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'gold' | 'mint' | 'soft';
type Size = 'sm' | 'md' | 'lg';

/* CHAMFER VARIANTS
   Each variant is just a surface (gradient + text colour). The chamfered
   silhouette, bevel, animated ring and press beam live on .gbtn-face / .gbtn-ring
   in the stylesheet — that way one shape system drives every variant and the
   outline / shadow stay consistent. Hover/focus states tune the gradient only. */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-nova-400 to-nova-700 text-white hover:from-nova-300 hover:to-nova-600',
  gold:
    'bg-gradient-to-b from-amber-400 to-amber-600 text-ink-950 hover:from-amber-300 hover:to-amber-500',
  mint:
    'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white hover:from-emerald-300 hover:to-emerald-500',
  danger:
    'bg-gradient-to-b from-flare-500 to-flare-700 text-white hover:from-flare-400 hover:to-flare-600',
  outline:
    'bg-[#0c0518] text-mist-100 hover:bg-[#150828] hover:text-white',
  ghost:
    'bg-white/[0.04] text-mist-300 hover:bg-nova-500/12 hover:text-mist-50',
  soft:
    'bg-nova-950/45 text-nova-200 hover:bg-nova-900/55 hover:text-nova-100',
};

/* SIZE on the outer button = height only. Padding & radius live on the face so
   the diagonal clip-path always wins (border-radius would otherwise re-round
   the corners on inner variants; clip-path ignores it, but we drop it anyway
   so there's no surprise). */
const SIZES: Record<Size, string> = {
  sm: 'h-9 text-[0.76rem] gap-1.5 font-bold tracking-wide',
  md: 'h-11 text-[0.82rem] gap-2 font-bold tracking-wider',
  lg: 'h-13 text-[0.90rem] gap-2.5 font-extrabold tracking-widest sm:h-14 sm:text-[0.94rem]',
};

/* Inner padding & radius — kept in lockstep with the old SIZES so existing
   layouts keep their rhythm. Slightly looser on lg so the shard's diagonal
   tips don't crowd the label. */
const FACE_SIZES: Record<Size, string> = {
  sm: 'px-3',
  md: 'px-4 sm:px-5',
  lg: 'px-5 sm:px-7',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  children,
  className = '',
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    /* Two layers: the outer <button> hosts the press / outer-glow / focus ring
       (which would be clipped if we put it on the shard), the inner <span>
       carries the diagonal clip-path and the painted surface so the shard's
       corners stay sharp and the violet halo glows around the full silhouette. */
    <button
      className={`gbtn inline-flex shrink-0 items-center justify-center touch-manipulation p-0
        focus-visible:ring-2 focus-visible:ring-nova-400/80 focus-visible:outline-none
        ${block ? 'w-full' : ''} ${SIZES[size]} ${className}`}
      disabled={disabled || loading}
      onClick={(e) => {
        uiClick(variant === 'danger' ? 'cancel' : variant === 'mint' ? 'confirm' : 'tap');
        onClick?.(e);
      }}
      {...(rest as object)}
    >
      <span
        className={`gbtn-face flex w-full items-center justify-center ${FACE_SIZES[size]} ${VARIANTS[variant]}`}
      >
        {/* The animated gradient ring sits inside the face so it inherits the
            chamfered clip and only its outer rim (the mask punches out the
            centre) is visible — that's the live HUD line around the tile. */}
        <span aria-hidden className="gbtn-ring" />
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </span>
    </button>
  );
}

export function IconButton({
  label,
  className = '',
  variant = 'ghost',
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string; variant?: Variant}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        uiClick('nav');
        onClick?.(e);
      }}
      className={`grid size-10 shrink-0 place-items-center transition-colors touch-manipulation ${
        variant === 'outline' ? 'border border-nova-500/30 bg-white/[0.04]' : ''
      } hover:bg-nova-500/15 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- chip */
/**
 * Chip — a collectible badge, not a developer label.
 *
 * Kept API-compatible with the old call sites (they pass colour classes), but
 * the default now carries the game badge chrome: hard border, top highlight and
 * a solid bottom edge.
 */
export function Chip({
  children,
  className = '',
  icon,
  shimmer = false,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  /** For limited-time / hot badges only — keep it rare. */
  shimmer?: boolean;
}) {
  return (
    <span
      className={`btag ${shimmer ? 'btag-shimmer ' : ''}${
        className || 'border-black/30 bg-ink-700 text-mist-300'
      }`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Difficulty/special tag with a fixed game meaning. */
export function GameTag({
  tone = 'easy',
  children,
  icon,
}: {
  tone?: 'easy' | 'medium' | 'hard' | 'boss' | 'new' | 'mastered' | 'daily' | 'hot';
  children: ReactNode;
  icon?: ReactNode;
}) {
  const tones: Record<string, string> = {
    easy: 'bg-gradient-to-b from-mint-300 to-mint-500 text-ink-950',
    medium: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950',
    hard: 'bg-gradient-to-b from-flare-400 to-flare-600 text-white',
    boss: 'bg-gradient-to-b from-nova-400 to-nova-700 text-white',
    new: 'bg-gradient-to-b from-pulse-300 to-pulse-600 text-ink-950',
    mastered: 'bg-gradient-to-b from-gold-200 to-gold-400 text-ink-950',
    daily: 'bg-gradient-to-b from-pulse-400 to-nova-600 text-white',
    hot: 'bg-gradient-to-b from-flare-300 to-flare-600 text-white',
  };
  return (
    <Chip className={tones[tone]} icon={icon} shimmer={tone === 'hot' || tone === 'daily'}>
      {children}
    </Chip>
  );
}

/* --------------------------------------------------------------- avatar */
/**
 * Avatar — the player's portrait everywhere: leaderboards, duels, chat, feeds.
 *
 * Three cosmetic layers ride on top of the identity, all optional:
 * an **aura** (a halo + drifting motes), a **frame** (a rarity ring, animated
 * for the vault frames) and an **avatar portrait** (a shop character that stands
 * in for the initials). A player with none of them looks exactly as before.
 */
export function Avatar({
  name,
  hue = 260,
  initials,
  size = 44,
  online,
  ring = false,
  className = '',
  photo = null,
  cosmetics = null,
}: {
  name: string;
  hue?: number;
  initials?: string;
  size?: number;
  online?: boolean;
  ring?: boolean;
  className?: string;
  photo?: {id: number; has?: boolean | null} | null;
  cosmetics?: CosmeticsRef | null;
}) {
  const photoUrl = usePlayerPhoto(photo?.id ?? null, photo?.has ?? null);
  const letters = initials || name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  const aura = auraOf(cosmetics);
  const frame = frameOf(cosmetics);
  const portrait = portraitOf(cosmetics);
  const mote = Math.max(3, Math.round(size * 0.12));
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {/* Aura: a soft glow behind the portrait, plus three drifting motes. */}
      {aura && (
        <span
          aria-hidden
          className="hero-aura pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${aura.glow} 0%, transparent 70%)`,
            boxShadow: `0 0 18px 4px ${aura.glow}`,
            transform: `scale(${1 + Math.min(0.4, size / 400)})`,
          }}
        />
      )}
      {aura && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="hero-mote absolute rounded-full"
              style={{
                width: mote,
                height: mote,
                background: aura.particles,
                boxShadow: `0 0 6px 1px ${aura.ring}`,
                animationDelay: `${index * 0.8}s`,
                left: `${18 + index * 30}%`,
                top: `${72 - index * 22}%`,
              }}
            />
          ))}
        </span>
      )}
      {/* `shrink-0` + `aspect-square` keep the initials badge a true circle: as a
          flex item it was being squeezed horizontally on narrow phones, which
          rendered the avatar as an oval. */}
      <span
        className={`grid aspect-square shrink-0 place-items-center overflow-hidden rounded-full leading-none font-black text-ink-950 ${
          ring && !frame ? 'ring-2 ring-white/25' : ''
        } ${frame?.animated ? 'hero-frame-spin' : ''}`}
        style={{
          ...avatarStyle(hue),
          width: size,
          height: size,
          minWidth: size,
          fontSize: Math.max(11, size * 0.36),
          ...(frame ? {boxShadow: `0 0 0 3px ${frame.ring}, 0 0 16px 2px ${frame.glow}`} : {}),
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" className="size-full rounded-full object-cover" style={{width: size, height: size}} />
        ) : portrait ? (
          <span aria-hidden style={{fontSize: size * 0.56, lineHeight: 1}}>
            {portrait}
          </span>
        ) : (
          letters
        )}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-ink-900 ${
            online ? 'bg-mint-400' : 'bg-mist-600'
          }`}
          style={{width: Math.max(9, size * 0.26), height: Math.max(9, size * 0.26)}}
        />
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- fields */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
 <span className="mb-1.5 block text-[0.72rem] font-bold tracking-[0.14em] text-mist-500">{label}</span>
      )}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[0.74rem] font-semibold text-flare-400">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[0.74rem] font-medium text-mist-500">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  // NOTE: no responsive horizontal padding here on purpose. Tailwind emits
  // breakpoint variants after base utilities, so a `sm:px-*` would outrank the
  // `pl-*` that icon-prefixed fields rely on and slide text under the icon.
  'w-full rounded-lg border border-white/12 bg-ink-950/80 px-3.5 py-2.5 text-base font-semibold text-mist-50 sm:text-[0.90rem] ' +
  'placeholder:font-medium placeholder:text-mist-600 transition-colors ' +
  'focus:border-nova-400/60 focus:bg-ink-900 focus:ring-2 focus:ring-nova-500/20 focus:outline-none';

export function TextInput({className = '', ...rest}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${className}`} {...rest} />;
}

/**
 * Phone field with a real country-code affix.
 *
 * The old version floated "+234" over the input and padded the text away from
 * it, which collapsed the moment a responsive padding variant outranked the
 * left pad — digits ended up sitting under the prefix. Here the prefix is a
 * layout sibling in a flex row, so overlap is impossible at any width, and the
 * focus ring wraps the whole field.
 */
export function PhoneInput({
  value,
  onChange,
  placeholder = '803 123 4567',
  invalid = false,
  id,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
}) {
  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-2xl border bg-ink-900/70 transition-colors focus-within:border-nova-400/60 focus-within:bg-ink-850 focus-within:ring-2 focus-within:ring-nova-500/25 ${
        invalid ? 'border-flare-500/50' : 'border-white/12'
      }`}
    >
      <span className="flex shrink-0 items-center gap-1.5 border-r border-white/10 bg-white/[0.05] px-2.5 text-[0.82rem] font-black text-mist-300 sm:px-3.5 sm:text-[0.88rem]">
        <Phone className="size-4 shrink-0 text-nova-400" />
        +234
      </span>
      <input
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        inputMode="tel"
        autoComplete="tel"
        aria-label="Phone number"
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base font-semibold tracking-wide text-mist-50 tabular placeholder:font-medium placeholder:text-mist-600 focus:outline-none sm:px-3.5 sm:text-[0.92rem]"
      />
    </div>
  );
}

export function TextArea({className = '', ...rest}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} resize-y ${className}`} {...rest} />;
}

export function Select({className = '', children, ...rest}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} appearance-none pr-10 ${className}`} {...rest}>
      {children}
    </select>
  );
}

/* -------------------------------------------------------------- progress */
export function ProgressBar({
  value,
  max = 100,
  className = '',
  barClassName = '',
  animated = true,
  tone = 'brand',
}: {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  animated?: boolean;
  tone?: 'brand' | 'gold';
}) {
  const percent = clamp(max > 0 ? (value / max) * 100 : 0, 0, 100);
  return (
    <div className={`xpbar w-full ${className}`}>
      <motion.div
        className={`xpbar-fill ${tone === 'gold' ? 'bg-[image:var(--xp-grad)]' : 'brand-gradient'} ${barClassName}`}
        initial={false}
        animate={{width: `${percent}%`}}
        transition={{duration: animated ? 0.7 : 0, ease: EASE}}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  size = 92,
  stroke = 8,
  children,
  gradientId = 'ring-brand',
  track = 'rgba(255,255,255,0.09)',
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  gradientId?: string;
  track?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = clamp(value, 0, 100);
  return (
    <div className="relative grid place-items-center" style={{width: size, height: size}}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="50%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{strokeDashoffset: circumference - (percent / 100) * circumference}}
          transition={{duration: 0.8, ease: EASE}}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">{children}</span>
    </div>
  );
}

/* --------------------------------------------------------------- layout */
export function SectionHeading({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 sm:mb-4 sm:gap-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[1rem] leading-tight font-extrabold text-mist-50 sm:text-lg">
          {icon && <span className="text-nova-400">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-[0.82rem] font-medium text-mist-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------- review options */
export function ReviewOptions({
  options,
  correct,
  chosen,
}: {
  options: Record<string, string> | null | undefined;
  correct?: string | null;
  chosen?: string | null;
}) {
  /** The full A-D list a finished screen owes the player: every option, their
   *  own pick flagged and the right answer highlighted — never letters alone. */
  const entries = Object.entries(options ?? {}).filter(([, text]) => (text ?? '').trim());
  if (!entries.length) return null;
  return (
    <ul className="mt-2 grid gap-1.5">
      {entries.map(([letter, text]) => {
        const isCorrect = letter === correct;
        const isChosen = letter === chosen && !isCorrect;
        return (
          <li
            key={letter}
            className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-[0.8rem] font-semibold ${
              isCorrect
                ? 'border-mint-500/45 bg-mint-500/12 text-mint-200'
                : isChosen
                  ? 'border-flare-500/45 bg-flare-500/12 text-flare-200'
                  : 'border-white/8 bg-white/[0.02] text-mist-400'
            }`}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.7rem] font-black">{letter}</span>
            <span className="min-w-0 flex-1">{text}</span>
            {isCorrect && <CheckCircle2 className="size-4 shrink-0 text-mint-400" />}
            {isChosen && <X className="size-4 shrink-0 text-flare-400" />}
          </li>
        );
      })}
    </ul>
  );
}

export function Skeleton({className = ''}: {className?: string}) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center sm:gap-4 sm:py-12">
      <span className="flex items-end gap-2">
        <span className="tf-orb grid size-9 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-pulse-300 to-pulse-600 text-ink-950 opacity-70 shadow-[inset_0_2px_0_rgba(255,255,255,0.45)]" />
        <IconOrb size="lg" tone="nova">
          {icon}
        </IconOrb>
        <span className="tf-orb grid size-9 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 opacity-70 shadow-[inset_0_2px_0_rgba(255,255,255,0.45)]" />
      </span>
      <div>
        <p className="text-[1.02rem] font-extrabold text-mist-100">{title}</p>
        {detail && <p className="mx-auto mt-1 max-w-sm text-[0.85rem] font-medium text-mist-400">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  icon,
  tone = 'nova',
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'nova' | 'flare' | 'pulse' | 'mint' | 'gold';
  hint?: string;
}) {
  const tones: Record<string, string> = {
    nova: 'from-nova-300 to-nova-600 text-ink-950',
    flare: 'from-flare-300 to-flare-600 text-ink-950',
    pulse: 'from-pulse-300 to-pulse-600 text-ink-950',
    mint: 'from-mint-300 to-mint-600 text-ink-950',
    gold: 'from-gold-300 to-gold-600 text-ink-950',
  };
  return (
    <div className="card flex min-w-0 items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3.5">
      {icon && <span className={`grid size-10 shrink-0 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br shadow-[inset_0_2px_0_rgba(255,255,255,0.4)] sm:size-11 ${tones[tone]}`}>{icon}</span>}
      <div className="min-w-0">
 <p className="truncate text-[0.62rem] font-bold tracking-[0.1em] text-mist-500 sm:text-[0.68rem] sm:tracking-[0.14em]">{label}</p>
        <p className="truncate text-base leading-tight font-extrabold tabular text-mist-50 sm:text-lg">{value}</p>
        {hint && <p className="truncate text-[0.68rem] font-medium text-mist-500 sm:text-[0.72rem]">{hint}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- modal */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const widths = {sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl'};

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-60 flex items-end justify-center overflow-y-auto scrim backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"
          variants={overlayVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className={`panel-hero flex max-h-[94dvh] w-full flex-col rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom,0px)] sm:max-h-[88dvh] sm:w-auto sm:rounded-[1.75rem] sm:pb-0 ${widths[size]}`}
            variants={sheetVariants}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex justify-center pt-2.5 sm:hidden">
              <span className="sheet-handle" />
            </div>
            {(title || subtitle) && (
              <header className="panel-band flex items-start justify-between gap-3 px-4 pt-3 pb-3.5 sm:gap-4 sm:px-5 sm:pt-4">
                <div className="min-w-0">
                  {title && <h3 className="text-[0.95rem] leading-snug font-extrabold text-mist-50 sm:text-base">{title}</h3>}
                  {subtitle && <p className="mt-0.5 text-[0.78rem] font-medium text-mist-500 sm:text-[0.82rem]">{subtitle}</p>}
                </div>
                <IconButton label="Close" onClick={onClose}>
                  <X className="size-5" />
                </IconButton>
              </header>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
            {footer && (
              <footer className="flex flex-wrap justify-end gap-2 border-t border-white/8 px-4 pt-3 pb-3 sm:px-5 sm:py-4">{footer}</footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------- segmented nav */
/** An icon may be passed either as an element or as a lucide component. */
export type IconProp = ReactNode | ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Icons may be passed either as an element (<Zap />) or as the component itself
 * (Zap). Lucide components are forwardRef objects, so test with isValidElement
 * rather than typeof — rendering one as a child crashes React.
 */
function renderIcon(icon: IconProp | undefined, className = 'size-4'): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return createElement(icon as ComponentType<SVGProps<SVGSVGElement>>, {className});
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: {value: T; label: string; icon?: IconProp}[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/10 bg-ink-950/80 p-1 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => {
              uiClick('select');
              onChange(option.value);
            }}
 className={`relative flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[0.78rem] font-bold tracking-wide transition-colors ${
              active ? 'text-white' : 'text-mist-400 hover:text-mist-100'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segment-${option.value}-${options.length}`}
                className="brand-gradient absolute inset-0 -z-1 rounded-md"
                transition={{type: 'spring', stiffness: 420, damping: 32}}
              />
            )}
            {renderIcon(option.icon)}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export {popIn};
