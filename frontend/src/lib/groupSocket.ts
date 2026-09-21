/**
 * One socket per study group. The workspace owns a single ``useGroupRoom`` and
 * shares its event bus with every section, so chat, presence, activity,
 * announcements and quiz updates all arrive over the same authenticated
 * ``/ws/group/{id}`` channel — never a per-member poll.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {tokenStore} from './api';
import {LiveSocket} from './ws';
import type {WsStatus} from './ws';
import type {GroupChatMessage, PresenceStatus} from './types';

type Handler = (data: unknown) => void;

export interface GroupStateSnapshot {
  group_id: number;
  messages: GroupChatMessage[];
  unread_notifications: number;
  presence: {statuses: Record<string, PresenceStatus>; online: number};
}

export interface GroupRoom {
  status: WsStatus;
  connected: boolean;
  snapshot: GroupStateSnapshot | null;
  on: (event: string, handler: Handler) => () => void;
  send: (payload: Record<string, unknown>) => void;
  requestPresence: () => void;
}

export function useGroupRoom(groupId: number | null): GroupRoom {
  const [status, setStatus] = useState<WsStatus>('closed');
  const [snapshot, setSnapshot] = useState<GroupStateSnapshot | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map());

  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    const socket = new LiveSocket({
      token: tokenStore.get() ?? '',
      path: `/ws/group/${groupId}`,
      onStatus: (next) => {
        if (alive) setStatus(next);
      },
      onEvent: (event, data) => {
        if (!alive) return;
        if (event === 'group_state') setSnapshot(data as GroupStateSnapshot);
        handlersRef.current.get(event)?.forEach((handler) => handler(data));
        handlersRef.current.get('*')?.forEach((handler) => handler(data));
      },
    });
    socketRef.current = socket;
    socket.connect();

    /* Report away/online as the tab hides and shows, so the presence dot is
       honest without the server polling every member. */
    const onVisibility = () => {
      socket.send({type: 'away', value: document.hidden});
      if (!document.hidden) socket.requestPresence?.();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      socket.close();
      socketRef.current = null;
      setSnapshot(null);
      setStatus('closed');
    };
  }, [groupId]);

  const on = useCallback((event: string, handler: Handler) => {
    const set = handlersRef.current.get(event) ?? new Set<Handler>();
    set.add(handler);
    handlersRef.current.set(event, set);
    return () => {
      set.delete(handler);
      if (!set.size) handlersRef.current.delete(event);
    };
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    socketRef.current?.send(payload);
  }, []);

  const requestPresence = useCallback(() => {
    socketRef.current?.send({type: 'presence'});
  }, []);

  return {status, connected: status === 'open', snapshot, on, send, requestPresence};
}

/** Live "time until" text for scheduled quizzes, duels and announcements. */
export function useCountdown(targetIso: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (!targetIso) return '';
  const target = new Date(targetIso.endsWith('Z') ? targetIso : `${targetIso}Z`).getTime();
  if (Number.isNaN(target)) return '';
  const diff = target - now;
  if (diff <= 0) return 'now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'in seconds';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hr`;
  return `in ${Math.round(hours / 24)} d`;
}

export function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}
