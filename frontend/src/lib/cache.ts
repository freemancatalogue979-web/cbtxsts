/**
 * Device cache — the chatty parts of the arena (friends list, chat threads,
 * notification inbox, the music session) are mirrored into localStorage so a
 * reload paints instantly and the network never blocks the screen.
 *
 * Rules that keep this honest:
 *  • Everything stored here is a **mirror** of server state, never a second
 *    source of truth. A stale entry can only cause one extra fetch.
 *  • Reads and writes never throw: private mode, a full quota or a corrupt
 *    value all fall back to "no cache" and the app behaves like it always did.
 *  • Every entry is timestamped, scoped per player (`user:<id>`) and swept when
 *    it ages out, so switching accounts never shows someone else's messages.
 */

export interface CacheEntry<T> {
  at: number;
  v: T;
}

const PREFIX = 'arena.cache.v1.';
const MAX_ENTRY_CHARS = 260_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const APP_SCOPE = 'app';
export const userScope = (id: number | string | null | undefined) => `user:${id ?? 'anon'}`;

/* ------------------------------------------------------------------ storage */

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // Safari private mode throws on access
  }
}

function fullKey(scope: string, key: string): string {
  return `${PREFIX}${scope}.${key}`;
}

/** Trim oversized values instead of dropping them: keep the newest slice. */
function shrink(value: unknown): unknown {
  let current = value;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (JSON.stringify(current).length <= MAX_ENTRY_CHARS) return current;
    if (Array.isArray(current)) current = current.slice(Math.ceil(current.length / 2));
    else if (current && typeof current === 'object') {
      const entries = Object.entries(current as Record<string, unknown>);
      current = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
    } else break;
  }
  return current;
}

/** Remove the oldest entries for a scope until a write fits. */
function makeRoom(scope: string): void {
  const store = storage();
  if (!store) return;
  const prefix = `${PREFIX}${scope}.`;
  const rows: {key: string; at: number}[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      let at = 0;
      try {
        at = Number((JSON.parse(store.getItem(key) || '{}') as CacheEntry<unknown>).at) || 0;
      } catch {
        at = 0;
      }
      rows.push({key, at});
    }
  } catch {
    return;
  }
  rows.sort((a, b) => a.at - b.at);
  for (const row of rows.slice(0, Math.max(1, Math.ceil(rows.length / 3)))) {
    try {
      store.removeItem(row.key);
    } catch {
      return;
    }
  }
}

/* -------------------------------------------------------------------- api */

/**
 * Read a cached value, or null when missing/expired/unreadable.
 * `maxAgeMs` of 0 (or less) means "never expires".
 */
export function cacheRead<T>(scope: string, key: string, maxAgeMs: number = MAX_AGE_MS): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(fullKey(scope, key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.at !== 'number') return null;
    if (maxAgeMs > 0 && Date.now() - entry.at > maxAgeMs) {
      store.removeItem(fullKey(scope, key));
      return null;
    }
    return entry.v as T;
  } catch {
    return null;
  }
}

/** Timestamp of a cached value (ms epoch), or null when it is not cached. */
export function cacheAge(scope: string, key: string): number | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(fullKey(scope, key));
    if (!raw) return null;
    const at = Number((JSON.parse(raw) as CacheEntry<unknown>).at);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Best-effort write: trims large values and clears room when the quota is full. */
export function cacheWrite<T>(scope: string, key: string, value: T): void {
  const store = storage();
  if (!store || value === undefined) return;
  const payload = JSON.stringify({at: Date.now(), v: shrink(value)});
  try {
    store.setItem(fullKey(scope, key), payload);
    return;
  } catch {
    /* fall through — almost always the quota */
  }
  makeRoom(scope);
  try {
    store.setItem(fullKey(scope, key), payload);
  } catch {
    /* still too big: the app simply fetches instead */
  }
}

export function cacheDrop(scope: string, key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(fullKey(scope, key));
  } catch {
    /* ignore */
  }
}

/** Forget everything cached for one player (used on sign-out). */
export function cacheClearScope(scope: string): void {
  const store = storage();
  if (!store) return;
  const prefix = `${PREFIX}${scope}.`;
  const doomed: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
  } catch {
    /* ignore */
  }
}

/** Drop entries older than `maxAgeMs` across every scope. */
export function cacheSweep(maxAgeMs: number = MAX_AGE_MS): number {
  const store = storage();
  if (!store) return 0;
  const doomed: string[] = [];
  const now = Date.now();
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        const at = Number((JSON.parse(store.getItem(key) || '{}') as CacheEntry<unknown>).at) || 0;
        if (now - at > maxAgeMs) doomed.push(key);
      } catch {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => store.removeItem(key));
  } catch {
    return doomed.length;
  }
  return doomed.length;
}

/** How much room the cache is using — surfaced in the profile for transparency. */
export function cacheStats(): {entries: number; bytes: number; scopes: string[]} {
  const store = storage();
  if (!store) return {entries: 0, bytes: 0, scopes: []};
  let entries = 0;
  let bytes = 0;
  const scopes = new Set<string>();
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(PREFIX)) continue;
      entries += 1;
      bytes += (store.getItem(key) || '').length + key.length;
      const rest = key.slice(PREFIX.length);
      scopes.add(rest.slice(0, rest.indexOf('.')));
    }
  } catch {
    /* ignore */
  }
  return {entries, bytes, scopes: [...scopes]};
}

/** Wipe the whole cache (keeps prefs, theme, fonts and the login token). */
export function cacheClearAll(): void {
  const store = storage();
  if (!store) return;
  const doomed: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(PREFIX)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
  } catch {
    /* ignore */
  }
}
