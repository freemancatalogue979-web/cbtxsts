/**
 * Haptics. Mobile players feel a buzz long before they read a score change, so
 * the duel and the celebration overlay fire short vibration patterns.
 *
 * `navigator.vibrate` exists on Android Chrome/Firefox and is simply absent on
 * iOS Safari and desktop, so every call degrades to a no-op. Players who ask the
 * OS to reduce motion get nothing either.
 */

type Pattern = number | number[];

function supported(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch {
      /* matchMedia unavailable — fall through and vibrate */
    }
  }
  return true;
}

export function haptic(pattern: Pattern = 12): void {
  if (!supported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when called without a user gesture — ignore */
  }
}

/** Named rhythms so the game feels consistent. */
export const HAPTICS = {
  tap: () => haptic(8),
  correct: () => haptic(18),
  wrong: () => haptic([45, 35, 45]),
  win: () => haptic([28, 40, 28, 40, 70]),
  lose: () => haptic([60, 40, 60]),
  reward: () => haptic([15, 25, 15]),
} as const;
