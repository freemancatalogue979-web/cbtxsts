/**
 * Ranked — matchmade competitive play with a live Elo ladder.
 *
 * One state machine covers the whole flow the spec draws:
 *   course select → Finding players → lobby countdown → live match
 *   → results with rating movement → back to the ladder.
 *
 * Every score, window and rating comes from the server; the panel only renders
 * what it is told. Live standings, activity and presence arrive on the match
 * websocket (`/ws/ranked/{id}`) — never by polling — and the in-match board is
 * a sidebar on desktop and a bottom sheet on phones so it never covers the
 * question.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {
  ArrowLeft,
  Check,
  ChevronUp,
  Eye,
  Flame,
  Loader2,
  Radio,
  RefreshCw,
  SignalHigh,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {Avatar, Button, Card, Chip, EmptyState, ProgressBar, ReviewOptions, Skeleton, StatTile} from '../components/ui';
import {api, tokenStore} from '../lib/api';
import {formatNumber} from '../lib/format';
import {sfx, uiClick} from '../lib/sfx';
import {LiveSocket} from '../lib/ws';
import {useSession} from '../store/session';
import type {
  QuestionPublic,
  RankedFinishPayload,
  RankedHistoryRow,
  RankedLadder,
  RankedMatchState,
  RankedMeta,
  RankedPlayer,
  RankedQuestionWindow,
  RankedReveal,
  RankedStatus,
  ReviewItem,
} from '../lib/types';

type Phase = 'loading' | 'idle' | 'queue' | 'lobby' | 'live' | 'results' | 'review';

const QUEUE_REFRESH_MS = 2000;
const QUEUE_TARGETS = [3, 8, 12, 15];

function parseTime(iso: string): number {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Server-synced clock: keeps a rolling offset from the server's timestamps. */
function useServerClock() {
  const offsetRef = useRef(0);
  const sync = useCallback((serverNowIso: string) => {
    const drift = Date.now() - parseTime(serverNowIso);
    offsetRef.current = offsetRef.current === 0 ? drift : offsetRef.current * 0.7 + drift * 0.3;
  }, []);
  const remaining = useCallback((deadlineIso: string) => Math.max(0, parseTime(deadlineIso) - (Date.now() - offsetRef.current)), []);
  return {sync, remaining};
}

function ConnectionDot({connected}: {connected: boolean}) {
  return (
    <span
      title={connected ? 'Connected' : 'Reconnecting'}
      className={`inline-block size-2 shrink-0 rounded-full ${connected ? 'bg-mint-400 shadow-[0_0_6px] shadow-mint-400/60' : 'bg-mist-600'}`}
    />
  );
}

function TierBadge({tier, tierName}: {tier: string; tierName: string}) {
  const tone: Record<string, string> = {
    bronze: 'border-amber-700/40 bg-amber-700/15 text-amber-300',
    silver: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
    gold: 'border-yellow-500/40 bg-yellow-500/12 text-yellow-300',
    platinum: 'border-teal-300/30 bg-teal-300/10 text-teal-200',
    diamond: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
    master: 'border-violet-400/40 bg-violet-400/12 text-violet-300',
    grandmaster: 'border-pink-400/40 bg-pink-400/12 text-pink-300',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-extrabold tracking-wide ${tone[tier] ?? tone.bronze}`}>
      {tierName}
    </span>
  );
}

function PlayerRow({player, meId, showPlace}: {player: RankedPlayer; meId: number; showPlace: boolean}) {
  const mine = player.student_id === meId;
  return (
    <li
      className={`flex items-center gap-2.5 rounded-2xl border px-2.5 py-2 transition-colors ${
        mine ? 'border-nova-400/40 bg-nova-400/10' : 'border-white/8 bg-white/4'
      }`}
    >
      {showPlace && (
        <span className="w-6 shrink-0 text-center font-display text-[0.72rem] font-black text-mist-400">
          {ordinal(player.position ?? 0)}
        </span>
      )}
      <Avatar
        name={player.name}
        hue={player.avatar_hue}
        initials={player.initials}
        size={34}
        photo={{id: player.student_id, has: player.has_photo}}
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[0.76rem] font-extrabold text-mist-100">
          <ConnectionDot connected={player.connected} />
          <span className="truncate">{player.name}</span>
          {mine && <span className="shrink-0 text-[0.6rem] font-black text-nova-300">You</span>}
        </p>
        <p className="text-[0.62rem] font-bold text-mist-500">
          Lv {player.level} · {formatNumber(player.rating)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-[0.86rem] font-black text-mist-50">{formatNumber(player.score)}</p>
        <p className="flex items-center justify-end gap-1 text-[0.58rem] font-bold text-mist-500">
          {player.streak > 1 && <Flame className="size-3 text-gold-400" />}
          {player.correct}/{player.questions_total || '–'}
        </p>
      </div>
    </li>
  );
}

function StandingsList({
  standings,
  meId,
  onSheetClose,
}: {
  standings: RankedPlayer[];
  meId: number;
  onSheetClose?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/8 px-3.5 py-2.5">
        <Trophy className="size-4 text-gold-300" />
        <h3 className="text-[0.8rem] font-extrabold text-mist-100">Live standings</h3>
        {onSheetClose && (
          <button onClick={onSheetClose} className="ml-auto rounded-lg p-1 text-mist-400 hover:text-mist-100" aria-label="Close standings">
            <X className="size-4" />
          </button>
        )}
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {standings.map((player) => (
          <PlayerRow key={player.student_id} player={player} meId={meId} showPlace />
        ))}
      </ul>
    </div>
  );
}

function ActivityFeed({items}: {items: {text: string; at: string}[]}) {
  const recent = items.slice(-5);
  return (
    <div className="border-t border-white/8 px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-[0.62rem] font-extrabold text-mist-500">
        <Radio className="size-3.5 text-nova-300" /> Live activity
      </p>
      <ul className="mt-1.5 space-y-1">
        {recent.length === 0 && <li className="text-[0.66rem] font-medium text-mist-600">The match is quiet — for now.</li>}
        {recent.map((item, i) => (
          <motion.li
            key={`${item.at}-${i}`}
            initial={{opacity: 0, x: -6}}
            animate={{opacity: 1, x: 0}}
            className="truncate text-[0.68rem] font-semibold text-mist-400"
          >
            {item.text}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export default function RankedPanel() {
  const {profile, on, toast} = useSession();
  const meId = profile?.id ?? 0;
  const clock = useServerClock();

  const [phase, setPhase] = useState<Phase>('loading');
  const [meta, setMeta] = useState<RankedMeta | null>(null);
  const [status, setStatus] = useState<RankedStatus | null>(null);
  const [courses, setCourses] = useState<{id: number; title: string; code: string}[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [match, setMatch] = useState<RankedMatchState | null>(null);
  const [window_, setWindow] = useState<RankedQuestionWindow | null>(null);
  const [reveal, setReveal] = useState<RankedReveal | null>(null);
  const [myPick, setMyPick] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finish, setFinish] = useState<RankedFinishPayload | null>(null);
  const [history, setHistory] = useState<RankedHistoryRow[]>([]);
  const [ladder, setLadder] = useState<RankedLadder | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const socketRef = useRef<LiveSocket | null>(null);
  const questionStartRef = useRef<number>(0);

  /* ------------------------------------------------------------ loaders */
  const loadStatus = useCallback(async () => {
    try {
      const payload = await api.rankedStatus();
      setStatus(payload);
      if (payload.server_now) clock.sync(payload.server_now);
      return payload;
    } catch {
      return null;
    }
  }, [clock]);

  const loadIdle = useCallback(async () => {
    const [metaPayload, historyPayload, ladderPayload] = await Promise.all([
      api.rankedMeta().catch(() => null),
      api.rankedHistory().catch(() => ({history: []})),
      api.rankedLadder().catch(() => null),
    ]);
    setMeta(metaPayload);
    setHistory(historyPayload.history);
    setLadder(ladderPayload);
  }, []);

  const applyState = useCallback(
    (state: RankedMatchState) => {
      setMatch(state);
      setMatchId(state.id);
      if (state.server_now) clock.sync(state.server_now);
      if (state.question) {
        setWindow({index: state.round_index, total: state.questions_total, seconds: state.per_question_seconds, deadline: '', server_now: state.server_now, question: state.question});
        questionStartRef.current = Date.now();
      }
      if (state.reveal) setReveal(state.reveal);
      if (state.status === 'lobby') setPhase('lobby');
      else if (state.status === 'live') setPhase(state.reveal ? 'live' : 'live');
      else setPhase('results');
    },
    [clock],
  );

  /* Boot: figure out where the player is right now. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [statusPayload, coursesPayload] = await Promise.all([
        loadStatus(),
        api.courses().catch(() => []),
      ]);
      if (!alive) return;
      setCourses(coursesPayload);
      if (courseId === null && coursesPayload.length) setCourseId(coursesPayload[0].id);
      if (statusPayload?.match) {
        applyState(statusPayload.match);
      } else if (statusPayload?.in_queue) {
        setPhase('queue');
      } else {
        setPhase('idle');
        void loadIdle();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A match found while the player is elsewhere in the app. */
  useEffect(() => on('ranked_match', () => {
    void (async () => {
      const payload = await loadStatus();
      if (payload?.match) applyState(payload.match);
    })();
  }), [on, loadStatus, applyState]);

  /* ------------------------------------------------------- queue phase */
  useEffect(() => {
    if (phase !== 'queue') return undefined;
    const started = Date.now();
    const tick = window.setInterval(() => setQueueSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    const poll = window.setInterval(async () => {
      const payload = await loadStatus();
      if (!payload) return;
      if (payload.match) {
        applyState(payload.match);
      } else if (!payload.in_queue) {
        setPhase('idle');
        void loadIdle();
      }
    }, QUEUE_REFRESH_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [phase, loadStatus, applyState, loadIdle]);

  /* ------------------------------------------------- match websocket */
  const inMatch = phase === 'lobby' || phase === 'live';
  useEffect(() => {
    if (!inMatch) return undefined;
    if (!matchId || !tokenStore.get()) return undefined;
    const token = tokenStore.get() ?? '';
    const socket = new LiveSocket({
      token,
      path: `/ws/ranked/${matchId}`,
      onEvent: (event, data) => {
        switch (event) {
          case 'ranked_state': {
            const payload = (data as {match?: RankedMatchState}).match;
            if (payload) applyState(payload);
            break;
          }
          case 'ranked_question': {
            const payload = data as unknown as RankedQuestionWindow;
            setPhase('live');
            setWindow(payload);
            setReveal(null);
            setMyPick(null);
            setSheetOpen(false);
            questionStartRef.current = Date.now();
            if (payload.server_now) clock.sync(payload.server_now);
            break;
          }
          case 'ranked_answered': {
            const payload = data as {standings?: RankedPlayer[]; student_id?: number};
            if (payload.standings && match) setMatch({...match, participants: payload.standings});
            break;
          }
          case 'ranked_reveal': {
            const payload = data as unknown as RankedReveal;
            setReveal(payload);
            setWindow(null);
            if (payload.standings?.length && match) setMatch({...match, participants: payload.standings});
            sfx.play(payload.correct_ids.includes(meId) ? 'correct' : 'wrong');
            break;
          }
          case 'ranked_presence': {
            const payload = data as {student_id: number; connected: boolean};
            setMatch((current) =>
              current
                ? {
                    ...current,
                    participants: current.participants.map((p) =>
                      p.student_id === payload.student_id ? {...p, connected: payload.connected} : p,
                    ),
                  }
                : current,
            );
            break;
          }
          case 'ranked_activity': {
            const payload = data as {items: {text: string; at: string}[]};
            setMatch((current) => (current ? {...current, activity: payload.items ?? []} : current));
            break;
          }
          case 'ranked_finish': {
            const payload = data as unknown as RankedFinishPayload;
            setFinish(payload);
            setWindow(null);
            setReveal(null);
            setPhase('results');
            sfx.play((payload.ratings.find((r) => r.student_id === meId)?.delta ?? 0) > 0 ? 'win' : 'lose');
            break;
          }
          default:
            break;
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch, matchId]);

  /* Poll a finished match's results if we never saw the finish event. */
  useEffect(() => {
    if (phase !== 'results' || finish) return;
    if (match?.status === 'finished' && !finish) {
      void api.rankedHistory().then((payload) => setHistory(payload.history)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, match?.status, finish]);

  /* -------------------------------------------------- question clock */
  useEffect(() => {
    if (!window_) return undefined;
    const tick = () => {
      if (window_.deadline) setSecondsLeft(Math.ceil(clock.remaining(window_.deadline) / 1000));
      else setSecondsLeft(Math.max(0, window_.seconds - Math.floor((Date.now() - questionStartRef.current) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [window_, clock]);

  /* -------------------------------------------------------- actions */
  const findMatch = async () => {
    if (courseId == null) return;
    uiClick('confirm');
    setBusy(true);
    try {
      const result = await api.rankedJoinQueue(courseId);
      if (result.queued) {
        setPhase('queue');
      } else if (result.state) {
        applyState(result.state);
      }
    } catch (error) {
      toast('error', 'Could not queue', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelQueue = async () => {
    uiClick('cancel');
    try {
      await api.rankedCancelQueue();
    } catch {
      /* already gone */
    }
    setPhase('idle');
    void loadIdle();
  };

  const answer = async (letter: string) => {
    if (!matchId || !window_ || myPick || busy) return;
    uiClick('select');
    const elapsed = Math.max(0, Date.now() - questionStartRef.current);
    setMyPick(letter);
    setBusy(true);
    try {
      const result = await api.rankedAnswer(matchId, letter, elapsed);
      sfx.play(result.result.correct ? 'correct' : 'wrong');
      if (result.reveal) setReveal(result.reveal);
      if (result.match) setMatch(result.match);
    } catch (error) {
      setMyPick(null);
      toast('error', 'Answer rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backToIdle = () => {
    uiClick('nav');
    setPhase('idle');
    setMatch(null);
    setMatchId(null);
    setWindow(null);
    setReveal(null);
    setFinish(null);
    setMyPick(null);
    void loadStatus();
    void loadIdle();
  };

  const playAgain = async () => {
    uiClick('confirm');
    if (courseId == null) return;
    setFinish(null);
    try {
      const result = await api.rankedJoinQueue(courseId);
      if (result.queued) setPhase('queue');
      else if (result.state) applyState(result.state);
    } catch (error) {
      toast('error', 'Could not queue', (error as Error).message);
    }
  };

  const openReview = async () => {
    uiClick('nav');
    if (!matchId) return;
    try {
      const payload = await api.rankedReview(matchId);
      setReview(payload.items);
      setPhase('review');
    } catch (error) {
      toast('error', 'Review unavailable', (error as Error).message);
    }
  };

  /* -------------------------------------------------------- derived */
  const standings = useMemo(() => {
    if (finish) return finish.standings;
    const rows = reveal?.standings ?? match?.participants ?? [];
    return [...rows].sort((a, b) => b.score - a.score || b.correct - a.correct);
  }, [finish, reveal, match]);

  const myPlace = useMemo(() => {
    const index = standings.findIndex((row) => row.student_id === meId);
    return index >= 0 ? index + 1 : null;
  }, [standings, meId]);

  const myRating = finish?.ratings.find((row) => row.student_id === meId) ?? null;
  const myRow = standings.find((row) => row.student_id === meId) ?? null;
  const answeredTotal = myRow?.answered ?? 0;
  const correctTotal = myRow?.correct ?? 0;
  const accuracy = answeredTotal ? Math.round((correctTotal / answeredTotal) * 100) : 0;
  const lobbySecondsLeft = match?.lobby_at ? Math.max(0, Math.ceil(clock.remaining(match.lobby_at) / 1000)) : 0;
  const queueTarget = QUEUE_TARGETS[Math.min(QUEUE_TARGETS.length - 1, Math.floor(queueSeconds / 8))];
  const waiting = status?.waiting ?? 0;

  /* --------------------------------------------------------- renders */
  if (phase === 'loading') {
    return (
      <div className="w-full space-y-4 p-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  /* ------------------------------------------------- course select */
  if (phase === 'idle') {
    return (
      <div className="w-full space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Swords className="size-5 text-nova-300" />
          <h1 className="font-display text-[1.15rem] font-black tracking-tight text-mist-50 sm:text-[1.35rem]">Ranked</h1>
          {status && <TierBadge tier={status.tier} tierName={status.tier_name} />}
        </div>
        <p className="max-w-2xl text-[0.82rem] font-medium text-mist-400">
          Same questions, one shared clock, live standings. Your rating moves with every result — accuracy
          always outweighs a fast click.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Rating" value={formatNumber(status?.rating ?? 1000)} hint={status?.tier_name ?? 'Bronze'} />
          <StatTile label="Matches" value={String(status?.played ?? 0)} hint={`${status?.won ?? 0} won`} />
          <StatTile label="Players per match" value={`${meta?.min_players ?? 2}–${meta?.match_size ?? 15}`} hint="server-matchmade" />
        </div>

        <Card className="p-4 sm:p-5">
          <h2 className="text-[0.95rem] font-extrabold text-mist-50">Find a match</h2>
          <p className="mt-1 text-[0.78rem] font-medium text-mist-500">Pick a course and the server will find opponents.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => {
                  uiClick('select');
                  setCourseId(course.id);
                }}
                className={`rounded-2xl border px-3.5 py-3 text-left transition-all active:translate-y-px ${
                  courseId === course.id
                    ? 'border-nova-400/60 bg-nova-400/10 shadow-[0_0_0_1px] shadow-nova-400/30'
                    : 'border-white/10 bg-white/4 hover:border-white/20 hover:bg-white/8'
                }`}
              >
                <p className="truncate text-[0.82rem] font-extrabold text-mist-100">{course.title}</p>
                <p className="text-[0.66rem] font-bold text-mist-500">{course.code}</p>
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" size="lg" loading={busy} disabled={courseId == null} onClick={findMatch} icon={<TrendingUp className="size-4" />}>
            Find match
          </Button>
        </Card>

        {history.length > 0 && (
          <Card className="p-4 sm:p-5">
            <h2 className="text-[0.95rem] font-extrabold text-mist-50">Recent matches</h2>
            <ul className="mt-3 space-y-2">
              {history.slice(0, 6).map((row) => (
                <li key={row.match_id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                  <span className="font-display text-[0.9rem] font-black text-mist-50">{ordinal(row.position)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.76rem] font-bold text-mist-200">{row.course_title}</p>
                    <p className="text-[0.62rem] font-semibold text-mist-500">
                      of {row.players} · {row.correct} correct · {formatNumber(row.score)} points
                    </p>
                  </div>
                  {row.rating_after != null && (
                    <span className={`flex items-center gap-1 text-[0.7rem] font-black ${row.rating_after >= row.rating_before ? 'text-mint-300' : 'text-flare-300'}`}>
                      {row.rating_after >= row.rating_before ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                      {row.rating_after >= row.rating_before ? '+' : ''}
                      {row.rating_after - row.rating_before}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {ladder && ladder.top.length > 0 && (
          <Card className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-gold-300" />
              <h2 className="text-[0.95rem] font-extrabold text-mist-50">The ladder</h2>
              <span className="ml-auto text-[0.66rem] font-bold text-mist-500">You: #{ladder.mine}</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {ladder.top.slice(0, 10).map((row) => (
                <li key={row.student_id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${row.student_id === meId ? 'bg-nova-400/10' : ''}`}>
                  <span className="w-6 text-center font-display text-[0.74rem] font-black text-mist-400">{row.position}</span>
                  <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={28} photo={{id: row.student_id, has: row.has_photo}} />
                  <p className="min-w-0 flex-1 truncate text-[0.76rem] font-bold text-mist-100">{row.name}</p>
                  <TierBadge tier={row.tier} tierName={row.tier_name} />
                  <span className="font-display text-[0.8rem] font-black text-mist-50">{formatNumber(row.rating)}</span>
                </li>
              ))}
            </ul>
            {ladder.nearby.length > 0 && ladder.mine > 10 && (
              <>
                <p className="mt-2 text-[0.62rem] font-extrabold text-mist-500">Near you</p>
                <ul className="mt-1.5 space-y-1.5">
                  {ladder.nearby.map((row) => (
                    <li key={row.student_id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${row.student_id === meId ? 'bg-nova-400/10' : ''}`}>
                      <span className="w-6 text-center font-display text-[0.74rem] font-black text-mist-400">{row.position}</span>
                      <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={28} photo={{id: row.student_id, has: row.has_photo}} />
                      <p className="min-w-0 flex-1 truncate text-[0.76rem] font-bold text-mist-100">{row.name}</p>
                      <span className="font-display text-[0.8rem] font-black text-mist-50">{formatNumber(row.rating)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {meta && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
                {meta.tiers.map((tier) => (
                  <Chip key={tier.key}>
                    {tier.name} {tier.min}+
                  </Chip>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------ queue */
  if (phase === 'queue') {
    return (
      <div className="w-full p-3 sm:p-4">
        <Card className="mx-auto max-w-lg p-5 text-center sm:p-7">
          <div className="relative mx-auto grid size-20 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-nova-500/20" />
            <span className="absolute inset-2 rounded-full border-2 border-nova-400/40 border-t-nova-300 animate-spin" />
            <Loader2 className="size-7 text-nova-200" />
          </div>
          <h2 className="mt-4 font-display text-[1.1rem] font-black text-mist-50">Finding players…</h2>
          <p className="mt-1 text-[0.8rem] font-medium text-mist-400">
            {courses.find((c) => c.id === status?.queue_course_id)?.title ?? 'The course bank'} · expanding the search as you wait
          </p>
          <div className="mx-auto mt-5 max-w-xs">
            <div className="flex items-end justify-between text-[0.72rem] font-extrabold text-mist-300">
              <span>{Math.max(waiting, 1)} found</span>
              <span className="text-mist-500">aiming for {queueTarget}</span>
            </div>
            <ProgressBar className="mt-1.5" value={Math.min(100, (Math.max(waiting, 1) / queueTarget) * 100)} />
            <p className="mt-2 text-[0.64rem] font-semibold text-mist-600">
              A match starts as soon as {meta?.min_players ?? 2} players are ready — you will never wait for a full {meta?.match_size ?? 15}.
            </p>
          </div>
          <Button variant="outline" className="mt-5" onClick={cancelQueue} icon={<X className="size-4" />}>
            Cancel
          </Button>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------ lobby */
  if (phase === 'lobby' && match) {
    return (
      <div className="w-full space-y-4 p-3 sm:p-4">
        <Card className="mx-auto max-w-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <SignalHigh className="size-4 text-mint-300" />
            <h2 className="text-[1rem] font-extrabold text-mist-50">Match found</h2>
            <span className="ml-auto font-display text-[1.3rem] font-black text-nova-200">{Math.max(0, lobbySecondsLeft)}s</span>
          </div>
          <p className="mt-1 text-[0.78rem] font-medium text-mist-400">
            {match.course_title} · {match.questions_total || match.question_count} questions · {match.per_question_seconds}s each
          </p>
          <ProgressBar className="mt-3" value={100 - (lobbySecondsLeft / 7) * 100} />
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {match.participants.map((player) => (
              <li key={player.student_id} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
                <Avatar
                  name={player.name}
                  hue={player.avatar_hue}
                  initials={player.initials}
                  size={38}
                  photo={{id: player.student_id, has: player.has_photo}}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[0.78rem] font-extrabold text-mist-100">
                    <ConnectionDot connected={player.connected} />
                    <span className="truncate">{player.name}</span>
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <TierBadge tier={player.tier} tierName={player.tier_name} />
                    <span className="text-[0.6rem] font-bold text-mist-500">Lv {player.level}</span>
                  </div>
                </div>
                <span title="Ready"><Check className="size-4 shrink-0 text-mint-300" /></span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-[0.68rem] font-semibold text-mist-600">Starting on the server clock — hold tight.</p>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------ live match */
  if (phase === 'live' && match) {
    const question = window_?.question ?? null;
    const options = question ? Object.entries(question.options as Record<string, string>) : [];
    const correctLabel = reveal?.correct ?? null;
    const iAnswered = myPick != null;
    const myPositionChip = myPlace ? (
      <span className="flex items-center gap-1 rounded-full border border-nova-400/30 bg-nova-400/10 px-2.5 py-1 text-[0.66rem] font-extrabold text-nova-200">
        <ChevronUp className="size-3" /> {ordinal(myPlace)} of {standings.length}
      </span>
    ) : null;

    return (
      <div className="w-full space-y-3 p-3 sm:p-4">
        {/* compact header */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8rem] font-extrabold text-mist-100">{match.course_title}</p>
            <p className="text-[0.62rem] font-bold text-mist-500">
              Question {(window_?.index ?? match.round_index) + 1} of {window_?.total ?? match.questions_total}
            </p>
          </div>
          {myPositionChip}
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.66rem] font-extrabold text-mist-200">
            <Zap className="size-3.5 text-gold-300" />
            {formatNumber(myRow?.score ?? 0)}
          </span>
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => { uiClick('tap'); setSheetOpen(true); }}>
            Standings
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_19rem]">
          {/* question column */}
          <div className="min-w-0 space-y-3">
            <Card className="p-4 sm:p-5">
              {question ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[0.9rem] font-black text-nova-200">{secondsLeft}s</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-nova-400 transition-all duration-300"
                        style={{width: `${Math.min(100, (secondsLeft / Math.max(1, window_?.seconds ?? 20)) * 100)}%`}}
                      />
                    </div>
                  </div>
                  <h2 className="mt-3 text-[0.98rem] font-extrabold leading-snug text-mist-50 sm:text-[1.05rem]">{question.text}</h2>
                  <div className="mt-4 grid gap-2">
                    {options.map(([letter, text]) => {
                      const picked = myPick === letter;
                      const isCorrect = reveal && correctLabel === letter;
                      const isWrongPick = reveal && picked && correctLabel !== letter;
                      return (
                        <button
                          key={letter}
                          disabled={iAnswered || !!reveal}
                          onClick={() => answer(letter)}
                          className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all active:translate-y-px disabled:opacity-60 ${
                            isCorrect
                              ? 'border-mint-400/60 bg-mint-400/12'
                              : isWrongPick
                                ? 'border-flare-400/60 bg-flare-400/12'
                                : picked
                                  ? 'border-nova-400/60 bg-nova-400/12'
                                  : 'border-white/10 bg-white/4 hover:border-white/25 hover:bg-white/8'
                          }`}
                        >
                          <span className="grid size-7 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/6 font-display text-[0.72rem] font-black text-mist-200">
                            {letter}
                          </span>
                          <span className="text-[0.84rem] font-semibold text-mist-100">{text}</span>
                          {isCorrect && <Check className="ml-auto size-4 shrink-0 text-mint-300" />}
                          {isWrongPick && <X className="ml-auto size-4 shrink-0 text-flare-300" />}
                        </button>
                      );
                    })}
                  </div>
                  {iAnswered && !reveal && (
                    <p className="mt-3 flex items-center gap-2 text-[0.72rem] font-bold text-mist-400">
                      <Loader2 className="size-3.5 animate-spin" /> Answer locked — waiting for the room.
                    </p>
                  )}
                </>
              ) : reveal ? (
                <div>
                  <p className="text-[0.72rem] font-extrabold text-mist-500">Answer</p>
                  <p className={`mt-1 font-display text-[1.05rem] font-black ${reveal.correct_ids.includes(meId) ? 'text-mint-300' : 'text-flare-300'}`}>
                    {reveal.correct_ids.includes(meId) ? 'Correct' : 'Not this time'}
                    {reveal.explanation ? '' : ''}
                  </p>
                  {reveal.explanation && <p className="mt-2 text-[0.8rem] font-medium leading-relaxed text-mist-300">{reveal.explanation}</p>}
                  <p className="mt-3 text-[0.7rem] font-bold text-mist-500">
                    {reveal.answered} of {standings.length} answered · next question on the server clock
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 py-10 text-[0.8rem] font-bold text-mist-500">
                  <Loader2 className="size-4 animate-spin" /> Waiting for the next question…
                </div>
              )}
            </Card>
          </div>

          {/* standings sidebar (desktop) */}
          <Card className="hidden max-h-[34rem] overflow-hidden p-0 lg:flex lg:flex-col">
            <StandingsList standings={standings} meId={meId} />
            <ActivityFeed items={match.activity ?? []} />
          </Card>
        </div>

        {/* standings bottom sheet (mobile) */}
        <AnimatePresence>
          {sheetOpen && (
            <motion.div
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              className="fixed inset-0 z-50 flex items-end bg-ink-950/70 backdrop-blur-sm lg:hidden"
              onClick={() => setSheetOpen(false)}
            >
              <motion.div
                initial={{y: '100%'}}
                animate={{y: 0}}
                exit={{y: '100%'}}
                transition={{type: 'spring', damping: 28, stiffness: 300}}
                className="max-h-[70vh] w-full overflow-hidden rounded-t-3xl border-t border-white/10 bg-ink-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
                <StandingsList standings={standings} meId={meId} onSheetClose={() => setSheetOpen(false)} />
                <ActivityFeed items={match.activity ?? []} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  /* ------------------------------------------------------ results */
  if (phase === 'results') {
    const position = myRating?.position ?? myPlace ?? 0;
    const players = standings.length;
    return (
      <div className="w-full space-y-4 p-3 sm:p-4">
        <Card className="mx-auto max-w-xl p-5 text-center sm:p-7">
          <div className="mx-auto grid size-16 place-items-center rounded-3xl brand-gradient text-white shadow-lg shadow-nova-500/20">
            <Trophy className="size-7" />
          </div>
          <h2 className="game-title mt-3 font-display text-[1.5rem] font-black tracking-tight">
            {ordinal(position)} of {players}
          </h2>
          {myRating && (
            <p className="mt-2 flex items-center justify-center gap-2 text-[0.95rem] font-extrabold">
              <span className="text-mist-400">{formatNumber(myRating.before)}</span>
              <span className="mx-1.5 text-mist-600">→</span>
              <span className="text-mist-50">{formatNumber(myRating.after)}</span>
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.76rem] ${myRating.delta >= 0 ? 'bg-mint-400/12 text-mint-300' : 'bg-flare-400/12 text-flare-300'}`}>
                {myRating.delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {myRating.delta >= 0 ? '+' : ''}
                {myRating.delta}
              </span>
            </p>
          )}
          {status && <div className="mt-2 flex items-center justify-center"><TierBadge tier={status.tier} tierName={status.tier_name} /></div>}
          <div className="mt-5 grid grid-cols-3 gap-2">
            <StatTile label="Score" value={formatNumber(myRow?.score ?? 0)} />
            <StatTile label="Accuracy" value={`${accuracy}%`} />
            <StatTile label="Correct" value={`${correctTotal}/${answeredTotal || 0}`} />
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={openReview} icon={<Eye className="size-4" />}>
              View answers
            </Button>
            <Button variant="ghost" onClick={backToIdle} icon={<ArrowLeft className="size-4" />}>
              Back to ranked
            </Button>
            <Button onClick={playAgain} icon={<RefreshCw className="size-4" />}>
              Play again
            </Button>
          </div>
        </Card>

        <Card className="mx-auto max-w-xl p-4 sm:p-5">
          <h3 className="text-[0.9rem] font-extrabold text-mist-50">Final standings</h3>
          <ul className="mt-3 space-y-1.5">
            {standings.map((player, index) => (
              <PlayerRow key={player.student_id} player={{...player, position: player.position ?? index + 1}} meId={meId} showPlace />
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------ review */
  if (phase === 'review' && review) {
    return (
      <div className="w-full space-y-4 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPhase('results')} icon={<ArrowLeft className="size-4" />}>
            Back to results
          </Button>
        </div>
        {review.length === 0 && <EmptyState icon={<Eye className="size-6" />} title="No answers recorded" detail="This match had no questions." />}
        <ul className="space-y-3">
          {review.map((item) => {
            const q = item.question as QuestionPublic & {correct?: string; explanation?: string};
            return (
              <Card key={item.index} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[0.7rem] font-black text-mist-500">Q{item.index + 1}</span>
                  <span className={`text-[0.66rem] font-extrabold ${item.correct ? 'text-mint-300' : 'text-flare-300'}`}>
                    {item.correct ? 'Correct' : item.selected ? 'Wrong' : 'Skipped'} · +{item.points}
                  </span>
                </div>
                <p className="mt-1.5 text-[0.86rem] font-bold leading-snug text-mist-100">{q.text}</p>
                <ReviewOptions options={q.options as Record<string, string>} correct={q.correct_label ?? q.correct} chosen={item.selected} />
                {q.explanation && <p className="mt-1.5 text-[0.76rem] font-medium leading-relaxed text-mist-400">{q.explanation}</p>}
                <p className="mt-2 text-[0.7rem] font-bold text-mist-500">
                  Your answer: {item.selected ?? '—'} · Correct: {q.correct_label ?? q.correct ?? '—'}
                </p>
              </Card>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <EmptyState
      icon={<Swords className="size-6" />}
      title="Ranked"
      detail="Queue up to find opponents."
      action={<Button onClick={backToIdle}>Back to ranked</Button>}
    />
  );
}
