/**
 * Practice arena + boss battles.
 *
 * Score, combos, lives and boss damage are all computed by the server; this
 * screen only ever renders what the API returns and sends the tapped option.
 */
import {
  AlertTriangle,
  Bomb,
  CheckCircle2,
  Flame,
  Gauge,
  Heart,
  ListChecks,
  Play,
  RotateCcw,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Swords,
  Target,
  Timer,
  Trophy,
  XCircle,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import Character from '../components/Character';
import {AnswerFeedback, AnswerTile, ComboMeter, Hearts} from '../components/GameQuestion';
import {Button, Card, Chip, EmptyState, ProgressBar, ReviewOptions, SectionHeading, Segmented, Select, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {HAPTICS} from '../lib/haptics';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';

type QuestionPayload = {
  id: number;
  text: string;
  options: Record<string, string>;
  display_order: string[];
  explanation?: string;
  hint?: string;
  difficulty?: string;
  topic?: string;
  media?: {question_image?: string; audio?: string};
};

type ModeRow = {key: string; label: string; size: number; lives: number; seconds: number; xp: number; best: number; played: number};
type Powerup = {key: string; name: string; blurb: string; icon: string};

const POWERUP_ICON: Record<string, typeof Zap> = {
  scissors: Bomb,
  lightbulb: Sparkles,
  snowflake: Snowflake,
  shield: Shield,
  'rotate-ccw': Timer,
  zap: Zap,
  flame: Flame,
};

function OptionButton({
  label,
  text,
  state,
  hidden,
  disabled,
  onClick,
}: {
  label: string;
  text: string;
  state: 'idle' | 'correct' | 'wrong';
  hidden: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (hidden) {
    return (
      <div className="sunken flex min-w-0 items-center gap-2.5 px-3 py-2.5 opacity-45">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.74rem] font-black text-mist-500">{label}</span>
        <span className="text-[0.84rem] font-semibold text-mist-500">Removed by 50/50</span>
      </div>
    );
  }
  return (
    <AnswerTile
      letter={label}
      text={text}
      state={state === 'correct' ? 'correct' : state === 'wrong' ? 'wrong' : 'idle'}
      disabled={disabled}
      onPick={onClick}
    />
  );
}

/* ------------------------------------------------------------------ practice */
function PracticeRun({mode, label, onExit}: {mode: string; label: string; onExit: () => void}) {
  const {toast, pushRewards, setProfile, profile} = useSession();
  const [run, setRun] = useState<{
    token: string;
    lives: number;
    seconds: number;
    questions: QuestionPayload[];
    powerups: Record<string, number>;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{correct: boolean; expected?: string; expected_label?: string | null; explanation?: string} | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [powerups, setPowerups] = useState<Record<string, number>>({});
  const [risk, setRisk] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [frozen, setFrozen] = useState(0);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const askedAt = useRef(Date.now());

  useEffect(() => {
    api.arena
      .startPractice({mode, size: 0})
      .then((payload) => {
        const data = payload as unknown as {token: string; lives: number; seconds: number; questions: QuestionPayload[]; powerups: Record<string, number>};
        setRun(data);
        setLives(data.lives);
        setPowerups(data.powerups ?? {});
        setRemaining(data.seconds);
        askedAt.current = Date.now();
      })
      .catch((error: Error) => toast('error', 'Could not start', error.message));
  }, [mode, toast]);

  useEffect(() => {
    if (!run || !run.seconds || summary) return undefined;
    const timer = window.setInterval(() => {
      setFrozen((value) => {
        if (value > 0) return value - 1;
        setRemaining((seconds) => Math.max(0, seconds - 1));
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [run, summary]);

  const question = run?.questions[index];
  const finished = Boolean(summary);

  const finish = useCallback(
    async (elapsedMs: number) => {
      if (!run) return;
      try {
        const result = await api.arena.finishPractice(run.token, elapsedMs);
        setSummary(result as unknown as Record<string, unknown>);
        const rewards = (result as {rewards?: unknown[]}).rewards ?? [];
        if (rewards.length) pushRewards(rewards as never);
        if ((result as {profile?: unknown}).profile) setProfile((result as {profile: never}).profile);
        HAPTICS.win();
        sfx.play('win');
      } catch (error) {
        toast('error', 'Could not finish the run', (error as Error).message);
      }
    },
    [pushRewards, run, setProfile, toast],
  );

  // Time attack: the server also refuses late answers, so the clock is honest.
  useEffect(() => {
    if (!run || !run.seconds || summary || remaining > 0) return;
    void finish((Date.now() - askedAt.current) * 0 + run.questions.length * 1000);
  }, [run, remaining, summary, finish]);

  const answer = async (label: string) => {
    if (!run || !question || picked || feedback) return;
    setPicked(label);
    try {
      const result = await api.arena.answerPractice({
        token: run.token,
        question_id: question.id,
        selected: label,
        elapsed_ms: Date.now() - askedAt.current,
        risk,
      });
      const data = result as unknown as {correct: boolean; expected: string; expected_label: string | null; explanation: string; score: number; combo: number; lives: number; finished: boolean; powerups: Record<string, number>; max_combo?: number};
      setFeedback({correct: data.correct, expected: data.expected, expected_label: data.expected_label, explanation: data.explanation});
      setScore(data.score);
      setCombo(data.combo);
      setLives(data.lives);
      setPowerups(data.powerups ?? powerups);
      if (data.correct) {
        sfx.play('correct');
        HAPTICS.correct();
      } else {
        sfx.play('wrong');
        HAPTICS.wrong();
      }
      if (data.finished) {
        window.setTimeout(() => void finish(Date.now() - askedAt.current), 900);
      }
    } catch (error) {
      setPicked(null);
      toast('error', 'Answer not saved', (error as Error).message);
    }
  };

  const next = () => {
    setFeedback(null);
    setPicked(null);
    setHidden([]);
    setIndex((value) => value + 1);
    askedAt.current = Date.now();
  };

  const usePowerup = async (key: string) => {
    if (!run || !question) return;
    try {
      const result = await api.arena.usePowerup(run.token, key, question.id);
      const data = result as unknown as {hidden?: string[]; hint?: string; freeze_seconds?: number; powerups?: Record<string, number>};
      if (data.powerups) setPowerups(data.powerups);
      if (data.hidden) setHidden(data.hidden);
      if (data.freeze_seconds) setFrozen(data.freeze_seconds);
      if (data.hint) setFeedback((current) => ({...(current ?? {correct: false}), explanation: data.hint}));
    } catch (error) {
      toast('error', 'Power-up failed', (error as Error).message);
    }
  };

  if (finished) {
    const correct = Number(summary?.correct ?? 0);
    const total = Number(summary?.total ?? 0);
    return (
      <Card className="relative overflow-hidden p-5 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full bg-nova-600/20 blur-3xl" />
        <div className="relative mx-auto grid size-16 place-items-center rounded-3xl brand-gradient text-white">
          {summary?.perfect ? <Trophy className="size-7" /> : <Gauge className="size-7" />}
        </div>
        <h3 className="relative mt-3 text-lg font-black text-mist-50">
          {summary?.perfect ? 'Perfect run!' : `${correct}/${total} correct`}
        </h3>
        <p className="relative mt-1 text-[0.84rem] font-medium text-mist-500">
          {label} · {Number(summary?.score ?? 0)} points · best combo {Number(summary?.max_combo ?? 0)}x
        </p>
        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Chip className="border-white/12 bg-white/6 text-mist-300">+{Number(summary?.xp ?? 0)} XP</Chip>
          <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200">+{Number(summary?.coins ?? 0)} coins</Chip>
          <Chip className="border-white/12 bg-white/6 text-mist-300">best {Number(summary?.best ?? 0)}</Chip>
          <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{summary?.new_best ? 'New personal best' : 'Keep pushing'}</Chip>
        </div>
        <div className="relative mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onExit}>Back to modes</Button>
        </div>
      </Card>
    );
  }

  if (!run || !question) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip className="border-white/12 bg-white/6 text-mist-300">{label}</Chip>
        <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200" icon={<Zap className="size-3.5" />}>
          {score} pts
        </Chip>
        <ComboMeter combo={combo} />
        {run.lives > 0 && (
          <span className="sunken flex items-center gap-1.5 px-2.5 py-1">
            <Hearts value={Math.max(0, lives)} max={run.lives} />
          </span>
        )}
        {run.seconds > 0 && (
          <Chip className="border-white/12 bg-white/6 text-mist-300" icon={<Timer className="size-3.5" />}>
            {frozen > 0 ? `frozen ${frozen}s` : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
          </Chip>
        )}
        <Chip className="ml-auto border-white/12 bg-white/6 text-mist-400">
          {index + 1}/{run.questions.length}
        </Chip>
      </div>

      <ProgressBar value={((index + (feedback ? 1 : 0)) / run.questions.length) * 100} />

      <Card className="relative overflow-hidden p-4 sm:p-5">
        {/* The hero watches the drill: cheering a hit, wincing a miss. */}
        <Character
          mood={feedback ? (feedback.correct ? 'cheer' : 'sad') : 'idle'}
          size={54}
          tone="day"
          className="absolute -top-2 right-1 hidden opacity-95 sm:block"
          label="Arena hero"
        />
        <div className="flex items-center gap-2">
          <Chip className="border-white/12 bg-white/6 text-mist-400">{question.topic || 'Practice'}</Chip>
          <Chip className="border-white/12 bg-white/6 text-mist-400">{question.difficulty || 'medium'}</Chip>
          <button
            type="button"
            onClick={() => setRisk((value) => !value)}
            className={`ml-auto rounded-xl border px-2.5 py-1 text-[0.7rem] font-extrabold transition-colors ${
              risk ? 'border-gold-500/40 bg-gold-500/15 text-gold-200' : 'border-white/12 bg-white/6 text-mist-400'
            }`}
            title="Risk mode: double points for a correct answer, −50 for a miss"
          >
            RISK
          </button>
        </div>
        {question.media?.question_image && (
          <img src={question.media.question_image} alt="" className="mt-3 max-h-52 w-full rounded-2xl object-contain" />
        )}
        <p className="mt-3 text-[0.98rem] leading-relaxed font-extrabold text-mist-50">{question.text}</p>
        {question.media?.audio && <audio className="mt-3 w-full" controls src={question.media.audio} />}

        <div className="mt-4 grid gap-2">
          {question.display_order.map((key, position) => {
            const label = 'ABCD'[position] ?? '';
            const state: 'idle' | 'correct' | 'wrong' =
              feedback && feedback.expected_label === label
                ? 'correct'
                : picked === label && feedback && !feedback.correct
                  ? 'wrong'
                  : 'idle';
            return (
              <OptionButton
                key={key}
                label={label}
                text={question.options[label] ?? ''}
                state={state}
                hidden={hidden.includes(key)}
                disabled={Boolean(picked)}
                onClick={() => void answer(label)}
              />
            );
          })}
        </div>

        <AnimatePresence>
          {feedback && (
            <motion.div initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} className="mt-4">
              <AnswerFeedback
                cosmetics={profile?.cosmetics}
                correct={feedback.correct}
                chosen={picked}
                answer={feedback.expected_label ?? feedback.expected ?? null}
                combo={combo}
                note={feedback.explanation || undefined}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {Object.entries(powerups).map(([key, count]) => {
          const Icon = POWERUP_ICON[key] ?? Zap;
          return (
            <button
              key={key}
              disabled={count <= 0 || Boolean(feedback)}
              onClick={() => void usePowerup(key)}
              className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-white/12 bg-ink-900/70 px-3 py-2 text-[0.74rem] font-bold text-mist-300 disabled:opacity-40"
            >
              <Icon className="size-3.5" />
              {key.replace('_', ' ')}
              <span className="text-mist-500">×{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        {feedback ? (
          <Button variant="primary" className="flex-1" onClick={next} disabled={index + 1 >= run.questions.length && !summary}>
            {index + 1 >= run.questions.length ? 'Finish run' : 'Next question'}
          </Button>
        ) : (
          <Button variant="ghost" className="flex-1" onClick={() => void finish((index + 1) * 1000)}>
            End run early
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- boss */
function BossFight({bossKey, onExit}: {bossKey: string; onExit: () => void}) {
  const {toast, pushRewards} = useSession();
  const [fight, setFight] = useState<{run_id: number; boss: {name: string; hp_max: number; lives: number}; questions: QuestionPayload[]} | null>(null);
  const [index, setIndex] = useState(0);
  const [hp, setHp] = useState(0);
  const [damage, setDamage] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{correct: boolean; damage: number; crit: boolean; expected?: string} | null>(null);
  const [over, setOver] = useState<{won: boolean; rewards?: unknown[]} | null>(null);
  const askedAt = useRef(Date.now());

  useEffect(() => {
    api.arena
      .startBoss({boss_key: bossKey, size: 0})
      .then((payload) => {
        const data = payload as unknown as {run_id: number; boss: {name: string; hp_max: number; lives: number}; questions: QuestionPayload[]};
        setFight(data);
        setHp(data.boss.hp_max);
        setLives(data.boss.lives);
        askedAt.current = Date.now();
      })
      .catch((error: Error) => toast('error', 'Boss unavailable', error.message));
  }, [bossKey, toast]);

  const question = fight?.questions[index];

  const strike = async (label: string) => {
    if (!fight || !question || picked) return;
    setPicked(label);
    try {
      const result = await api.arena.answerBoss({
        run_id: fight.run_id,
        question_id: question.id,
        selected: label,
        elapsed_ms: Date.now() - askedAt.current,
        combo,
      });
      const data = result as unknown as {correct: boolean; damage: number; crit: boolean; combo: number; hp_left: number; lives: number; finished: boolean; won?: boolean; rewards?: unknown[]};
      setHp(data.hp_left);
      setCombo(data.combo);
      setLives(data.lives);
      setDamage((value) => value + data.damage);
      setFeedback({correct: data.correct, damage: data.damage, crit: data.crit});
      if (data.correct) {
        sfx.play('correct');
        HAPTICS.correct();
      } else {
        sfx.play('wrong');
        HAPTICS.wrong();
      }
      if (data.finished) {
        setOver({won: Boolean(data.won), rewards: data.rewards});
        if (data.rewards?.length) pushRewards(data.rewards as never);
      }
    } catch (error) {
      setPicked(null);
      toast('error', 'Attack failed', (error as Error).message);
    }
  };

  if (over) {
    return (
      <Card className="p-5 text-center">
        <div className={`mx-auto grid size-16 place-items-center rounded-3xl ${over.won ? 'brand-gradient' : 'bg-gradient-to-br from-flare-600 to-nova-700'} text-white`}>
          {over.won ? <Trophy className="size-7" /> : <Skull className="size-7" />}
        </div>
        <h3 className="mt-3 text-lg font-black text-mist-50">{over.won ? 'Boss defeated!' : 'The boss survived'}</h3>
        <p className="mt-1 text-[0.84rem] font-medium text-mist-500">{damage} total damage · best combo {combo}x</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="primary" onClick={onExit}>Back to bosses</Button>
        </div>
      </Card>
    );
  }

  if (!fight || !question) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Card className="relative overflow-hidden p-4">
        <div className="pointer-events-none absolute -top-20 -right-16 size-44 rounded-full bg-rose-600/18 blur-3xl" />
        <div className="relative flex items-center gap-2">
          <Skull className="size-4 text-rose-300" />
          <h3 className="min-w-0 truncate text-[0.95rem] font-black text-mist-50">{fight.boss.name}</h3>
          <Chip className="ml-auto border-white/12 bg-white/6 text-mist-300" icon={<Swords className="size-3.5" />}>
            {combo > 1 ? `${combo}x combo` : 'combo —'}
          </Chip>
        </div>
        <div className="relative mt-3">
          <div className="flex items-center justify-between text-[0.72rem] font-bold text-mist-400">
            <span>Boss HP</span>
            <span>
              {Math.max(0, hp)}/{fight.boss.hp_max}
            </span>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-ink-800">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400"
              animate={{width: `${Math.max(0, (hp / Math.max(fight.boss.hp_max, 1)) * 100)}%`}}
              transition={{type: 'spring', stiffness: 220, damping: 26}}
            />
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-2">
          <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200" icon={<Zap className="size-3.5" />}>{damage} damage</Chip>
          {fight.boss.lives > 0 && (
            <Chip className="border-rose-500/25 bg-rose-500/10 text-rose-200" icon={<Heart className="size-3.5" />}>
              {Math.max(0, lives)} lives
            </Chip>
          )}
          <Chip className="ml-auto border-white/12 bg-white/6 text-mist-400">
            {index + 1}/{fight.questions.length}
          </Chip>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="text-[0.98rem] leading-relaxed font-extrabold text-mist-50">{question.text}</p>
        <div className="mt-4 grid gap-2">
          {question.display_order.map((key, position) => {
            const label = 'ABCD'[position] ?? '';
            return (
              <OptionButton
                key={key}
                label={label}
                text={question.options[label] ?? ''}
                state={feedback && feedback.correct && picked === label ? 'correct' : feedback && !feedback.correct && picked === label ? 'wrong' : 'idle'}
                hidden={false}
                disabled={Boolean(picked)}
                onClick={() => void strike(label)}
              />
            );
          })}
        </div>
        <AnimatePresence>
          {feedback && (
            <motion.p
              initial={{opacity: 0, y: 22, scale: 0.9}}
              animate={{opacity: 1, y: 0, scale: 1}}
              exit={{opacity: 0}}
              className={`mt-4 text-center text-[1.05rem] font-black ${feedback.correct ? 'text-mint-300' : 'text-rose-300'}`}
            >
              {feedback.correct ? `${feedback.crit ? 'Critical! ' : ''}−${feedback.damage} HP` : 'The boss heals a little…'}
            </motion.p>
          )}
        </AnimatePresence>
      </Card>

      <div className="flex gap-2">
        {feedback ? (
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => {
              setFeedback(null);
              setPicked(null);
              setIndex((value) => value + 1);
              askedAt.current = Date.now();
            }}
          >
            Next attack
          </Button>
        ) : (
          <p className="flex-1 text-center text-[0.78rem] font-semibold text-mist-500">
            Correct answers deal damage — answer inside 5 seconds for a critical hit.
          </p>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- custom practice */
type CatalogTopic = {topic: string; key: string; count: number};
type CatalogCourse = {id: number; code: string; title: string; accent: string; available: number; topics: CatalogTopic[]};
type PracticeCatalog = {courses: CatalogCourse[]; count_choices: number[]; duration_choices_minutes: number[]};
type RunStats = {answered: number; correct: number; wrong: number; remaining: number};

type CustomRunPayload = {
  token: string;
  questions: QuestionPayload[];
  ends_at: string | null;
  server_now: string | null;
  duration_seconds: number;
  course: {id: number; code: string; title: string; accent: string} | null;
  topic: string;
  index: number;
  stats: RunStats;
  finished: boolean;
};

type ReviewRow = {
  id: number;
  text: string;
  topic: string;
  options: Record<string, string>;
  chosen_label: string | null;
  chosen_text: string | null;
  correct_label: string | null;
  correct_text: string;
  correct: boolean;
  answered: boolean;
  explanation: string;
};

type RunSummary = {
  correct: number;
  wrong: number;
  total: number;
  score: number;
  score_percent: number;
  time_used_seconds: number;
  course: {id?: number; code?: string; title?: string} | null;
  topic: string;
  xp: number;
  coins: number;
  perfect: boolean;
  review: ReviewRow[];
};

function clock(seconds: number): string {
  return `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
}

function PickChip({active, children, onClick, disabled = false}: {active: boolean; children: ReactNode; onClick: () => void; disabled?: boolean}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-full border px-3.5 py-2 text-[0.78rem] font-bold transition-colors touch-manipulation disabled:opacity-40 ${
        active ? 'border-nova-400/60 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400 hover:text-mist-200'
      }`}
    >
      {children}
    </button>
  );
}

/** Course → Topic → Number of questions → Duration → Start. */
function CustomSetup({catalog, onStart, busy}: {catalog: PracticeCatalog; onStart: (courseId: number, topicKey: string, count: number, minutes: number) => void; busy: boolean}) {
  const [courseId, setCourseId] = useState<number | null>(null);
  const [topicKey, setTopicKey] = useState('');
  const [count, setCount] = useState(0);
  const [minutes, setMinutes] = useState(30);

  const course = catalog.courses.find((row) => row.id === courseId) ?? catalog.courses[0] ?? null;
  const topics = course?.topics ?? [];
  const available = topicKey ? (topics.find((row) => row.key === topicKey)?.count ?? 0) : (course?.available ?? 0);
  const standardCounts = (catalog.count_choices?.length ? catalog.count_choices : [5, 10, 20, 30, 40, 50]).filter((size) => size <= available);
  const choices = standardCounts.length ? [...standardCounts, available] : available > 0 ? [available] : [];
  const uniqueChoices = [...new Set(choices)];
  // follow the availability: never leave a selected count the bank cannot fill
  const effectiveCount = uniqueChoices.includes(count) ? count : (uniqueChoices.find((size) => size >= 20) ?? uniqueChoices[uniqueChoices.length - 1] ?? 0);
  const durations = catalog.duration_choices_minutes?.length ? catalog.duration_choices_minutes : [10, 20, 30, 40, 50, 60];
  const capped = available > 0 && effectiveCount > available;

  if (!catalog.courses.length) {
    return (
      <EmptyState
        icon={<Gauge className="size-5" />}
        title="No questions available yet"
        detail="An admin needs to publish questions with a course before practice can start."
      />
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <SectionHeading
        title="Set up your practice"
        subtitle="Pick a course, a topic, how many questions and how long — the server draws random questions and owns the clock."
        icon={<Target className="size-4" />}
      />

      {/* 1 — course */}
      <div className="mt-4">
 <p className="text-[0.7rem] font-black tracking-wider text-mist-500">1 · Course</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {catalog.courses.map((row) => {
            const active = course?.id === row.id;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setCourseId(row.id);
                  setTopicKey('');
                  setCount(0);
                }}
                className={`rounded-2xl border p-3 text-left transition-colors touch-manipulation ${
                  active ? 'border-nova-400/50 bg-nova-500/12' : 'border-white/10 bg-ink-900/60 hover:border-white/25'
                }`}
              >
                <span className="text-[0.78rem] font-black" style={{color: row.accent}}>
                  {row.code}
                </span>
                <span className="mt-0.5 block truncate text-[0.84rem] font-bold text-mist-100">{row.title}</span>
                <span className="mt-0.5 block text-[0.7rem] font-semibold text-mist-500">{row.available} questions</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 — topic */}
      <div className="mt-4">
 <p className="text-[0.7rem] font-black tracking-wider text-mist-500">2 · Topic</p>
        <div className="mt-2">
          <Select value={topicKey} onChange={(event) => {setTopicKey(event.target.value); setCount(0);}} aria-label="Topic">
            <option value="">All topics ({course?.available ?? 0} questions)</option>
            {topics.map((topic) => (
              <option key={topic.key || 'general'} value={topic.key}>
                {topic.topic} ({topic.count} {topic.count === 1 ? 'question' : 'questions'})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 3 — number of questions */}
      <div className="mt-4">
 <p className="text-[0.7rem] font-black tracking-wider text-mist-500">3 · Number of questions</p>
        <div className="no-scrollbar mt-2 flex flex-wrap gap-2">
          {uniqueChoices.map((size) => (
            <PickChip key={size} active={effectiveCount === size} onClick={() => setCount(size)}>
              {standardCounts.includes(size) ? size : `All ${size}`}
            </PickChip>
          ))}
        </div>
        {available > 0 && effectiveCount >= available && (
          <p className="mt-2 text-[0.76rem] font-semibold text-amber-300">
            Only {available} {available === 1 ? 'question is' : 'questions are'} available for {topicKey ? topics.find((row) => row.key === topicKey)?.topic ?? 'this topic' : 'this course'}.
          </p>
        )}
      </div>

      {/* 4 — duration */}
      <div className="mt-4">
 <p className="text-[0.7rem] font-black tracking-wider text-mist-500">4 · Practice duration</p>
        <div className="no-scrollbar mt-2 flex flex-wrap gap-2">
          {durations.map((value) => (
            <PickChip key={value} active={minutes === value} onClick={() => setMinutes(value)}>
              {value} min
            </PickChip>
          ))}
        </div>
      </div>

      <Button
        variant="primary"
        className="mt-5 w-full"
        size="md"
        disabled={busy || !course || available < 1 || effectiveCount < 1 || capped}
        icon={<Play className="size-4" />}
        onClick={() => course && onStart(course.id, topicKey, effectiveCount, minutes)}
      >
        {busy ? 'Preparing your questions…' : 'Start practice'}
      </Button>
    </Card>
  );
}

/** One custom run: timed, refresh-proof, graded by the server. */
function CustomRun({run, expired, onNewPractice}: {run: CustomRunPayload; expired: boolean; onNewPractice: () => void}) {
  const {toast, pushRewards, setProfile, profile} = useSession();
  const [index, setIndex] = useState(() => Math.max(0, Math.min(run.index ?? 0, run.questions.length - 1)));
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{correct: boolean; expectedLabel: string | null; explanation: string; chosen: string} | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<RunStats>(run.stats ?? {answered: 0, correct: 0, wrong: 0, remaining: run.questions.length});
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const askedAt = useRef(Date.now());
  const finishing = useRef(false);
  const skew = useRef(0);

  if (run.server_now) {
    skew.current = Date.now() - Date.parse(run.server_now);
  }

  // The countdown is computed from the server's ends_at (corrected for clock
  // skew), so a refresh, a nap or a lying device clock cannot bend it.
  useEffect(() => {
    if (!run.ends_at) return undefined;
    const endsAt = Date.parse(run.ends_at);
    const update = () => setRemaining(Math.max(0, Math.ceil((endsAt - (Date.now() - skew.current)) / 1000)));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [run.ends_at]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const result = (await api.arena.finishPractice(run.token, 0)) as unknown as RunSummary & {rewards?: unknown[]; profile?: unknown};
      setSummary(result);
      if (result.rewards?.length) pushRewards(result.rewards as never);
      if (result.profile) setProfile(result.profile as never);
      HAPTICS.win();
      sfx.play('win');
    } catch (error) {
      finishing.current = false;
      toast('error', 'Could not finish practice', (error as Error).message);
    }
  }, [pushRewards, run.token, setProfile, toast]);

  // resumed an already-expired run (tab was closed at 00:00): collect the result
  useEffect(() => {
    if (expired && !summary) void finish();
  }, [expired, summary, finish]);

  // the clock reached 00:00 — end it, no more answers
  useEffect(() => {
    if (remaining === 0 && !summary) void finish();
  }, [remaining, summary, finish]);

  const question = run.questions[index];
  const total = run.questions.length;

  const submit = async () => {
    if (!question || !picked || feedback || submitting) return;
    setSubmitting(true);
    try {
      const result = (await api.arena.answerPractice({
        token: run.token,
        question_id: question.id,
        selected: picked,
        elapsed_ms: Date.now() - askedAt.current,
      })) as unknown as {correct: boolean; expected: string; expected_label: string | null; explanation: string; finished: boolean};
      setFeedback({correct: result.correct, expectedLabel: result.expected_label, explanation: result.explanation, chosen: picked});
      setStats((current) => ({
        answered: current.answered + 1,
        correct: current.correct + (result.correct ? 1 : 0),
        wrong: current.wrong + (result.correct ? 0 : 1),
        remaining: Math.max(0, current.remaining - 1),
      }));
      if (result.correct) {
        sfx.play('correct');
        HAPTICS.correct();
      } else {
        sfx.play('wrong');
        HAPTICS.wrong();
      }
      if (result.finished) {
        window.setTimeout(() => void finish(), 1400);
      }
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('Time is up')) {
        void finish();
        return;
      }
      if (message.includes('not found') || message.includes('no longer')) {
        // the question was deleted mid-session — skip to the next one
        toast('error', 'Question removed', 'That question was removed from the bank — moving on.');
        setPicked(null);
        setIndex((value) => Math.min(value + 1, total - 1));
        askedAt.current = Date.now();
        return;
      }
      toast('error', 'Answer not saved', message);
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    setFeedback(null);
    setPicked(null);
    setIndex((value) => Math.min(value + 1, total - 1));
    askedAt.current = Date.now();
  };

  const endEarly = async () => {
    if (stats.answered > 0) {
      await finish();
      return;
    }
    try {
      await api.arena.abandonPractice(run.token);
    } catch {
      /* abandoning is best-effort */
    }
    onNewPractice();
  };

  /* ------------------------------------------------------------ the result */
  if (summary) {
    return (
      <div className="grid gap-3">
        <Card className="relative overflow-hidden p-5 text-center">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full bg-nova-600/20 blur-3xl" />
          <div className="relative mx-auto grid size-16 place-items-center rounded-3xl brand-gradient text-white">
            {summary.perfect ? <Trophy className="size-7" /> : <Target className="size-7" />}
          </div>
          <h3 className="relative mt-3 text-lg font-black tracking-wide text-mist-50">Practice completed</h3>
          <p className="relative mt-1 text-[0.84rem] font-medium text-mist-500">
            {summary.course?.title ?? run.course?.title ?? 'Practice'}
            {summary.topic || run.topic ? ` · ${summary.topic || run.topic}` : ''}
          </p>
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/4 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-mist-500">Questions</p>
              <p className="text-[0.98rem] font-black text-mist-100">{summary.total}</p>
            </div>
            <div className="rounded-xl border border-mint-500/25 bg-mint-500/10 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-mint-300">Correct</p>
              <p className="text-[0.98rem] font-black text-mint-100">{summary.correct}</p>
            </div>
            <div className="rounded-xl border border-flare-500/25 bg-flare-500/10 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-flare-300">Wrong</p>
              <p className="text-[0.98rem] font-black text-flare-100">{summary.wrong}</p>
            </div>
            <div className="rounded-xl border border-gold-500/25 bg-gold-500/10 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-gold-300">Score</p>
              <p className="text-[0.98rem] font-black text-gold-100">{summary.score_percent}%</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/4 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-mist-500">Time used</p>
              <p className="text-[0.98rem] font-black text-mist-100">{clock(summary.time_used_seconds)}</p>
            </div>
            <div className="rounded-xl border border-nova-500/25 bg-nova-500/10 px-2 py-2">
 <p className="text-[0.64rem] font-black tracking-wider text-nova-300">Rewards</p>
              <p className="text-[0.98rem] font-black text-nova-100">+{summary.xp} XP · +{summary.coins}</p>
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={onNewPractice} icon={<RotateCcw className="size-4" />}>
              New practice
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeading title="Review your answers" subtitle="Every question, your pick, the right answer and why." icon={<ListChecks className="size-4" />} />
          <ul className="mt-3 grid gap-2">
            {summary.review.map((row, position) => (
              <li
                key={row.id}
                className={`rounded-2xl border p-3 ${row.correct ? 'border-mint-500/25 bg-mint-500/6' : row.answered ? 'border-flare-500/25 bg-flare-500/6' : 'border-white/10 bg-white/[0.03]'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full ${row.correct ? 'bg-mint-500/20 text-mint-300' : 'bg-flare-500/20 text-flare-300'}`}>
                    {row.correct ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  </span>
 <span className="text-[0.68rem] font-black tracking-wider text-mist-500">Question {position + 1}</span>
                  {row.topic && <Chip className="border-white/12 bg-white/6 text-[0.62rem] text-mist-400">{row.topic}</Chip>}
                </div>
                <p className="mt-1.5 text-[0.86rem] leading-snug font-bold text-mist-100">{row.text}</p>
                <ReviewOptions options={row.options} correct={row.correct_label} chosen={row.chosen_label} />
                <div className="mt-2 grid gap-1 text-[0.78rem] font-semibold">
                  <p className="text-mist-400">
                    Your answer:{' '}
                    {row.answered && row.chosen_label ? (
                      <span className={row.correct ? 'text-mint-300' : 'text-flare-300'}>
                        {row.chosen_label}. {row.chosen_text}
                      </span>
                    ) : (
                      <span className="text-mist-500">not answered</span>
                    )}
                  </p>
                  <p className="text-mist-400">
                    Correct answer: <span className="text-mint-300">{row.correct_label}. {row.correct_text}</span>
                  </p>
                  {row.explanation && <p className="leading-relaxed text-mist-500">{row.explanation}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  /* -------------------------------------------------------------- the run */
  if (!question) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title="This run has no questions left"
        detail="The questions were removed from the bank while you practised. Start a fresh run."
        action={<Button variant="primary" onClick={onNewPractice}>Back to setup</Button>}
      />
    );
  }

  const timerLow = remaining !== null && remaining <= 60;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {run.course && (
          <Chip className="border-white/12 bg-white/6 text-mist-300">
            <span style={{color: run.course.accent}} className="font-black">{run.course.code}</span>
          </Chip>
        )}
        <Chip className="border-white/12 bg-white/6 text-mist-300">{run.topic || 'All topics'}</Chip>
        <Chip className="ml-auto border-white/12 bg-white/6 text-mist-400">
          {index + 1} / {total}
        </Chip>
        {remaining !== null && (
          <Chip className={`${timerLow ? 'animate-pulse border-flare-500/40 bg-flare-500/12 text-flare-200' : 'border-white/12 bg-white/6 text-mist-300'}`} icon={<Timer className="size-3.5" />}>
            {clock(remaining)}
          </Chip>
        )}
      </div>

      <ProgressBar value={(stats.answered / Math.max(total, 1)) * 100} />

      <div className="flex flex-wrap gap-1.5 text-[0.7rem] font-bold">
        <span className="rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-mist-400">{stats.answered} answered</span>
        <span className="rounded-full border border-mint-500/25 bg-mint-500/10 px-2.5 py-1 text-mint-300">{stats.correct} correct</span>
        <span className="rounded-full border border-flare-500/25 bg-flare-500/10 px-2.5 py-1 text-flare-300">{stats.wrong} wrong</span>
        <span className="rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-mist-400">{stats.remaining} remaining</span>
      </div>

      <Card className="relative overflow-hidden p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Chip className="border-white/12 bg-white/6 text-mist-400">{question.topic || 'Practice'}</Chip>
          <Chip className="border-white/12 bg-white/6 text-mist-400">{question.difficulty || 'medium'}</Chip>
 <span className="ml-auto text-[0.7rem] font-black tracking-wider text-mist-500">
            Question {index + 1} of {total}
          </span>
        </div>
        {question.media?.question_image && (
          <img src={question.media.question_image} alt="" className="mt-3 max-h-52 w-full rounded-2xl object-contain" />
        )}
        <p className="mt-3 text-[0.98rem] leading-relaxed font-extrabold text-mist-50">{question.text}</p>
        {question.media?.audio && <audio className="mt-3 w-full" controls src={question.media.audio} />}

        <div className="mt-4 grid gap-2">
          {question.display_order.map((key, position) => {
            const label = 'ABCD'[position] ?? '';
            const state: 'idle' | 'picked' | 'correct' | 'wrong' | 'muted' = feedback
              ? label === feedback.expectedLabel
                ? 'correct'
                : label === feedback.chosen && !feedback.correct
                  ? 'wrong'
                  : 'muted'
              : picked === label
                ? 'picked'
                : 'idle';
            return (
              <AnswerTile
                key={key}
                letter={label}
                text={question.options[label] ?? ''}
                state={state}
                disabled={Boolean(feedback) || submitting}
                onPick={() => setPicked(label)}
              />
            );
          })}
        </div>

        <AnimatePresence>
          {feedback && (
            <motion.div initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} className="mt-4">
              <AnswerFeedback
                cosmetics={profile?.cosmetics}
                correct={feedback.correct}
                chosen={feedback.chosen}
                answer={feedback.expectedLabel}
                note={
                  <>
                    <p className="font-semibold">
                      {feedback.correct ? 'Correct!' : `Correct answer: ${feedback.expectedLabel ?? '—'}. ${question.options[feedback.expectedLabel ?? ''] ?? ''}`}
                    </p>
                    {feedback.explanation && <p className="mt-1 leading-relaxed">{feedback.explanation}</p>}
                  </>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="flex gap-2">
        {feedback ? (
          <Button variant="primary" className="flex-1" onClick={next} disabled={index + 1 >= total}>
            {index + 1 >= total ? 'Finishing…' : 'Next question'}
          </Button>
        ) : (
          <>
            <Button variant="ghost" className="flex-1" onClick={() => void endEarly()} disabled={submitting}>
              End practice
            </Button>
            <Button variant="primary" className="flex-1" onClick={() => void submit()} disabled={!picked || submitting}>
              {submitting ? 'Checking…' : 'Submit answer'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The custom-practice tab: setup → run → result, resuming an open run first. */
function CustomPractice() {
  const {toast} = useSession();
  const [phase, setPhase] = useState<'loading' | 'setup' | 'run'>('loading');
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [run, setRun] = useState<CustomRunPayload | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog((await api.arena.practiceCatalog()) as unknown as PracticeCatalog);
    } catch (error) {
      toast('error', 'Practice unavailable', (error as Error).message);
      setCatalog({courses: [], count_choices: [], duration_choices_minutes: []});
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // A refresh must land back inside the same session — same questions, same
      // order, same shuffled options — never a brand-new paper.
      try {
        const active = (await api.arena.practiceActive()) as unknown as {run: CustomRunPayload | null; expired: boolean};
        if (!alive) return;
        if (active.run) {
          setRun(active.run);
          setExpired(Boolean(active.expired));
          setPhase('run');
          return;
        }
      } catch {
        /* no session to resume — fall through to the setup screen */
      }
      await loadCatalog();
      if (alive) setPhase('setup');
    })();
    return () => {
      alive = false;
    };
  }, [loadCatalog]);

  const start = async (courseId: number, topicKey: string, count: number, minutes: number) => {
    setBusy(true);
    try {
      const payload = (await api.arena.startPractice({
        mode: 'custom',
        course_id: courseId,
        topic: topicKey,
        size: count,
        time_limit_seconds: minutes * 60,
      })) as unknown as CustomRunPayload;
      setRun(payload);
      setExpired(false);
      setPhase('run');
    } catch (error) {
      toast('error', 'Could not start practice', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backToSetup = async () => {
    setRun(null);
    setExpired(false);
    await loadCatalog();
    setPhase('setup');
  };

  if (phase === 'loading' || (phase === 'setup' && !catalog)) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (phase === 'run' && run) {
    return <CustomRun run={run} expired={expired} onNewPractice={() => void backToSetup()} />;
  }
  return <CustomSetup catalog={catalog as PracticeCatalog} onStart={(courseId, topicKey, count, minutes) => void start(courseId, topicKey, count, minutes)} busy={busy} />;
}

/* --------------------------------------------------------------------- panel */
export default function PracticePanel() {
  const {toast} = useSession();
  const [tab, setTab] = useState<'custom' | 'practice' | 'boss'>('custom');
  const [modes, setModes] = useState<{modes: ModeRow[]; powerups: Powerup[]} | null>(null);
  const [bossHome, setBossHome] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState<{mode: string; label: string} | null>(null);
  const [fighting, setFighting] = useState<string | null>(null);

  useEffect(() => {
    api.arena.practiceModes().then((payload) => setModes(payload as unknown as {modes: ModeRow[]; powerups: Powerup[]})).catch((error: Error) => toast('error', 'Practice unavailable', error.message));
    api.arena.bossHome().then(setBossHome).catch(() => setBossHome(null));
    api.arena.practiceHistory().then(setHistory).catch(() => setHistory(null));
  }, [toast]);

  const bosses = useMemo(() => (bossHome?.bosses as {key: string; name: string; hp_per_question: number; lives: number; cycle: string}[] | undefined) ?? [], [bossHome]);
  const community = bossHome?.community as {name: string; hp_max: number; hp_left: number; percent: number; contributions: number; defeated: boolean} | undefined;

  if (running) {
    return <PracticeRun mode={running.mode} label={running.label} onExit={() => { setRunning(null); api.arena.practiceHistory().then(setHistory).catch(() => null); }} />;
  }
  if (fighting) {
    return <BossFight bossKey={fighting} onExit={() => { setFighting(null); api.arena.bossHome().then(setBossHome).catch(() => null); }} />;
  }

  return (
    <div className="grid gap-4">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          {value: 'custom', label: 'Practice', icon: Target},
          {value: 'practice', label: 'Quick modes', icon: Gauge},
          {value: 'boss', label: 'Boss battles', icon: Skull},
        ]}
      />

      {tab === 'custom' && <CustomPractice />}

      {tab === 'practice' && (
        <>
          <div className="grid gap-3">
            <SectionHeading title="Practice modes" subtitle="Sprints, survival runs and daily challenges." icon={<Play className="size-4" />} />
            {!modes && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {modes?.modes.map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setRunning({mode: mode.key, label: mode.label})}
                  className="rounded-2xl border border-white/10 bg-ink-900/60 p-3 text-left transition-colors hover:border-nova-400/35 active:scale-[0.99]"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[0.86rem] font-extrabold text-mist-100">{mode.label}</span>
                    {mode.best > 0 && <span className="text-[0.68rem] font-bold text-gold-300">PB {mode.best}</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-[0.68rem] font-semibold text-mist-500">
                    <span>{mode.size} questions</span>
                    {mode.lives > 0 && <span>· {mode.lives} lives</span>}
                    {mode.seconds > 0 && <span>· {mode.seconds}s</span>}
                    <span>· {mode.xp} XP/q</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {history && (
            <Card className="p-4">
              <SectionHeading title="Your runs" subtitle="Personal bests and recent history" icon={<Trophy className="size-4" />} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip className="border-white/12 bg-white/6 text-mist-300">{String((history.stats as Record<string, number>)?.runs ?? 0)} runs</Chip>
                <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">{String((history.stats as Record<string, number>)?.accuracy ?? 0)}% accuracy</Chip>
                <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200">best streak {String((history.stats as Record<string, number>)?.best_streak ?? 0)}</Chip>
                <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{String((history.stats as Record<string, number>)?.days_played ?? 0)} days played</Chip>
              </div>
              <ul className="mt-3 grid gap-1.5">
                {((history.runs as Record<string, unknown>[]) ?? []).slice(0, 6).map((row) => (
                  <li key={String(row.id)} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">{String(row.label ?? row.mode)}</span>
                    <span className="text-[0.74rem] font-semibold text-mist-500">{String(row.correct)}/{String(row.total)}</span>
                    <span className="text-[0.74rem] font-black text-gold-300">{String(row.score)}</span>
                    {Boolean(row.perfect) && <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">perfect</Chip>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {tab === 'boss' && (
        <>
          {community && (
            <Card className="relative overflow-hidden p-4">
              <div className="pointer-events-none absolute -top-20 -right-14 size-44 rounded-full bg-rose-600/18 blur-3xl" />
              <div className="relative flex items-center gap-2">
                <Skull className="size-4 text-rose-300" />
                <h3 className="text-[0.95rem] font-black text-mist-50">{community.name}</h3>
                <Chip className="ml-auto border-white/12 bg-white/6 text-mist-300">{community.contributions} hits</Chip>
              </div>
              <ProgressBar value={community.percent} className="mt-3" />
              <p className="mt-1.5 text-[0.76rem] font-semibold text-mist-500">
                {formatHp(community.hp_left)} HP left of {formatHp(community.hp_max)} — every player’s damage counts.
                {community.defeated ? ' Defeated!' : ''}
              </p>
              <Button variant="primary" className="mt-3" onClick={() => setFighting('community')}>Join the raid</Button>
            </Card>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {!bosses.length && <Skeleton className="h-28 w-full" />}
            {bosses.map((boss) => (
              <Card key={boss.key} className="flex h-full flex-col p-4">
                <div className="flex items-start gap-2">
                  <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-rose-500/25 bg-rose-500/12 text-rose-200">
                    <Skull className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[0.9rem] font-extrabold text-mist-50">{boss.name}</h3>
                    <p className="text-[0.72rem] font-semibold text-mist-500">
                      {boss.hp_per_question} HP per hit · {boss.lives > 0 ? `${boss.lives} lives` : 'no life limit'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip className="border-white/12 bg-white/6 text-mist-400">{boss.cycle}</Chip>
                  {(boss.key === 'daily_boss' || boss.key === 'weekly_boss') && (
                    <Chip className="border-amber-500/25 bg-amber-500/10 text-amber-200" icon={<AlertTriangle className="size-3" />}>one attempt</Chip>
                  )}
                </div>
                <Button variant="primary" size="sm" className="mt-3 self-start" onClick={() => setFighting(boss.key)}>
                  Fight
                </Button>
              </Card>
            ))}
          </div>

          {Boolean(bossHome?.weekly) && (
            <Card className="p-4">
              <SectionHeading title="Weekly boss ladder" subtitle="Highest damage this cycle" icon={<Trophy className="size-4" />} />
              <ul className="mt-3 grid gap-1.5">
                {(((bossHome?.weekly as Record<string, unknown>)?.leaderboard as {name: string; damage: number}[]) ?? []).map((row, position) => (
                  <li key={`${row.name}-${position}`} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                    <span className="w-6 text-[0.76rem] font-black text-mist-500">#{position + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.name}</span>
                    <span className="text-[0.78rem] font-black text-gold-300">{row.damage}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {tab === 'practice' && modes && !modes.modes.length && (
        <EmptyState icon={<Gauge className="size-5" />} title="No questions available" detail="An admin needs to publish questions before practice modes open up." />
      )}
    </div>
  );
}

function formatHp(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}
