/**
 * Lock the page behind an overlay. `overflow: hidden` alone is ignored by iOS
 * Safari, so the page would keep scrolling under a drawer or sheet. Pinning the
 * body in place and restoring the saved scroll position works everywhere.
 * Calls nest: the page unlocks only when the last overlay closes.
 */
let depth = 0;
let savedY = 0;
let savedStyle: Partial<CSSStyleDeclaration> | null = null;

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (depth === 0) {
    const body = document.body;
    savedY = window.scrollY;
    savedStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    Object.assign(body.style, {position: 'fixed', top: `-${savedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden'});
  }
  depth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && savedStyle) {
      Object.assign(document.body.style, savedStyle);
      window.scrollTo(0, savedY);
      savedStyle = null;
    }
  };
}
