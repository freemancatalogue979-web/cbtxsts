/**
 * Resolves once the app's bundled type is ready and the first frames have
 * painted, so the interface is revealed in its final layout instead of
 * reflowing as fonts swap in. Capped so a slow or blocked font request can
 * never hold the splash open.
 */
const FACES = [
  "400 16px 'Courier Std'",
  "900 16px 'Courier Std'",
  "400 16px 'Space Grotesk Variable'",
  "400 16px 'AG Caps'",
];
const MAX_WAIT_MS = 2500;

export function fontsSettled(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  const loads = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => [])))
    .then(() => document.fonts.ready)
    .then(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  const cap = new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS));
  return Promise.race([loads, cap]);
}
