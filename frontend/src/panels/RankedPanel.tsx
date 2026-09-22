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
import RankedTeams from './RankedTeams';
import {AnimatePresence, motion} from 'motion/react';
import {ArrowLeft, ArrowRight, Award, BookOpen, Brain, Calculator, Check, ChevronUp, Cpu, Crown, Eye, FileText, Flame, FlaskConical, Globe2, GraduationCap, Landmark, ListChecks, Loader2, Lock, Medal, Microscope, Radio, RefreshCw, Scale, Send, SignalHigh, SkipForward, Swords, TrendingDown, TrendingUp, Trophy, Users, X, Zap} from 'lucide-react';
import {Avatar, Button, Card, Chip, EmptyState, ProgressBar, ReviewOptions, Skeleton, StatTile, Segmented} from '../components/ui';
import RankedBadge, {RankedTierPill} from '../components/RankedBadge';
import {api, tokenStore} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {sfx, uiClick} from '../lib/sfx';
import {LiveSocket} from '../lib/ws';
import {useSession} from '../store/session';
import type {
  Course,
  QuestionPublic,
  RankedCourseStat,
  RankedFinishPayload,
  RankedHistoryRow,
  RankedLadder,
  RankedMatchState,
  RankedMeta,
  RankedPlayer,
  RankedQuestionWindow,
  RankedReveal,
  RankedStatus,
  RankedTier,
  RankedChatLine,
  ReviewItem,
} from '../lib/types';

type Phase = 'loading' | 'idle' | 'queue' | 'lobby' | 'live' | 'results' | 'review';

const QUEUE_REFRESH_MS = 2000;

/* Course picker dressing: every course gets a stable icon (keyed off its id)
   and wears its own accent colour so the grid reads at a glance. Accents are
   hex pairs (deep → bright) so cards can paint real gradients and glows. */
const COURSE_ICONS = [BookOpen, FlaskConical, Calculator, Globe2, Cpu, Scale, Landmark, Microscope, Brain, GraduationCap];
const COURSE_ACCENTS: Record<string, {deep: string; bright: string}> = {
  red: {deep: '#92145a', bright: '#ff7ab3'},
  violet: {deep: '#6d28d9', bright: '#c9a8fc'},
  blue: {deep: '#1d4ed8', bright: '#7cc0ff'},
  amber: {deep: '#a06b00', bright: '#ffd75e'},
};
const FALLBACK_ACCENT = COURSE_ACCENTS.violet;

function courseIcon(course: Course) {
  return COURSE_ICONS[course.id % COURSE_ICONS.length];
}

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
  /** Raw server-synced time — may sit in the past (used to measure queue waits). */
  const now = useCallback(() => Date.now() - offsetRef.current, []);
  return {sync, remaining, now};
}

function ConnectionDot({connected}: {connected: boolean}) {
  return (
    <span
      title={connected ? 'Connected' : 'Reconnecting'}
      className={`inline-block size-2 shrink-0 rounded-full ${connected ? 'bg-mint-400 shadow-[0_0_6px] shadow-mint-400/60' : 'bg-mist-600'}`}
    />
  );
}

function TierBadge({tier, tierName}: {tier: RankedTier | undefined; tierName: string}) {
  /* Full metal-shield art when the tier list has loaded; a tinted text tag
     keeps the row readable until then. */
  if (tier) return <RankedTierPill tier={tier} />;
  return (
    <span className="rounded-full border border-white/14 bg-white/6 px-2 py-0.5 text-[0.6rem] font-extrabold tracking-wide text-mist-300">
      {tierName}
    </span>
  );
}

/* Ranked-mode dressing for the course picker: every card reads like a collectible
   arena — rarity comes from how deep the approved question bank is, "heat" comes
   from the live queue and the last 7 days of matches, and the record line is the
   player's own head-to-head in that course. All numbers are server-computed
   (`/ranked/course-stats`); an empty bank means the server can never deal from
   that course, so those cards lock themselves. */
const DECK_RARITY = [
  {min: 40, label: 'LEGENDARY', color: '#ffd75e'},
  {min: 24, label: 'EPIC', color: '#c9a8fc'},
  {min: 12, label: 'RARE', color: '#7cc0ff'},
  {min: 1, label: 'COMMON', color: '#a5b4fc'},
];

function RankedCourseCard({
  course,
  stat,
  selected,
  onSelect,
}: {
  course: Course;
  stat: RankedCourseStat | undefined;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const Icon = courseIcon(course);
  const accent = COURSE_ACCENTS[course.accent] ?? FALLBACK_ACCENT;
  const bank = course.question_count ?? 0;
  const locked = bank === 0;
  const rarity = DECK_RARITY.find((r) => bank >= r.min) ?? null;
  const inQueue = stat?.in_queue ?? 0;
  const hot = stat?.matches_7d ?? 0;
  const played = stat?.played ?? 0;
  const wins = stat?.wins ?? 0;
  const deckPct = Math.max(6, Math.min(100, Math.round((bank / 40) * 100)));
  const flavour = course.description || (course.lecturer ? `Taught by ${course.lecturer}` : '');
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => {
        uiClick('select');
        onSelect(course.id);
      }}
      aria-pressed={selected}
      className={`group relative block w-full min-w-0 overflow-hidden rounded-[1.35rem] border text-left transition-all duration-200 active:translate-y-px ${
        locked
          ? 'cursor-not-allowed border-white/8 bg-white/[0.02] opacity-60'
          : selected
            ? ''
            : 'border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06] hover:shadow-[0_18px_38px_-20px_rgba(0,0,0,0.8)]'
      }`}
      style={
        selected
          ? {
              borderColor: `${accent.bright}99`,
              background: `linear-gradient(140deg, ${accent.deep}33, rgba(255,255,255,0.04) 52%)`,
              boxShadow: `0 0 0 1px ${accent.bright}66, 0 20px 44px -20px ${accent.bright}aa`,
            }
          : undefined
      }
    >
      {/* Arena plating: scanlines over the header + a light sweep on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-14 opacity-[0.05]"
        style={{backgroundImage: 'repeating-linear-gradient(180deg, #fff 0 1px, transparent 1px 5px)'}}
      />
      {!locked && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 h-px w-1/3 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent opacity-0 transition-all duration-700 group-hover:translate-x-[300%] group-hover:opacity-100"
        />
      )}
      <div className="relative flex min-w-0 items-start gap-3 p-3.5 pb-2.5">
        <span
          aria-hidden
          className="relative grid size-12 shrink-0 place-items-center rounded-2xl border border-white/20"
          style={{
            background: `linear-gradient(150deg, ${accent.bright}, ${accent.deep})`,
            boxShadow: `0 10px 22px -12px ${accent.deep}, inset 0 1px 0 rgba(255,255,255,0.35)`,
          }}
        >
          <Icon className="size-6 text-white drop-shadow" />
          {selected && !locked && (
            <span
              className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-white/40"
              style={{background: accent.bright, color: '#171030'}}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate font-display text-[0.92rem] font-extrabold text-mist-50">{course.title}</h3>
            <span
              className="shrink-0 rounded-md border px-1.5 py-0.5 text-[0.5rem] font-black tracking-[0.14em] uppercase"
              style={
                rarity
                  ? {color: rarity.color, borderColor: `${rarity.color}55`, background: `${rarity.color}14`, boxShadow: `0 0 12px -6px ${rarity.color}`}
                  : {color: '#94a3b8', borderColor: 'rgba(148,163,184,0.3)', background: 'rgba(148,163,184,0.08)'}
              }
            >
              {rarity?.label ?? 'NO BANK'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[0.6rem] font-black tracking-[0.16em] uppercase" style={{color: accent.bright}}>
            {course.code} · {course.semester}
            {course.credit_units > 0 ? ` · ${course.credit_units} CU` : ''}
          </p>
          {flavour && <p className="mt-1 line-clamp-1 min-w-0 text-[0.7rem] font-medium break-words text-mist-400">{flavour}</p>}
        </div>
      </div>
      {/* Heat + head-to-head: the row that makes it feel like a ladder, not a syllabus. */}
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3.5">
        {locked ? (
          <span className="inline-flex items-center gap-1 text-[0.58rem] font-black tracking-[0.1em] text-mist-500 uppercase">
            <Lock className="size-3" /> bank empty — staff must approve questions
          </span>
        ) : inQueue > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-mint-400/35 bg-mint-400/10 px-2 py-0.5 text-[0.56rem] font-black tracking-[0.1em] text-mint-300 uppercase">
            <span aria-hidden className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-400 opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-mint-400" />
            </span>
            {inQueue} in queue now
          </span>
        ) : hot > 0 ? (
          <span className="inline-flex items-center gap-1 text-[0.58rem] font-black tracking-[0.1em] uppercase" style={{color: '#ff7ab3'}}>
            <Flame className="size-3" /> {hot} match{hot === 1 ? '' : 'es'} this week
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[0.58rem] font-black tracking-[0.1em] text-gold-300 uppercase">
            <Zap className="size-3" /> fresh arena — be first
          </span>
        )}
        <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-[0.62rem] font-black tabular text-mist-300">
          {played > 0 ? (
            <>
              <Trophy className="size-3 shrink-0 text-gold-300" />
              <span className="text-mint-300">{wins}W</span>
              <span className="text-mist-600">–</span>
              <span className="text-flare-300">{played - wins}L</span>
              {stat?.best ? <span className="text-[0.56rem] font-bold text-mist-500">· best {ordinal(stat.best)}</span> : null}
            </>
          ) : (
            !locked && <span className="text-[0.56rem] font-bold text-mist-600 normal-case">unranked here — make your mark</span>
          )}
        </span>
      </div>
      {/* Stat meters: deck depth bar, exam papers, current form in this arena. */}
      <div className="relative mt-2.5 grid grid-cols-3 border-t border-white/8 bg-black/20 py-2">
        <div className="min-w-0 px-3.5">
          <p className="flex items-center gap-1 text-[0.5rem] font-black tracking-[0.16em] text-mist-600 uppercase">
            <ListChecks className="size-2.5 shrink-0" /> Deck
          </p>
          <p className="font-display text-[0.82rem] leading-tight font-black text-mist-50 tabular">
            {bank}
            <span className="ml-1 text-[0.54rem] font-bold text-mist-500">Q</span>
          </p>
          <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-white/8">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{width: `${deckPct}%`, background: `linear-gradient(90deg, ${accent.deep}, ${accent.bright})`}}
            />
          </span>
        </div>
        <div className="min-w-0 border-l border-white/8 px-3 py-2">
          <p className="flex items-center gap-1 text-[0.5rem] font-black tracking-[0.16em] text-mist-600 uppercase">
            <FileText className="size-2.5 shrink-0" /> Papers
          </p>
          <p className="font-display text-[0.82rem] leading-tight font-black text-mist-50 tabular">
            {course.quiz_count ?? 0}
            <span className="ml-1 text-[0.54rem] font-bold text-mist-500">exam{(course.quiz_count ?? 0) === 1 ? '' : 's'}</span>
          </p>
          <span aria-hidden className="mt-1 block h-1 rounded-full bg-white/8" />
        </div>
        <div className="min-w-0 border-l border-white/8 px-3 py-2">
          <p className="flex items-center gap-1 text-[0.5rem] font-black tracking-[0.16em] text-mist-600 uppercase">
            <Award className="size-2.5 shrink-0" /> Form
          </p>
          <p className="font-display text-[0.82rem] leading-tight font-black text-mist-50 tabular">
            {played > 0 ? `${Math.round((wins / played) * 100)}%` : '—'}
            <span className="ml-1 text-[0.54rem] font-bold text-mist-500">{played > 0 ? `of ${played}` : 'unranked'}</span>
          </p>
          <span aria-hidden className="mt-1 block h-1 rounded-full bg-white/8" />
        </div>
      </div>
      <div className="relative flex min-w-0 items-center justify-between gap-2 border-t border-white/8 bg-black/25 px-3.5 py-2">
        {selected && !locked && (
          <span
            aria-hidden
            className="absolute inset-x-0 -top-px h-[3px]"
            style={{background: `linear-gradient(90deg, transparent, ${accent.bright}, transparent)`, boxShadow: `0 0 14px ${accent.bright}`}}
          />
        )}
        <p className="min-w-0 truncate text-[0.56rem] font-bold text-mist-600">
          {locked
            ? 'not playable yet'
            : `server-dealt set · rating moves every result${course.created_at ? ` · added ${formatRelative(course.created_at)}` : ''}`}
        </p>
        {locked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-2.5 py-1 text-[0.58rem] font-black tracking-[0.14em] text-mist-500 uppercase">
            <Lock className="size-3" /> Locked
          </span>
        ) : selected ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[0.58rem] font-black tracking-[0.14em] uppercase"
            style={{background: `linear-gradient(135deg, ${accent.bright}, ${accent.deep})`, color: '#171030', boxShadow: `0 6px 16px -8px ${accent.bright}`}}
          >
            Armed <ArrowRight className="size-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[0.58rem] font-black tracking-[0.14em] text-mist-400 uppercase transition-colors group-hover:border-white/35 group-hover:text-mist-200">
            Select
          </span>
        )}
      </div>
    </button>
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
        {standings.map((player, index) => (
          <PlayerRow key={player.student_id} player={{...player, position: player.position || index + 1}} meId={meId} showPlace />
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

function RankedSoloPanel() {
  const {profile, on, toast} = useSession();
  const meId = profile?.id ?? 0;
  const clock = useServerClock();

  const [phase, setPhase] = useState<Phase>('loading');
  const [meta, setMeta] = useState<RankedMeta | null>(null);
  const [status, setStatus] = useState<RankedStatus | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [courseStats, setCourseStats] = useState<Record<string, RankedCourseStat>>({});
  const [matchId, setMatchId] = useState<number | null>(null);
  const [match, setMatch] = useState<RankedMatchState | null>(null);
  const [window_, setWindow] = useState<RankedQuestionWindow | null>(null);
  const [reveal, setReveal] = useState<RankedReveal | null>(null);
  const [myPick, setMyPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finish, setFinish] = useState<RankedFinishPayload | null>(null);
  const [history, setHistory] = useState<RankedHistoryRow[]>([]);
  const [ladder, setLadder] = useState<RankedLadder | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /* Lobby chat: relayed by the ranked socket, never persisted. */
  const [lobbyChat, setLobbyChat] = useState<RankedChatLine[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const lobbyChatMatchId = useRef<number | null>(null);
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
    const [metaPayload, historyPayload, ladderPayload, statsPayload] = await Promise.all([
      api.rankedMeta().catch(() => null),
      api.rankedHistory().catch(() => ({history: []})),
      api.rankedLadder().catch(() => null),
      api.rankedCourseStats().catch(() => ({stats: {}})),
    ]);
    setMeta(metaPayload);
    setHistory(historyPayload.history);
    setLadder(ladderPayload);
    setCourseStats(statsPayload.stats);
  }, []);

  const applyState = useCallback(
    (state: RankedMatchState) => {
      /* Fresh match = fresh lobby chat. */
      if (lobbyChatMatchId.current !== null && lobbyChatMatchId.current !== state.id) setLobbyChat([]);
      lobbyChatMatchId.current = state.id;
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
      // Open an arena by default — but never a locked one (an empty bank
      // can't be dealt from; the server would keep the queue waiting forever).
      const firstOpen = coursesPayload.find((c) => (c.question_count ?? 0) > 0) ?? coursesPayload[0];
      if (courseId === null && firstOpen) setCourseId(firstOpen.id);
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
    return () => window.clearInterval(poll);
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
          case 'ranked_chat': {
            const event = data as {match_id: number; student_id: number; name: string; body: string};
            setLobbyChat((current) => [
              ...current.slice(-79),
              {key: `${event.student_id}-${current.length}-${event.body.length}`, student_id: event.student_id, name: event.name, body: event.body, mine: event.student_id === meId},
            ]);
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
    setLobbyChat([]);
    setPhase('idle');
    void loadIdle();
  };

  /** Lobby chat rides the ranked socket; the server gates it to the lobby. */
  const sendLobbyChat = () => {
    const body = chatDraft.trim();
    if (!body || !socketRef.current) return;
    socketRef.current.send({type: 'chat', body});
    setChatDraft('');
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({block: 'end'});
  }, [lobbyChat]);

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

  const skip = async () => {
    if (!matchId || !window_ || myPick || busy || reveal) return;
    uiClick('cancel');
    setMyPick('SKIP');
    setBusy(true);
    try {
      const result = await api.rankedSkip(matchId);
      sfx.play('whoosh');
      if (result.reveal) setReveal(result.reveal);
      if (result.match) setMatch(result.match);
    } catch (error) {
      setMyPick(null);
      toast('error', 'Could not skip', (error as Error).message);
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
  const waiting = status?.waiting ?? 0;

  /* Badge art for any tier key, straight from the server's ladder. */
  const tierByKey = useMemo(() => {
    const map = new Map<string, RankedTier>();
    for (const tier of meta?.tiers ?? []) map.set(tier.key, tier);
    return map;
  }, [meta]);
  const tierOf = (key: string | undefined | null) => (key ? tierByKey.get(key) : undefined);
  const myTier = tierOf(status?.tier);
  const nextTier = useMemo(() => {
    if (!meta || status == null) return undefined;
    return meta.tiers.find((tier) => tier.min > status.rating);
  }, [meta, status]);

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
    const heroBright = myTier?.bright ?? '#a855f7';
    const queueTotal = Object.values(courseStats).reduce((sum, s) => sum + (s.in_queue || 0), 0);
    return (
      <div className="w-full min-w-0 space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Swords className="size-5 text-nova-300" />
          <h1 className="font-display text-[1.15rem] font-black tracking-tight text-mist-50 sm:text-[1.35rem]">Ranked</h1>
          {status && <TierBadge tier={myTier} tierName={status.tier_name} />}
        </div>
        <p className="max-w-2xl text-[0.82rem] font-medium text-mist-400">
          Same questions, one shared clock, live standings. Your rating moves with every result — accuracy
          always outweighs a fast click. Higher tiers play longer sets on a tighter clock, fast answers pay
          bonus XP, and you can skip a question you would rather not guess.
        </p>

        {/* Your standing: the badge you currently hold and the climb to the next one. */}
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{background: `radial-gradient(560px 190px at 18% -30%, ${heroBright}2e, transparent 70%)`}}
          />
          <div className="relative flex items-center gap-3.5 sm:gap-4">
            {myTier ? (
              <RankedBadge tier={myTier} size="lg" current />
            ) : (
              <span className="grid size-18 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/4">
                <Trophy className="size-8 text-mist-500" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] font-black tracking-[0.18em] text-mist-500 uppercase">Your rank</p>
              <p className="mt-0.5 truncate font-display text-[1.2rem] leading-tight font-black text-mist-50 sm:text-[1.35rem]">
                {myTier?.name ?? status?.tier_name ?? 'Unranked'}
              </p>
              {nextTier ? (
                <p className="mt-0.5 text-[0.68rem] font-bold text-mist-400">
                  <span className="tabular">{Math.max(0, nextTier.min - (status?.rating ?? 1000))}</span> rating to{' '}
                  <span style={{color: nextTier.bright}}>{nextTier.name}</span>
                </p>
              ) : (
                <p className="mt-0.5 text-[0.68rem] font-bold text-gold-300">Top of the ladder — defend the crown.</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-[1.6rem] leading-none font-black text-mist-50 tabular sm:text-[1.9rem]">
                {formatNumber(status?.rating ?? 1000)}
              </p>
              <p className="mt-1 text-[0.6rem] font-black tracking-[0.18em] text-mist-500 uppercase">Rating</p>
            </div>
          </div>
          {nextTier && myTier && (
            <div className="relative mt-3.5">
              <ProgressBar
                value={Math.max(2, Math.min(98, Math.round(((status?.rating ?? 1000) - myTier.min) / Math.max(1, nextTier.min - myTier.min)) * 100))}
              />
              <div className="mt-1.5 flex items-center justify-between text-[0.58rem] font-bold text-mist-500">
                <span className="tabular">{myTier.min}</span>
                <span className="tabular">{nextTier.min}</span>
              </div>
            </div>
          )}
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Rating" value={formatNumber(status?.rating ?? 1000)} hint={status?.tier_name ?? 'Bronze III'} />
          <StatTile label="Matches" value={String(status?.played ?? 0)} hint={`${status?.won ?? 0} won`} />
          <StatTile label="Players per match" value={`${meta?.min_players ?? 2}–${meta?.match_size ?? 15}`} hint="server-matchmade" />
        </div>

        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[0.95rem] font-extrabold text-mist-50">Find a match</h2>
            <Chip className="border-nova-500/30 bg-nova-500/12 text-nova-300" icon={<SignalHigh className="size-3" />}>
              {courses.length} arena{courses.length === 1 ? '' : 's'} open
            </Chip>
            {queueTotal > 0 && (
              <Chip className="border-mint-400/35 bg-mint-400/10 text-mint-300" icon={<Flame className="size-3" />}>
                {queueTotal} player{queueTotal === 1 ? '' : 's'} queueing now
              </Chip>
            )}
          </div>
          <p className="mt-1 text-[0.78rem] font-medium text-mist-500">
            Pick a course and the server will find opponents. Every card shows the bank you will be quizzed from.
          </p>
          <div className="mt-3 grid min-w-0 gap-2.5 sm:grid-cols-2">
            {courses.map((course) => (
              <RankedCourseCard
                key={course.id}
                course={course}
                stat={courseStats[String(course.id)]}
                selected={courseId === course.id}
                onSelect={setCourseId}
              />
            ))}
          </div>
          <Button
            className="mt-4 w-full"
            size="lg"
            loading={busy}
            disabled={courseId == null || (courses.find((c) => c.id === courseId)?.question_count ?? 0) === 0}
            onClick={findMatch}
            icon={<TrendingUp className="size-4" />}
          >
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
                  <TierBadge tier={tierOf(row.tier)} tierName={row.tier_name} />
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
          </Card>
        )}

        {/* The full fifteen-badge ladder: every division, its gate and its rules. */}
        {meta && meta.tiers.length > 0 && (
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Crown className="size-4 text-gold-300" />
              <h2 className="font-display text-[0.95rem] font-extrabold text-mist-50">The ranked ladder</h2>
              <Chip className="border-gold-400/30 bg-gold-400/12 text-gold-200" icon={<Medal className="size-3" />}>
                {meta.tiers.length} badges
              </Chip>
            </div>
            <p className="mt-1 text-[0.72rem] font-medium text-mist-500">
              Win matches to climb divisions. Each metal plays its own shape — higher badges mean longer sets on a tighter clock.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {meta.tiers.map((tier) => {
                const isMe = status?.tier === tier.key;
                const reached = (status?.rating ?? 1000) >= tier.min;
                const rules = meta.tier_rules?.[tier.key];
                return (
                  <div
                    key={tier.key}
                    className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center ${
                      isMe ? '' : 'border-white/8 bg-white/[0.025]'
                    }`}
                    style={isMe ? {borderColor: `${tier.bright}88`, background: `${tier.bright}14`} : undefined}
                  >
                    <RankedBadge tier={tier} size="md" current={isMe} locked={!reached} />
                    <p className="w-full truncate text-[0.62rem] font-black text-mist-100">{tier.name}</p>
                    <p className="text-[0.54rem] font-bold text-mist-500 tabular">
                      {tier.min}+{rules ? ` · ${rules.questions}Q/${rules.seconds}s` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------ queue */
  if (phase === 'queue') {
    const queuePlayers = status?.queue_players ?? [];
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
          <QueueMeter waiting={waiting} meta={meta} status={status} clock={clock} />

          {/* Everyone standing in the queue with you — live, oldest first. */}
          {queuePlayers.length > 0 && (
            <div className="mt-5 text-left">
              <p className="flex items-center justify-between text-[0.62rem] font-black tracking-[0.18em] text-mist-500 uppercase">
                In the queue
                <span className="tabular">{queuePlayers.length}</span>
              </p>
              <ul className="mt-2 space-y-1.5">
                {queuePlayers.map((player) => (
                  <li key={player.student_id} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-2.5 py-2">
                    <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={32} photo={{id: player.student_id, has: player.has_photo}} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.76rem] font-extrabold text-mist-100">
                        {player.name}
                        {player.student_id === meId && <span className="ml-1.5 text-[0.6rem] font-black tracking-wider text-nova-300">You</span>}
                      </p>
                      <p className="text-[0.6rem] font-bold text-mist-500">Lv {player.level} · {formatNumber(player.rating)} rating</p>
                    </div>
                    <TierBadge tier={tierOf(player.tier)} tierName={player.tier_name} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="outline" className="mt-5" onClick={cancelQueue} icon={<X className="size-4" />}>
            Cancel
          </Button>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------ lobby */
  if (phase === 'lobby' && match) {
    const lobbyTotal = Math.max(1, match.lobby_seconds ?? 12);
    return (
      <div className="w-full space-y-4 p-3 sm:p-4">
        <Card className="mx-auto max-w-3xl p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <SignalHigh className="size-4 text-mint-300" />
            <h2 className="text-[1rem] font-extrabold text-mist-50">Match found</h2>
            <span className="ml-auto font-display text-[1.3rem] font-black text-nova-200 tabular">{Math.max(0, lobbySecondsLeft)}s</span>
          </div>
          <p className="mt-1 text-[0.78rem] font-medium text-mist-400">
            {match.course_title} · {match.questions_total || match.question_count} questions · {match.per_question_seconds}s each
          </p>
          <ProgressBar className="mt-3" value={100 - (Math.min(lobbySecondsLeft, lobbyTotal) / lobbyTotal) * 100} />

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_1fr] lg:gap-4">
            {/* The fighters: who joined, their face and their rank. */}
            <div className="min-w-0">
              <p className="text-[0.62rem] font-black tracking-[0.18em] text-mist-500 uppercase">Players · {match.participants.length}</p>
              <ul className="mt-2 grid gap-2">
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
                        {player.student_id === meId && <span className="text-[0.6rem] font-black tracking-wider text-nova-300">You</span>}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <TierBadge tier={tierOf(player.tier)} tierName={player.tier_name} />
                        <span className="text-[0.6rem] font-bold text-mist-500">Lv {player.level}</span>
                      </div>
                    </div>
                    <span title="Ready"><Check className="size-4 shrink-0 text-mint-300" /></span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Lobby chat: open until the first question fires. */}
            <div className="flex min-w-0 flex-col rounded-2xl border border-white/8 bg-white/[0.03]">
              <p className="border-b border-white/8 px-3 py-2 text-[0.62rem] font-black tracking-[0.18em] text-mist-500 uppercase">
                Lobby chat
              </p>
              <div className="min-h-[9rem] flex-1 space-y-1.5 overflow-y-auto px-3 py-2.5" style={{maxHeight: '16rem'}}>
                {lobbyChat.length === 0 && (
                  <p className="text-[0.68rem] font-medium text-mist-600">Say good luck — chat locks the moment questions start.</p>
                )}
                {lobbyChat.map((line) => (
                  <p key={line.key} className="text-[0.72rem] leading-snug font-medium break-words text-mist-300">
                    <span className={`font-extrabold ${line.mine ? 'text-nova-300' : 'text-gold-300'}`}>{line.mine ? 'You' : line.name}</span>{' '}
                    {line.body}
                  </p>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="flex items-center gap-1.5 border-t border-white/8 p-2">
                <input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      sendLobbyChat();
                    }
                  }}
                  maxLength={300}
                  placeholder="Good luck everyone…"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[0.76rem] font-semibold text-mist-100 outline-none placeholder:text-mist-600 focus:border-nova-400/50"
                />
                <Button size="sm" onClick={sendLobbyChat} disabled={!chatDraft.trim()} icon={<Send className="size-3.5" />}>
                  Send
                </Button>
              </div>
            </div>
          </div>
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
                  <QuestionClock window_={window_} clock={clock} />
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
                      <Loader2 className="size-3.5 animate-spin" />{' '}
                      {myPick === 'SKIP' ? 'Skipped — waiting for the room.' : 'Answer locked — waiting for the room.'}
                    </p>
                  )}
                  {!iAnswered && !reveal && (
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => void skip()}
                        className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[0.7rem] font-bold text-mist-400 transition-colors touch-manipulation hover:border-white/25 hover:text-mist-200"
                      >
                        <SkipForward className="size-3.5" /> Skip this question
                      </button>
                    </div>
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
          {myTier ? (
            <div className="flex justify-center">
              <RankedBadge tier={myTier} size="lg" current />
            </div>
          ) : (
            <div className="mx-auto grid size-16 place-items-center rounded-3xl brand-gradient text-white shadow-lg shadow-nova-500/20">
              <Trophy className="size-7" />
            </div>
          )}
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
          {myRating?.xp != null && (
            <p className="mt-1.5 text-[0.72rem] font-bold text-mist-400">
              +{myRating.xp} XP
              {(myRating.speed_xp ?? 0) > 0 ? ` · includes +${myRating.speed_xp} speed bonus for fast answers` : ''}
            </p>
          )}
          {status && <div className="mt-2 flex items-center justify-center"><TierBadge tier={tierOf(status.tier)} tierName={status.tier_name} /></div>}
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
              <PlayerRow key={player.student_id} player={{...player, position: player.position || index + 1}} meId={meId} showPlace />
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
                  <span className={`text-[0.66rem] font-extrabold ${item.correct ? 'text-mint-300' : item.selected && item.selected !== 'SKIP' ? 'text-flare-300' : 'text-mist-400'}`}>
                    {item.correct ? 'Correct' : item.selected && item.selected !== 'SKIP' ? 'Wrong' : 'Skipped'} · +{item.points}
                  </span>
                </div>
                <p className="mt-1.5 text-[0.86rem] font-bold leading-snug text-mist-100">{q.text}</p>
                <ReviewOptions options={q.options as Record<string, string>} correct={q.correct_label ?? q.correct} chosen={item.selected} />
                {q.explanation && <p className="mt-1.5 text-[0.76rem] font-medium leading-relaxed text-mist-400">{q.explanation}</p>}
                <p className="mt-2 text-[0.7rem] font-bold text-mist-500">
                  Your answer: {item.selected && item.selected !== 'SKIP' ? item.selected : '—'} · Correct: {q.correct_label ?? q.correct ?? '—'}
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


/* ------------------------------------------------------------ clock leaves
   These own their own tick so the 250ms/500ms countdowns re-render only this
   small subtree, never the whole panel — that is what keeps matches smooth. */
function QuestionClock({window_, clock}: {window_: RankedQuestionWindow | null; clock: {remaining: (iso: string) => number}}) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    if (!window_) return undefined;
    const tick = () => {
      if (window_.deadline) setSecondsLeft(Math.ceil(clock.remaining(window_.deadline) / 1000));
      else setSecondsLeft(Math.max(0, window_.seconds - Math.floor((Date.now() - startRef.current) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [window_, clock]);
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[0.9rem] font-black text-nova-200">{secondsLeft}s</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-nova-400 transition-all duration-300"
          style={{width: `${Math.min(100, (secondsLeft / Math.max(1, window_?.seconds ?? 20)) * 100)}%`}}
        />
      </div>
    </div>
  );
}

/**
 * The wait-timer ladder, straight from the server: the longer the oldest
 * player has waited, the fewer players a match needs — full at first, then
 * 12 → 10 → 6 → 4, and eventually whoever showed up. The meter shows the
 * rung you are on and when the next one drops.
 */
function QueueMeter({
  waiting,
  meta,
  status,
  clock,
}: {
  waiting: number;
  meta: RankedMeta | null;
  status: RankedStatus | null;
  clock: {now: () => number};
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const ladder = meta?.queue_ladder ?? [];
  const full = meta?.match_size ?? 15;
  const joinedAt = status?.queue_joined_at ? parseTime(status.queue_joined_at) : null;
  const elapsed = joinedAt != null ? Math.max(0, (clock.now() - joinedAt) / 1000) : seconds;

  // The server computes the rung from the oldest waiter in the course — trust
  // it when present; fall back to deriving it locally from our own join time.
  let target = status?.players_needed ?? full;
  if (status?.players_needed == null) {
    for (const rung of ladder) {
      if (elapsed >= rung.wait) target = rung.players;
    }
  }
  const nextDrop = ladder.find((rung) => rung.wait > elapsed && rung.players < target) ?? null;
  const mmss = (value: number) => `${Math.floor(value / 60)}:${String(Math.round(value) % 60).padStart(2, '0')}`;

  return (
    <div className="mx-auto mt-5 max-w-xs">
      <div className="flex items-end justify-between text-[0.72rem] font-extrabold text-mist-300">
        <span>{Math.max(waiting, 1)} found</span>
        <span className="text-mist-500">starts at {target} players</span>
      </div>
      <ProgressBar className="mt-1.5" value={Math.min(100, (Math.max(waiting, 1) / Math.max(1, target)) * 100)} />
      <p className="mt-2 text-[0.64rem] font-semibold text-mist-600">
        {nextDrop
          ? `Waiting ${mmss(elapsed)} — at ${mmss(nextDrop.wait)} only ${nextDrop.players} players are enough.`
          : 'Past the last rung — the match starts with whoever shows up.'}
      </p>
      <p className="mt-1 text-[0.6rem] font-semibold text-mist-700">
        The longer you wait, the fewer players you need — you will never wait forever.
      </p>
    </div>
  );
}


/* ------------------------------------------------------------------ shell
 * Ranked is a full game mode, not a button: the tab opens on a shell with two
 * wings — the solo ladder queue (unchanged engine) and the Team Ranked war
 * room (lobbies, squads, dashboard). Wing choice persists per device. */
export default function RankedPanel() {
  const [wing, setWing] = useState<'solo' | 'teams'>(() => {
    try {
      return localStorage.getItem('arena.ranked.wing') === 'teams' ? 'teams' : 'solo';
    } catch {
      return 'solo';
    }
  });
  const pick = (value: 'solo' | 'teams') => {
    setWing(value);
    try {
      localStorage.setItem('arena.ranked.wing', value);
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="min-w-0 space-y-3.5">
      <Segmented
        value={wing}
        options={[
          {value: 'solo', label: 'Solo queue', icon: Swords},
          {value: 'teams', label: 'Teams & board', icon: Users},
        ]}
        onChange={(value) => pick(value as 'solo' | 'teams')}
      />
      {wing === 'teams' ? <RankedTeams onSoloQueue={() => pick('solo')} /> : <RankedSoloPanel />}
    </div>
  );
}
