/**
 * Viewport lock — one fixed scale, on phones and on desktops.
 *
 * The arena is laid out for exactly the viewport it lands on: pinch zoom,
 * double-tap zoom and Safari's rubber-band page zoom all break that promise
 * (a 320px phone zoomed to 200% shows a different app than the one we tested).
 *
 * What each layer does:
 *   - `index.html` sets `maximum-scale=1, user-scalable=no` (Android, and any
 *     browser that still honours it).
 *   - `index.css` sets `touch-action: pan-x pan-y` on <body>, which removes
 *     pinch-zoom and double-tap-zoom on iOS 13+ and Chrome, without touching
 *     taps or normal panning/scrolling.
 *   - this module covers the stragglers: iOS Safari's `gesture*` events (it
 *     ignores `user-scalable=no` since iOS 10) and desktop ctrl/cmd + wheel or
 *     +/- keyboard zoom.
 *
 * It never swallows ordinary input: taps, drags, scrolls and pinch-free
 * gestures all pass through untouched.
 */
export function lockViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const stop = (event: Event) => event.preventDefault();

  /* iOS Safari: the only reliable way to stop two-finger page scaling. */
  for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(gesture, stop, {passive: false});
  }

  /* Desktops: ctrl/cmd + wheel is browser zoom, not a scroll. */
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    {passive: false},
  );

  /* Desktops: the keyboard shortcuts for zoom. Everything else on the keyboard
     is left alone — the arena's own shortcuts (⌘K, "/", digits) still work. */
  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (['+', '=', '-', '_', '0'].includes(event.key)) event.preventDefault();
  });
}
