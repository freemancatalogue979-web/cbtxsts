/**
 * Device effects profile.
 *
 * The game layer (bevels, drifting clouds, glow pulses, shimmer sweeps) is cheap
 * on a flagship but not on a 4-year-old budget Android. Rather than guessing per
 * component, we measure once at boot and stamp `data-fx="low"` on <html>; the CSS
 * in index.css then drops the expensive parts (blur, big shadows, scenery,
 * infinite animations) while keeping the art direction.
 *
 * Deliberately conservative: only slow devices get downgraded, and
 * prefers-reduced-motion always wins regardless of hardware.
 */
export type FxProfile = 'full' | 'low';

function detect(): FxProfile {
  if (typeof window === 'undefined') return 'full';
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'low';
  } catch {
    /* matchMedia can throw in exotic webviews — fall through to hardware checks */
  }
  const nav = navigator as Navigator & {deviceMemory?: number; hardwareConcurrency?: number};
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  const saveData = (nav as Navigator & {connection?: {saveData?: boolean}}).connection?.saveData === true;
  if (cores <= 4 || memory <= 2 || saveData) return 'low';
  return 'full';
}

let applied: FxProfile | null = null;

/** Stamp the profile on <html> (idempotent — safe to call from several mounts). */
export function applyFxProfile(profile: FxProfile = detect()): FxProfile {
  if (typeof document === 'undefined') return profile;
  if (applied === profile && document.documentElement.dataset.fx) return applied;
  document.documentElement.dataset.fx = profile;
  applied = profile;
  return profile;
}

export function fxProfile(): FxProfile {
  return applied ?? 'full';
}
