/**
 * Viewport helpers.
 *
 * `useIsDesktop` tracks the 1024px breakpoint the arena uses for its desktop
 * navigation. The staff console is fully responsive — it folds its rail into
 * a drawer and stacks its tables on phones — so this hook only drives layout
 * choices (wordmarks, rails), never access.
 */
import {useEffect, useState} from 'react';

export const DESKTOP_QUERY = '(min-width: 1024px)';

function read(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(query).matches;
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True on laptop/desktop widths (≥1024px) — where the staff console is available. */
export function useIsDesktop(): boolean {
  return useMedia(DESKTOP_QUERY);
}
