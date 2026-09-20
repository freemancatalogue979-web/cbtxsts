/** Formatting helpers shared across the arena UI. */

export function formatPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone || '';
}

export function normalizePhoneInput(value: string): string {
  return value.replace(/[^\d+]/g, '').slice(0, 16);
}

export function isValidPhone(value: string): boolean {
  let digits = (value || '').replace(/\D/g, '');
  if (digits.startsWith('234')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  // Nigerian mobile numbers are 10 digits after the trunk zero: 7xx/8xx/9xx.
  return digits.length === 10 && /^[789]/.test(digits);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-NG').format(Math.round(value || 0));
}

export function formatCompact(value: number): string {
  const n = value || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
  ];
  if (abs < 45_000) return diff >= 0 ? 'just now' : 'in a moment';
  if (abs < 3600_000) {
    const mins = Math.round(abs / 60_000);
    return diff >= 0 ? `${mins} min ago` : `in ${mins} min`;
  }
  if (abs < 86_400_000) {
    const hours = Math.round(abs / 3_600_000);
    return diff >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  if (abs < 604_800_000) {
    const days = Math.round(abs / 86_400_000);
    return diff >= 0 ? `${days}d ago` : `in ${days}d`;
  }
  void units;
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
  if (!withTime) return day;
  return `${day}, ${date.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, true);
}

export function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic, on-brand avatar colouring from the stored hue. */
export function avatarStyle(hue: number): React.CSSProperties {
  const h = ((hue || 0) % 360 + 360) % 360;
  return {
    background: `linear-gradient(140deg, hsl(${h} 88% 62%), hsl(${(h + 52) % 360} 84% 54%))`,
    boxShadow: `0 10px 26px -14px hsl(${h} 90% 60% / 0.9)`,
  };
}

export const TIER_STYLES: Record<string, {label: string; className: string; ring: string}> = {
  bronze: {label: 'Bronze', className: 'text-gold-400 bg-gold-500/12 border-gold-500/30', ring: '#f59e0b'},
  silver: {label: 'Silver', className: 'text-mist-200 bg-white/8 border-white/18', ring: '#cbd5e1'},
  gold: {label: 'Gold', className: 'text-gold-300 bg-gold-400/14 border-gold-400/34', ring: '#fbbf24'},
  platinum: {label: 'Platinum', className: 'text-pulse-300 bg-pulse-500/14 border-pulse-400/34', ring: '#93c5fd'},
};

export const GRADE_STYLES: Record<string, string> = {
  A1: 'text-mint-400 bg-mint-500/14 border-mint-500/30',
  B2: 'text-mint-300 bg-mint-500/12 border-mint-500/25',
  B3: 'text-pulse-300 bg-pulse-500/12 border-pulse-500/25',
  C4: 'text-pulse-400 bg-pulse-500/10 border-pulse-500/22',
  C5: 'text-nova-300 bg-nova-500/12 border-nova-500/25',
  C6: 'text-nova-400 bg-nova-500/12 border-nova-500/25',
  D7: 'text-gold-400 bg-gold-500/12 border-gold-500/25',
  E8: 'text-flare-400 bg-flare-500/12 border-flare-500/25',
  F: 'text-flare-500 bg-flare-600/14 border-flare-600/30',
};

export const DIFFICULTY_STYLES: Record<string, string> = {
  easy: 'text-mint-400 bg-mint-500/12 border-mint-500/25',
  medium: 'text-gold-400 bg-gold-500/12 border-gold-500/25',
  hard: 'text-flare-400 bg-flare-500/12 border-flare-500/25',
};

export const KIND_META: Record<string, {label: string; className: string}> = {
  exam: {label: 'Exam', className: 'text-pulse-300 bg-pulse-500/14 border-pulse-500/28'},
  duel: {label: 'Duel', className: 'text-flare-300 bg-flare-500/14 border-flare-500/28'},
  xp: {label: 'XP', className: 'text-nova-300 bg-nova-500/14 border-nova-500/28'},
  reward: {label: 'Reward', className: 'text-gold-300 bg-gold-500/14 border-gold-500/28'},
  streak: {label: 'Streak', className: 'text-flare-300 bg-flare-500/12 border-flare-500/24'},
  friend: {label: 'Social', className: 'text-mint-300 bg-mint-500/14 border-mint-500/28'},
  badge: {label: 'Badge', className: 'text-gold-300 bg-gold-400/14 border-gold-400/28'},
  prize: {label: 'Prize', className: 'text-gold-300 bg-gold-500/14 border-gold-500/28'},
  announcement: {label: 'News', className: 'text-mist-200 bg-white/8 border-white/16'},
  admin: {label: 'Admin', className: 'text-flare-300 bg-flare-500/12 border-flare-500/24'},
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
