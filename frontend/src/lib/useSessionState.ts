import {useEffect, useState} from 'react';

/**
 * useState that survives a reload in this tab (sessionStorage), so a page the
 * phone discarded — or an app update — comes back on the same tab/section.
 * `valid` guards against stale values from an older build.
 */
export function useSessionState<T extends string>(key: string, initial: T, valid?: (value: string) => boolean): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null && (!valid || valid(saved))) return saved as T;
    } catch {
      /* storage blocked */
    }
    return initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue];
}
