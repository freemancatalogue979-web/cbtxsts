/**
 * Hold-to-act maths: how long a press becomes a "hold", when a hold should be
 * abandoned (the finger was scrolling), and where the little action menu lands
 * so it never runs off the screen.
 *
 * Kept pure so the behaviour can be reasoned about — and tested — without a
 * browser in the loop.
 */

/** Press duration before the action menu opens (ms). */
export const HOLD_MS = 460;
/** Movement that means "they were scrolling, not holding" (px). */
export const HOLD_TOLERANCE = 12;
/** Menu size used for placement (px). */
export const MENU_WIDTH = 184;
export const MENU_ITEM_HEIGHT = 44;
export const MENU_MARGIN = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** True when the pointer travelled far enough that this is a scroll, not a hold. */
export function holdAbandoned(dx: number, dy: number, tolerance: number = HOLD_TOLERANCE): boolean {
  return Math.abs(dx) > tolerance || Math.abs(dy) > tolerance;
}

/** Menu height for a given number of actions (padding + rows). */
export function menuSize(count: number, width: number = MENU_WIDTH): Size {
  return {width, height: Math.max(MENU_ITEM_HEIGHT, count * MENU_ITEM_HEIGHT) + 10};
}

/**
 * Place the menu near the press point, Preferring to open upward on phones
 * (the keyboard/thumb zone) and downward when there is more room below.
 * Always clamps inside the viewport.
 */
export function menuPosition(point: Point, size: Size, viewport: Size, margin: number = MENU_MARGIN): Point {
  const below = viewport.height - point.y;
  const openUp = below < size.height + margin && point.y > size.height + margin;

  let y = openUp ? point.y - size.height - margin : point.y + margin;
  y = Math.max(margin, Math.min(viewport.height - size.height - margin, y));

  let x = point.x - size.width / 2;
  x = Math.max(margin, Math.min(viewport.width - size.width - margin, x));

  return {x, y};
}
