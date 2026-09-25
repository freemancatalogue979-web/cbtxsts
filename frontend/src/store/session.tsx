/**
 * Session provider: owns auth state, the live websocket, and the celebration
 * pipeline (XP/coin toasts, level-ups, badges, duel wins).
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {api, tokenStore} from '../lib/api';
import {cacheClearScope, cacheRead, cacheSweep, cacheWrite, userScope} from '../lib/cache';
import {sfx} from '../lib/sfx';
import {celebrate, coinRain, burst} from '../lib/confetti';
import {LiveSocket} from '../lib/ws';
import type {WsStatus} from '../lib/ws';
import type {BadgeItem, ChatMessage, Config, InboxNote, LeaderboardRow, Notice, Profile, RewardEvent, SeasonRank, Session} from '../lib/types';

export type ToastKind = 'success' | 'error' | 'info' | 'reward';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  icon?: string;
}

export type CelebrationKind = 'level_up' | 'season_rank' | 'season_roll' | 'badge' | 'duel_win' | 'exam_pass' | 'prize';

export interface Celebration {
  id: string;
  kind: CelebrationKind;
  title: string;
  subtitle?: string;
  detail?: string;
  badge?: BadgeItem;
  level?: number;
  score?: number;
  percentage?: number;
  grade?: string;
  rankLabel?: string;
  /** Set on 'season_rank' celebrations: the badge that was just earned. */
  season?: {
    level: number;
    rank: SeasonRank;
    previousRank: SeasonRank | null;
    label: string;
    nextRank: SeasonRank | null;
    levelsToNextRank: number;
    levelsGained: number;
  };
  /** Set on 'season_roll': how the month before this one finished. */
  seasonRoll?: {label: string; level: number; xp: number; rankLabel: string};
  rewards?: RewardEvent[];
}

interface SessionValue {
  ready: boolean;
  token: string | null;
  role: 'student' | 'admin' | null;
  profile: Profile | null;
  config: Config | null;
  socketStatus: WsStatus;
  online: number;
  onlineIds: number[];
  leaderboard: LeaderboardRow[];
  notices: Notice[];
  toasts: Toast[];
  celebrations: Celebration[];
  signIn: (identifier: string, password: string) => Promise<Profile>;
  register: (payload: {username: string; phone: string; password: string; displayName?: string}) => Promise<Profile>;
  signInAdmin: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Instant Admin⇄Player switch using the stored slot for the other role. */
  switchTo: (target: 'student' | 'admin') => Promise<'ok' | 'missing'>;
  storedRole: (probe: 'student' | 'admin') => boolean;
  /** Drop the shell (keeping both tokens) so the sign-in sheet can add the
   *  missing role's session; the app re-renders by itself once it lands. */
  beginSwitch: (target: 'student' | 'admin') => void;
  cancelSwitch: () => void;
  switchTarget: 'student' | 'admin' | null;
  refreshProfile: () => Promise<Profile | null>;
  setProfile: (profile: Profile) => void;
  loadBootstrap: () => Promise<void>;
  toast: (kind: ToastKind, title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  pushRewards: (events: RewardEvent[], context?: {title?: string; kind?: CelebrationKind}) => void;
  pushCelebration: (celebration: Omit<Celebration, 'id'>) => void;
  dismissCelebration: (id: string) => void;
  on: (event: string, handler: (data: unknown) => void) => () => void;
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
  duelSend: (room: string, message: Record<string, unknown>) => void;
  chatUnread: Record<number, number>;
  setChatFocus: (friendId: number | null) => void;
  refreshChatUnread: () => void;
  inbox: InboxNote[];
  inboxUnread: number;
  refreshInbox: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);

export function SessionProvider({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const [role, setRole] = useState<'student' | 'admin' | null>(() => tokenStore.getRole());
  const [switching, setSwitching] = useState<'student' | 'admin' | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [socketStatus, setSocketStatus] = useState<WsStatus>('closed');
  const [online, setOnline] = useState(0);
  const [onlineIds, setOnlineIds] = useState<number[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  // Chat unread badges and the notification inbox are mirrored on the device:
  // they paint on the first frame, then the live socket corrects them.
  const [chatUnread, setChatUnread] = useState<Record<number, number>>(() => cacheRead('app', 'chat.unread') ?? {});
  const [inbox, setInbox] = useState<InboxNote[]>(() => cacheRead('app', 'inbox.notes') ?? []);
  const [inboxUnread, setInboxUnread] = useState(() => Number(cacheRead('app', 'inbox.unread') ?? 0));
  const chatFocusRef = useRef<number | null>(null);
  const myIdRef = useRef<number | null>(null);

  const socketRef = useRef<LiveSocket | null>(null);
  const duelSocketsRef = useRef<Map<string, LiveSocket>>(new Map());
  const subsRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());

  const toast = useCallback((kind: ToastKind, title: string, detail?: string) => {
    const id = uid();
    setToasts((current) => [...current.slice(-3), {id, kind, title, detail}]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), kind === 'error' ? 6000 : 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissCelebration = useCallback((id: string) => {
    setCelebrations((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushCelebration = useCallback((celebration: Omit<Celebration, 'id'>) => {
    setCelebrations((current) => [...current, {...celebration, id: uid()}]);
  }, []);

  const pushRewards = useCallback(
    (events: RewardEvent[], context?: {title?: string; kind?: CelebrationKind}) => {
      if (!events?.length) return;
      let xp = 0;
      let coins = 0;
      let streakDays = 0;
      const badges: BadgeItem[] = [];
      const levelUp = events.find((event) => event.type === 'level_up') as
        | {level: number; title: string}
        | undefined;
      const seasonClimb = events.find((event) => event.type === 'season_level') as
        | Extract<RewardEvent, {type: 'season_level'}>
        | undefined;

      events.forEach((event) => {
        if (event.type === 'xp') xp += event.amount;
        else if (event.type === 'coins') coins += event.amount;
        else if (event.type === 'streak') streakDays = Math.max(streakDays, event.days);
        else if (event.type === 'badge') badges.push(event.badge);
      });

      if (coins > 0) coinRain(Math.min(70, 26 + coins / 3));

      // Where the climb left the player on the seasonal ladder. Every reward
      // surface mentions it, so the badge is never a surprise.
      const seasonLine = seasonClimb ? `Season Lv ${seasonClimb.level} · ${seasonClimb.rank.label}` : '';
      const toNextBadge = seasonClimb
        ? seasonClimb.next_rank
          ? `${seasonClimb.levels_to_next_rank} level${seasonClimb.levels_to_next_rank === 1 ? '' : 's'} to ${seasonClimb.next_rank.label}`
          : 'Top of the ladder'
        : '';

      if (levelUp) {
        celebrate({big: true});
        pushCelebration({
          kind: 'level_up',
          title: `Level ${levelUp.level}`,
          subtitle: levelUp.title,
          detail: [`+${xp} XP`, coins ? `+${coins} coins` : '', seasonLine].filter(Boolean).join(' • '),
          level: levelUp.level,
          rewards: events,
        });
        return;
      }

      /* A new badge is worth stopping for — twelve of them exist per season and
         you only pass one every few levels. Ordinary season levels ride along
         in the reward toast instead of interrupting play. */
      if (seasonClimb?.promoted) {
        celebrate({big: true});
        sfx.play('levelup');
        pushCelebration({
          kind: 'season_rank',
          title: `${seasonClimb.rank.label} badge`,
          subtitle: `Season level ${seasonClimb.level}`,
          detail: `+${xp} XP${coins ? ` • +${coins} coins` : ''}`,
          level: seasonClimb.level,
          season: {
            level: seasonClimb.level,
            rank: seasonClimb.rank,
            previousRank: seasonClimb.previous_rank ?? null,
            label: seasonClimb.label,
            nextRank: seasonClimb.next_rank ?? null,
            levelsToNextRank: seasonClimb.levels_to_next_rank ?? 0,
            levelsGained: seasonClimb.levels_gained ?? 1,
          },
          rewards: events,
        });
        return;
      }

      badges.forEach((badge) => {
        burst({count: 70});
        pushCelebration({kind: 'badge', title: badge.name, subtitle: 'Badge unlocked', detail: badge.description, badge});
      });

      if (context?.kind) {
        pushCelebration({
          kind: context.kind,
          title: context.title ?? 'Reward',
          /* The season line rides in the detail text here: a prize card keeps
             its own hero, and the badge hero is reserved for the badge itself. */
          detail: [`+${xp} XP`, `+${coins} coins`, seasonLine].filter(Boolean).join(' • '),
          rewards: events,
        });
        return;
      }

      if (xp || coins || streakDays) {
        // A season level that did not cross a badge boundary still deserves a
        // line: it is the number the ladder is built on.
        toast(
          'reward',
          streakDays > 1
            ? `${streakDays}-day streak!`
            : seasonClimb
              ? `${seasonClimb.rank.label} · season level ${seasonClimb.level}`
              : 'Rewards banked',
          [xp ? `+${xp} XP` : '', coins ? `+${coins} coins` : '', toNextBadge].filter(Boolean).join(' • '),
        );
      }
    },
    [pushCelebration, toast],
  );

  const loadBootstrap = useCallback(async () => {
    try {
      const boot = await api.bootstrap();
      setConfig(boot.config);
      setNotices(boot.notifications);
      setLeaderboard(boot.leaderboard);
      setOnline(boot.online);
    } catch (error) {
      if (!config) {
        toast('error', 'Server unreachable', (error as Error).message);
      }
    }
  }, [config, toast]);

  const refreshProfile = useCallback(async () => {
    if (!tokenStore.get() || tokenStore.getRole() !== 'student') return null;
    try {
      const me = await api.me();
      setProfile(me);
      return me;
    } catch (error) {
      if ((error as {status?: number}).status === 401) {
        tokenStore.clear();
        setToken(null);
        setRole(null);
        setProfile(null);
      }
      return null;
    }
  }, []);

  /* ------------------------------------------------- a new season begins */
  /* The ladder resets on the first of the month. Say so once, on the first
     screen of the new month, and say what the month before ended on — otherwise
     a player just finds their badge gone one morning. */
  useEffect(() => {
    const season = profile?.season;
    if (!profile || !season) return;
    const scope = userScope(profile.id);
    const seen = cacheRead<string>(scope, 'season_seen', Number.POSITIVE_INFINITY);
    cacheWrite(scope, 'season_seen', season.season_key);
    if (!seen || seen === season.season_key) return;
    const previous = season.previous;
    const finished = previous && previous.xp > 0 ? previous : null;
    pushCelebration({
      kind: 'season_roll',
      title: season.label,
      subtitle: typeof season.number === 'number' ? `Season ${season.number} has begun` : 'A new season has begun',
      detail: finished
        ? 'Your badge has reset — lifetime XP, coins and trophies are untouched.'
        : 'A fresh ladder: everyone starts on level 1 and the Bronze badge.',
      level: season.level,
      season: {
        level: season.level,
        rank: season.rank,
        previousRank: null,
        label: season.label,
        nextRank: season.next_rank,
        levelsToNextRank: season.next_rank ? Math.max(0, season.next_rank.level_from - season.level) : 0,
        levelsGained: 0,
      },
      seasonRoll: finished
        ? {
            label: finished.label ?? 'last season',
            level: finished.level,
            xp: finished.xp,
            rankLabel: finished.rank?.label ?? 'no badge',
          }
        : undefined,
    });
  }, [profile, pushCelebration]);

  /* ------------------------------------------------- restore the session */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = tokenStore.get();
      const storedRole = tokenStore.getRole();
      await loadBootstrap();
      if (stored && storedRole === 'student') {
        try {
          const me = await api.me();
          if (!cancelled) {
            setToken(stored);
            setRole('student');
            setProfile(me);
            if (me.is_new) {
              celebrate();
              pushCelebration({
                kind: 'exam_pass',
                title: `Welcome, ${me.name.split(' ')[0]}!`,
                subtitle: 'Arena account created',
                detail: 'You start with 100 coins and a free daily bonus.',
              });
            }
          }
        } catch {
          tokenStore.clear();
          setToken(null);
          setRole(null);
        }
      } else if (stored && storedRole === 'admin') {
        setToken(stored);
        setRole('admin');
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------- live websocket */
  useEffect(() => {
    if (!token || role !== 'student') return undefined;

    const socket = new LiveSocket({
      token,
      onStatus: setSocketStatus,
      onEvent: (event, data) => {
        subsRef.current.get(event)?.forEach((handler) => handler(data));
        subsRef.current.get('*')?.forEach((handler) => handler(data));

        switch (event) {
          case 'presence': {
            const payload = data as {online: number; student_ids: number[]};
            setOnline(payload.online);
            setOnlineIds(payload.student_ids ?? []);
            break;
          }
          case 'welcome': {
            const payload = data as {online?: number; online_ids?: number[]; leaderboard?: LeaderboardRow[]};
            if (typeof payload.online === 'number') setOnline(payload.online);
            if (payload.online_ids) setOnlineIds(payload.online_ids);
            if (payload.leaderboard) setLeaderboard(payload.leaderboard);
            break;
          }
          case 'leaderboard': {
            const payload = data as {scope: string; rows: LeaderboardRow[]};
            if (payload.scope === 'global') setLeaderboard(payload.rows);
            break;
          }
          case 'reward': {
            const payload = data as {rewards: RewardEvent[]};
            pushRewards(payload.rewards);
            break;
          }
          case 'duel_invite': {
            const payload = data as {challenger_name: string; stake_coins: number; deadline: string};
            toast('info', `⚔️ ${payload.challenger_name} challenged you`, `${payload.stake_coins} coins at stake`);
            break;
          }
          case 'notification': {
            const payload = data as Notice;
            setNotices((current) => [payload, ...current.filter((n) => n.id !== payload.id)].slice(0, 20));
            toast('info', payload.title, payload.message);
            break;
          }
          case 'exam_result': {
            refreshProfile();
            break;
          }
          case 'notify': {
            const payload = data as InboxNote;
            setInbox((current) => [payload, ...current.filter((note) => note.id !== payload.id)].slice(0, 40));
            setInboxUnread((current) => current + (payload.read ? 0 : 1));
            sfx.play('chat');
            toast('info', payload.title, payload.message.slice(0, 80));
            break;
          }
          case 'chat': {
            const payload = data as ChatMessage & {sender_name?: string};
            if (payload.sender_id === myIdRef.current) break; // echo of my own send
            if (chatFocusRef.current === payload.sender_id) {
              api
                .markChatRead(payload.sender_id)
                .then(() =>
                  setChatUnread((current) => {
                    const next = {...current};
                    delete next[payload.sender_id];
                    return next;
                  }),
                )
                .catch(() => {});
            } else {
              setChatUnread((current) => ({
                ...current,
                [payload.sender_id]: (current[payload.sender_id] ?? 0) + 1,
              }));
              sfx.play('chat');
              toast(
                'info',
                `💬 ${payload.sender_name ?? 'New message'}`,
                payload.kind === 'text'
                  ? payload.body.slice(0, 60)
                  : payload.kind === 'duel'
                    ? 'Sent you a duel invite'
                    : 'Proposed a quiz plan',
              );
            }
            break;
          }
          default:
            break;
        }
      },
    });

    socket.connect();
    socketRef.current = socket;

    // Coming back from a locked phone / lost signal / another tab: reconnect
    // right away. Nothing reloads — the same session just dials again.
    const resume = () => socket.resume();
    const onVisible = () => {
      if (!document.hidden) socket.resume();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', onVisible);
      socket.close();
      socketRef.current = null;
      setSocketStatus('closed');
    };
  }, [token, role, pushRewards, refreshProfile, toast]);

  useEffect(() => {
    myIdRef.current = profile?.id ?? null;
  }, [profile]);

  /* Keep the device mirror in step, and sweep stale entries once per boot. */
  useEffect(() => {
    cacheWrite('app', 'chat.unread', chatUnread);
  }, [chatUnread]);

  useEffect(() => {
    cacheWrite('app', 'inbox.notes', inbox.slice(0, 40));
    cacheWrite('app', 'inbox.unread', inboxUnread);
  }, [inbox, inboxUnread]);

  useEffect(() => {
    cacheSweep();
  }, []);

  const refreshInbox = useCallback(() => {
    if (!tokenStore.get() || tokenStore.getRole() !== 'student') return;
    api
      .inbox()
      .then((payload) => {
        setInbox(payload.notes);
        setInboxUnread(payload.unread);
      })
      .catch(() => {});
  }, []);

  const refreshChatUnread = useCallback(() => {
    if (!token || role !== 'student') return;
    api
      .chatUnread()
      .then((result) => setChatUnread(result.per_friend ?? {}))
      .catch(() => {});
  }, [token, role]);

  /* The first connect brings presence in its welcome frame; every reconnect
     after that quietly re-reads the player's numbers so nothing looks stale. */
  const firstConnectRef = useRef(true);
  const droppedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!token || role !== 'student') return;
    if (socketStatus === 'open') {
      const wasFirst = firstConnectRef.current;
      firstConnectRef.current = false;
      const droppedAt = droppedAtRef.current;
      droppedAtRef.current = null;
      if (wasFirst) {
        refreshInbox();
        return;
      }
      // Reconnected: refresh the live numbers without touching the page.
      void refreshProfile();
      refreshInbox();
      refreshChatUnread();
      socketRef.current?.requestPresence();
      if (droppedAt && Date.now() - droppedAt > 4_000) {
        toast('success', 'Back online', 'Reconnected — your session picked up where it left off.');
      }
      return;
    }
    if (!firstConnectRef.current) droppedAtRef.current = droppedAtRef.current ?? Date.now();
  }, [socketStatus, token, role, refreshProfile, refreshInbox, refreshChatUnread, toast]);

  const setChatFocus = useCallback(
    (friendId: number | null) => {
      chatFocusRef.current = friendId;
      if (friendId === null) {
        refreshChatUnread();
        return;
      }
      api
        .markChatRead(friendId)
        .then(() =>
          setChatUnread((current) => {
            const next = {...current};
            delete next[friendId];
            return next;
          }),
        )
        .catch(() => {});
    },
    [refreshChatUnread],
  );

  useEffect(() => {
    refreshChatUnread();
    refreshInbox();
  }, [refreshChatUnread, refreshInbox]);

  const on = useCallback((event: string, handler: (data: unknown) => void) => {
    const set = subsRef.current.get(event) ?? new Set<(data: unknown) => void>();
    set.add(handler);
    subsRef.current.set(event, set);
    return () => {
      set.delete(handler);
      if (!set.size) subsRef.current.delete(event);
    };
  }, []);

  /**
   * Duel rooms are their own authenticated sockets on the server
   * (``/ws/duel/{id}``); opening one pipes its events into the same bus the
   * live channel uses, so components subscribe identically.
   */
  const joinRoom = useCallback(
    (room: string) => {
      if (!room.startsWith('duel:') || !token) return;
      if (duelSocketsRef.current.has(room)) return;
      const duelId = room.slice('duel:'.length);
      const socket = new LiveSocket({
        token,
        path: `/ws/duel/${duelId}`,
        onEvent: (event, data) => {
          subsRef.current.get(event)?.forEach((handler) => handler(data));
          subsRef.current.get('*')?.forEach((handler) => handler(data));
        },
      });
      socket.connect();
      duelSocketsRef.current.set(room, socket);
    },
    [token],
  );

  const leaveRoom = useCallback((room: string) => {
    const socket = duelSocketsRef.current.get(room);
    socket?.close();
    duelSocketsRef.current.delete(room);
  }, []);

  /** Push a message down an open duel socket (waiting-room chat). */
  const duelSend = useCallback((room: string, message: Record<string, unknown>) => {
    duelSocketsRef.current.get(room)?.send(message);
  }, []);

  const closeDuelSockets = useCallback(() => {
    duelSocketsRef.current.forEach((socket) => socket.close());
    duelSocketsRef.current.clear();
  }, []);

  // Tear every duel socket down when the provider unmounts.
  useEffect(() => () => closeDuelSockets(), [closeDuelSockets]);

  const adoptSession = useCallback(
    async (sessionPromise: Promise<Session>) => {
      const session = await sessionPromise;
      tokenStore.set(session.token, 'student');
      setSwitching(null);
      setToken(session.token);
      setRole('student');
      setProfile(session.profile);
      await loadBootstrap();
      if (session.profile.is_new) {
        celebrate();
      }
      return session.profile;
    },
    [loadBootstrap],
  );

  const signIn = useCallback(
    (identifier: string, password: string) => adoptSession(api.loginWithPassword(identifier.trim(), password)),
    [adoptSession],
  );

  const register = useCallback(
    (payload: {username: string; phone: string; password: string; displayName?: string}) =>
      adoptSession(
        api.registerStudent({
          username: payload.username.trim().toLowerCase(),
          phone: payload.phone.trim(),
          password: payload.password,
          display_name: payload.displayName?.trim() || undefined,
        }),
      ),
    [adoptSession],
  );

  const signInAdmin = useCallback(async (email: string, password: string) => {
    const session = await api.loginAsAdmin(email, password);
    tokenStore.set(session.token, 'admin');
    setToken(session.token);
    setRole('admin');
    setProfile(null);
    setSwitching(null);
  }, []);

  /* --------------------------------------------- Admin ⇄ Player switching
     Both tokens live side by side in localStorage slots, so switching is a
     pointer flip: the other role's shell mounts with its data already loaded
     and its websocket already reconnecting. No re-login, no page refresh,
     no duplicate sessions — and a failed slot (revoked token) costs nothing
     but that one slot, restoring whatever session was active before. */
  const storedRole = useCallback((probe: 'student' | 'admin') => Boolean(tokenStore.getSlot(probe)), []);

  const switchTo = useCallback(
    async (target: 'student' | 'admin'): Promise<'ok' | 'missing'> => {
      const stored = tokenStore.getSlot(target);
      if (!stored) return 'missing';
      const prevToken = tokenStore.get();
      const prevRole = tokenStore.getRole();
      tokenStore.set(stored, target);
      setToken(stored);
      setRole(target);
      setSwitching(null);
      try {
        if (target === 'student') {
          const me = await api.me();
          setProfile(me);
        } else {
          // Prove the staff slot still works before trusting the console shell.
          await api.admin.notifications({limit: 1});
          setProfile(null);
        }
        await loadBootstrap();
        sfx.play('whoosh');
        return 'ok';
      } catch {
        tokenStore.clearSlot(target);
        if (prevToken && prevRole) {
          tokenStore.set(prevToken, prevRole);
          setToken(prevToken);
          setRole(prevRole);
        } else {
          tokenStore.clear();
          setToken(null);
          setRole(null);
        }
        setSwitching(null);
        return 'missing';
      }
    },
    [loadBootstrap],
  );

  const beginSwitch = useCallback((target: 'student' | 'admin') => {
    setSwitching(target);
    setRole(null); // shell falls back to Welcome without touching stored tokens
  }, []);

  const cancelSwitch = useCallback(() => {
    setSwitching(null);
    const stored = tokenStore.get();
    const roleNow = tokenStore.getRole();
    setToken(stored);
    setRole(roleNow);
  }, []);

  const signOut = useCallback(() => {
    setProfile((current) => {
      // Personal mirrors (chat, friends, inbox) never outlive the session.
      cacheClearScope(userScope(current?.id));
      return null;
    });
    // Signing out logs out *this* role; the other role's stored session (if
    // any) stays signed in so the switcher still works on next entry.
    const activeRole = tokenStore.getRole();
    if (activeRole) tokenStore.clearSlot(activeRole);
    tokenStore.clear();
    setSwitching(null);
    socketRef.current?.close();
    socketRef.current = null;
    duelSocketsRef.current.forEach((socket) => socket.close());
    duelSocketsRef.current.clear();
    setToken(null);
    setRole(null);
    setSocketStatus('closed');
    setCelebrations([]);
    setToasts([]);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      token,
      role,
      profile,
      config,
      socketStatus,
      online,
      switchTo,
      storedRole,
      beginSwitch,
      cancelSwitch,
      switchTarget: switching,
      onlineIds,
      leaderboard,
      notices,
      toasts,
      celebrations,
      signIn,
      register,
      signInAdmin,
      signOut,
      refreshProfile,
      setProfile,
      loadBootstrap,
      toast,
      dismissToast,
      pushRewards,
      pushCelebration,
      dismissCelebration,
      on,
      joinRoom,
      leaveRoom,
      duelSend,
      chatUnread,
      setChatFocus,
      refreshChatUnread,
      inbox,
      inboxUnread,
      refreshInbox,
    }),
    [
      switchTo,
      storedRole,
      beginSwitch,
      cancelSwitch,
      switching,
      ready,
      token,
      role,
      profile,
      config,
      socketStatus,
      online,
      onlineIds,
      leaderboard,
      notices,
      toasts,
      celebrations,
      signIn,
      register,
      signInAdmin,
      signOut,
      refreshProfile,
      loadBootstrap,
      toast,
      dismissToast,
      pushRewards,
      pushCelebration,
      dismissCelebration,
      on,
      joinRoom,
      leaveRoom,
      duelSend,
      chatUnread,
      setChatFocus,
      refreshChatUnread,
      inbox,
      inboxUnread,
      refreshInbox,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
