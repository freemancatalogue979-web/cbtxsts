/**
 * Game Arena — Star Dash.
 *
 * The arcade half of the Study → Game loop. Everything the player can win is
 * decided on the server: the run only reports what happened, the backend clamps
 * it, pays XP/coins and resolves friend challenges. Playtime comes out of the
 * daily bank that reading materials fills.
 */
import {
  ArrowLeft,
  Award,
  Clock3,
  Coins,
  Crown,
  Flame,
  Gamepad2,
  Heart,
  Play,
  Radio,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Card, Chip, EmptyState, Modal, ProgressBar, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {GameBoardRow, GameHub, GameRunResult, PlaytimeBank} from '../lib/types';

type Mode = 'survival' | 'score_attack' | 'time_trial' | 'daily';
type View = 'hub' | 'run' | 'board' | 'locker';

interface Entity {
  id: number;
  kind: 'star' | 'bomb' | 'gem';
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  ttl: number;
}

const MODES: {id: Mode; label: string; blurb: string; seconds: number; icon: typeof Play}[] = [
  {id: 'score_attack', label: 'Score attack', blurb: 'Two minutes, maximum points.', seconds: 120, icon: Target},
  {id: 'survival', label: 'Survival', blurb: 'Three lives, one mistake each.', seconds: 180, icon: Shield},
  {id: 'time_trial', label: 'Time trial', blurb: 'Sixty frantic seconds.', seconds: 60, icon: Clock3},
  {id: 'daily', label: 'Daily challenge', blurb: 'Everyone plays the same run.', seconds: 90, icon: Crown},
];

const FIELD = {w: 100, h: 100};

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return undefined;
    let frame = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setNow(Date.now());
      frame = window.setTimeout(tick, 250);
    };
    frame = window.setTimeout(tick, 250);
    return () => {
      alive = false;
      window.clearTimeout(frame);
    };
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.round((deadline - now) / 1000));
}

/* ------------------------------------------------------------------ hub */

function BankCard({bank, streak}: {bank: PlaytimeBank; streak: GameHub['streak']}) {
  const remaining = Math.max(0, bank.remaining_seconds);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <Card className="relative min-w-0 overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-20 -right-10 size-48 rounded-full bg-nova-500/16 blur-3xl" />
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-nova-500/30 bg-nova-500/12">
          <Gamepad2 className="size-5 text-nova-300" />
        </span>
        <div className="min-w-0">
 <p className="text-[0.7rem] font-black tracking-wide text-mist-500">Playtime bank</p>
          <p className="text-[1.4rem] leading-tight font-black text-mist-50 tabular">
            {minutes}:{String(seconds).padStart(2, '0')}
          </p>
          <p className="text-[0.72rem] font-bold text-mist-500">
            {bank.study_xp_today} Study XP today · {Math.round(bank.earned_seconds / 60)} min earned · {Math.round(bank.used_seconds / 60)} min played
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          <Chip className="border-gold-500/25 bg-gold-500/12 text-gold-300">
            <Flame className="size-3" /> {streak.current} day streak
          </Chip>
        </div>
      </div>
      <ProgressBar className="mt-3" value={bank.cap_seconds ? (bank.earned_seconds / bank.cap_seconds) * 100 : 0} />
      <p className="mt-1.5 text-[0.72rem] font-semibold text-mist-500">
        Daily cap {Math.round(bank.cap_seconds / 60)} min · every {Math.round(bank.seconds_per_threshold / 60)} min more unlocks at{' '}
        {bank.thresholds.join(', ')} Study XP.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ run */

function StarDash({
  hub,
  mode,
  onExit,
  onToast,
}: {
  hub: GameHub;
  mode: Mode;
  onExit: () => void;
  onToast: (kind: 'success' | 'error', title: string, body?: string) => void;
}) {
  const reduced = useReducedMotion();
  const {pushRewards, refreshProfile} = useSession();
  const config = MODES.find((row) => row.id === mode) ?? MODES[0];
  const [phase, setPhase] = useState<'starting' | 'playing' | 'over'>('starting');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [, setBestCombo] = useState(0);
  const [lives, setLives] = useState(mode === 'survival' ? 3 : 0);
  const [collected, setCollected] = useState(0);
  const [wave, setWave] = useState(1);
  const [remaining, setRemaining] = useState(hub.playtime.remaining_seconds);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [pops, setPops] = useState<{id: number; x: number; y: number; text: string; tone: string}[]>([]);
  const [result, setResult] = useState<GameRunResult | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const seconds = useCountdown(deadline);

  const entitiesRef = useRef<Entity[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const livesRef = useRef(lives);
  const elapsedRef = useRef(0);
  const idRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const spawnRef = useRef(0);
  const chargedRef = useRef(0);
  const finishedRef = useRef(false);

  /* ---- open the banked session first; the server decides if you can play ---- */
  useEffect(() => {
    let alive = true;
    void api.game
      .start(mode)
      .then((payload) => {
        if (!alive) return;
        setSessionId(payload.session_id);
        setRemaining(payload.remaining_seconds);
        setPhase('playing');
        setDeadline(Date.now() + config.seconds * 1000);
        lastRef.current = performance.now();
      })
      .catch((error: Error) => {
        onToast('error', 'Arena closed', error.message);
        onExit();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const finish = useCallback(
    async (reason: 'time' | 'lives') => {
      if (finishedRef.current || sessionId === null) return;
      finishedRef.current = true;
      setPhase('over');
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      try {
        const payload = await api.game.finish(sessionId, {
          score: scoreRef.current,
          seconds: Math.round(elapsedRef.current),
          combo: comboRef.current,
          collected,
          wave,
        });
        setResult(payload);
        // The arcade's own XP, plus whatever the season ladder did with it.
        const arcadeRewards = payload.rewards?.length
          ? (payload.rewards as never)
          : payload.session.xp
            ? [{type: 'xp' as const, amount: payload.session.xp, reason: 'game'}]
            : [];
        if (arcadeRewards.length) pushRewards(arcadeRewards);
        void refreshProfile();
        sfx.play(payload.session.score >= hub.profile.best_score ? 'levelup' : 'coin');
        if (payload.achievements.length) onToast('success', 'Achievement unlocked', payload.achievements.map((row) => row.name).join(' · '));
        else if (reason === 'lives') onToast('success', 'Run over', 'Back to the arena floor.');
      } catch (error) {
        onToast('error', 'Could not bank that run', (error as Error).message);
        onExit();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, collected, wave, hub.profile.best_score, pushRewards, refreshProfile, onToast, onExit],
  );

  const hit = useCallback(
    (entity: Entity) => {
      const elapsed = elapsedRef.current;
      entitiesRef.current = entitiesRef.current.filter((row) => row.id !== entity.id);
      if (entity.kind === 'bomb') {
        comboRef.current = 0;
        setCombo(0);
        sfx.play('wrong');
        if (mode === 'survival') {
          livesRef.current -= 1;
          setLives(livesRef.current);
          if (livesRef.current <= 0) void finish('lives');
        } else {
          scoreRef.current = Math.max(0, scoreRef.current - 40);
        }
        setPops((current) => [...current, {id: entity.id, x: entity.x, y: entity.y, text: '-40', tone: 'text-flare-300'}]);
      } else {
        comboRef.current += 1;
        setBestCombo((current) => Math.max(current, comboRef.current));
        setCombo(comboRef.current);
        const value = (entity.kind === 'gem' ? 60 : 20) + comboRef.current * 4;
        scoreRef.current += value;
        setCollected((current) => current + 1);
        setPops((current) => [...current, {id: entity.id, x: entity.x, y: entity.y, text: `+${value}`, tone: 'text-mint-300'}]);
        if (comboRef.current > 0 && comboRef.current % 8 === 0) sfx.play('whoosh');
        else sfx.play('tap');
      }
      setScore(scoreRef.current);
      setEntities([...entitiesRef.current]);
      window.setTimeout(() => setPops((current) => current.filter((row) => row.id !== entity.id)), 700);
      void elapsed;
    },
    [mode, finish],
  );

  /* ---- the loop: move the field, spawn pickups, keep the bank honest ---- */
  useEffect(() => {
    if (phase !== 'playing' || sessionId === null) return undefined;
    let lastHeartbeat = 0;

    const step = (frame: number) => {
      const dt = Math.min(0.05, (frame - lastRef.current) / 1000);
      lastRef.current = frame;
      elapsedRef.current += dt;
      const elapsed = elapsedRef.current;

      // difficulty curve: a new wave every 20 seconds
      const nextWave = 1 + Math.floor(elapsed / 20);
      setWave((current) => (current === nextWave ? current : nextWave));

      spawnRef.current -= dt;
      if (spawnRef.current <= 0 && entitiesRef.current.length < 12) {
        const spawnEvery = Math.max(0.34, 0.95 - elapsed * 0.008);
        spawnRef.current = spawnEvery;
        const roll = Math.random();
        const kind: Entity['kind'] = roll < 0.2 - Math.min(0.1, elapsed * 0.0006) ? 'bomb' : roll < 0.3 ? 'gem' : 'star';
        const edge = Math.random();
        const speed = (kind === 'bomb' ? 22 : 18) + elapsed * 0.14 + Math.random() * 8;
        const entity: Entity = {
          id: idRef.current++,
          kind,
          x: edge * FIELD.w,
          y: FIELD.h + 6,
          vx: (Math.random() - 0.5) * 10,
          vy: -speed,
          born: elapsed,
          ttl: kind === 'gem' ? 2.6 : 3.6,
        };
        entitiesRef.current = [...entitiesRef.current.slice(-11), entity];
      }

      const kept: Entity[] = [];
      entitiesRef.current.forEach((entity) => {
        const nx = entity.x + entity.vx * dt;
        const ny = entity.y + entity.vy * dt;
        const age = elapsed - entity.born;
        if (age > entity.ttl) {
          if (entity.kind === 'star') {
            comboRef.current = 0;
            setCombo(0);
          }
          return;
        }
        if (mode === 'time_trial' && entity.kind === 'bomb') {
          kept.push({...entity, x: nx, y: ny});
          return;
        }
        kept.push({...entity, x: nx, y: ny});
      });
      entitiesRef.current = kept;
      setEntities(kept);

      // charge the bank in 15-second bites so a killed tab cannot eat the day
      if (elapsed - lastHeartbeat >= 15) {
        lastHeartbeat = elapsed;
        chargedRef.current += 15;
        void api.game
          .heartbeat(sessionId, 15)
          .then((payload) => {
            setRemaining(payload.remaining_seconds);
            if (payload.out_of_time) void finish('time');
          })
          .catch(() => undefined);
      }

      const outOfTime = deadline !== null && Date.now() >= deadline;
      const outOfBank = chargedRef.current * 1000 >= hub.playtime.remaining_seconds * 1000 + 15_000;
      if (outOfTime || outOfBank) {
        void finish('time');
        return;
      }
      rafRef.current = window.requestAnimationFrame(step);
    };

    rafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId, deadline, mode]);

  const drain = hub.playtime.remaining_seconds - (hub.playtime.remaining_seconds - remaining);

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onExit}>
          Arena
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Chip className="border-nova-500/25 bg-nova-500/12 text-nova-200">
            <Clock3 className="size-3" /> {Math.max(0, Math.floor(remaining / 60))}:{String(Math.max(0, remaining % 60)).padStart(2, '0')}
          </Chip>
          {mode === 'survival' ? (
            <Chip className="border-flare-500/25 bg-flare-500/12 text-flare-300">
              <Heart className="size-3" /> {lives}
            </Chip>
          ) : null}
        </div>
      </div>

      <Card className="relative min-w-0 overflow-hidden p-0">
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2.5">
          <div className="min-w-0">
 <p className="text-[0.68rem] font-black tracking-wide text-mist-500">{config.label}</p>
            <p className="text-[1.1rem] font-black text-mist-50 tabular">{formatNumber(score)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Chip className="border-white/10 bg-white/4 text-mist-300">wave {wave}</Chip>
            <Chip className={combo >= 8 ? 'border-gold-500/30 bg-gold-500/14 text-gold-300' : 'border-white/10 bg-white/4 text-mist-400'}>
              <Zap className="size-3" /> x{combo}
            </Chip>
            {deadline !== null ? <Chip className="border-white/10 bg-white/4 text-mist-300">{seconds}s</Chip> : null}
          </div>
        </div>

        <div className="relative aspect-[3/4] w-full touch-manipulation select-none overflow-hidden bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,0.25),rgba(6,6,20,0.9))] sm:aspect-[4/3]">
          <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-flare-500/20 to-transparent" />

          <AnimatePresence initial={false}>
            {entities.map((entity) => (
              <motion.button
                key={entity.id}
                initial={{opacity: 0, scale: 0.7}}
                animate={{opacity: 1, scale: 1}}
                exit={{opacity: 0, scale: 0.6}}
                transition={{duration: reduced ? 0 : 0.14}}
                onPointerDown={(event) => {
                  event.preventDefault();
                  hit(entity);
                }}
                style={{left: `${entity.x}%`, top: `${100 - entity.y}%`, transform: 'translate(-50%, -50%)'}}
                className={`absolute grid size-12 place-items-center rounded-full border text-[0.7rem] font-black sm:size-11 ${
                  entity.kind === 'bomb'
                    ? 'border-flare-400/60 bg-flare-500/25 text-flare-200'
                    : entity.kind === 'gem'
                      ? 'border-gold-300/60 bg-gold-400/25 text-gold-200'
                      : 'border-nova-300/50 bg-nova-500/25 text-nova-100'
                }`}
                aria-label={entity.kind}
              >
                {entity.kind === 'bomb' ? '×' : entity.kind === 'gem' ? <Sparkles className="size-4" /> : <Zap className="size-4" />}
              </motion.button>
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {pops.map((pop) => (
              <motion.span
                key={pop.id}
                initial={{opacity: 0.9, y: 0}}
                animate={{opacity: 0, y: -34}}
                exit={{opacity: 0}}
                transition={{duration: reduced ? 0 : 0.7}}
                style={{left: `${pop.x}%`, top: `${100 - pop.y}%`}}
                className={`pointer-events-none absolute -translate-x-1/2 text-[0.86rem] font-black ${pop.tone}`}
              >
                {pop.text}
              </motion.span>
            ))}
          </AnimatePresence>

          {phase !== 'playing' ? (
            <div className="keep-dark absolute inset-0 grid place-items-center bg-ink-950/70 px-4 text-center">
              {result ? (
                <div className="min-w-0">
                  <Trophy className="mx-auto size-8 text-gold-300" />
                  <p className="mt-2 text-[1.1rem] font-black text-mist-50">{formatNumber(result.session.score)} points</p>
                  <p className="text-[0.8rem] font-bold text-mist-400">
                    {result.session.seconds}s played · best combo x{result.session.combo} · {result.session.xp} XP · {result.session.coins} coins
                  </p>
                  {result.session.score >= result.best_score ? (
                    <p className="mt-1 text-[0.8rem] font-black text-gold-300">New personal best!</p>
                  ) : (
                    <p className="mt-1 text-[0.8rem] font-bold text-mist-500">Personal best {formatNumber(result.best_score)}</p>
                  )}
                  {result.challenges_resolved.length ? (
                    <p className="mt-1 text-[0.8rem] font-black text-mint-300">
                      {result.challenges_resolved.filter((row) => row.beaten).length} friend challenge
                      {result.challenges_resolved.filter((row) => row.beaten).length === 1 ? '' : 's'} beaten
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={onExit}>
                      Play another round
                    </Button>
                    <Button size="sm" variant="outline" icon={<ArrowLeft className="size-4" />} onClick={onExit}>
                      Back to the hub
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <Radio className="mx-auto size-6 animate-pulse text-nova-300" />
                  <p className="mt-2 text-[0.86rem] font-black text-mist-200">Opening your banked time…</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-white/8 px-3.5 py-2">
          <p className="min-w-0 truncate text-[0.72rem] font-bold text-mist-500">
            Tap the sparks, dodge the red X. Bank this run: {drain >= 0 ? 'charged every 15s' : 'free time'}
          </p>
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => void finish('time')}>
            End run
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ hub */

export default function GameArenaPanel() {
  const {toast} = useSession();
  const [hub, setHub] = useState<GameHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('hub');
  const [mode, setMode] = useState<Mode>('score_attack');
  const [boardScope, setBoardScope] = useState<'daily' | 'weekly' | 'friends' | 'personal'>('daily');
  const [board, setBoard] = useState<GameBoardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challenging, setChallenging] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHub(await api.game.hub());
    } catch (error) {
      toast('error', 'Could not open the arena', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openBoard = async (scope: typeof boardScope) => {
    setBoardScope(scope);
    setBoardLoading(true);
    try {
      const payload = await api.game.leaderboard(scope);
      setBoard(payload.rows ?? []);
    } catch (error) {
      toast('error', 'Board unavailable', (error as Error).message);
    } finally {
      setBoardLoading(false);
    }
  };

  const sendChallenge = async (opponentId: number) => {
    setChallenging(opponentId);
    try {
      const payload = await api.game.challenge({opponent_id: opponentId, mode, target_score: hub?.profile.best_score ?? 0});
      toast('success', `Challenge sent to ${payload.opponent}`, `Beat ${formatNumber(payload.target_score)} to win.`);
      setChallengeOpen(false);
      void load();
    } catch (error) {
      toast('error', 'Challenge failed', (error as Error).message);
    } finally {
      setChallenging(null);
    }
  };

  const pickCosmetic = async (kind: 'character' | 'trail', id: string) => {
    try {
      const payload = await api.game.cosmetics({[kind]: id} as {character?: string; trail?: string});
      setHub((current) => (current ? {...current, profile: {...current.profile, character: payload.character, trail: payload.trail}} : current));
      sfx.play('tap');
    } catch (error) {
      toast('error', 'Still locked', (error as Error).message);
    }
  };

  const earned = useMemo(() => hub?.achievements.filter((row) => row.earned).length ?? 0, [hub]);

  if (loading && !hub) {
    return (
      <div className="w-full space-y-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!hub) {
    return <EmptyState icon={<Gamepad2 className="size-5" />} title="Arena unavailable" detail="The game hub could not load. Try again in a moment." action={<Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button>} />;
  }

  if (view === 'run') {
    return <StarDash hub={hub} mode={mode} onToast={toast} onExit={() => { setView('hub'); void load(); }} />;
  }

  return (
    <div className="w-full min-w-0 space-y-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SectionHeading title="Game Arena" subtitle="Reading fills the bank — the arena spends it." />
        <Button size="sm" variant="ghost" icon={<Trophy className="size-4" />} onClick={() => { setView('board'); void openBoard(boardScope); }}>
          Leaderboards
        </Button>
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" />} onClick={() => setView('locker')}>
          Locker
        </Button>
      </div>

      <BankCard bank={hub.playtime} streak={hub.streak} />

      {view === 'board' ? (
        <Card className="min-w-0 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SectionHeading title="Leaderboards" subtitle="Daily, weekly, friends and your own best runs." />
            <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setView('hub')}>
              Back
            </Button>
          </div>
          <Segmented
            className="mt-3"
            value={boardScope}
            options={[
              {value: 'daily', label: 'Today'},
              {value: 'weekly', label: 'Week'},
              {value: 'friends', label: 'Friends'},
              {value: 'personal', label: 'My runs'},
            ]}
            onChange={(value) => void openBoard(value as typeof boardScope)}
          />
          {boardLoading ? (
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-11 w-full" />
              ))}
            </div>
          ) : board.length ? (
            <ol className="mt-3 min-w-0 space-y-1.5">
              {board.map((row, index) => (
                <li
                  key={`${row.student_id ?? row.id ?? index}`}
                  className={`flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 ${
                    row.you ? 'border-nova-400/40 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-[0.72rem] font-black tabular ${index < 3 ? 'brand-gradient text-white' : 'bg-white/6 text-mist-300'}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.86rem] font-bold text-mist-100">
                    {row.name ?? 'My run'} {row.you ? '· you' : ''}
                  </span>
                  <span className="shrink-0 text-[0.86rem] font-black text-gold-300 tabular">{formatNumber(row.score)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={<Trophy className="size-5" />} title="No runs yet" detail="Play a round and you will be the first name on the board." />
          )}
        </Card>
      ) : view === 'locker' ? (
        <Card className="min-w-0 p-4">
          <div className="flex min-w-0 items-center gap-2">
            <SectionHeading title="Locker" subtitle="Characters and trails unlock as your Study XP grows." />
            <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setView('hub')}>
              Back
            </Button>
          </div>
          <div className="mt-3 min-w-0 space-y-3">
            <div className="min-w-0">
 <p className="text-[0.7rem] font-black tracking-wide text-mist-500">Characters</p>
              <div className="mt-1.5 grid min-w-0 gap-2 sm:grid-cols-2">
                {hub.characters.map((row) => {
                  const unlocked = hub.profile.characters.includes(row.id);
                  const active = hub.profile.character === row.id;
                  return (
                    <button
                      key={row.id}
                      disabled={!unlocked}
                      onClick={() => void pickCosmetic('character', row.id)}
                      className={`min-w-0 rounded-xl border p-2.5 text-left transition-colors ${
                        active ? 'border-nova-400/50 bg-nova-500/14' : unlocked ? 'border-white/12 bg-white/[0.03] hover:border-white/20' : 'border-white/8 bg-white/[0.02] opacity-60'
                      }`}
                    >
                      <p className="text-[0.86rem] font-black text-mist-100">{row.name}</p>
                      <p className="text-[0.72rem] leading-snug text-mist-500">{unlocked ? row.blurb : `Unlocks at ${row.unlock_xp} Study XP`}</p>
                      <p className="mt-1 text-[0.68rem] font-black text-nova-300">{active ? 'In use' : unlocked ? 'Equip' : 'Locked'}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="min-w-0">
 <p className="text-[0.7rem] font-black tracking-wide text-mist-500">Trails</p>
              <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                {hub.trails.map((row) => {
                  const unlocked = hub.profile.trails.includes(row.id);
                  const active = hub.profile.trail === row.id;
                  return (
                    <button
                      key={row.id}
                      disabled={!unlocked}
                      onClick={() => void pickCosmetic('trail', row.id)}
                      className={`rounded-full border px-3 py-1.5 text-[0.74rem] font-bold ${
                        active ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : unlocked ? 'border-white/12 bg-white/[0.03] text-mist-300' : 'border-white/8 bg-white/[0.02] text-mist-600'
                      }`}
                    >
                      {row.name}
                      {!unlocked ? ` · ${row.unlock_xp} XP` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div className="min-w-0 space-y-3.5">
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
            <Card className="min-w-0 p-4">
              <SectionHeading title="Daily challenge" subtitle={hub.daily_challenge.title} action={hub.daily_challenge.done ? <Chip className="border-mint-500/25 bg-mint-500/12 text-mint-300">cleared</Chip> : null} />
              <ol className="mt-2.5 space-y-1.5">
                {hub.daily_challenge.board.slice(0, 5).map((row, index) => (
                  <li key={row.student_id} className="flex min-w-0 items-center gap-2 text-[0.82rem]">
                    <span className="w-4 shrink-0 text-mist-500 tabular">{index + 1}</span>
                    <span className={`min-w-0 flex-1 truncate font-bold ${row.you ? 'text-nova-200' : 'text-mist-300'}`}>{row.name}</span>
                    <span className="shrink-0 font-black text-gold-300 tabular">{formatNumber(row.score)}</span>
                  </li>
                ))}
                {!hub.daily_challenge.board.length ? <p className="text-[0.8rem] text-mist-500">Nobody has cleared it today — be the first.</p> : null}
              </ol>
              <Button
                className="mt-3"
                block
                variant="gold"
                icon={<Crown className="size-4" />}
                onClick={() => {
                  setMode('daily');
                  setView('run');
                }}
              >
                Take the daily challenge
              </Button>
            </Card>

            <Card className="min-w-0 p-4">
              <SectionHeading title="Personal bests" subtitle="Your own records, kept server-side." />
              <div className="mt-2.5 grid min-w-0 grid-cols-2 gap-2">
                {[
                  {label: 'Best score', value: formatNumber(hub.profile.best_score), icon: Trophy},
                  {label: 'Best run', value: `${hub.profile.best_survival_seconds}s`, icon: Clock3},
                  {label: 'Best combo', value: `x${hub.profile.best_combo}`, icon: Zap},
                  {label: 'Runs', value: formatNumber(hub.profile.runs), icon: Gamepad2},
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <tile.icon className="size-3.5 text-nova-300" />
                    <p className="mt-1 text-[0.95rem] font-black text-mist-50 tabular">{tile.value}</p>
 <p className="text-[0.64rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="min-w-0 p-4">
            <SectionHeading title="Play a round" subtitle={hub.locked ? 'Bank is empty — read a material to unlock more time.' : 'Pick a mode; the clock runs on your banked minutes.'} />
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mt-2.5 grid min-w-0 gap-2 sm:grid-cols-2">
              {MODES.map((row) => (
                <motion.button
                  key={row.id}
                  variants={staggerItem}
                  whileTap={{scale: 0.98}}
                  disabled={hub.locked && row.id !== 'score_attack' ? true : false}
                  onClick={() => {
                    setMode(row.id);
                    setView('run');
                  }}
                  className={`card min-w-0 p-3 text-left transition-colors hover:border-white/20 ${hub.locked ? 'opacity-60' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    <row.icon className="size-4 text-nova-300" />
                    <span className="text-[0.9rem] font-extrabold text-mist-50">{row.label}</span>
                    <span className="ml-auto text-[0.7rem] font-black text-mist-500">{row.seconds}s</span>
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-snug text-mist-500">{row.blurb}</span>
                </motion.button>
              ))}
            </motion.div>
            {hub.locked ? (
              <p className="mt-2.5 rounded-xl border border-flare-500/25 bg-flare-500/10 p-2.5 text-[0.78rem] font-bold text-flare-200">
                You have used today’s playtime. Finish a material section or a focus session to bank more.
              </p>
            ) : null}
          </Card>

          <Card className="min-w-0 p-4">
            <SectionHeading
              title="Friend challenges"
              subtitle="Send a target score — whoever beats it takes the round."
              action={
                <Button size="sm" variant="soft" icon={<Swords className="size-4" />} onClick={() => setChallengeOpen(true)}>
                  Challenge
                </Button>
              }
            />
            {hub.challenges.length ? (
              <ul className="mt-2.5 space-y-1.5">
                {hub.challenges.map((row) => (
                  <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <Swords className="size-3.5 shrink-0 text-flare-300" />
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] text-mist-300">
                      <span className="font-bold text-mist-100">{row.mine ? 'You' : row.from}</span> vs <span className="font-bold text-mist-100">{row.mine ? row.to : 'you'}</span> · target{' '}
                      {formatNumber(row.target_score)}
                    </span>
                    <Chip className={row.status === 'beaten' ? 'border-mint-500/25 bg-mint-500/12 text-mint-300' : 'border-white/10 bg-white/4 text-mist-400'}>
                      {row.status}
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Users className="size-5" />} title="No open challenges" detail="Send one to a friend and the next run decides it." />
            )}
          </Card>

          <Card className="min-w-0 p-4">
            <SectionHeading title="Achievements" subtitle={`${earned}/${hub.achievements.length} unlocked`} />
            <ProgressBar className="mt-2" value={(earned / Math.max(1, hub.achievements.length)) * 100} />
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mt-2.5 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {hub.achievements.map((row) => (
                <motion.div
                  key={row.key}
                  variants={staggerItem}
                  className={`flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 ${
                    row.earned ? 'border-gold-500/30 bg-gold-500/10' : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <Award className={`size-4 shrink-0 ${row.earned ? 'text-gold-300' : 'text-mist-600'}`} />
                  <div className="min-w-0">
                    <p className={`text-[0.82rem] font-black ${row.earned ? 'text-gold-100' : 'text-mist-300'}`}>{row.name}</p>
                    <p className="text-[0.7rem] leading-snug text-mist-500">{row.blurb}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </Card>

          <Card className="min-w-0 p-4">
            <SectionHeading title="Banked today" subtitle={`${Math.round(hub.today_played_seconds / 60)} min played · ${hub.study.xp_today} Study XP earned`} />
            <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
              <Chip className="border-mint-500/25 bg-mint-500/12 text-mint-300">
                <Coins className="size-3" /> {hub.friends.length} friends playing
              </Chip>
              {hub.study.next_threshold ? (
                <Chip className="border-nova-500/25 bg-nova-500/12 text-nova-200">
                  {hub.study.next_threshold - hub.study.xp_today} XP to the next unlock
                </Chip>
              ) : (
                <Chip className="border-gold-500/25 bg-gold-500/12 text-gold-300">All unlocks today are yours</Chip>
              )}
            </div>
          </Card>
        </div>
      )}

      <Modal open={challengeOpen} onClose={() => setChallengeOpen(false)} title="Challenge a friend" subtitle="They play a run and try to beat your target score.">
        <div className="min-w-0 space-y-2">
          {hub.friends.length ? (
            hub.friends.map((row) => (
              <button
                key={row.student_id}
                onClick={() => void sendChallenge(row.student_id)}
                disabled={challenging === row.student_id}
                className="flex min-w-0 w-full items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.03] p-2.5 text-left hover:border-nova-400/40"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full brand-gradient text-[0.72rem] font-black text-white">
                  {row.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.86rem] font-bold text-mist-100">{row.name}</span>
                <span className="shrink-0 text-[0.72rem] font-black text-mist-500">
                  {challenging === row.student_id ? 'Sending…' : `beat ${formatNumber(hub.profile.best_score)}`}
                </span>
              </button>
            ))
          ) : (
            <EmptyState icon={<Users className="size-5" />} title="No friends yet" detail="Add friends from the Friends tab to challenge them here." />
          )}
        </div>
      </Modal>
    </div>
  );
}
