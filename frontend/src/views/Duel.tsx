/**
 * Live 1v1 duel arena over websocket: VS scoreboard, per-question speed scoring,
 * combos, real-time opponent progress and a winner celebration.
 */
import {
  ArrowLeft,
  CheckCircle2,
  Crown,
  Flame,
  Handshake,
  Hourglass,
  Link2,
  MessageCircle,
  RotateCcw,
  Send,
  Skull,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, CopyCode, ProgressBar, ReviewOptions} from '../components/ui';
import Character from '../components/Character';
import {AnswerFeedback, AnswerTile, ComboMeter} from '../components/GameQuestion';
import {victoryOf} from '../lib/cosmetics';
import {api} from '../lib/api';
import {celebrate} from '../lib/confetti';
import {HAPTICS} from '../lib/haptics';
import {sfx} from '../lib/sfx';
import {formatClock, formatNumber, formatRelative} from '../lib/format';
import {EASE} from '../lib/motion';
import {useSize} from '../lib/responsive';
import {useSession} from '../store/session';
import type {Duel, DuelPlayer, OptionKey, RewardEvent} from '../lib/types';

const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];

/*
 * The speed ladder, mirrored from the server for display only. Scoring itself
 * happens in the duel service — these numbers just draw the meter that shows a
 * player what a fast answer is still worth.
 */
const SPEED_MAX = 40;
const SPEED_WINDOW = 20;

/**
 * The points still on the table for this question. It drains as the clock runs,
 * exactly like the server's speed bonus does, and it is frozen the moment the
 * answer lands so the number stops accusing the player.
 */
function SpeedBonus({startedAt, frozen}: {startedAt: number; frozen: boolean}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [frozen]);

  const seconds = Math.min(SPEED_WINDOW, Math.max(0, (now - startedAt) / 1000));
  const bonus = Math.round(SPEED_MAX * Math.max(0, 1 - seconds / SPEED_WINDOW));
  const spent = bonus <= 0;
  const percent = (bonus / SPEED_MAX) * 100;

  return (
    <div className="mt-3 min-w-0">
 <div className="flex items-center justify-between gap-2 text-[0.62rem] font-black tracking-[0.14em]">
        <span className={spent ? 'text-mist-600' : 'text-gold-300'}>
          {spent ? 'Speed bonus spent' : `Speed bonus +${bonus}`}
        </span>
        <span className="text-mist-600">combo still counts</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full border-2 border-black/30 bg-ink-800/70">
        <motion.div
          className={`h-full rounded-full ${spent ? 'bg-mist-600/50' : 'bg-gradient-to-r from-gold-300 to-flare-500'}`}
          animate={{width: `${percent}%`}}
          transition={{duration: 0.25, ease: 'linear'}}
        />
      </div>
    </div>
  );
}

function PlayerPlate({
  player,
  active,
  pulse,
  side,
}: {
  player?: DuelPlayer;
  active: boolean;
  pulse: number;
  side: 'left' | 'right';
}) {
  const plateAvatar = useSize(38, 50);

  if (!player) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-3 py-3 sm:gap-3 sm:rounded-3xl sm:px-4 sm:py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/6 text-mist-600 sm:size-12">
          <Users className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.8rem] font-extrabold text-mist-400 sm:text-[0.86rem]">Waiting for a rival</p>
          <p className="truncate text-[0.7rem] font-semibold text-mist-600 sm:text-[0.74rem]">Share the code to fill this seat</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      animate={pulse ? {scale: [1, 1.035, 1]} : {}}
      transition={{duration: 0.42}}
      className={`relative min-w-0 flex-1 overflow-hidden rounded-2xl border px-3 py-2.5 sm:rounded-3xl sm:px-4 sm:py-4 ${
        active ? 'border-nova-400/45 bg-nova-500/12' : 'border-white/10 bg-white/[0.035]'
      } ${side === 'right' ? 'text-right' : ''}`}
    >
      <div className={`flex items-center gap-2 sm:gap-3 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
        <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={plateAvatar} ring={active} photo={{id: player.student_id, has: player.has_photo}} />
        <div className={`min-w-0 flex-1 ${side === 'right' ? 'text-right' : ''}`}>
          <p className="truncate text-[0.82rem] font-extrabold text-mist-50 sm:text-[0.92rem]">
            {player.name}
 {player.is_you && <span className="ml-1 text-[0.6rem] font-black tracking-wider text-nova-300 sm:ml-1.5 sm:text-[0.64rem]">You</span>}
          </p>
          <p className="truncate text-[0.68rem] font-semibold text-mist-500 sm:text-[0.74rem]">Lv {player.level}</p>
        </div>
      </div>

      <div className={`mt-1.5 flex items-baseline gap-1.5 sm:mt-3 sm:gap-2 ${side === 'right' ? 'justify-end' : ''}`}>
        <motion.span
          key={player.score}
          initial={{scale: 1.35}}
          animate={{scale: 1}}
          transition={{duration: 0.4}}
          className="score-pop text-2xl leading-none font-black tabular sm:text-3xl"
        >
          {player.score}
        </motion.span>
 <span className="text-[0.62rem] font-bold tracking-[0.12em] text-mist-500 sm:text-[0.68rem] sm:tracking-[0.16em]">pts</span>
      </div>

      <div
        className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.66rem] font-bold text-mist-500 sm:mt-2 sm:text-[0.72rem] ${
          side === 'right' ? 'justify-end' : ''
        }`}
      >
        <span className="inline-flex items-center gap-0.5 sm:gap-1">
          <CheckCircle2 className="size-3 text-mint-400 sm:size-3.5" /> {player.correct_count}
        </span>
        <span className="inline-flex items-center gap-0.5 sm:gap-1">
          <Hourglass className="size-3 sm:size-3.5" /> {player.answered_count}
        </span>
        {player.best_run >= 3 && (
          <span className="inline-flex items-center gap-0.5 text-flare-300 sm:gap-1">
            <Flame className="size-3 sm:size-3.5" /> {player.best_run}x
          </span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Tug-of-war bar between the two live scores. Cosmetic framing only: the scores
 * themselves are whatever the server last told us, never a local tally.
 */
function ClashBar({me, rival}: {me?: DuelPlayer; rival?: DuelPlayer}) {
  const mine = me?.score ?? 0;
  const theirs = rival?.score ?? 0;
  const total = mine + theirs;
  const share = total ? (mine / total) * 100 : 50;
  return (
    <div className="mt-2.5 flex items-center gap-2 sm:mt-3.5">
      <span className="w-8 shrink-0 text-right text-[0.8rem] font-black text-nova-300 tabular">{mine}</span>
      <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border-2 border-black/25 bg-ink-800/70">
        <motion.div
          animate={{width: `${share}%`}}
          transition={{type: 'spring', stiffness: 140, damping: 20}}
          className="h-full rounded-full bg-gradient-to-r from-nova-500 to-nova-300"
        />
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/25" />
      </div>
      <span className="w-8 shrink-0 text-[0.8rem] font-black text-flare-300 tabular">{theirs}</span>
    </div>
  );
}

/**
 * Phone scoreboard: one 46px strip instead of two stacked plates, so the
 * question and all four answers stay on screen without scrolling.
 */
function MobileScoreboard({
  me,
  rival,
  youPulse,
  opponentPulse,
}: {
  me?: DuelPlayer;
  rival?: DuelPlayer;
  youPulse: number;
  opponentPulse: number;
}) {
  const Side = ({player, pulse, reverse}: {player?: DuelPlayer; pulse: number; reverse?: boolean}) => (
    <motion.div
      animate={pulse ? {scale: [1, 1.025, 1]} : {}}
      transition={{duration: 0.4}}
      className={`flex min-w-0 flex-1 items-center gap-1.5 ${reverse ? 'flex-row-reverse' : ''}`}
    >
      {player ? (
        <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={28} ring photo={{id: player.student_id, has: player.has_photo}} />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/6 text-mist-600">
          <Users className="size-3.5" />
        </span>
      )}
      <div className={`min-w-0 flex-1 ${reverse ? 'text-right' : ''}`}>
        <p className="truncate text-[0.72rem] leading-tight font-extrabold text-mist-100">
          {player ? (player.is_you ? 'You' : player.name.split(' ')[0]) : 'Waiting'}
        </p>
        <p className={`flex items-center gap-1 truncate text-[0.6rem] font-bold text-mist-500 ${reverse ? 'justify-end' : ''}`}>
          {player ? (
            <>
              <CheckCircle2 className="size-2.5 shrink-0 text-mint-400" />
              {player.correct_count}
              <Hourglass className="ml-0.5 size-2.5 shrink-0" />
              {player.answered_count}
              {player.best_run >= 3 && (
                <>
                  <Flame className="ml-0.5 size-2.5 shrink-0 text-flare-300" />
                  {player.best_run}x
                </>
              )}
            </>
          ) : (
            'open seat'
          )}
        </p>
      </div>
      <motion.span
        key={player?.score ?? 0}
        initial={{scale: 1.3}}
        animate={{scale: 1}}
        transition={{duration: 0.35}}
        className="score-pop shrink-0 font-display text-xl leading-none font-black tabular"
      >
        {player?.score ?? 0}
      </motion.span>
    </motion.div>
  );

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-2 sm:hidden">
      <Side player={me} pulse={youPulse} />
      <span className="shrink-0 text-[0.62rem] font-black tracking-tight text-mist-600">VS</span>
      <Side player={rival} pulse={opponentPulse} reverse />
    </div>
  );
}

/** Server timestamps travel as naive-UTC ISO strings with a Z suffix. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).getTime();
  return Number.isNaN(value) ? null : value;
}

export interface DuelChatLine {
  key: string;
  student_id: number;
  name: string;
  body: string;
  mine: boolean;
}

export default function DuelArena({duelId, onExit, onOpenDuels}: {duelId: number; onExit: () => void; onOpenDuels: () => void}) {
  const {profile, toast, on, joinRoom, leaveRoom, duelSend} = useSession();
  const [duel, setDuel] = useState<Duel | null>(null);
  const [loading, setLoading] = useState(true);
  const [answeredIds, setAnsweredIds] = useState<Set<number>>(new Set());
  const [locked, setLocked] = useState<OptionKey | null>(null);
  const [flash, setFlash] = useState<'correct' | 'wrong' | null>(null);
  const [opponentPulse, setOpponentPulse] = useState(0);
  const [youPulse, setYouPulse] = useState(0);
  /* The server's own words about my last answer: did it land, what was it worth.
     Nothing here is inferred from the scoreboard any more. */
  const [award, setAward] = useState(0);
  const [myRun, setMyRun] = useState(0);
  const [finished, setFinished] = useState<Duel | null>(null);
  /* The round clock is server-owned. We store the deadline translated into OUR
     epoch (deadline = local-now + (server-deadline − server-now)), so a skewed
     device clock can never stretch or shrink the window. A refresh just
     re-reads the same deadline from the server — it never buys time. */
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [roundOpenedAt, setRoundOpenedAt] = useState<number>(Date.now());
  const [now, setNow] = useState(() => Date.now());
  /* Waiting-room chat lives here: relayed by the duel socket, never persisted. */
  const [chat, setChat] = useState<DuelChatLine[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const socketJoined = useRef(false);
  const busyRef = useRef(false);
  const winnerAvatar = useSize(58, 72);
  const loserAvatar = useSize(46, 58);
  const medalSize = useSize(80, 96);

  /** Translate a server deadline/opened pair into local-epoch milliseconds. */
  const syncRoundClock = useCallback((payload: {round_deadline?: string | null; round_opened?: string | null; server_now?: string}) => {
    const serverNow = toMs(payload.server_now);
    const deadline = toMs(payload.round_deadline);
    if (deadline !== null) {
      setDeadlineAt(serverNow !== null ? Date.now() + (deadline - serverNow) : deadline);
    } else {
      setDeadlineAt(null);
    }
    const opened = toMs(payload.round_opened);
    if (opened !== null) {
      setRoundOpenedAt(serverNow !== null ? Date.now() + (opened - serverNow) : opened);
    }
  }, []);

  /** One place to fold any duel payload (REST or websocket) into local state. */
  const applyDuel = useCallback(
    (payload: Duel) => {
      setDuel(payload);
      setLoading(false);
      if (payload.status === 'finished') {
        setFinished(payload);
        setDeadlineAt(null);
      } else if (payload.status === 'live' || payload.status === 'starting') {
        syncRoundClock(payload);
      } else {
        setDeadlineAt(null);
      }
      if (payload.questions) {
        setAnsweredIds(new Set(payload.questions.filter((question) => question.answered_by_you).map((question) => question.id)));
      }
    },
    [syncRoundClock],
  );

  const load = useCallback(async () => {
    try {
      applyDuel(await api.duel(duelId));
    } catch (error) {
      toast('error', 'Could not load the duel', (error as Error).message);
      setLoading(false);
    }
  }, [duelId, toast, applyDuel]);

  /* The duel room socket is authenticated per-member: it opens once the viewer
     actually sits in the duel. Guests browsing a public lobby stay REST-only
     until they join. */
  useEffect(() => {
    if (!duel?.is_yours || socketJoined.current) return undefined;
    socketJoined.current = true;
    joinRoom(`duel:${duelId}`);
    return () => {
      socketJoined.current = false;
      leaveRoom(`duel:${duelId}`);
    };
  }, [duel?.is_yours, duelId, joinRoom, leaveRoom]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Fine-grained local tick purely for DISPLAY: the countdown ring and the
     speed meter. What question is up and when it closes come from the server. */
  useEffect(() => {
    if (!duel || finished || (duel.status !== 'live' && duel.status !== 'starting')) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [duel?.status, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------- live duel events */
  useEffect(() => {
    const offs = [
      on('duel_state', (data) => {
        // Sent by the duel room socket the moment it connects — the full
        // reconnect restore: questions, scores AND the current round clock.
        const payload = data as Duel;
        if (payload.id !== duelId) return;
        applyDuel(payload);
        setFlash(null);
        setLocked(null);
        setAward(0);
      }),
      on('duel_start', (data) => {
        // Both seats filled: the shared countdown starts, served by the server.
        const payload = data as Duel;
        if (payload.id !== duelId) return;
        applyDuel(payload);
        setFlash(null);
        setLocked(null);
      }),
      on('duel_question', (data) => {
        // The server pacing engine opened a new question for BOTH players.
        const event = data as {duel_id: number; index: number; deadline?: string; opened?: string; server_now?: string};
        if (event.duel_id !== duelId) return;
        syncRoundClock({round_deadline: event.deadline, round_opened: event.opened, server_now: event.server_now});
        setFlash(null);
        setLocked(null);
        setAward(0);
        setDuel((current) => (current ? {...current, status: 'live', round_index: event.index} : current));
      }),
      on('duel_joined', (data) => {
        const event = data as {duel_id: number};
        if (event.duel_id === duelId) void load();
      }),
      on('duel_chat', (data) => {
        const event = data as {duel_id: number; student_id: number; name: string; body: string};
        if (event.duel_id !== duelId) return;
        setChat((current) => [
          ...current.slice(-79),
          {key: `${event.student_id}-${current.length}-${event.body.length}`, student_id: event.student_id, name: event.name, body: event.body, mine: event.student_id === profile?.id},
        ]);
      }),
      on('duel_disconnect', (data) => {
        const payload = data as {duel_id: number; student_id: number};
        if (payload.duel_id === duelId && payload.student_id !== profile?.id) {
          toast('info', 'Rival disconnected', 'The server clock keeps the duel fair.');
        }
      }),
      on('duel_live', (data) => {
        const payload = data as {duel_id: number};
        if (payload.duel_id === duelId) void load();
      }),
      on('duel_progress', (data) => {
        const event = data as {duel_id: number; student_id: number; question_order: number; correct: boolean; score: number; run: number; answered?: number};
        if (event.duel_id !== duelId) return;
        setDuel((current) => {
          if (!current) return current;
          const participants = current.participants.map((player) =>
            player.student_id === event.student_id
              ? {
                  ...player,
                  score: event.score,
                  /* The server reports how many questions this player actually
                     answered — timeouts never count, so trust that number. */
                  answered_count: event.answered ?? event.question_order,
                  correct_count: player.correct_count + (event.correct ? 1 : 0),
                  best_run: Math.max(player.best_run, event.run),
                }
              : player,
          );
          return {...current, participants};
        });
        if (event.student_id === profile?.id) {
          setYouPulse((n) => n + 1);
          setMyRun(event.run);
        } else {
          setOpponentPulse((n) => n + 1);
        }
      }),
      on('duel_finished', (data) => {
        const payload = data as Duel;
        if (payload.id !== duelId) return;
        setFinished(payload);
        setDuel(payload);
        setDeadlineAt(null);
        if (payload.winner_id === profile?.id) {
          celebrate({big: true});
          HAPTICS.win();
          sfx.play('win');
        } else {
          HAPTICS.lose();
          sfx.play('lose');
        }
      }),
      on('duel_result', (data) => {
        // Personal companion to duel_finished: carries THIS player's rewards.
        // App.tsx defers the reveal to this screen while it is open, so the
        // XP/coins breakdown merges in here.
        const payload = data as Duel & {rewards?: RewardEvent[]};
        if (payload.id !== duelId) return;
        setFinished((current) => (current ? {...current, ...payload} : payload));
        setDuel((current) => (current && current.id === duelId ? {...current, ...payload} : current));
      }),
      on('duel_cancelled', (data) => {
        const payload = data as {id?: number; duel_id?: number};
        if ((payload.id ?? payload.duel_id) === duelId) {
          toast('info', 'Duel cancelled', 'Your stake has been refunded.');
          onExit();
        }
      }),
      on('duel_expired', (data) => {
        const payload = data as {id?: number; duel_id?: number};
        if ((payload.id ?? payload.duel_id) === duelId) {
          toast('info', 'Duel expired', 'The invite ran out of time.');
          onExit();
        }
      }),
    ];
    return () => offs.forEach((dispose) => dispose());
  }, [on, duelId, profile?.id, toast, onExit, load, applyDuel, syncRoundClock]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({block: 'nearest'});
  }, [chat.length]);

  const questions = duel?.questions ?? [];
  /* Which question is on the wire comes straight from the server's round
     cursor — the client never advances on its own. */
  const index = duel?.status === 'live' ? duel.round_index ?? -1 : -1;
  const current = questions.find((question) => (question.order ?? 0) === index + 1);
  const me = duel?.participants.find((player) => player.is_you || player.student_id === profile?.id);
  const rival = duel?.participants.find((player) => !player.is_you && player.student_id !== profile?.id);
  const answeredByMe = useMemo(() => questions.filter((question) => question.answered_by_you).length, [questions]);
  const perQuestion = Math.max(1, duel?.time_limit_seconds ?? 20);
  const remainingSeconds = deadlineAt === null ? perQuestion : Math.max(0, (deadlineAt - now) / 1000);
  const remaining = Math.ceil(remainingSeconds);
  const timerPercent = Math.max(0, Math.min(100, (remainingSeconds / perQuestion) * 100));

  const answer = async (key: OptionKey) => {
    if (!duel || !current || busyRef.current || answeredIds.has(current.id) || duel.status !== 'live') return;
    busyRef.current = true;
    setLocked(key);
    /* elapsed_ms travels for compatibility only — the server measures the real
       window itself and pays the speed bonus off its own clock. */
    const elapsed = Math.max(0, Math.round((perQuestion - remainingSeconds) * 1000));
    try {
      const updated = await api.answerDuel(duel.id, {question_id: current.id, selected: key, elapsed_ms: elapsed});
      /* The answer key stays hidden mid-duel — but the server does report what
         it graded MY answer as, and what it paid. The verdict is read from that
         record, never guessed from a scoreboard jump. */
      const graded = updated.my_answers?.find((row) => row.question_id === current.id);
      const correct = Boolean(graded?.is_correct);
      setAward(graded?.points ?? 0);
      if (correct) {
        HAPTICS.correct();
        sfx.play('correct');
      } else {
        HAPTICS.wrong();
        sfx.play('wrong');
      }
      setFlash(correct ? 'correct' : 'wrong');
      setAnsweredIds((prev) => new Set(prev).add(current.id));
      applyDuel(updated);
      if (updated.status === 'finished') {
        if (updated.winner_id === profile?.id) {
          celebrate({big: true});
          HAPTICS.win();
          sfx.play('win');
        } else {
          HAPTICS.lose();
          sfx.play('lose');
        }
        busyRef.current = false;
      } else {
        /* Cosmetic beat only: the SERVER decides when the next question appears
           (duel_question event), so reading the verdict never costs time. */
        window.setTimeout(() => {
          setFlash(null);
          setLocked(null);
          setAward(0);
          busyRef.current = false;
        }, 900);
      }
    } catch (error) {
      toast('error', 'Answer rejected', (error as Error).message);
      setLocked(null);
      busyRef.current = false;
    }
  };

  const accept = async () => {
    if (!duel) return;
    try {
      const live = await api.acceptDuel(duel.id);
      applyDuel(live);
      toast('success', 'Duel accepted', 'The countdown is on — stay sharp.');
    } catch (error) {
      toast('error', 'Could not accept', (error as Error).message);
      onExit();
    }
  };

  const join = async () => {
    if (!duel) return;
    try {
      const joined = await api.joinDuelById(duel.id);
      applyDuel(joined);
      toast('success', 'You are in the duel', 'The countdown starts now.');
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
      onExit();
    }
  };

  const sendChat = () => {
    const body = chatDraft.trim().slice(0, 300);
    if (!body || !duel || duel.status !== 'invited') return;
    setChatDraft('');
    /* Fire-and-forget through the duel socket: the server validates membership
       and lobby status, then relays the line to everyone in THIS room only. */
    duelSend(`duel:${duel.id}`, {type: 'chat', body});
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4">
        <motion.div animate={{rotate: 360}} transition={{repeat: Infinity, duration: 1.2, ease: 'linear'}} className="size-14 rounded-2xl brand-gradient" />
        <p className="text-[0.86rem] font-bold text-mist-400">Entering the arena…</p>
      </div>
    );
  }

  if (!duel) {
    return (
      <div className="w-full py-16">
        <Card className="p-7 text-center">
          <Skull className="mx-auto size-10 text-flare-400" />
          <h2 className="mt-4 text-xl font-black text-mist-50">Duel not found</h2>
          <Button className="mt-6" onClick={onOpenDuels}>
            Back to duels
          </Button>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------- finished view */
  if (finished) {
    const winner = finished.participants.find((player) => player.student_id === finished.winner_id);
    const iWon = finished.winner_id === profile?.id;
    const draw = finished.draw || !finished.winner_id;
    /* The victory animation is a cosmetic the winner equipped — server-owned
       loadout, client-side look. */
    const victory = iWon ? victoryOf(profile?.cosmetics) : null;
    const rewards = (finished as unknown as {rewards?: RewardEvent[]}).rewards ?? [];

    const xp = rewards.filter((r) => r.type === 'xp').reduce((sum, r) => sum + ('amount' in r ? r.amount : 0), 0);
    const coins = rewards.filter((r) => r.type === 'coins').reduce((sum, r) => sum + ('amount' in r ? r.amount : 0), 0);

    return (
      <div className="w-full py-1 sm:py-4">
        <Card className="relative overflow-hidden p-4 text-center sm:p-8">
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-1.5 ${iWon ? 'bg-gradient-to-r from-mint-400 to-pulse-500' : draw ? 'bg-white/20' : 'bg-gradient-to-r from-flare-600 to-nova-600'}`} />
          <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-nova-600/22 blur-3xl" />
          <Character
            mood={iWon ? 'celebrate' : draw ? 'think' : 'sad'}
            size={72}
            tone="day"
            className="pointer-events-none absolute top-2 right-2 sm:top-4 sm:right-5"
            label="Arena hero"
          />

          <motion.span
            initial={{scale: 0.4, opacity: 0}}
            animate={{scale: 1, opacity: 1}}
            transition={{type: 'spring', stiffness: 260, damping: 16}}
            style={{width: medalSize, height: medalSize}}
            className={`relative mx-auto grid place-items-center rounded-[1.5rem] text-white shadow-2xl sm:rounded-[1.8rem] ${
              iWon ? 'bg-gradient-to-br from-mint-400 to-pulse-600' : draw ? 'bg-gradient-to-br from-mist-400 to-mist-600' : 'bg-gradient-to-br from-flare-500 to-nova-700'
            }`}
          >
            {iWon ? <Crown className="size-10 sm:size-12" /> : draw ? <Handshake className="size-9 sm:size-11" /> : <Skull className="size-9 sm:size-11" />}
          </motion.span>

          <h1 className={`game-title relative mt-3.5 font-display text-2xl font-black tracking-tight sm:mt-5 sm:text-4xl ${iWon ? victory?.className ?? 'text-mist-50' : 'text-mist-50'}`}>
            {iWon ? victory?.line ?? 'Victory!' : draw ? 'Dead heat' : 'Defeated'}
          </h1>
          <p className="relative mt-1.5 px-1 text-[0.84rem] font-semibold text-mist-400 sm:mt-2 sm:text-[0.9rem]">
            {draw
              ? 'Both fighters scored identically — stakes returned.'
              : iWon
                ? `You out-scored ${rival?.name ?? 'your rival'} and took the pot.`
                : `${winner?.name ?? 'Your rival'} edged you this time.`}
          </p>

          <div className="relative mt-4 flex items-center justify-center gap-3 sm:mt-6 sm:gap-4">
            {finished.participants.map((player) => (
              <div key={player.student_id} className="flex min-w-0 max-w-[9rem] flex-col items-center gap-1.5 sm:gap-2">
                <Avatar
                  name={player.name}
                  hue={player.avatar_hue}
                  initials={player.initials}
                  size={player.student_id === finished.winner_id ? winnerAvatar : loserAvatar}
                  ring={player.student_id === finished.winner_id}
                  photo={{id: player.student_id, has: player.has_photo}}
                />
                <p className="w-full truncate text-center text-[0.78rem] font-extrabold text-mist-100 sm:text-[0.82rem]">
                  {player.is_you ? 'You' : player.name}
                </p>
                <p className="text-lg font-black tabular text-mist-50 sm:text-xl">{player.score}</p>
 <p className="text-[0.62rem] font-bold tracking-wider text-mist-500 sm:text-[0.68rem]">
                  {player.correct_count}/{finished.question_count} correct
                </p>
              </div>
            ))}
          </div>

          <div className="relative mt-5 grid grid-cols-3 gap-1.5 sm:mt-7 sm:gap-2">
            {[
              {label: 'XP earned', value: `+${formatNumber(xp)}`, tone: 'text-nova-300'},
              {label: 'Coins', value: `+${formatNumber(coins)}`, tone: 'text-gold-300'},
              {label: 'Best run', value: `${me?.best_run ?? 0}x`, tone: 'text-flare-300'},
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-1.5 py-2.5 sm:px-3 sm:py-3">
                <p className={`truncate text-base font-black tabular sm:text-lg ${stat.tone}`}>{stat.value}</p>
 <p className="mt-0.5 truncate text-[0.56rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <div className="relative mt-5 grid gap-2 sm:mt-7 sm:flex sm:flex-wrap sm:justify-center">
            <Button className="w-full sm:w-auto" onClick={onOpenDuels} icon={<Swords className="size-4" />}>
              Duel again
            </Button>
            <Button className="w-full sm:w-auto" variant="outline" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
              Back to dashboard
            </Button>
          </div>
        </Card>

        {questions.some((question) => question.correct) && (
          <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
              <Trophy className="size-3.5 text-gold-400" /> Answer breakdown
            </p>
            <ul className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
              {questions.map((question, position) => {
                const mine = question.my_selection;
                const correct = question.correct === mine;
                return (
                  <li
                    key={question.id}
                    className={`rounded-2xl border px-3 py-2.5 sm:px-3.5 sm:py-3 ${correct ? 'border-mint-500/28 bg-mint-500/8' : 'border-flare-500/25 bg-flare-500/8'}`}
                  >
                    <p className="flex items-start gap-2 text-[0.84rem] font-bold text-mist-100">
                      <span className="shrink-0 text-mist-500">{position + 1}.</span>
                      <span className="min-w-0 flex-1">{question.text}</span>
                      {correct ? <CheckCircle2 className="size-4 shrink-0 text-mint-400" /> : <X className="size-4 shrink-0 text-flare-400" />}
                    </p>
                    <ReviewOptions options={question.options} correct={question.correct} chosen={question.my_selection} />
                    <p className="mt-1.5 text-[0.76rem] font-semibold text-mist-500">
                      Correct: <span className="text-mint-300">{question.correct}</span>
                      {mine ? (
                        <> · Your pick: <span className={correct ? 'text-mint-300' : 'text-flare-300'}>{mine}</span></>
                      ) : (
                        <> · <span className="text-mist-600">no answer</span></>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  /* ----------------------------------------------------- waiting room
     One shared lobby for BOTH fighters: the creator is already inside the
     moment the duel exists, a guest lands here from the public list or a chat
     invite, and once both seats are filled the server runs one countdown
     everyone watches before question 1. */
  if (duel.status === 'invited' || duel.status === 'starting') {
    const iAmChallenger = duel.participants.find((player) => player.seat === 'challenger')?.student_id === profile?.id;
    const challenger = duel.participants.find((player) => player.seat === 'challenger');
    const opponent = duel.participants.find((player) => player.seat === 'opponent');
    const seatsFull = duel.participants.length >= 2;
    const isPublic = duel.visibility === 'public';
    /* Chat stays open through the waiting room AND the shared countdown; the
       server hard-locks it the moment the first question goes live. */
    const chatOpen = (duel.status === 'invited' || duel.status === 'starting') && duel.is_yours;
    const heading =
      duel.status === 'starting'
        ? 'Both fighters ready'
        : !duel.is_yours
          ? `${duel.challenger_name ?? 'A player'} is waiting for a rival`
          : !seatsFull
            ? 'Waiting for an opponent'
            : iAmChallenger
              ? 'Challenge sent'
              : 'You have been challenged';
    return (
      <div className="w-full py-2 sm:py-6">
        <Card className="relative overflow-hidden p-4 text-center sm:p-8">
          <div className="pointer-events-none absolute -top-20 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold-500/16 blur-3xl" />
          <motion.span
            animate={{y: [0, -8, 0]}}
            transition={{repeat: Infinity, duration: 2.4, ease: 'easeInOut'}}
            className="relative mx-auto grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-gold-400 to-flare-500 text-ink-950 sm:size-20"
          >
            <Swords className="size-8 sm:size-10" />
          </motion.span>

          <Character
            mood={duel.status === 'starting' ? 'cheer' : iAmChallenger ? 'think' : 'cheer'}
            size={104}
            tone="day"
            className="relative -mt-1 inline-block"
            label="Arena hero"
          />
          <h1 className="relative mt-1 text-xl font-black tracking-tight text-mist-50 sm:text-2xl">{heading}</h1>
          <p className="relative mt-1.5 px-1 text-[0.84rem] font-semibold text-mist-400 sm:mt-2 sm:text-[0.88rem]">
            {duel.status === 'starting'
              ? 'The countdown is running for both players — questions start together.'
              : !duel.is_yours
                ? 'Join now to take the open seat.'
                : !seatsFull
                  ? isPublic
                    ? 'This duel is listed in the open arena — anyone can grab the seat.'
                    : `${rival?.name ?? 'Your rival'} has not accepted yet. Share the code to speed things up.`
                  : iAmChallenger
                    ? `${rival?.name ?? 'Your rival'} has not accepted yet.`
                    : `${duel.challenger_name ?? 'A player'} wants a duel — ${duel.stake_coins} coins at stake.`}
          </p>

          {/* Both seats, live: whoever is already in the room shows up here. */}
          <div className="relative mx-auto mt-4 grid max-w-xl grid-cols-2 gap-2 sm:mt-5">
            {[{seat: challenger, label: 'Challenger'}, {seat: opponent, label: 'Open seat'}].map(({seat, label}, position) => (
              <div
                key={label}
                className={`flex min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left ${
                  seat ? 'border-nova-400/35 bg-nova-500/10' : 'border-dashed border-white/14 bg-white/[0.02]'
                }`}
              >
                {seat ? (
                  <>
                    <Avatar name={seat.name} hue={seat.avatar_hue} initials={seat.initials} size={34} photo={{id: seat.student_id, has: seat.has_photo}} />
                    <div className="min-w-0">
                      <p className="truncate text-[0.8rem] font-extrabold text-mist-50">
                        {seat.is_you ? 'You' : seat.name}
                      </p>
                      <p className="text-[0.64rem] font-bold text-mist-500">{position === 0 ? 'Challenger' : 'Opponent'}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-white/6 text-mist-600">
                      <Users className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.8rem] font-extrabold text-mist-500">Waiting…</p>
                      <p className="text-[0.64rem] font-bold text-mist-600">{label}</p>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* The shared server countdown — identical for both fighters. */}
          <AnimatePresence>
            {duel.status === 'starting' && (
              <motion.div
                initial={{opacity: 0, scale: 0.9}}
                animate={{opacity: 1, scale: 1}}
                className="relative mx-auto mt-4 flex max-w-[15rem] flex-col items-center rounded-3xl border border-nova-400/30 bg-nova-500/10 px-6 py-4 sm:mt-5"
              >
                <p className="text-[0.64rem] font-black tracking-[0.22em] text-nova-300">DUEL STARTS IN</p>
                <motion.p
                  key={remaining}
                  initial={{scale: 1.25}}
                  animate={{scale: 1}}
                  className="font-display text-5xl font-black tabular text-mist-50 sm:text-6xl"
                >
                  {Math.max(0, remaining)}
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {duel.is_yours && (
            <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2 sm:mt-6 sm:gap-3">
              <span className="text-[0.66rem] font-black tracking-[0.2em] text-mist-500 sm:text-[0.7rem] sm:tracking-[0.24em]">Code</span>
              <CopyCode code={duel.code} size="lg" />
            </div>
          )}

          <div className="relative mt-4 grid grid-cols-3 gap-1.5 text-center sm:mt-6 sm:gap-2">
            {[
              {label: 'Questions', value: duel.question_count},
              {label: 'Per question', value: `${duel.time_limit_seconds}s`},
              {label: 'Pot', value: duel.stake_coins * 2 + 25},
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-1.5 py-2.5 sm:px-3 sm:py-3">
                <p className="truncate text-base font-black tabular text-mist-50 sm:text-lg">{stat.value}</p>
 <p className="truncate text-[0.56rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <p className="relative mt-2.5 text-[0.72rem] font-bold text-mist-500">
            <Chip className={`mr-1.5 ${isPublic ? 'border-mint-500/30 bg-mint-500/10 text-mint-300' : 'border-white/12 bg-white/6 text-mist-400'}`}>
              {isPublic ? 'Public duel' : 'Private duel'}
            </Chip>
            Every question runs on a server-synced {duel.time_limit_seconds}-second clock.
          </p>

          {duel.expires_at && duel.status === 'invited' && (
            <p className="relative mt-3 text-[0.76rem] font-semibold text-mist-600">
              <Link2 className="mr-1 inline size-3.5" /> Invite expires {formatRelative(duel.expires_at)}
            </p>
          )}

          <div className="relative mt-5 grid gap-2 sm:mt-7 sm:flex sm:flex-wrap sm:justify-center">
            {!duel.is_yours && duel.status === 'invited' && (
              <Button className="w-full sm:w-auto" variant="mint" size="lg" onClick={join} icon={<Zap className="size-4" />}>
                Join this duel
              </Button>
            )}
            {duel.is_yours && !iAmChallenger && duel.status === 'invited' && (
              <Button className="w-full sm:w-auto" variant="mint" size="lg" onClick={accept} icon={<Zap className="size-4" />}>
                Accept duel
              </Button>
            )}
            <Button className="w-full sm:w-auto" variant="outline" onClick={onOpenDuels} icon={<RotateCcw className="size-4" />}>
              Back to lobby
            </Button>
          </div>
        </Card>

        {/* Waiting-room chat: free talk scoped to this duel's participants,
            closed for good the moment the duel starts. */}
        {duel.is_yours && (
          <Card className="mt-3 p-3.5 sm:mt-4 sm:p-5">
            <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
              <MessageCircle className="size-3.5 text-nova-300" /> Waiting-room chat
              {!chatOpen && <span className="ml-auto rounded-full bg-white/8 px-2 py-0.5 text-[0.62rem] font-bold text-mist-500">locked during the duel</span>}
            </p>
            <div className="mt-2.5 max-h-44 min-h-[3.5rem] space-y-1.5 overflow-y-auto overscroll-contain rounded-2xl border border-white/8 bg-white/[0.02] p-2.5">
              {chat.length === 0 ? (
                <p className="py-2 text-center text-[0.76rem] font-semibold text-mist-600">
                  {chatOpen ? 'Say hello before the fight starts.' : 'Chat is closed now — the duel is on.'}
                </p>
              ) : (
                chat.map((line) => (
                  <p key={line.key} className="text-[0.8rem] leading-snug">
                    <span className={`font-extrabold ${line.mine ? 'text-nova-300' : 'text-gold-300'}`}>{line.mine ? 'You' : line.name}:</span>{' '}
                    <span className="font-medium break-words text-mist-200">{line.body}</span>
                  </p>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="mt-2.5 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendChat();
              }}
            >
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value.slice(0, 300))}
                disabled={!chatOpen}
                placeholder={chatOpen ? 'Message your rival…' : 'Chat locked — duel started'}
                aria-label="Waiting room message"
                className="min-w-0 flex-1 rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-2.5 text-[0.9rem] font-semibold text-mist-50 placeholder:text-mist-600 focus:border-nova-400/60 focus:outline-none disabled:opacity-50"
              />
              <Button type="submit" size="sm" disabled={!chatOpen || !chatDraft.trim()} aria-label="Send waiting room message" icon={<Send className="size-4" />} />
            </form>
          </Card>
        )}
      </div>
    );
  }

  /* --------------------------------------------------------- live play */
  const allAnswered = answeredByMe >= duel.question_count || !current;
  const clockHot = remaining <= 5;

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center gap-1.5 sm:mb-4 sm:gap-3">
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Leave duel" className="-ml-2 w-10 px-0 sm:ml-0 sm:w-auto sm:px-3.5" icon={<ChevronBack />}>
          <span className="hidden sm:inline">Leave</span>
        </Button>
        <Chip className="hidden border-flare-500/35 bg-flare-500/14 text-flare-300 sm:inline-flex" icon={<Zap className="size-3.5" />}>
          Live duel
        </Chip>
        <CopyCode code={duel.code} size="sm" pillClassName="hidden border-white/10 bg-white/5 text-mist-300 sm:inline-flex" />
        <Chip className="px-2 sm:px-2.5" icon={<Trophy className="size-3" />}>
          <span className="hidden sm:inline">Pot </span>
          {formatNumber(duel.stake_coins * 2 + 25)}
        </Chip>
        {/* Per-question countdown — synced to the server's deadline, so both
            fighters always see the same window. */}
        <div
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 tabular sm:gap-2 sm:px-3.5 sm:py-2 ${
            clockHot ? 'border-flare-500/45 bg-flare-500/14' : 'border-white/12 bg-white/6'
          }`}
        >
          <Hourglass className={`size-3.5 sm:size-4 ${clockHot ? 'animate-pulse text-flare-400' : 'text-mist-400'}`} />
          <span className={`text-[0.95rem] font-black sm:text-[1.02rem] ${clockHot ? 'text-flare-300' : 'text-mist-100'}`}>{remaining}s</span>
        </div>
      </div>

      <div className="mb-2.5 sm:mb-4">
        <ProgressBar value={timerPercent} className="h-1.5 sm:h-2" barClassName={clockHot ? 'bg-flare-500' : ''} animated={false} />
      </div>

      <MobileScoreboard me={me} rival={rival} youPulse={youPulse} opponentPulse={opponentPulse} />
      <ClashBar me={me} rival={rival} />

      <div className="hidden items-stretch gap-3 sm:flex">
        <PlayerPlate player={me} active pulse={youPulse} side="left" />
        <span className="grid shrink-0 place-items-center text-xl font-black tracking-tight text-mist-600">VS</span>
        <PlayerPlate player={rival} active={false} pulse={opponentPulse} side="right" />
      </div>

      <Card className="mt-2.5 p-3.5 sm:mt-4 sm:p-6">
        {allAnswered ? (
          <div className="py-6 text-center sm:py-8">
            <motion.div
              animate={{scale: [1, 1.08, 1]}}
              transition={{repeat: Infinity, duration: 1.6}}
              className="mx-auto grid size-14 place-items-center rounded-3xl brand-gradient text-white sm:size-16"
            >
              <Hourglass className="size-6 sm:size-7" />
            </motion.div>
            <h3 className="mt-3 text-base font-black text-mist-50 sm:mt-4 sm:text-lg">You are done — waiting for your rival</h3>
            <p className="mt-1.5 px-1 text-[0.82rem] font-semibold text-mist-400 sm:text-[0.86rem]">
              {rival ? `${rival.name} has answered ${rival.answered_count}/${duel.question_count}.` : 'The duel ends when both sides finish or the clock runs out.'}
            </p>
            <Button className="mt-5" variant="outline" onClick={() => void load()} icon={<RotateCcw className="size-4" />}>
              Refresh state
            </Button>
          </div>
        ) : (
          current && (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={current.id} initial={{opacity: 0, x: 24}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: -24}} transition={{duration: 0.24, ease: EASE}}>
                {/* ------------------------------------------ round header
                    The question is a round in a fight: which round, what it is
                    worth, how hot the run is, and what speed is still paying. */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Chip className="border-nova-500/28 bg-nova-500/12 text-nova-300">
                    Round {current.order ?? index + 1}/{duel.question_count}
                  </Chip>
                  <Chip className="border-gold-500/28 bg-gold-500/12 text-gold-300" icon={<Zap className="size-3" />}>
                    {current.points} pts on the line
                  </Chip>
                  <ComboMeter combo={myRun} className="sm:ml-0" />
 <span className="ml-auto hidden items-center gap-1.5 text-[0.66rem] font-black tracking-[0.14em] text-mist-500 sm:inline-flex">
                    <Hourglass className="size-3.5" /> {formatClock(remaining)} left
                  </span>
                </div>

                <div className="mt-3 flex items-start gap-3 sm:mt-4">
                  <Character
                    mood={flash ? (flash === 'correct' ? 'cheer' : 'sad') : 'idle'}
                    size={52}
                    tone="day"
                    className="-mt-1 hidden shrink-0 sm:block"
                    label="Arena hero"
                  />
                  <p className="min-w-0 text-[0.98rem] leading-relaxed font-bold text-mist-50 sm:text-[1.14rem]">{current.text}</p>
                </div>

                {/* What a fast answer is still worth — the server measures the
                    window itself and pays the bonus off its own clock. */}
                {!flash && current && (
                  <SpeedBonus startedAt={roundOpenedAt} frozen={Boolean(locked) || answeredIds.has(current.id)} />
                )}

                <div className="mt-3.5 grid gap-2 sm:mt-5 sm:grid-cols-2 sm:gap-2.5">
                  {LETTERS.filter((letter) => current.options[letter]).map((letter) => {
                    const isLocked = locked === letter;
                    const spent = answeredIds.has(current.id);
                    /* The verdict is the server's: `flash` carries what the
                       answer call returned, never a local guess. */
                    const state = flash && isLocked
                      ? flash === 'correct'
                        ? 'correct'
                        : 'wrong'
                      : spent && isLocked
                        ? 'picked'
                        : spent
                          ? 'muted'
                          : 'idle';
                    return (
                      <AnswerTile
                        key={letter}
                        letter={letter}
                        text={current.options[letter]}
                        state={state}
                        disabled={Boolean(locked) || spent}
                        onPick={() => void answer(letter)}
                      />
                    );
                  })}
                </div>

                {/* The verdict banner: server verdict, server points. */}
                <AnimatePresence>
                  {flash && (
                    <div className="mt-3 sm:mt-4">
                      <AnswerFeedback
                        correct={flash === 'correct'}
                        kind="duel"
                        cosmetics={profile?.cosmetics}
                        xp={award}
                        xpLabel="pts"
                        combo={flash === 'correct' ? myRun : undefined}
                        note={
                          flash === 'correct'
                            ? 'Points banked. Next round — keep the run alive for a bigger combo.'
                            : 'No points this round. The key stays hidden until the duel ends.'
                        }
                      />
                    </div>
                  )}
                </AnimatePresence>

                <div className="mt-3 flex items-center justify-between gap-3 sm:mt-5">
                  <p className="hidden text-[0.76rem] font-semibold text-mist-600 sm:block">
                    Faster answers score more — the speed bonus decays over {perQuestion} seconds.
                  </p>
                  {/* No client-side skip: the server advances BOTH fighters the
                      instant the round closes, so nobody can jump ahead. */}
                  <p className="ml-auto text-[0.72rem] font-bold text-mist-600">
                    Next round is served by the arena clock
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          )
        )}
      </Card>

      <div className="mt-4 hidden gap-2 sm:grid sm:grid-cols-3">
        {[
          {label: 'Answered', value: `${answeredByMe}/${duel.question_count}`},
          {label: 'Your score', value: formatNumber(me?.score ?? 0)},
          {label: 'Rival score', value: formatNumber(rival?.score ?? 0)},
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <p className="text-lg font-black tabular text-mist-50">{stat.value}</p>
 <p className="text-[0.62rem] font-bold tracking-[0.14em] text-mist-500">{stat.label}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ChevronBack() {
  return <ArrowLeft className="size-4" />;
}
