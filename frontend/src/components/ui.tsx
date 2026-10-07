/** Shared UI primitives — buttons, cards, fields, progress, modals, skeletons. */
import {AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, HelpCircle, Loader2, Minus, Phone, Plus, Search, X} from 'lucide-react';
import {AnimatePresence, motion, useDragControls} from 'motion/react';
import type {ButtonHTMLAttributes, ChangeEvent, ComponentType, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, SVGProps, TextareaHTMLAttributes} from 'react';
import {Children, cloneElement, createElement, Fragment, isValidElement, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {avatarStyle, clamp, PHONE_COUNTRIES, phoneCountry} from '../lib/format';
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

/* VARIANTS — each is only a surface (fill, border, text colour). Shape, sheen and
   press feel live on .gbtn / .gbtn-face in the stylesheet, so one system drives
   every button. Solid variants get depth; quiet ones get a hairline border. */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-nova-400 to-nova-600 text-white hover:from-nova-300 hover:to-nova-500',
  gold: 'bg-gradient-to-b from-amber-300 to-amber-500 text-ink-950 hover:from-amber-200 hover:to-amber-400',
  mint: 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white hover:from-emerald-300 hover:to-emerald-500',
  danger: 'bg-gradient-to-b from-flare-500 to-flare-700 text-white hover:from-flare-400 hover:to-flare-600',
  outline: 'border border-white/14 bg-white/[0.03] text-mist-100 hover:border-white/24 hover:bg-white/[0.07] hover:text-mist-50',
  ghost: 'border border-transparent bg-transparent text-mist-300 hover:bg-white/[0.07] hover:text-mist-50',
  soft: 'border border-nova-400/20 bg-nova-500/12 text-nova-100 hover:border-nova-400/35 hover:bg-nova-500/20 hover:text-white',
};
const SOLID = new Set<Variant>(['primary', 'gold', 'mint', 'danger']);

/* SIZE on the outer button: height, type and corner radius. */
const SIZES: Record<Size, string> = {
  sm: 'h-9 text-[0.78rem] font-bold [--qa-btn-radius:10px]',
  md: 'h-11 text-[0.84rem] font-bold [--qa-btn-radius:12px]',
  lg: 'h-13 text-[0.92rem] font-extrabold tracking-wide [--qa-btn-radius:14px] sm:h-14 sm:text-[0.96rem]',
};
/* Icon-only buttons are squares of the same height. */
const SQUARE: Record<Size, string> = {sm: 'w-9', md: 'w-11', lg: 'w-13 sm:w-14'};
const FACE_SIZES: Record<Size, string> = {
  sm: 'px-3 gap-1.5',
  md: 'px-4 gap-2 sm:px-5',
  lg: 'px-5 gap-2.5 sm:px-7',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  /** Accessible name + tooltip. Required in practice for icon-only buttons. */
  label?: string;
  /** Rounded everywhere by default; "angular" is an explicit opt-in for special art-directed spots. */
  shape?: 'auto' | 'rounded' | 'angular';
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  label,
  shape = 'auto',
  children,
  className = '',
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  const iconOnly = !!icon && (children === undefined || children === null || children === false || children === '');
  const solid = SOLID.has(variant);
  const angular = shape === 'angular' && !iconOnly;
  // Icon-only buttons are named by `label`, falling back to an existing title / aria-label.
  const {title, ...others} = rest;
  const name = label ?? title ?? (rest as {'aria-label'?: string})['aria-label'];
  const passthrough = iconOnly ? others : rest;
  /* A caller's base display class (e.g. "hidden lg:inline-flex") must win;
     Tailwind emits inline-flex after hidden, so drop our default instead. */
  const ownDisplay = /(^|\s)(hidden|flex|grid|block|inline-grid|inline-block)(\s|$)/.test(className);
  return (
    <button
      className={`gbtn ${ownDisplay ? '' : 'inline-flex'} shrink-0 items-center justify-center touch-manipulation p-0 focus-visible:outline-none
        ${block ? 'w-full' : ''} ${SIZES[size]} ${iconOnly ? SQUARE[size] : ''} ${className}`}
      data-shape={angular ? 'angular' : undefined}
      data-variant={variant}
      data-tip={iconOnly && name ? name : undefined}
      aria-label={name}
      disabled={disabled || loading}
      onClick={(e) => {
        uiClick(variant === 'danger' ? 'cancel' : variant === 'mint' ? 'confirm' : 'tap');
        onClick?.(e);
      }}
      {...(passthrough as object)}
    >
      <span
        data-solid={solid ? '' : undefined}
        className={`gbtn-face flex w-full items-center justify-center ${iconOnly ? 'px-0' : FACE_SIZES[size]} ${VARIANTS[variant]}`}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </span>
    </button>
  );
}

/** A square, icon-only button with a tooltip — same shape language as Button. */
export function IconButton({
  label,
  className = '',
  variant = 'ghost',
  size,
  active = false,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string; variant?: Variant; size?: Size; active?: boolean}) {
  // Default footprint stays 40px so headers and chat rows keep their rhythm.
  const box = size ? `${SIZES[size]} ${SQUARE[size]}` : 'h-10 w-10 [--qa-btn-radius:12px]';
  return (
    <button
      aria-label={label}
      aria-pressed={active || undefined}
      data-tip={label}
      onClick={(e) => {
        uiClick('nav');
        onClick?.(e);
      }}
      className={`gbtn ${/(^|\s)(hidden|flex|grid|block|inline-flex|inline-block)(\s|$)/.test(className) ? '' : 'inline-grid'} shrink-0 place-items-center touch-manipulation p-0 focus-visible:outline-none ${box} ${className}`}
      {...rest}
    >
      <span
        data-solid={SOLID.has(variant) ? '' : undefined}
        className={`gbtn-face grid place-items-center ${active ? VARIANTS.soft : VARIANTS[variant]}`}
      >
        {children}
      </span>
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
/* ================================================================== chips
   One chip system for the whole arena. A chip is a small rounded label that
   can also be a toggle (`onClick` + `selected`) or removable (`onRemove`).
   Colour comes from a named `tone`; the CSS derives fill, edge and ink from
   it, so every chip in the app agrees. Legacy callers that pass colour
   utilities in `className` still work (the tint follows their text colour).
   ========================================================================= */
export type ChipTone = 'neutral' | 'muted' | 'nova' | 'pulse' | 'flare' | 'mint' | 'gold' | 'rose';
export type ChipSize = 'xs' | 'sm' | 'md';
export type ChipVariant = 'soft' | 'solid' | 'outline';

export function Chip({
  children,
  tone,
  size = 'sm',
  variant = 'soft',
  icon,
  dot = false,
  selected,
  onClick,
  onRemove,
  removeLabel = 'Remove',
  disabled,
  title,
  role,
  className = '',
  shimmer = false,
  color,
}: {
  children?: ReactNode;
  /** Data-driven accent (e.g. a course colour). Ink is auto-lightened for contrast. */
  color?: string;
  /** `radio` for single-choice groups (PillSelect); default is a toggle button. */
  role?: 'radio';
  /** Named colour. Omit to let a legacy text-colour class drive the tint. */
  tone?: ChipTone;
  size?: ChipSize;
  variant?: ChipVariant;
  icon?: ReactNode;
  /** A small status dot before the label (live, online, new…). */
  dot?: boolean;
  /** Toggle state when the chip is a button. */
  selected?: boolean;
  onClick?: () => void;
  /** Shows a trailing × button. */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** For limited-time / hot badges only — keep it rare. */
  shimmer?: boolean;
}) {
  const legacy = !tone && /(^|\s)text-(white|black|mist|ink|nova|pulse|flare|mint|gold|rose|red|amber|emerald|sky|cyan|blue|violet|orange|green|yellow|pink)/.test(className);
  const attrs = {
    'data-tone': color ? 'custom' : tone ?? (legacy ? undefined : 'neutral'),
    style: color ? ({'--chip-c': color} as CSSProperties) : undefined,
    'data-size': size,
    'data-variant': variant,
    title,
  };
  const cls = `chip ${shimmer ? 'chip-shimmer ' : ''}${onRemove ? 'chip-removable ' : ''}${className}`;
  const body = (
    <>
      {dot && <i className="chip-dot" aria-hidden="true" />}
      {icon}
      {children !== undefined && children !== null && children !== false && <span className="chip-label">{children}</span>}
    </>
  );
  const remove = onRemove ? (
    <button
      type="button"
      className="chip-x"
      aria-label={removeLabel}
      title={removeLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        uiClick('select');
        onRemove();
      }}
    >
      <X strokeWidth={3} />
    </button>
  ) : null;

  if (onClick) {
    return (
      <span className={`${cls} chip-press`} {...attrs} data-selected={selected ? '' : undefined}>
        <button
          type="button"
          className="chip-hit"
          role={role}
          aria-checked={role === 'radio' ? Boolean(selected) : undefined}
          aria-pressed={role === 'radio' || selected === undefined ? undefined : selected}
          disabled={disabled}
          onClick={() => {
            uiClick('select');
            onClick();
          }}
        >
          {body}
        </button>
        {remove}
      </span>
    );
  }
  return (
    <span className={cls} {...attrs}>
      {body}
      {remove}
    </span>
  );
}

/* ------------------------------------------------------------ smart chips */
const DIFF_TONE: Record<string, {tone: ChipTone; bars: number; label: string}> = {
  easy: {tone: 'mint', bars: 1, label: 'Easy'},
  medium: {tone: 'gold', bars: 2, label: 'Medium'},
  hard: {tone: 'flare', bars: 3, label: 'Hard'},
};

/** Difficulty with a three-bar signal: easy (1, mint), medium (2, gold), hard (3, pink). */
export function DifficultyChip({level, size, className = ''}: {level?: string | null; size?: ChipSize; className?: string}) {
  if (!level) return null;
  const d = DIFF_TONE[level.toLowerCase()] ?? {tone: 'neutral' as ChipTone, bars: 0, label: level};
  return (
    <Chip
      tone={d.tone}
      size={size}
      className={className}
      title={`Difficulty: ${d.label}`}
      icon={
        <span className="chip-bars" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <i key={n} data-on={n <= d.bars ? '' : undefined} />
          ))}
        </span>
      }
    >
      {d.label}
    </Chip>
  );
}

/** A topic / subject tag: `#` badge + truncating label. */
export function TopicChip({topic, tone = 'nova', size, className = ''}: {topic?: string | null; tone?: ChipTone; size?: ChipSize; className?: string}) {
  if (!topic) return null;
  return (
    <Chip
      tone={tone}
      size={size}
      title={topic}
      className={`chip-topic max-w-full min-w-0 ${className}`}
      icon={
        <span className="chip-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
          </svg>
        </span>
      }
    >
      {topic}
    </Chip>
  );
}

/** A live counter — "3 correct": number bold, label quieter. */
export function ScoreChip({value, label, icon, tone = 'neutral', size, className = ''}: {value: ReactNode; label: string; icon?: ReactNode; tone?: ChipTone; size?: ChipSize; className?: string}) {
  return (
    <Chip tone={tone} size={size} icon={icon} className={`chip-score ${className}`}>
      <b>{value}</b> <span>{label}</span>
    </Chip>
  );
}

/* ------------------------------------------------------------ copy code */
/**
 * Write text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a hidden textarea + ``execCommand`` so older mobile browsers
 * and non-secure contexts still work. Returns whether the copy landed.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * A shareable code rendered as one big tappable pill: tap/click anywhere on it
 * (or on the copy icon) and the FULL code is copied, with an inline "Copied"
 * confirmation. Only the code text itself is ever put on the clipboard.
 */
export function CopyCode({
  code,
  className = '',
  pillClassName = '',
  size = 'md',
}: {
  code: string;
  className?: string;
  pillClassName?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    uiClick();
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [code]);

  const sizing =
    size === 'lg'
      ? 'px-5 py-2.5 text-2xl tracking-[0.3em]'
      : size === 'sm'
        ? 'px-2.5 py-1.5 text-[0.8rem] tracking-[0.14em]'
        : 'px-3.5 py-2 text-lg tracking-[0.2em]';

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Code copied' : `Copy code ${code}`}
      title={copied ? 'Copied' : 'Tap to copy'}
      className={`group inline-flex min-w-0 items-center gap-2.5 rounded-2xl border text-left font-black tabular transition-colors touch-manipulation ${
        copied ? 'border-mint-400/50 bg-mint-500/12 text-mint-200' : 'border-white/14 bg-white/6 text-mist-50 hover:border-nova-400/45'
      } ${sizing} ${pillClassName} ${className}`}
    >
      <span className="truncate">{code}</span>
      <span className={`grid shrink-0 place-items-center rounded-lg p-1 ${copied ? 'bg-mint-400/20 text-mint-200' : 'bg-white/8 text-mist-400 group-hover:text-nova-200'}`}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
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
  const tones: Record<string, ChipTone> = {
    easy: 'mint',
    medium: 'gold',
    hard: 'flare',
    boss: 'nova',
    new: 'pulse',
    mastered: 'gold',
    daily: 'pulse',
    hot: 'flare',
  };
  return (
    <Chip tone={tones[tone]} variant="solid" icon={icon} shimmer={tone === 'hot' || tone === 'daily'}>
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
/**
 * A labelled form row. Labels read as sentences (not tiny all-caps), a trailing
 * "(optional)" is quietened automatically, and `aside` puts a counter or a
 * small action on the right of the label.
 */
export function Field({
  label,
  hint,
  error,
  aside,
  children,
  className = '',
}: {
  label?: string;
  hint?: string;
  error?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const optional = label ? /\s*\((optional[^)]*)\)\s*$/i.exec(label) : null;
  const main = optional && label ? label.slice(0, optional.index) : label;
  return (
    <label className={`block ${className}`}>
      {(label || aside) && (
        <span className="mb-1.5 flex min-w-0 items-baseline justify-between gap-2">
          {label && (
            <span className="min-w-0 truncate text-[0.8rem] font-semibold text-mist-200">
              {main}
              {optional && <span className="ml-1 font-medium text-mist-500">({optional[1]})</span>}
            </span>
          )}
          {aside && <span className="shrink-0 text-[0.72rem] font-medium text-mist-500">{aside}</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[0.74rem] font-semibold text-flare-400">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[0.74rem] leading-snug font-medium text-mist-500">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  // NOTE: no responsive horizontal padding here on purpose. Tailwind emits
  // breakpoint variants after base utilities, so a `sm:px-*` would outrank the
  // `pl-*` that icon-prefixed fields rely on and slide text under the icon.
  'w-full rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 text-base font-medium text-mist-50 sm:text-[0.9rem] ' +
  'shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] placeholder:font-normal placeholder:text-mist-500 transition-[border-color,background-color,box-shadow] ' +
  'hover:border-white/20 focus:border-nova-400/70 focus:bg-white/[0.07] focus:ring-4 focus:ring-nova-500/15 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

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
  placeholder,
  invalid = false,
  id,
  country,
  onCountry,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  /** ISO code from PHONE_COUNTRIES. With `onCountry` the prefix becomes a country picker. */
  country?: string;
  onCountry?: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = phoneCountry(country || 'NG');
  const prefix = (
    <>
      {onCountry ? <span aria-hidden className="text-base leading-none">{current.flag}</span> : <Phone className="size-4 shrink-0 text-nova-400" />}
      +{current.dial}
      {onCountry && <ChevronDown aria-hidden className="size-3.5 text-mist-500" />}
    </>
  );
  const prefixClass = 'flex shrink-0 items-center gap-1.5 border-r border-white/10 bg-white/[0.05] px-2.5 text-[0.82rem] font-black text-mist-300 sm:px-3.5 sm:text-[0.88rem]';
  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-2xl border bg-ink-900/70 transition-colors focus-within:border-nova-400/60 focus-within:bg-ink-850 focus-within:ring-2 focus-within:ring-nova-500/25 ${
        invalid ? 'border-flare-500/50' : 'border-white/12'
      }`}
    >
      {onCountry ? (
        <button type="button" className={`${prefixClass} hover:bg-white/[0.09]`} aria-label={`Country code: ${current.name}`} onClick={() => { setQuery(''); setOpen(true); }}>
          {prefix}
        </button>
      ) : (
        <span className={prefixClass}>{prefix}</span>
      )}
      <input
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? current.sample}
        inputMode="tel"
        autoComplete="tel-national"
        aria-label="Phone number"
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base font-semibold tracking-wide text-mist-50 tabular placeholder:font-medium placeholder:text-mist-600 focus:outline-none sm:px-3.5 sm:text-[0.92rem]"
      />
      {onCountry &&
        portal(
          <Modal open={open} onClose={() => setOpen(false)} title="Country code" subtitle="Where is your phone number from?" size="sm">
            <PickSearch value={query} onChange={setQuery} count={PHONE_COUNTRIES.length} />
            <PickList
              options={PHONE_COUNTRIES.map((row) => ({value: row.code, label: `${row.flag}  ${row.name}`, hint: `+${row.dial}`}))}
              isOn={(v) => v === current.code}
              onPick={(o) => { onCountry(o.value); setOpen(false); }}
              query={query}
            />
          </Modal>,
        )}
    </div>
  );
}

export function TextArea({className = '', ...rest}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} resize-y ${className}`} {...rest} />;
}

/* ---------------------------------------------------------------- pickers */
export type PickOption = {value: string; label: string; disabled?: boolean; group?: string; hint?: string};

/** Read <option>/<optgroup> children (also inside fragments, arrays, maps). */
function optionsFrom(children: ReactNode, group?: string, out: PickOption[] = []): PickOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {value?: unknown; children?: ReactNode; disabled?: boolean; label?: string; hidden?: boolean};
    if (child.type === Fragment) optionsFrom(props.children, group, out);
    else if (child.type === 'optgroup') optionsFrom(props.children, props.label, out);
    else if (child.type === 'option') {
      if (props.hidden) return;
      const text = Children.toArray(props.children).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('').trim();
      out.push({value: props.value === undefined ? text : String(props.value), label: text || String(props.value ?? ''), disabled: props.disabled, group});
    }
  });
  return out;
}

/** The designed list shown inside the picker sheet (single or multi). */
function PickList({options, isOn, onPick, multi, query}: {options: PickOption[]; isOn: (v: string) => boolean; onPick: (o: PickOption) => void; multi?: boolean; query: string}) {
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(needle)) : options;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-on="true"]')?.scrollIntoView({block: 'center'});
  }, []);
  if (!shown.length) return <p className="rounded-2xl border border-dashed border-white/12 px-3 py-8 text-center text-[0.84rem] text-mist-400">Nothing matches “{query}”.</p>;
  let lastGroup: string | undefined;
  return (
    <div ref={listRef} className="pick-list space-y-1" role="listbox" aria-multiselectable={multi || undefined}>
      {shown.map((o, i) => {
        const on = isOn(o.value);
        const heading = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        return (
          <Fragment key={`${o.value}-${i}`}>
            {heading && <p className="px-1 pt-2 pb-0.5 text-[0.64rem] font-extrabold tracking-[0.14em] text-mist-500 uppercase">{heading}</p>}
            <button
              type="button"
              role="option"
              aria-selected={on}
              data-on={on}
              disabled={o.disabled}
              onClick={() => onPick(o)}
              className={`pick-row group flex w-full min-w-0 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${
                on ? 'border-nova-400/45 bg-nova-500/[0.13]' : 'border-white/6 bg-white/[0.025] hover:border-white/14 hover:bg-white/[0.05]'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-[0.9rem] leading-snug font-semibold [overflow-wrap:anywhere] ${on ? 'text-mist-50' : 'text-mist-100'}`}>{o.label}</span>
                {o.hint && <span className="mt-0.5 block text-[0.72rem] font-medium text-mist-400">{o.hint}</span>}
              </span>
              <span
                aria-hidden
                className={`grid size-[22px] shrink-0 place-items-center border-2 transition ${multi ? 'rounded-[7px]' : 'rounded-full'} ${
                  on ? 'border-nova-400 bg-nova-500 text-white shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-nova-500)_18%,transparent)]' : 'border-white/22 group-hover:border-white/40'
                }`}
              >
                {on && (multi ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-2 rounded-full bg-white" />)}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function PickSearch({value, onChange, count}: {value: string; onChange: (v: string) => void; count: number}) {
  return (
    <label className="mb-3 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 focus-within:border-nova-400/55">
      <Search className="size-4 shrink-0 text-mist-500" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Search ${count} options`} className="min-w-0 flex-1 bg-transparent text-[0.88rem] text-mist-100 outline-none placeholder:text-mist-500" aria-label="Search options" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="grid size-6 place-items-center rounded-full text-mist-500 hover:bg-white/[0.06] hover:text-mist-200">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}

const portal = (node: ReactNode) => (typeof document === 'undefined' ? node : createPortal(node, document.body));

/**
 * Drop-down replacement: same props as a native <select> (value, onChange,
 * <option>/<optgroup> children), but opens the arena's own picker sheet —
 * a bottom sheet on phones, a dialog on desktop — with wrapping labels,
 * a clear selected state and search for long lists.
 */
export function Select({
  className = '',
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  label,
  title,
  id,
  name,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement> & {label?: string}) {
  const options = useMemo(() => optionsFrom(children), [children]);
  const [inner, setInner] = useState(String(defaultValue ?? options[0]?.value ?? ''));
  const current = value !== undefined ? String(value) : inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = options.find((o) => o.value === current);
  const heading = label || ariaLabel || title || 'Choose an option';
  const pick = (o: PickOption) => {
    if (value === undefined) setInner(o.value);
    onChange?.({target: {value: o.value, name}, currentTarget: {value: o.value, name}} as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setQuery(''); setOpen(true); }}
        className={`${className.includes('pro-input') ? '' : CONTROL} ag-picker relative flex items-center gap-2 !pr-10 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${chosen ? '' : 'text-mist-500'}`}>{chosen?.label ?? 'Choose…'}</span>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mist-400" />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {portal(
        <Modal open={open} onClose={() => setOpen(false)} title={heading} subtitle={options.length > 1 ? `${options.length} options` : undefined} size="sm">
          {options.length > 8 && <PickSearch value={query} onChange={setQuery} count={options.length} />}
          <PickList options={options} isOn={(v) => v === current} onPick={pick} query={query} />
        </Modal>,
      )}
    </>
  );
}

/**
 * Pick several options at once (mix topics, filter by many tags…). An empty
 * selection means "all" and is labelled with `allLabel`.
 */
export function MultiSelect({
  options,
  values,
  onChange,
  label,
  allLabel = 'All',
  className = '',
  disabled,
  max,
}: {
  options: PickOption[];
  values: string[];
  onChange: (values: string[]) => void;
  label: string;
  allLabel?: string;
  className?: string;
  disabled?: boolean;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const set = new Set(values);
  const names = options.filter((o) => set.has(o.value)).map((o) => o.label);
  const summary = names.length === 0 ? allLabel : names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`;
  const toggle = (o: PickOption) => {
    if (set.has(o.value)) onChange(values.filter((v) => v !== o.value));
    else if (!max || values.length < max) onChange([...values, o.value]);
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        onClick={() => { setQuery(''); setOpen(true); }}
        className={`${className.includes('pro-input') ? '' : CONTROL} ag-picker relative flex items-center gap-2 !pr-10 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {names.length > 1 && <span className="shrink-0 rounded-full bg-nova-500/20 px-2 py-0.5 text-[0.68rem] font-extrabold text-nova-200">{names.length}</span>}
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mist-400" />
      </button>
      {portal(
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          subtitle={values.length ? `${values.length} selected${max ? ` · up to ${max}` : ''}` : `None selected = ${allLabel.toLowerCase()}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => onChange([])} disabled={!values.length}>Clear</Button>
              <Button onClick={() => setOpen(false)} icon={<Check className="size-4" />}>Done{values.length ? ` · ${values.length}` : ''}</Button>
            </>
          }
        >
          {options.length > 8 && <PickSearch value={query} onChange={setQuery} count={options.length} />}
          {!max && options.length > 2 && (
            <div className="mb-2 flex items-center gap-1 text-[0.74rem] font-bold text-mist-400">
              <button type="button" className="rounded-full px-2.5 py-1 hover:bg-white/[0.06] hover:text-mist-100" onClick={() => onChange(options.filter((o) => !o.disabled).map((o) => o.value))}>Select all</button>
              <span className="ml-auto">{values.length}/{options.length}</span>
            </div>
          )}
          <PickList options={options} isOn={(v) => set.has(v)} onPick={toggle} multi query={query} />
        </Modal>,
      )}
    </>
  );
}

/* ------------------------------------------------------------- confirm */
export type ConfirmOptions = {title?: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean};
type ConfirmRequest = ConfirmOptions & {resolve: (ok: boolean) => void};
let confirmSink: ((request: ConfirmRequest) => void) | null = null;
const DANGER_WORDS = /^(delete|remove|block|suspend|discard|withdraw|leave|ban|reset|clear|cancel)\b/i;

/**
 * The arena's own yes/no dialog — use instead of window.confirm.
 *   if (!(await askConfirm('Delete this note? You can undo straight after.'))) return;
 * A plain string is split into a title (first sentence) and a body; words like
 * Delete/Remove/Block make it a red, destructive confirmation.
 */
export function askConfirm(input: string | ConfirmOptions): Promise<boolean> {
  let opts: ConfirmOptions = typeof input === 'string' ? {} : input;
  if (typeof input === 'string') {
    const cut = input.search(/[?.!](\s|$)/);
    const title = cut > 0 ? input.slice(0, cut + 1) : input;
    const rest = cut > 0 ? input.slice(cut + 1).trim() : '';
    opts = {title, message: rest || undefined};
  }
  const head = String(opts.title ?? '');
  const danger = opts.danger ?? DANGER_WORDS.test(head);
  const verb = head.match(DANGER_WORDS)?.[1] ?? head.match(/^(\w+)/)?.[1];
  const confirmLabel = opts.confirmLabel ?? (danger && verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : /^(mark|withdraw|leave|restore|send|publish|approve)\b/i.test(head) && verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : 'Confirm');
  return new Promise((resolve) => {
    if (!confirmSink) {
      resolve(typeof window !== 'undefined' ? window.confirm([head, typeof opts.message === 'string' ? opts.message : ''].filter(Boolean).join('\n\n')) : false);
      return;
    }
    confirmSink({...opts, danger, confirmLabel, resolve});
  });
}

/** Mount once near the app root; askConfirm() talks to it. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  useEffect(() => {
    confirmSink = (request) => setQueue((q) => [...q, request]);
    return () => {
      confirmSink = null;
    };
  }, []);
  const current = queue[0];
  const settle = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  return portal(
    <Modal
      open={!!current}
      onClose={() => settle(false)}
      title={current?.title || 'Are you sure?'}
      icon={current?.danger ? AlertTriangle : HelpCircle}
      tone={current?.danger ? 'flare' : 'nova'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => settle(false)}>{current?.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={current?.danger ? 'danger' : 'primary'} onClick={() => settle(true)} autoFocus>
            {current?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-[0.88rem] leading-relaxed text-mist-300">{current?.message || (current?.danger ? "This can't be undone." : 'Do you want to continue?')}</p>
    </Modal>,
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
        <h2 className="flex items-center gap-2 text-[1.02rem] leading-tight sm:text-[1.2rem]">
          {icon && <span className="text-nova-400">{icon}</span>}
          <span className="ag-title min-w-0">{title}</span>
        </h2>
        {subtitle && <p className="mt-1 text-[0.82rem] font-medium text-mist-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------- page banner */
export type BannerTone = 'nova' | 'pulse' | 'flare' | 'mint' | 'gold' | 'cyan';
export type BannerStat = {label: string; value: ReactNode; tone?: BannerTone};

/**
 * PageBanner — the header every console / network page opens with.
 *
 * A tinted, glowing card: icon medallion, eyebrow with a live dot, display
 * title, subtitle, optional quick stats and a footer slot (tabs, filters).
 * API is a superset of `SectionHeading` (title / subtitle / icon / action), so
 * swapping one for the other is a rename. Pro mode re-skins it flat.
 */
export function PageBanner({
  title,
  subtitle,
  icon,
  action,
  eyebrow,
  tone = 'nova',
  stats,
  children,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  tone?: BannerTone;
  stats?: (BannerStat | false | null | undefined)[];
  children?: ReactNode;
  className?: string;
}) {
  const glyph = (cls: string) => (isValidElement<{className?: string}>(icon) ? cloneElement(icon, {className: cls}) : icon);
  const shown = (stats ?? []).filter(Boolean) as BannerStat[];
  return (
    <header className={`pbanner ${icon ? 'pbanner--art' : ''} ${className}`} data-tone={tone}>
      {/* Standard-mode scenery: light, grid, sweep, HUD corners (Pro hides these). */}
      <span className="pbanner-scene" aria-hidden="true">
        <span className="pbanner-grid" />
        <span className="pbanner-sweep" />
        <i className="pbanner-corner" data-c="tl" />
        <i className="pbanner-corner" data-c="br" />
      </span>
      {icon && (
        <span className="pbanner-art" aria-hidden="true">
          <svg className="pbanner-rings" viewBox="0 0 200 200" fill="none">
            <defs>
              <linearGradient id="pbRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <circle className="pbanner-ring-a" cx="100" cy="100" r="92" stroke="currentColor" strokeOpacity="0.22" strokeDasharray="2 7" />
            <g className="pbanner-ring-b">
              <circle cx="100" cy="100" r="74" stroke="url(#pbRing)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="150 315" />
              <circle cx="174" cy="100" r="4" fill="currentColor" />
            </g>
            <g className="pbanner-ring-c">
              <circle cx="100" cy="100" r="58" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="60 22 6 22" />
              <circle cx="100" cy="42" r="2.6" fill="currentColor" fillOpacity="0.85" />
            </g>
          </svg>
          <span className="pbanner-gem">{glyph('pbanner-gem-ico')}</span>
          <i className="pbanner-spark" data-s="1" />
          <i className="pbanner-spark" data-s="2" />
          <i className="pbanner-spark" data-s="3" />
        </span>
      )}
      {icon && (
        <span className="pbanner-watermark" aria-hidden="true">
          {glyph('pbanner-watermark-ico')}
        </span>
      )}
      <div className="pbanner-row">
        {icon && (
          <span className="pbanner-medal" aria-hidden="true">
            {glyph('pbanner-medal-ico')}
          </span>
        )}
        <div className="pbanner-copy">
          {eyebrow && (
            <p className="pbanner-eyebrow">
              <i aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="pbanner-title">{title}</h1>
          {subtitle && <p className="pbanner-sub">{subtitle}</p>}
        </div>
        {action && <div className="pbanner-actions">{action}</div>}
      </div>
      {shown.length > 0 && (
        <div className="pbanner-stats">
          {shown.map((stat) => (
            <span key={stat.label} className="pbanner-stat" data-tone={stat.tone ?? tone}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </span>
          ))}
        </div>
      )}
      {children && <div className="pbanner-foot">{children}</div>}
    </header>
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
export type Tone = 'nova' | 'pulse' | 'flare' | 'gold' | 'mint' | 'cyan' | 'amber';

/* Full class strings so Tailwind keeps them. */
const TONE_CHIP: Record<Tone, string> = {
  nova: 'from-nova-400/30 to-nova-600/10 border-nova-400/30 text-nova-200',
  pulse: 'from-pulse-400/30 to-pulse-600/10 border-pulse-400/30 text-pulse-200',
  flare: 'from-flare-400/30 to-flare-600/10 border-flare-400/30 text-flare-200',
  gold: 'from-gold-400/30 to-gold-600/10 border-gold-400/30 text-gold-200',
  mint: 'from-mint-400/30 to-mint-600/10 border-mint-400/30 text-mint-200',
  cyan: 'from-cyan-400/30 to-cyan-600/10 border-cyan-400/30 text-cyan-200',
  amber: 'from-amber-400/30 to-amber-600/10 border-amber-400/30 text-amber-200',
};
const TONE_GLOW: Record<Tone, string> = {
  nova: 'bg-nova-500/30',
  pulse: 'bg-pulse-500/28',
  flare: 'bg-flare-500/26',
  gold: 'bg-gold-500/22',
  mint: 'bg-mint-500/24',
  cyan: 'bg-cyan-500/24',
  amber: 'bg-amber-500/22',
};

/** A tinted squircle holding an icon — the app-style icon used in headers and menus. */
export function ToneIcon({tone = 'nova', icon, size = 'md', className = ''}: {tone?: Tone; icon: IconProp; size?: 'sm' | 'md' | 'lg'; className?: string}) {
  const box = size === 'sm' ? 'size-8 rounded-[0.7rem]' : size === 'lg' ? 'size-12 rounded-[1rem]' : 'size-10 rounded-[0.85rem]';
  const glyph = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5';
  return (
    <span className={`grid shrink-0 place-items-center border bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${TONE_CHIP[tone]} ${box} ${className}`}>
      {renderIcon(icon, glyph)}
    </span>
  );
}

function useSmallScreen() {
  const query = '(max-width: 639px)';
  const [small, setSmall] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const on = () => setSmall(media.matches);
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, []);
  return small;
}

/**
 * The popup used everywhere. Bottom sheet on phones (drag the header down to
 * close), centred card from `sm` up. `icon` + `tone` give the header an
 * app-style icon and a matching glow; the footer's buttons share the width on
 * phones.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = 'nova',
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: IconProp;
  tone?: Tone;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const small = useSmallScreen();
  const drag = useDragControls();

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

  const widths = {sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl'};
  const startDrag = (event: React.PointerEvent) => {
    if (small) drag.start(event);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-60 flex items-end justify-center scrim backdrop-blur-sm sm:items-center sm:p-4"
          variants={overlayVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className={`panel-hero relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom,0px)] sm:max-h-[88dvh] sm:rounded-[1.6rem] sm:pb-0 ${widths[size]}`}
            {...(small
              ? {
                  initial: {y: '100%'},
                  animate: {y: 0},
                  exit: {y: '100%'},
                  transition: {type: 'spring' as const, stiffness: 420, damping: 40},
                }
              : {variants: sheetVariants})}
            drag={small ? 'y' : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{top: 0, bottom: 0}}
            dragElastic={{top: 0, bottom: 0.6}}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="relative shrink-0 touch-none select-none sm:touch-auto sm:select-auto" onPointerDown={startDrag}>
              {(title || subtitle) && (
                <span aria-hidden className={`pointer-events-none absolute -top-16 -left-10 size-44 rounded-full blur-3xl ${TONE_GLOW[tone]}`} />
              )}
              <div className="relative flex justify-center pt-2.5 sm:hidden">
                <span className="sheet-handle" />
              </div>
              {(title || subtitle) && (
                <header className="relative flex items-center gap-3 px-4 pt-2.5 pb-3.5 sm:px-6 sm:pt-5 sm:pb-4">
                  {icon && <ToneIcon tone={tone} icon={icon} />}
                  <div className="min-w-0 flex-1">
                    {title && (
                      <h3 className="font-display text-[1.02rem] leading-snug font-bold text-mist-50 sm:text-[1.1rem]">{title}</h3>
                    )}
                    {subtitle && <p className="mt-0.5 text-[0.78rem] leading-snug font-medium text-mist-400 sm:text-[0.82rem]">{subtitle}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Close"
                    className="grid size-9 shrink-0 place-items-center self-start rounded-full border border-white/10 bg-white/[0.05] text-mist-300 transition hover:bg-white/[0.09] hover:text-mist-50 active:scale-90"
                  >
                    <X className="size-[18px]" />
                  </button>
                </header>
              )}
              {(title || subtitle) && <div className="h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>
            {footer && (
              <footer className="relative flex flex-wrap items-center justify-end gap-2 border-t border-white/8 bg-black/20 px-4 py-3 max-sm:[&>button]:flex-1 sm:px-6 sm:py-3.5">
                {footer}
              </footer>
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
  // Four or five icon tabs: on phones stack icon over label so none scroll away.
  const stacked = options.length >= 4 && options.length <= 5 && options.some((option) => option.icon);
  return (
    <div className={`flex w-full min-w-0 flex-wrap gap-1 rounded-xl border border-white/8 bg-black/25 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => {
              uiClick('select');
              onChange(option.value);
            }}
            className={`relative isolate flex min-w-0 flex-1 basis-[46%] items-center justify-center rounded-lg px-2 py-2 text-center text-[0.72rem] font-semibold leading-tight break-words whitespace-normal transition-colors sm:basis-0 sm:text-[0.8rem] ${
              stacked ? 'flex-col gap-0.5 sm:flex-row sm:gap-1.5' : 'gap-1.5'
            } ${
              active ? 'text-white' : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-100'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segment-${option.value}-${options.length}`}
                className="brand-gradient absolute inset-0 -z-1 rounded-lg shadow-[0_6px_16px_-6px_rgba(124,58,237,0.7),inset_0_1px_0_rgba(255,255,255,0.25)]"
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

/* --------------------------------------------------------- choice cards */
export type ChoiceOption<T extends string> = {value: T; label: string; description?: string; icon?: IconProp; disabled?: boolean};

/**
 * Single choice shown as tappable cards (icon + label + optional line of
 * description), with a check badge on the picked one. Replaces rows of plain
 * look-alike buttons.
 */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  columns = 2,
  className = '',
}: {
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const grid = columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2';
  return (
    <div role="radiogroup" className={`grid gap-2 ${grid} ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => {
              uiClick('select');
              onChange(option.value);
            }}
            className={`relative flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition touch-manipulation active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? 'border-nova-400/60 bg-nova-500/14 shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_8px_20px_-12px_rgba(124,58,237,0.8)]'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
            }`}
          >
            {option.icon && (
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-nova-400/25 text-nova-100' : 'bg-white/[0.06] text-mist-300'}`}>
                {renderIcon(option.icon, 'size-4')}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[0.82rem] font-semibold ${active ? 'text-white' : 'text-mist-100'}`}>{option.label}</span>
              {option.description && (
                <span className="line-clamp-2 block text-[0.68rem] leading-tight font-medium text-mist-500">{option.description}</span>
              )}
            </span>
            {active && (
              <span className="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full bg-nova-400 text-ink-950 shadow">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select pills with a check on the picked ones. `min` keeps at least that many on. */
export function ToggleChips<T extends string>({
  values,
  options,
  onChange,
  min = 0,
  className = '',
}: {
  values: T[];
  options: {value: T; label: string; icon?: IconProp}[];
  onChange: (values: T[]) => void;
  min?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((option) => {
        const on = values.includes(option.value);
        return (
          <Chip
            key={option.value}
            tone="nova"
            size="md"
            selected={on}
            onClick={() => {
              if (on) {
                if (values.length > min) onChange(values.filter((v) => v !== option.value));
              } else onChange([...values, option.value]);
            }}
            icon={
              <>
                <span className="chip-mark" aria-hidden="true">{on && <Check strokeWidth={3.5} />}</span>
                {option.icon && renderIcon(option.icon, 'size-3.5')}
              </>
            }
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
  );
}

/** Single-choice pills — for short option lists that used to be a plain dropdown. */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: {
  value: T;
  options: {value: T; label: string; icon?: IconProp}[];
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Chip
            key={option.value}
            tone="nova"
            size="md"
            role="radio"
            selected={on}
            onClick={() => onChange(option.value)}
            icon={option.icon ? renderIcon(option.icon, 'size-3.5') : undefined}
          >
            {option.label}
          </Chip>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- switch */
/** An on/off switch. Use `SwitchRow` when it needs a label and description. */
export function Switch({checked, onChange, disabled, 'aria-label': ariaLabel}: {checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; 'aria-label'?: string}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        uiClick('toggle');
        onChange(!checked);
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${checked ? 'bg-gradient-to-r from-pulse-500 to-nova-500 shadow-[0_0_14px_-4px_rgba(139,92,246,0.9)]' : 'bg-white/15'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.375rem]' : 'left-0.5'}`} />
    </button>
  );
}

/** A full-width tappable row: title, optional description and a switch on the right. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  icon,
  disabled,
  className = '',
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: IconProp;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (disabled) return;
        uiClick('toggle');
        onChange(!checked);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          uiClick('toggle');
          onChange(!checked);
        }
      }}
      className={`flex cursor-pointer select-none items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-nova-400 ${
        checked ? 'border-nova-400/30 bg-nova-500/[0.07]' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
      } ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`}
    >
      {icon && (
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${checked ? 'bg-nova-500/20 text-nova-200' : 'bg-white/[0.05] text-mist-400'}`}>{renderIcon(icon, 'size-4.5')}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.86rem] font-bold text-white">{label}</span>
        {description && <span className="mt-0.5 block text-[0.74rem] leading-snug text-mist-500">{description}</span>}
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-gradient-to-r from-pulse-500 to-nova-500 shadow-[0_0_14px_-4px_rgba(139,92,246,0.9)]' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- stepper */
/** A number field with − / + buttons. Typing still works; the value is clamped on blur. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  className = '',
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const set = (next: number) => onChange(clamp(Math.round(next), min, max));
  const btn =
    'grid w-11 shrink-0 place-items-center text-mist-300 transition hover:bg-white/[0.06] hover:text-white active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div
      className={`flex h-[2.8rem] items-stretch overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] transition focus-within:border-nova-400/70 focus-within:ring-4 focus-within:ring-nova-500/15 ${className}`}
    >
      <button type="button" className={btn} onClick={() => set(value - step)} disabled={value <= min} aria-label="Decrease">
        <Minus className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 border-x border-white/8">
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          aria-label={ariaLabel}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          onBlur={() => set(value)}
          className="w-12 min-w-0 bg-transparent text-center text-base font-bold text-mist-50 tabular focus:outline-none sm:text-[0.95rem] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix && <span className="text-[0.74rem] font-medium text-mist-500">{suffix}</span>}
      </div>
      <button type="button" className={btn} onClick={() => set(value + step)} disabled={value >= max} aria-label="Increase">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- pager */
/**
 * Shared pagination control — "Previous | 1–20 of 137 | Next" plus numbered
 * pages on wide screens. Every long list in the arena (group members,
 * questions, activity, admin tables) pages through this instead of forcing
 * the player to scroll one endless document.
 */
export function Pager({
  page,
  pages,
  total,
  size,
  onPage,
  className = '',
  label,
}: {
  page: number;
  pages: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  className?: string;
  label?: string;
}) {
  if (total <= 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  /* Compact window of page buttons: 1 … 4 5 [6] 7 8 … 20 */
  const window: (number | 'gap')[] = [];
  if (pages <= 7) {
    for (let index = 1; index <= pages; index += 1) window.push(index);
  } else {
    window.push(1);
    const start = Math.max(2, page - 1);
    const end = Math.min(pages - 1, page + 1);
    if (start > 2) window.push('gap');
    for (let index = start; index <= end; index += 1) window.push(index);
    if (end < pages - 1) window.push('gap');
    window.push(pages);
  }

  const buttonBase =
    'grid min-w-8 place-items-center rounded-lg border px-2 py-1.5 text-[0.74rem] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav className={`flex flex-wrap items-center justify-between gap-2 ${className}`} aria-label={label ?? 'Pagination'}>
      <span className="text-[0.72rem] font-semibold text-mist-500 tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${buttonBase} border-white/12 bg-white/5 text-mist-300 hover:border-nova-400/40 hover:text-mist-50`}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {window.map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${index}`} className="px-1 text-[0.72rem] text-mist-600">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPage(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={`${buttonBase} tabular ${
                  entry === page
                    ? 'border-nova-400/50 bg-nova-500/20 text-nova-200'
                    : 'border-white/10 bg-white/4 text-mist-400 hover:border-nova-400/30 hover:text-mist-100'
                }`}
              >
                {entry}
              </button>
            ),
          )}
        </div>
        <span className="text-[0.72rem] font-bold text-mist-400 tabular sm:hidden">
          {page}/{pages}
        </span>
        <button
          type="button"
          className={`${buttonBase} border-white/12 bg-white/5 text-mist-300 hover:border-nova-400/40 hover:text-mist-50`}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export {popIn};
