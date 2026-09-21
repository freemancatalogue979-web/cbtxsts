/**
 * Live 1v1 duel arena over websocket: VS scoreboard, per-question speed scoring,
 * combos, real-time opponent progress and a winner celebration.
 */
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Crown,
  Flame,
  Handshake,
  Hourglass,
  Link2,
  RotateCcw,
  Skull,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, ProgressBar, ReviewOptions} from '../components/ui';
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

export default function DuelArena({duelId, onExit, onOpenDuels}: {duelId: number; onExit: () => void; onOpenDuels: () => void}) {
  const {profile, toast, on, joinRoom, leaveRoom} = useSession();
  const [duel, setDuel] = useState<Duel | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
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
  const questionStart = useRef(Date.now());
  const busyRef = useRef(false);
  const winnerAvatar = useSize(58, 72);
  const loserAvatar = useSize(46, 58);
  const medalSize = useSize(80, 96);

  /** One place to fold any duel payload (REST or websocket) into local state. */
  const applyDuel = useCallback((payload: Duel) => {
    setDuel(payload);
    setLoading(false);
    if (payload.status === 'finished') {
      setFinished(payload);
      setRemaining(0);
    } else if (payload.started_at) {
      const started = new Date(payload.started_at.endsWith('Z') ? payload.started_at : `${payload.started_at}Z`).getTime();
      setRemaining(Math.max(0, Math.round((started + payload.time_limit_seconds * 1000 - Date.now()) / 1000)));
    }
    if (payload.questions) {
      setAnsweredIds(new Set(payload.questions.filter((question) => question.answered_by_you).map((question) => question.id)));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      applyDuel(await api.duel(duelId));
    } catch (error) {
      toast('error', 'Could not load the duel', (error as Error).message);
      setLoading(false);
    }
  }, [duelId, toast, applyDuel]);

  useEffect(() => {
    void load();
    joinRoom(`duel:${duelId}`);
    return () => leaveRoom(`duel:${duelId}`);
  }, [load, joinRoom, leaveRoom, duelId]);

  /* ------------------------------------------------- live duel events */
  useEffect(() => {
    const offs = [
      on('duel_state', (data) => {
        // Sent by the duel room socket the moment it connects.
        const payload = data as Duel;
        if (payload.id === duelId) applyDuel(payload);
      }),
      on('duel_start', (data) => {
        const payload = data as Duel;
        if (payload.id !== duelId) return;
        applyDuel(payload);
        setIndex(0);
        setRemaining(payload.time_limit_seconds);
        questionStart.current = Date.now();
      }),
      on('duel_disconnect', (data) => {
        const payload = data as {duel_id: number; student_id: number};
        if (payload.duel_id === duelId && payload.student_id !== profile?.id) {
          toast('info', 'Rival disconnected', 'They forfeit if the clock runs out.');
        }
      }),
      on('duel_live', (data) => {
        const payload = data as {duel_id: number};
        if (payload.duel_id === duelId) void load();
      }),
      on('duel_progress', (data) => {
        const event = data as {duel_id: number; student_id: number; question_order: number; correct: boolean; score: number; run: number};
        if (event.duel_id !== duelId) return;
        setDuel((current) => {
          if (!current) return current;
          const participants = current.participants.map((player) =>
            player.student_id === event.student_id
              ? {
                  ...player,
                  score: event.score,
                  answered_count: event.question_order,
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
        /* The room feed carries the result only — my own questions and the
           answer key arrive per-player via duel_result / the REST reload. */
        void load();
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
        /* Server-private finale for me: my set, my answer key, my rewards. */
        const payload = data as Duel;
        if (payload.id !== duelId) return;
        applyDuel(payload);
      }),
      on('duel_cancelled', (data) => {
        const payload = data as {id?: number; duel_id?: number};
        if ((payload.id ?? payload.duel_id) === duelId) {
          toast('info', 'Duel cancelled', 'Your stake has been refunded.');
          onExit();
        }
      }),
    ];
    return () => offs.forEach((dispose) => dispose());
  }, [on, duelId, profile?.id, toast, onExit, load, applyDuel]);

  /* --------------------------------------------------------- countdown */
  useEffect(() => {
    if (!duel || duel.status !== 'live' || finished) return undefined;
    const id = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(id);
          void load(); // the server finalises expired duels
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [duel, finished, load]);

  const questions = duel?.questions ?? [];
  const current = questions[index];
  const me = duel?.participants.find((player) => player.is_you || player.student_id === profile?.id);
  const rival = duel?.participants.find((player) => !player.is_you && player.student_id !== profile?.id);
  const answeredByMe = useMemo(() => questions.filter((question) => question.answered_by_you).length, [questions]);

  const answer = async (key: OptionKey) => {
    if (!duel || !current || busyRef.current || answeredIds.has(current.id) || duel.status !== 'live') return;
    busyRef.current = true;
    setLocked(key);
    const elapsed = Date.now() - questionStart.current;
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
      setDuel(updated);
      if (updated.status === 'finished') {
        setFinished(updated);
        if (updated.winner_id === profile?.id) {
          celebrate({big: true});
          HAPTICS.win();
          sfx.play('win');
        } else {
          HAPTICS.lose();
          sfx.play('lose');
        }
      } else {
        window.setTimeout(() => {
          setFlash(null);
          setLocked(null);
          setAward(0);
          setIndex((value) => {
            const nextIndex = questions.findIndex((question, position) => position > value && !answeredIds.has(question.id));
            return nextIndex >= 0 ? nextIndex : value + 1;
          });
          questionStart.current = Date.now();
          busyRef.current = false;
          /* Long enough to read POINT WON / NOT QUITE - the next question's
             clock starts after this, so reading never costs speed points. */
        }, 1000);
      }
      if (updated.status === 'finished') busyRef.current = false;
    } catch (error) {
      toast('error', 'Answer rejected', (error as Error).message);
      setLocked(null);
      busyRef.current = false;
    }
  };

  useEffect(() => {
    questionStart.current = Date.now();
  }, [index]);

  const accept = async () => {
    if (!duel) return;
    try {
      const live = await api.acceptDuel(duel.id);
      applyDuel(live);
      setRemaining(live.time_limit_seconds);
      setIndex(0);
      questionStart.current = Date.now();
      toast('success', 'Duel accepted', 'First to finish the set wins the pot.');
    } catch (error) {
      toast('error', 'Could not accept', (error as Error).message);
      onExit();
    }
  };

  const copyCode = async () => {
    if (!duel?.code) return;
    try {
      await navigator.clipboard.writeText(duel.code);
      toast('success', 'Code copied', duel.code);
    } catch {
      toast('info', 'Share this code', duel.code);
    }
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

  /* ----------------------------------------------------- waiting room */
  if (duel.status === 'invited') {
    const iAmChallenger = duel.participants.find((player) => player.seat === 'challenger')?.student_id === profile?.id;
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
            mood={iAmChallenger ? 'think' : 'cheer'}
            size={104}
            tone="day"
            className="relative -mt-1 inline-block"
            label="Arena hero"
          />
          <h1 className="relative mt-1 text-xl font-black tracking-tight text-mist-50 sm:text-2xl">
            {iAmChallenger ? 'Challenge sent' : 'You have been challenged'}
          </h1>
          <p className="relative mt-1.5 px-1 text-[0.84rem] font-semibold text-mist-400 sm:mt-2 sm:text-[0.88rem]">
            {iAmChallenger
              ? `${rival?.name ?? 'Your rival'} has not accepted yet. Share the code to speed things up.`
              : `${duel.challenger_name ?? 'A player'} wants a duel — ${duel.stake_coins} coins at stake.`}
          </p>

          <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2 sm:mt-6 sm:gap-3">
 <span className="text-[0.66rem] font-black tracking-[0.2em] text-mist-500 sm:text-[0.7rem] sm:tracking-[0.24em]">Code</span>
            <span className="rounded-2xl border border-white/14 bg-white/6 px-3.5 py-2 text-xl font-black tracking-[0.22em] text-mist-50 sm:px-5 sm:py-2.5 sm:text-2xl sm:tracking-[0.35em]">
              {duel.code}
            </span>
            <Button size="sm" variant="outline" onClick={copyCode} icon={<Copy className="size-4" />}>
              Copy
            </Button>
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-1.5 text-center sm:mt-6 sm:gap-2">
            {[
              {label: 'Questions', value: duel.question_count},
              {label: 'Time', value: `${duel.time_limit_seconds}s`},
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

          {duel.expires_at && (
            <p className="relative mt-4 text-[0.76rem] font-semibold text-mist-600">
              <Link2 className="mr-1 inline size-3.5" /> Invite expires {formatRelative(duel.expires_at)}
            </p>
          )}

          <div className="relative mt-5 grid gap-2 sm:mt-7 sm:flex sm:flex-wrap sm:justify-center">
            {!iAmChallenger && (
              <Button className="w-full sm:w-auto" variant="mint" size="lg" onClick={accept} icon={<Zap className="size-4" />}>
                Accept duel
              </Button>
            )}
            <Button className="w-full sm:w-auto" variant="outline" onClick={onOpenDuels} icon={<RotateCcw className="size-4" />}>
              Back to lobby
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* --------------------------------------------------------- live play */
  const allAnswered = answeredByMe >= duel.question_count || !current;
  const timerPercent = duel.time_limit_seconds ? (remaining / duel.time_limit_seconds) * 100 : 0;

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center gap-1.5 sm:mb-4 sm:gap-3">
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Leave duel" className="-ml-2 w-10 px-0 sm:ml-0 sm:w-auto sm:px-3.5" icon={<ChevronBack />}>
          <span className="hidden sm:inline">Leave</span>
        </Button>
        <Chip className="hidden border-flare-500/35 bg-flare-500/14 text-flare-300 sm:inline-flex" icon={<Zap className="size-3.5" />}>
          Live duel
        </Chip>
        <Chip icon={<Link2 className="size-3" />}>{duel.code}</Chip>
        <Chip className="px-2 sm:px-2.5" icon={<Trophy className="size-3" />}>
          <span className="hidden sm:inline">Pot </span>
          {formatNumber(duel.stake_coins * 2 + 25)}
        </Chip>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 rounded-2xl border border-white/12 bg-white/6 px-2.5 py-1.5 tabular sm:gap-2 sm:px-3.5 sm:py-2">
          <Hourglass className={`size-3.5 sm:size-4 ${remaining <= 20 ? 'text-flare-400' : 'text-mist-400'}`} />
          <span className={`text-[0.95rem] font-black sm:text-[1.02rem] ${remaining <= 20 ? 'text-flare-300' : 'text-mist-100'}`}>{formatClock(remaining)}</span>
        </div>
      </div>

      <div className="mb-2.5 sm:mb-4">
        <ProgressBar value={timerPercent} className="h-1.5 sm:h-2" barClassName={remaining <= 20 ? 'bg-flare-500' : ''} animated={false} />
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

                {/* What a fast answer is still worth — the server pays this
                    bonus on the elapsed time it is sent. */}
                {!flash && current && (
                  <SpeedBonus startedAt={questionStart.current} frozen={Boolean(locked) || answeredIds.has(current.id)} />
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

                <div className="mt-3 flex items-center justify-end gap-3 sm:mt-5 sm:justify-between">
                  <p className="hidden text-[0.76rem] font-semibold text-mist-600 sm:block">
                    Faster answers score more — the speed bonus decays over 20 seconds.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = questions.findIndex((question, position) => position > index && !answeredIds.has(question.id));
                      if (next >= 0) setIndex(next);
                    }}
                  >
                    Skip
                  </Button>
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
