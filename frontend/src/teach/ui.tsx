/** Shared building blocks for the Teacher Network screens (Pro design language). */
import {AnimatePresence, motion} from 'framer-motion';
import {Atom, BadgeCheck, BookOpen, Calculator, Check, Code2, Dna, FlaskConical, Globe2, GraduationCap, Landmark, Languages, LineChart, Music2, Palette, Scale, Sigma, Star, X, type LucideIcon} from 'lucide-react';
import {useEffect, useRef, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Tab} from '../lib/nav';
import {usePlayerPhoto} from '../lib/photos';
import {useExperience} from '../lib/mode';
import type {RequestStatus, TeacherBadge} from '../lib/teachers';
import {useSession} from '../store/session';
import './teach.css';

/* ------------------------------------------------------------- navigation */
/** `groupId` opens the group screen (tab is ignored). */
export type NavDetail = {tab?: Tab | 'groups'; groupId?: number; withId?: number; teacherId?: number; view?: string};

/** Cross-screen navigation without prop drilling; App listens for it. */
export function goTo(detail: NavDetail): void {
  if (detail.withId) sessionStorage.setItem('ag.msg.with', String(detail.withId));
  if (detail.teacherId) sessionStorage.setItem('ag.teacher.open', String(detail.teacherId));
  if (detail.view) sessionStorage.setItem(`ag.${detail.tab}.view`, detail.view);
  window.dispatchEvent(new CustomEvent<NavDetail>('ag:navigate', {detail}));
}

/** Read-and-clear a one-shot deep-link value left by goTo(). */
export function takeIntent(key: string): string | null {
  const value = sessionStorage.getItem(key);
  if (value !== null) sessionStorage.removeItem(key);
  return value;
}

/* ------------------------------------------------------------------ scope */
/** Standard mode borrows the Pro tokens for these workspaces; Pro uses its own theme. */
export function ProScope({children}: {children: ReactNode}) {
  const {pro} = useExperience();
  if (pro) return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</div>;
  return <div className="pro-scope grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</div>;
}

/* ---------------------------------------------------------------- avatar */
/**
 * Profile picture with personality: photo or a rich two-tone monogram, an
 * optional conic ring (verified teachers get the brand ring), a verified seal
 * and an online dot. Works on any surface — the gap ring uses the surface colour.
 */
export function PersonAvatar({
  id,
  name,
  hue = 260,
  hasPhoto,
  size = 40,
  online,
  ring,
  verified,
}: {
  id?: number | null;
  name: string;
  hue?: number;
  hasPhoto?: boolean;
  size?: number;
  online?: boolean;
  /** 'brand' = verified/teacher ring, 'hue' = ring in the person's colour. */
  ring?: 'brand' | 'hue';
  /** Small verified seal on the avatar. */
  verified?: boolean;
}) {
  const photo = usePlayerPhoto(id ?? null, hasPhoto ?? false);
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const seal = Math.max(14, Math.round(size * 0.3));
  return (
    <span className="t-avatar" data-ring={ring} style={{width: size, height: size, ['--hue' as string]: String(hue), ['--ring-w' as string]: `${size >= 72 ? 3 : 2}px`}} aria-hidden>
      <span className="t-avatar-core">{photo ? <img src={photo} alt="" /> : <span style={{fontSize: Math.max(11, size * 0.36)}}>{initials || '·'}</span>}</span>
      {verified && (
        <b className="t-avatar-seal" style={{width: seal, height: seal}}>
          <Check strokeWidth={3.5} style={{width: seal * 0.6, height: seal * 0.6}} />
        </b>
      )}
      {online && !verified && <i data-on="" aria-label="Online" />}
    </span>
  );
}

/* --------------------------------------------------------------- subjects */
export type HueName = 'blue' | 'green' | 'amber' | 'violet' | 'rose' | 'teal';
export const HUE_DEG: Record<HueName, number> = {blue: 218, green: 152, amber: 36, violet: 262, rose: 340, teal: 178};
const SUBJECT_LOOK: [RegExp, LucideIcon, HueName][] = [
  [/math|calculus|algebra|geometry|statistic|trigon/i, Sigma, 'violet'],
  [/physic|mechanic|vector|electric/i, Atom, 'blue'],
  [/chem|organic|stoichi/i, FlaskConical, 'green'],
  [/bio|anatomy|physiolog|genetic/i, Dna, 'rose'],
  [/english|literature|essay|comprehension|grammar/i, BookOpen, 'amber'],
  [/french|yoruba|igbo|hausa|language|spanish/i, Languages, 'teal'],
  [/computer|program|coding|software|data/i, Code2, 'blue'],
  [/econom|finance|account|business/i, LineChart, 'teal'],
  [/law|government|civic|politic/i, Scale, 'amber'],
  [/history|geograph|social/i, Globe2, 'teal'],
  [/account|tax/i, Calculator, 'green'],
  [/art|design|draw/i, Palette, 'rose'],
  [/music/i, Music2, 'violet'],
  [/relig|crk|irk/i, Landmark, 'amber'],
];
/** Icon + colour for a subject or topic, so cards read at a glance. */
export function subjectLook(subject?: string | null): {Icon: LucideIcon; hue: HueName; deg: number} {
  const hit = SUBJECT_LOOK.find(([re]) => re.test(subject ?? ''));
  const hue = hit?.[2] ?? 'violet';
  return {Icon: hit?.[1] ?? GraduationCap, hue, deg: HUE_DEG[hue]};
}

/** Stable hue (0-359) from any string — used for people without a stored avatar hue. */
export function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function SubjectChip({subject, label, size = 'md'}: {subject: string; label?: string; size?: 'sm' | 'md'}) {
  const {Icon, hue} = subjectLook(subject);
  return (
    <span className="t-subject" data-hue={hue} data-size={size}>
      <Icon />
      <span className="truncate">{label ?? subject}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ cover */
/** Gradient-mesh banner with a faint dotted grid and a watermark icon. */
export function Cover({deg = 262, deg2, icon: Icon, height = 88, className = '', children}: {deg?: number; deg2?: number; icon?: LucideIcon; height?: number; className?: string; children?: ReactNode}) {
  return (
    <div className={`t-cover ${className}`} style={{height, ['--c1' as string]: String(deg), ['--c2' as string]: String(deg2 ?? deg + 48)}}>
      {Icon && <Icon className="t-cover-mark" aria-hidden />}
      {children}
    </div>
  );
}

/** Compact stat with a coloured icon tile — replaces bare "label: value" text. */
export function StatTile({icon, label, value, sub, hue = 'violet'}: {icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; hue?: HueName}) {
  return (
    <div className="t-stat-tile" data-hue={hue}>
      <span className="t-stat-icon">{icon}</span>
      <span className="min-w-0">
        <b>{value}</b>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

export function VerifiedMark({size = 16, label = 'Verified teacher'}: {size?: number; label?: string}) {
  return (
    <span className="t-verified" title={label} aria-label={label} role="img">
      <BadgeCheck style={{width: size, height: size}} />
    </span>
  );
}

/* ----------------------------------------------------------------- rating */
export function Stars({value, size = 14}: {value: number; size?: number}) {
  return (
    <span className="t-stars" aria-label={`${value.toFixed(1)} out of 5`} role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} style={{width: size, height: size}} data-on={value >= n - 0.25 ? '' : undefined} />
      ))}
    </span>
  );
}

export function StarInput({value, onChange}: {value: number; onChange: (value: number) => void}) {
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <div className="flex items-center gap-3">
      <div className="t-star-input" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)} data-on={value >= n ? '' : undefined}>
            <Star />
          </button>
        ))}
      </div>
      <span className="pro-secondary">{labels[value] ?? ''}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- badges */
const BADGE_HUE: Record<string, string> = {verified: 'blue', top_rated: 'amber', fast: 'green', experienced: 'violet', community: 'teal', retention: 'rose', new: 'teal'};

export function BadgeRow({badges, max, compact}: {badges: TeacherBadge[]; max?: number; compact?: boolean}) {
  const shown = max ? badges.slice(0, max) : badges;
  if (!shown.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {shown.map((badge) => (
        <span key={badge.key} className="t-badge" data-hue={BADGE_HUE[badge.key] ?? 'violet'} title={badge.reason} data-compact={compact ? '' : undefined}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'warning',
  accepted: 'success',
  active: 'success',
  approved: 'success',
  completed: 'accent',
  declined: 'danger',
  rejected: 'danger',
  suspended: 'danger',
  cancelled: undefined,
  expired: undefined,
  ended: undefined,
  needs_info: 'warning',
  draft: undefined,
  published: 'success',
  archived: undefined,
};
const STATUS_LABEL: Record<string, string> = {needs_info: 'Needs info', pending: 'Pending'};

export function StatusPill({status}: {status: RequestStatus | string}) {
  return (
    <span className="pro-badge" data-tone={STATUS_TONE[status]}>
      {STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function AvailabilityDot({state}: {state: 'available' | 'busy' | 'unavailable'}) {
  const label = state === 'available' ? 'Available now' : state === 'busy' ? 'Accepting students' : 'Not taking students';
  return (
    <span className="t-avail" data-state={state}>
      <i />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ sheet */
/** Bottom sheet on phones, centred dialog on larger screens. Portalled, keeps Pro tokens. */
export function Sheet({open, onClose, title, subtitle, children, footer, size = 'md', icon}: {open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; icon?: ReactNode}) {
  const {pro} = useExperience();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);
  const widths = {sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl'};
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className={`t-scrim ${pro ? '' : 'pro-scope'}`} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.16}} onClick={onClose} role="presentation">
          <motion.div
            className={`t-sheet ${widths[size]}`}
            initial={{opacity: 0, y: 24}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: 24}}
            transition={{duration: 0.2, ease: [0.2, 0.8, 0.2, 1]}}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <header className="t-sheet-head">
              {icon && <span className="t-sheet-icon">{icon}</span>}
              <div className="min-w-0 flex-1">
                <h2 className="pro-h3 [overflow-wrap:anywhere]">{title}</h2>
                {subtitle && <p className="pro-meta mt-0.5 [overflow-wrap:anywhere]">{subtitle}</p>}
              </div>
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm shrink-0" onClick={onClose} aria-label="Close" title="Close">
                <X className="size-4" />
              </button>
            </header>
            <div className="t-sheet-body">{children}</div>
            {footer && <footer className="t-sheet-foot">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ forms */
/** Labelled form row. Use `group` when the children are several buttons (chips, segments) —
 *  a <label> would forward clicks on its text to the first button. */
export function Field({label, hint, children, error, group}: {label: string; hint?: ReactNode; children: ReactNode; error?: string | null; group?: boolean}) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className="grid min-w-0 content-start gap-1.5" role={group ? 'group' : undefined} aria-label={group ? label : undefined}>
      <span className="t-label">{label}</span>
      {children}
      {error ? <span className="pro-meta" style={{color: 'var(--pro-danger)'}}>{error}</span> : hint ? <span className="pro-meta">{hint}</span> : null}
    </Tag>
  );
}

export function Toggle({checked, onChange, label}: {checked: boolean; onChange: (value: boolean) => void; label: string}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="t-toggle" onClick={() => onChange(!checked)}>
      <i />
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- time */
export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const stamp = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const seconds = Math.max(0, (Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(stamp).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

export function clockTime(iso: string): string {
  const stamp = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return stamp.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
}

export function dayLabel(iso: string): string {
  const stamp = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (stamp.toDateString() === today.toDateString()) return 'Today';
  if (stamp.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return stamp.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
}

/* ------------------------------------------------------------------- live */
/** Subscribe to a live socket event for the life of the component. */
export function useLive(event: string, handler: (data: unknown) => void): void {
  const {on} = useSession();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => on(event, (data) => ref.current(data)), [on, event]);
}

/** `last_active` is a calendar day (streak tracking), so speak in days, not hours. */
export function activeLabel(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const then = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  if (days < 30) return `Active ${days} days ago`;
  return 'Active over a month ago';
}

/** Plain-language reputation numbers for profiles and cards. */
export function responseLabel(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return 'Under an hour';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
