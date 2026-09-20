/**
 * Profile photos live in the database and are served from an authenticated
 * endpoint, so an <img src> tag alone cannot fetch them. This module pulls
 * each photo once with the bearer token, keeps an object-URL cache and exposes
 * a tiny React hook the Avatar component uses.
 */
import {useEffect, useState} from 'react';

import {tokenStore} from './api';

const cache = new Map<number, string>(); // player id -> object URL
const inflight = new Map<number, Promise<string | null>>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

async function load(playerId: number): Promise<string | null> {
  const existing = inflight.get(playerId);
  if (existing) return existing;
  const task = (async () => {
    try {
      const token = tokenStore.get();
      const response = await fetch(`/api/players/${playerId}/photo`, {
        headers: token ? {Authorization: `Bearer ${token}`} : undefined,
      });
      if (!response.ok) return null;
      const url = URL.createObjectURL(await response.blob());
      cache.set(playerId, url);
      notify();
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(playerId);
    }
  })();
  inflight.set(playerId, task);
  return task;
}

/** Cached photo URL for a player, or null while loading / when they have none. */
export function photoUrl(playerId: number): string | null {
  return cache.get(playerId) ?? null;
}

/** Drop the cached photo (after an upload or removal) so the next read refetches. */
export function invalidatePhoto(playerId: number): void {
  const url = cache.get(playerId);
  if (url) URL.revokeObjectURL(url);
  cache.delete(playerId);
  notify();
}

/** React hook: resolves a player's photo once `has` says they uploaded one. */
export function usePlayerPhoto(playerId?: number | null, has?: boolean | null): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!playerId || !has) return;
    if (!cache.has(playerId)) void load(playerId);
  }, [playerId, has]);
  if (!playerId || !has) return null;
  return cache.get(playerId) ?? null;
}
