/**
 * Study Lab — the fun-ways-to-study tab: daily challenge, blitz & sudden-death
 * rush runs, flashcards, ask-a-friend help requests with tutor points, weekly
 * missions, the lucky spin and the coin shop. Everything is graded server-side.
 */
import {
  ArrowLeft,
  Brain,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Disc3,
  GraduationCap,
  HandHelping,
  Layers,
  ListChecks,
  RotateCcw,
  Send,
  ShoppingBag,
  Skull,
  Sparkles,
  Target,
  Timer,
  Trophy,
  XCircle,
  Zap,
} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import Character from '../components/Character';
import {AnswerTile} from '../components/GameQuestion';
import {Avatar, Button, Card, Chip, EmptyState, ProgressBar, SectionHeading, Segmented, Skeleton} from '../components/ui';
import FlashcardsPanel from './FlashcardsPanel';
import InsightsPanel from './InsightsPanel';
import {DifficultyChip, QuestionCard} from '../components/QuestionCard';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {
  Analytics,
  DailyChallenge,
  HelpRow,
  MatchSet,
  MissionRow,
  OptionKey,
  PlayerSummary,
  QuestionPublic,
  RushSet,
  ShopItem,
  StudyCard,
} from '../lib/types';

const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];

type Mode = 'hub' | 'flash' | 'rush' | 'daily' | 'match' | 'help' | 'missions' | 'shop' | 'decks' | 'insights';

/* ------------------------------------------------------------------ hub */

function ModeCard({
  icon,
  title,
  detail,
  badge,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  badge?: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      variants={staggerItem}
      whileTap={{scale: 0.97}}
      onClick={() => {
        sfx.play('tap');
        onClick();
      }}
      className="card relative min-w-0 p-3.5 text-left transition-colors hover:border-white/20 sm:p-4"
    >
      {badge && (
        <span className="absolute top-2.5 right-2.5 grid min-w-5 place-items-center rounded-full brand-gradient px-1.5 text-[0.6rem] leading-5 font-black text-white tabular">
          {badge}
        </span>
      )}
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl border sm:size-10 ${accent}`}>{icon}</span>
      <p className="mt-2.5 text-[0.9rem] font-extrabold text-mist-50">{title}</p>
      <p className="mt-1 break-words text-[0.74rem] font-medium leading-snug text-mist-500">{detail}</p>
    </motion.button>
  );
}

function SpinCard() {
  const {toast, pushRewards, setProfile} = useSession();
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const spin = async () => {
    setSpinning(true);
    sfx.play('whoosh');
    try {
      const payload = await api.spin();
      setResult(payload.coins);
      setProfile(payload.profile);
      pushRewards(payload.rewards);
      sfx.play('coin');
    } catch (error) {
      toast('error', 'No spin left', (error as Error).message);
    } finally {
      setSpinning(false);
    }
  };

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-gold-500/14 blur-3xl" />
      <div className="relative flex items-center gap-3.5">
        <motion.span
          animate={spinning ? {rotate: 360} : {rotate: 0}}
          transition={spinning ? {duration: 0.9, ease: 'linear', repeat: Infinity} : {duration: 0.3}}
          className="grid size-11 shrink-0 place-items-center rounded-2xl border border-gold-500/30 bg-gold-500/12 text-gold-300"
        >
          <Disc3 className="size-5" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9rem] font-extrabold text-mist-50">Lucky spin</p>
          <p className="mt-0.5 text-[0.74rem] font-medium text-mist-500">
            {result ? `Last win: ${result} coins 🪙` : 'One free spin every day — up to 250 coins.'}
          </p>
        </div>
        <Button size="sm" variant="gold" onClick={spin} disabled={spinning} className="shrink-0">
          {spinning ? 'Spinning…' : 'Spin'}
        </Button>
      </div>
    </Card>
  );
}

function DailyCard({onOpen}: {onOpen: () => void}) {
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  useEffect(() => {
    api
      .daily()
      .then(setDaily)
      .catch(() => {});
  }, []);
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute -top-20 -left-10 size-52 rounded-full bg-nova-600/16 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-nova-500/30 bg-nova-500/12 text-nova-300">
          <CalendarDays className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-extrabold text-mist-50">Daily challenge</p>
          <p className="mt-0.5 text-[0.74rem] font-medium text-mist-500">
            {daily?.done
              ? `Done today — ${daily.result?.correct ?? 0}/5 correct · ${daily.players_today} players took it`
              : daily
                ? `Same 5 questions for everyone today · ${daily.players_today} played`
                : 'Same 5 questions for everyone today.'}
          </p>
        </div>
        <Button size="sm" variant={daily?.done ? 'outline' : 'primary'} onClick={onOpen} className="shrink-0">
          {daily?.done ? 'See result' : 'Take it'}
        </Button>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- flashcards */

function Flashcards({onExit}: {onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [deckKey, setDeckKey] = useState(0);

  useEffect(() => {
    setCards(null);
    api
      .studyFlashcards()
      .then((payload) => setCards(payload.cards))
      .catch((error: Error) => toast('error', 'No cards', error.message));
  }, [toast, deckKey]);

  const newDeck = () => {
    setIndex(0);
    setKnown(0);
    setFlipped(false);
    setDeckKey((value) => value + 1);
  };

  if (!cards) return <Skeleton className="h-64" />;
  const card = cards[index];
  const finished = index >= cards.length;

  const grade = async (knewIt: boolean) => {
    const nextKnown = known + (knewIt ? 1 : 0);
    setKnown(nextKnown);
    const next = index + 1;
    setIndex(next);
    setFlipped(false);
    sfx.play(knewIt ? 'correct' : 'tap');
    if (next >= cards.length) {
      try {
        const result = await api.flashLog(cards.length, nextKnown);
        setProfile(result.profile);
        if (result.rewards.length) pushRewards(result.rewards);
      } catch {
        /* the summary still shows */
      }
    }
  };

  if (finished) {
    return (
      <div className="space-y-4">
        <BackHeader title="Flashcards done" onExit={onExit} />
        <Card className="p-6 text-center">
          <Sparkles className="mx-auto size-8 text-gold-300" />
          <p className="mt-3 text-2xl font-black text-mist-50">
            {known}/{cards.length} known cold
          </p>
          <p className="mt-1.5 text-[0.82rem] font-medium text-mist-500">
            {known >= cards.length * 0.8 ? 'Deck demolished. Try a rush run next.' : 'Run the deck again tomorrow — repetition is the cheat code.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="mint" icon={<RotateCcw className="size-4" />} onClick={newDeck}>
              New deck
            </Button>
            <Button variant="outline" onClick={onExit}>
              Back to the lab
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <BackHeader title={`Card ${index + 1} of ${cards.length}`} onExit={onExit} />
      <ProgressBar value={((index + (flipped ? 0.5 : 0)) / cards.length) * 100} />
      <motion.div
        key={card.id}
        initial={{opacity: 0, y: 14}}
        animate={{opacity: 1, y: 0}}
        className="min-w-0 cursor-pointer"
        onClick={() => {
          setFlipped((value) => !value);
          sfx.play('tick');
        }}
      >
        <QuestionCard
          number={index + 1}
          className="min-w-0"
          chips={
            <>
              <Chip className="border-nova-500/28 bg-nova-500/12 text-nova-300">{card.quiz_title || 'Mixed deck'}</Chip>
              <DifficultyChip level={card.difficulty} />
            </>
          }
          text={card.text}
        >
        {flipped ? (
          <motion.div initial={{opacity: 0}} animate={{opacity: 1}} className="mt-3.5 space-y-2.5">
            <p className="rounded-xl border border-mint-500/25 bg-mint-500/10 px-3 py-2 text-[0.86rem] font-bold text-mint-300">
              {card.correct ? `${card.correct.toUpperCase()} · ${card.options[card.correct]}` : ''}
            </p>
            {card.explanation && <p className="break-words text-[0.78rem] font-medium text-mist-400">{card.explanation}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="mint" className="flex-1" icon={<CheckCircle2 className="size-4" />} onClick={() => grade(true)}>
                Knew it
              </Button>
              <Button variant="outline" className="flex-1" icon={<XCircle className="size-4" />} onClick={() => grade(false)}>
                Still learning
              </Button>
            </div>
          </motion.div>
        ) : (
 <p className="mt-4 text-[0.72rem] font-black tracking-[0.18em] text-mist-600">Tap to flip</p>
        )}
        </QuestionCard>
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------- rush run */

function QuestionRunner({
  questions,
  timerSeconds,
  stopOnWrong,
  onFinish,
  onExit,
  title,
}: {
  questions: QuestionPublic[];
  timerSeconds: number; // 0 = untimed
  stopOnWrong: boolean;
  onFinish: (answers: Record<number, OptionKey>, stoppedEarly: boolean) => void;
  onExit: () => void;
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, OptionKey>>({});
  const [left, setLeft] = useState(timerSeconds);
  const [wrongFlash, setWrongFlash] = useState(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const finishedRef = useRef(false);

  const finish = useCallback(
    (stoppedEarly: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinish(answersRef.current, stoppedEarly);
    },
    [onFinish],
  );

  useEffect(() => {
    if (!timerSeconds) return undefined;
    const id = window.setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          sfx.play('whoosh');
          finish(false);
          return 0;
        }
        if (value <= 6) sfx.play('tick');
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerSeconds, finish]);

  const question = questions[Math.min(index, questions.length - 1)];

  const pick = (key: OptionKey) => {
    if (finishedRef.current) return;
    const next = {...answersRef.current, [question.id]: key};
    setAnswers(next);
    answersRef.current = next;
    const correct = question.correct ? (key as string) === question.correct : true;
    if (stopOnWrong && !correct) {
      sfx.play('wrong');
      setWrongFlash(true);
      window.setTimeout(() => finish(true), 650);
      return;
    }
    sfx.play('tap');
    if (index + 1 >= questions.length) finish(false);
    else setIndex(index + 1);
  };

  if (!question) return null;
  return (
    <div className="space-y-3.5">
      <BackHeader title={title} onExit={onExit} />
      <div className="flex items-center gap-2.5">
        <Character mood={wrongFlash ? 'sad' : 'idle'} size={38} tone="day" className="-my-2 hidden sm:block" label="Arena hero" />
        <ProgressBar value={(index / questions.length) * 100} className="flex-1" />
        {timerSeconds > 0 && (
          <Chip className={`tabular ${left <= 10 ? 'border-flare-500/40 bg-flare-500/14 text-flare-300' : ''}`} icon={<Timer className="size-3.5" />}>
            0:{String(left).padStart(2, '0')}
          </Chip>
        )}
        <Chip className="tabular">
          {index + 1}/{questions.length}
        </Chip>
      </div>
      <motion.div key={question.id} initial={{opacity: 0, x: 24}} animate={{opacity: 1, x: 0}}>
        <QuestionCard
          number={index + 1}
          className={`min-w-0 ${wrongFlash ? 'ring-2 ring-flare-500/70' : ''}`}
          chips={
            <>
              <DifficultyChip level={question.difficulty} />
              <Chip>{question.points} pts</Chip>
            </>
          }
          text={question.text}
        >
        {/* Blitz and Sudden Death use the same tiles as the exam, so the whole
            arena answers questions with one consistent surface. */}
        <div className="mt-3.5 grid gap-2">
          {LETTERS.filter((key) => question.options[key]).map((key) => (
            <AnswerTile
              key={key}
              letter={key}
              text={question.options[key]}
              disabled={wrongFlash}
              state={stopOnWrong && wrongFlash && answers[question.id] === key ? 'wrong' : answers[question.id] === key ? 'picked' : 'idle'}
              onPick={() => pick(key)}
            />
          ))}
        </div>
        </QuestionCard>
      </motion.div>
    </div>
  );
}

function Rush({mode, onExit}: {mode: 'blitz' | 'sudden'; onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [set, setSet] = useState<RushSet | null>(null);
  const [result, setResult] = useState<{score: number; total: number; best: number} | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setSet(null);
    api
      .rushSet(mode)
      .then(setSet)
      .catch((error: Error) => toast('error', 'Rush unavailable', error.message));
  }, [mode, toast, runKey]);

  if (result) {
    return (
      <div className="space-y-4">
        <BackHeader title={mode === 'blitz' ? 'Blitz result' : 'Sudden Death result'} onExit={onExit} />
        <Card className="p-6 text-center">
          <Trophy className={`mx-auto size-9 ${result.score >= 7 ? 'text-gold-300' : 'text-mist-400'}`} />
          <p className="mt-2.5 text-3xl font-black tabular text-mist-50">
            {result.score}
            <span className="text-lg text-mist-500">/{result.total}</span>
          </p>
          <p className="mt-1 text-[0.8rem] font-semibold text-mist-500">Personal best: {result.best}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              variant="primary"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                setResult(null);
                setRunKey((value) => value + 1);
              }}
            >
              Run it again
            </Button>
            <Button variant="outline" onClick={onExit}>
              Back to the lab
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  if (!set) return <Skeleton className="h-64" />;
  return (
    <QuestionRunner
      key={runKey}
      questions={set.questions}
      timerSeconds={mode === 'blitz' ? 60 : 0}
      stopOnWrong={mode === 'sudden'}
      title={mode === 'blitz' ? '⚡ Blitz — 60 seconds' : '💀 Sudden Death — one miss ends it'}
      onExit={onExit}
      onFinish={async (answers) => {
        const items = set.questions.map((question) => ({question_id: question.id, answer: answers[question.id] ?? ''}));
        try {
          const graded = await api.rushGrade(mode, set.issued_at, items);
          setResult({score: graded.score, total: graded.total, best: graded.best});
          setProfile(graded.profile);
          if (graded.rewards.length) pushRewards(graded.rewards);
          sfx.play(graded.score >= 7 ? 'win' : 'coin');
        } catch (error) {
          toast('error', 'Run rejected', (error as Error).message);
          onExit();
        }
      }}
    />
  );
}

function DailyRunner({onExit}: {onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [result, setResult] = useState<{correct: number; total: number; perfect: boolean} | null>(null);

  useEffect(() => {
    api
      .daily()
      .then(setDaily)
      .catch((error: Error) => toast('error', 'Daily challenge unavailable', error.message));
  }, [toast]);

  if (daily?.done && !result) {
    return (
      <div className="space-y-4">
        <BackHeader title="Daily challenge" onExit={onExit} />
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto size-9 text-mint-300" />
          <p className="mt-2.5 text-2xl font-black text-mist-50">
            {daily.result?.correct ?? 0}/{daily.result?.score ?? 5} today
          </p>
          <p className="mt-1.5 text-[0.82rem] font-medium text-mist-500">
            {daily.players_today} players took today's challenge. Come back at midnight for a fresh five.
          </p>
          <Button className="mx-auto mt-4" variant="outline" onClick={onExit}>
            Back to the lab
          </Button>
        </Card>
      </div>
    );
  }
  if (result) {
    return (
      <div className="space-y-4">
        <BackHeader title="Daily challenge" onExit={onExit} />
        <Card className="p-6 text-center">
          {result.perfect ? <Sparkles className="mx-auto size-9 text-gold-300" /> : <Trophy className="mx-auto size-9 text-mint-300" />}
          <p className="mt-2.5 text-3xl font-black tabular text-mist-50">
            {result.correct}
            <span className="text-lg text-mist-500">/{result.total}</span>
          </p>
          <p className="mt-1 text-[0.82rem] font-semibold text-mist-500">{result.perfect ? 'PERFECT DAY — bonus banked 🎉' : 'Solid. Tomorrow is a new five.'}</p>
          <Button className="mx-auto mt-4" variant="outline" onClick={onExit}>
            Back to the lab
          </Button>
        </Card>
      </div>
    );
  }
  if (!daily) return <Skeleton className="h-64" />;
  return (
    <QuestionRunner
      questions={daily.questions}
      timerSeconds={0}
      stopOnWrong={false}
      title={`📅 Daily challenge · ${daily.day}`}
      onExit={onExit}
      onFinish={async (answers) => {
        const items = daily.questions.map((question) => ({question_id: question.id, answer: answers[question.id] ?? ''}));
        try {
          const graded = await api.dailySubmit(daily.day, items);
          setResult({correct: graded.correct, total: graded.total, perfect: graded.perfect});
          setProfile(graded.profile);
          if (graded.rewards.length) pushRewards(graded.rewards);
          sfx.play(graded.perfect ? 'levelup' : 'coin');
        } catch (error) {
          toast('error', 'Submission rejected', (error as Error).message);
          onExit();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------ mind match */

function MatchGame({onExit}: {onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [set, setSet] = useState<MatchSet | null>(null);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [lock, setLock] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{score: number; matched: number; pairs: number; perfect: boolean; best: number; moves: number} | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    setSet(null);
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setLock(false);
    setResult(null);
    startedAt.current = Date.now();
    api
      .matchSet()
      .then(setSet)
      .catch((error: Error) => toast('error', 'Mind Match unavailable', error.message));
  }, [runKey, toast]);

  const finish = useCallback(
    async (board: MatchSet, finalMoves: number, finalMatched: number) => {
      try {
        const graded = await api.matchGrade({
          issued_at: board.issued_at,
          moves: finalMoves,
          matched: finalMatched,
          elapsed_ms: Date.now() - startedAt.current,
        });
        setResult({score: graded.score, matched: graded.matched, pairs: graded.pairs, perfect: graded.perfect, best: graded.best, moves: finalMoves});
        setProfile(graded.profile);
        if (graded.rewards.length) pushRewards(graded.rewards);
        sfx.play(graded.perfect ? 'levelup' : 'win');
      } catch (error) {
        toast('error', 'Score rejected', (error as Error).message);
      }
    },
    [pushRewards, setProfile, toast],
  );

  const flip = (position: number) => {
    if (!set || lock || result) return;
    const card = set.cards[position];
    if (flipped.includes(position) || matched.includes(card.pair)) return;
    sfx.play('tick');
    const next = [...flipped, position];
    setFlipped(next);
    if (next.length < 2) return;
    const [first, second] = next;
    const nextMoves = moves + 1;
    setMoves(nextMoves);
    if (set.cards[first].pair === set.cards[second].pair) {
      sfx.play('correct');
      const nextMatched = [...matched, card.pair];
      setMatched(nextMatched);
      setFlipped([]);
      if (nextMatched.length === set.pairs) void finish(set, nextMoves, nextMatched.length);
    } else {
      sfx.play('wrong');
      setLock(true);
      window.setTimeout(() => {
        setFlipped([]);
        setLock(false);
      }, 760);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <BackHeader title="Mind Match result" onExit={onExit} />
        <Card className="p-6 text-center">
          <Layers className={`mx-auto size-9 ${result.perfect ? 'text-gold-300' : 'text-pulse-300'}`} />
          <p className="mt-2.5 text-3xl font-black tabular text-mist-50">{result.score}</p>
          <p className="mt-1 text-[0.82rem] font-semibold text-mist-500">
            {result.matched}/{result.pairs} pairs in {result.moves} flips{result.perfect ? ' — flawless memory 👑' : ''}
          </p>
          <p className="mt-0.5 text-[0.74rem] font-medium text-mist-600">Best score: {result.best}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setRunKey((value) => value + 1)}>
              Play again
            </Button>
            <Button variant="outline" onClick={onExit}>
              Back to the lab
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  if (!set) return <Skeleton className="h-72" />;

  return (
    <div className="min-w-0 space-y-3.5">
      <BackHeader title="🧩 Mind Match" onExit={onExit} />
      <div className="flex items-center gap-2">
        <Chip className="tabular" icon={<Layers className="size-3.5" />}>
          {matched.length}/{set.pairs} pairs
        </Chip>
        <Chip className="tabular">Flips: {moves}</Chip>
        <p className="min-w-0 flex-1 truncate text-right text-[0.68rem] font-semibold text-mist-600">Match each question with its correct answer</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {set.cards.map((card, position) => {
          const isUp = flipped.includes(position) || matched.includes(card.pair);
          const isMatched = matched.includes(card.pair);
          return (
            <button
              key={card.card}
              onClick={() => flip(position)}
              aria-label={isUp ? card.text.slice(0, 60) : 'Face-down card'}
              className={`grid h-24 min-w-0 place-items-center overflow-hidden rounded-2xl border p-2 text-center transition-all touch-manipulation sm:h-28 ${
                isMatched
                  ? 'border-mint-500/50 bg-mint-500/12'
                  : isUp
                    ? 'border-nova-400/55 bg-nova-500/14'
                    : 'border-white/10 bg-white/[0.03] hover:border-nova-400/35'
              }`}
            >
              {isUp ? (
                <span className={`line-clamp-4 break-words text-[0.6rem] leading-tight font-bold sm:text-[0.68rem] ${card.side === 'answer' ? 'text-mint-200' : 'text-mist-100'}`}>
                  {card.text}
                </span>
              ) : (
                <span className="brand-gradient grid size-9 place-items-center rounded-xl text-base font-black text-white">?</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- ask a friend */

function HelpHub({onExit}: {onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [pane, setPane] = useState<'ask' | 'inbox' | 'sent'>('inbox');
  const [friends, setFriends] = useState<PlayerSummary[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [pickedFriend, setPickedFriend] = useState<PlayerSummary | null>(null);
  const [pickedCard, setPickedCard] = useState<StudyCard | null>(null);
  const [inbox, setInbox] = useState<HelpRow[] | null>(null);
  const [sent, setSent] = useState<HelpRow[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const loadPane = useCallback(
    (target: 'ask' | 'inbox' | 'sent') => {
      if (target === 'ask') {
        api.friends().then((payload) => setFriends(payload.friends)).catch(() => {});
        api.studyFlashcards().then((payload) => setCards(payload.cards)).catch(() => {});
      } else if (target === 'inbox') {
        setInbox(null);
        api
          .helpInbox()
          .then((payload) => setInbox(payload.requests))
          .catch(() => setInbox([]));
      } else {
        setSent(null);
        api
          .helpSent()
          .then((payload) => setSent(payload.requests))
          .catch(() => setSent([]));
      }
    },
    [],
  );

  useEffect(() => loadPane(pane), [pane, loadPane]);

  const ask = async () => {
    if (!pickedFriend || !pickedCard) return;
    try {
      await api.helpAsk(pickedFriend.id, pickedCard.id);
      sfx.play('chat');
      toast('success', 'Asked!', `${pickedFriend.name.split(' ')[0]} got your question.`);
      setPickedCard(null);
      setPane('sent');
    } catch (error) {
      toast('error', 'Could not ask', (error as Error).message);
    }
  };

  const answer = async (row: HelpRow, key: OptionKey) => {
    setBusy(row.id);
    try {
      const result = await api.helpAnswer(row.id, key);
      setProfile(result.profile);
      if (result.rewards.length) pushRewards(result.rewards);
      sfx.play(result.was_correct ? 'correct' : 'wrong');
      toast(result.was_correct ? 'success' : 'info', result.was_correct ? 'Tutor points! +15 XP' : 'Not quite', result.was_correct
        ? `${row.other?.name.split(' ')[0] ?? 'Your friend'} can see the explanation now.`
        : 'They got a nudge to work it out with you.');
      loadPane('inbox');
    } catch (error) {
      toast('error', 'Answer failed', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const renderRow = (row: HelpRow, isInbox: boolean) => (
    <Card key={row.id} className="min-w-0 p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        {row.other && <Avatar name={row.other.name} hue={row.other.avatar_hue} initials={row.other.initials} size={30} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.82rem] font-extrabold text-mist-100">
            {isInbox ? row.other?.name ?? 'A friend' : `To ${row.other?.name ?? 'friend'}`}
          </p>
 <p className="text-[0.66rem] font-bold tracking-wide text-mist-600">{formatRelative(row.created_at)}</p>
        </div>
        {row.status === 'answered' ? (
          <Chip className={row.was_correct ? 'border-mint-500/30 bg-mint-500/12 text-mint-300' : 'border-flare-500/30 bg-flare-500/12 text-flare-300'}>
            {row.was_correct ? '✅ Solved' : '❌ Missed'}
          </Chip>
        ) : (
          <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-300">Waiting</Chip>
        )}
      </div>
      <p className="mt-2.5 break-words text-[0.86rem] leading-snug font-bold text-mist-50">{row.prompt}</p>
      {row.status === 'pending' && isInbox ? (
        <div className="mt-2.5 grid gap-1.5">
          {LETTERS.filter((key) => row.options[key]).map((key) => (
            <button
              key={key}
              disabled={busy === row.id}
              onClick={() => answer(row, key)}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-nova-400/45 touch-manipulation disabled:opacity-50"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/8 text-[0.68rem] font-black text-mist-300">{key}</span>
              <span className="min-w-0 break-words text-[0.8rem] font-semibold text-mist-100">{row.options[key]}</span>
            </button>
          ))}
          <p className="mt-0.5 text-[0.66rem] font-semibold text-mist-600">Answer correctly → +15 XP, +10 coins, +1 tutor point.</p>
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5">
          {LETTERS.filter((key) => row.options[key]).map((key) => {
            const isAnswer = row.status === 'answered' && row.helper_answer?.toUpperCase() === key;
            const isRight = row.status === 'answered' && row.was_correct && isAnswer;
            return (
              <p
                key={key}
                className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-[0.78rem] font-semibold ${
                  isRight
                    ? 'border-mint-500/40 bg-mint-500/12 text-mint-200'
                    : isAnswer
                      ? 'border-flare-500/40 bg-flare-500/12 text-flare-200'
                      : 'border-white/8 bg-white/[0.02] text-mist-400'
                }`}
              >
                <span className="font-black">{key}.</span>
                <span className="min-w-0 break-words">{row.options[key]}</span>
              </p>
            );
          })}
        </div>
      )}
      {row.status === 'answered' && row.explanation && (
        <p className="mt-2 break-words rounded-xl bg-white/[0.04] px-3 py-2 text-[0.74rem] font-medium text-mist-400">
          💡 {row.explanation}
        </p>
      )}
    </Card>
  );

  return (
    <div className="min-w-0 space-y-3.5">
      <BackHeader title="Ask a friend" onExit={onExit} />
      <Segmented
        value={pane}
        options={[
          {value: 'inbox', label: 'Help them', icon: HandHelping},
          {value: 'ask', label: 'Ask', icon: CircleHelp},
          {value: 'sent', label: 'My asks', icon: Send},
        ]}
        onChange={setPane}
      />

      {pane === 'ask' && (
        <div className="min-w-0 space-y-3.5">
          <Card className="min-w-0 p-3.5 sm:p-4">
 <p className="text-[0.7rem] font-black tracking-[0.16em] text-mist-500">1 · Pick a friend</p>
            {friends.length === 0 ? (
              <p className="mt-2 text-[0.8rem] font-medium text-mist-500">Add friends first — you can only ask people you know.</p>
            ) : (
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                {friends.map((friend) => (
                  <button
                    key={friend.id}
                    onClick={() => {
                      setPickedFriend(friend);
                      sfx.play('tap');
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-2xl border px-2.5 py-2 transition-colors ${
                      pickedFriend?.id === friend.id ? 'border-nova-400/60 bg-nova-500/14' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <Avatar name={friend.name} hue={friend.avatar_hue} initials={friend.initials} size={28} />
                    <span className="max-w-[7.5rem] truncate text-[0.78rem] font-bold text-mist-200">{friend.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
          <Card className="min-w-0 p-3.5 sm:p-4">
 <p className="text-[0.7rem] font-black tracking-[0.16em] text-mist-500">2 · Pick a question from the study deck</p>
            <div className="mt-2 grid max-h-[46vh] min-w-0 gap-2 overflow-y-auto pr-0.5">
              {cards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => {
                    setPickedCard(card);
                    sfx.play('tap');
                  }}
                  className={`min-w-0 rounded-2xl border p-3 text-left transition-colors ${
                    pickedCard?.id === card.id ? 'border-nova-400/60 bg-nova-500/14' : 'border-white/8 bg-white/[0.02] hover:border-white/20'
                  }`}
                >
                  <p className="break-words text-[0.8rem] leading-snug font-bold text-mist-100">{card.text}</p>
 <p className="mt-1 text-[0.64rem] font-bold tracking-wide text-mist-600">{card.quiz_title}</p>
                </button>
              ))}
              {cards.length === 0 && <Skeleton className="h-16" />}
            </div>
          </Card>
          <Button className="w-full" variant="primary" disabled={!pickedFriend || !pickedCard} onClick={ask} icon={<Send className="size-4" />}>
            {pickedFriend && pickedCard
              ? `Ask ${pickedFriend.name.split(' ')[0]}`
              : pickedFriend
                ? 'Now pick a question'
                : 'Pick a friend to ask'}
          </Button>
        </div>
      )}

      {pane === 'inbox' &&
        (inbox === null ? (
          <Skeleton className="h-40" />
        ) : inbox.length === 0 ? (
          <EmptyState icon={<HandHelping className="size-6" />} title="No one needs you yet" detail="When friends ask you questions, they land here. Correct answers pay tutor points." />
        ) : (
          <div className="min-w-0 space-y-2.5">{inbox.map((row) => renderRow(row, true))}</div>
        ))}

      {pane === 'sent' &&
        (sent === null ? (
          <Skeleton className="h-40" />
        ) : sent.length === 0 ? (
          <EmptyState icon={<CircleHelp className="size-6" />} title="You haven't asked anyone" detail="Stuck on a question? Send it to a friend — they earn points for helping you." />
        ) : (
          <div className="min-w-0 space-y-2.5">{sent.map((row) => renderRow(row, false))}</div>
        ))}
    </div>
  );
}

/* -------------------------------------------------------------- missions */

function Missions({onExit}: {onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [rows, setRows] = useState<MissionRow[] | null>(null);

  const load = useCallback(() => {
    api
      .missions()
      .then((payload) => setRows(payload.missions))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const claim = async (row: MissionRow) => {
    try {
      const result = await api.missionClaim(row.key);
      setProfile(result.profile);
      if (result.rewards.length) pushRewards(result.rewards);
      sfx.play('levelup');
      load();
    } catch (error) {
      toast('error', 'Cannot claim yet', (error as Error).message);
    }
  };

  return (
    <div className="min-w-0 space-y-3.5">
      <BackHeader title="Weekly missions" onExit={onExit} />
      {!rows ? (
        <Skeleton className="h-48" />
      ) : (
        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="min-w-0 space-y-2.5">
          {rows.map((row) => {
            const done = row.progress >= row.goal;
            return (
              <motion.li key={row.key} variants={staggerItem}>
                <Card className="min-w-0 p-3.5 sm:p-4">
                  <div className="flex items-center gap-2.5">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${done ? 'border-mint-500/30 bg-mint-500/12 text-mint-300' : 'border-white/10 bg-white/[0.04] text-mist-500'}`}>
                      <ListChecks className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{row.title}</p>
                      <p className="truncate text-[0.72rem] font-medium text-mist-500">{row.detail}</p>
                    </div>
                    <Chip className="border-gold-500/28 bg-gold-500/12 text-gold-300">+{row.coins}🪙</Chip>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <ProgressBar value={Math.min(100, (row.progress / row.goal) * 100)} className="flex-1" tone="gold" />
                    <span className="shrink-0 text-[0.7rem] font-black tabular text-mist-500">
                      {row.progress}/{row.goal}
                    </span>
                    {row.claimed ? (
                      <Chip className="border-white/12 text-mist-500">Claimed</Chip>
                    ) : (
                      <Button size="sm" variant={done ? 'mint' : 'outline'} disabled={!done} onClick={() => claim(row)} className="shrink-0">
                        {done ? `Claim +${row.xp} XP` : `+${row.xp} XP`}
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shop */

const SHOP_ICONS: Record<string, typeof Zap> = {snowflake: Sparkles, zap: Zap, crown: Trophy, flame: Zap, sparkles: Sparkles};

function Shop({onExit}: {onExit: () => void}) {
  const {profile, toast, setProfile} = useSession();
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [owned, setOwned] = useState({freezes: 0, boosted: false, flair: ''});

  const load = useCallback(() => {
    api
      .shop()
      .then((payload) => {
        setItems(payload.items);
        setOwned({freezes: payload.streak_freezes, boosted: payload.xp_boosted, flair: payload.flair});
      })
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const buy = async (item: ShopItem) => {
    try {
      const result = await api.shopBuy(item.sku);
      setProfile(result.profile);
      sfx.play('coin');
      toast('success', `Bought ${item.name}`, result.detail);
      load();
    } catch (error) {
      sfx.play('wrong');
      toast('error', 'Purchase failed', (error as Error).message);
    }
  };

  return (
    <div className="min-w-0 space-y-3.5">
      <BackHeader title="Coin shop" onExit={onExit} />
      <Card className="flex items-center gap-3 p-3.5 sm:p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold-500/30 bg-gold-500/12 text-gold-300">
          <ShoppingBag className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-extrabold text-mist-50">Your wallet</p>
          <p className="text-[0.74rem] font-semibold text-mist-500">
            {formatNumber(profile?.coins ?? 0)} coins
            {owned.freezes > 0 && ` · ${owned.freezes} freeze${owned.freezes > 1 ? 's' : ''} stored`}
            {owned.boosted && ' · 2× XP live'}
            {owned.flair && ` · ${owned.flair} flair on`}
          </p>
        </div>
      </Card>
      {!items ? (
        <Skeleton className="h-48" />
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = SHOP_ICONS[item.icon] ?? Sparkles;
            const affordable = (profile?.coins ?? 0) >= item.cost;
            const equipped = item.sku.startsWith('flair_') && owned.flair === item.sku.slice(6);
            return (
              <motion.div key={item.sku} variants={staggerItem}>
                <Card className="flex min-w-0 items-center gap-3 p-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-nova-300">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.84rem] font-extrabold text-mist-50">{item.name}</p>
                    <p className="mt-0.5 break-words text-[0.72rem] font-medium text-mist-500">{item.blurb}</p>
                  </div>
                  <Button size="sm" variant={equipped ? 'outline' : affordable ? 'gold' : 'outline'} disabled={!affordable || equipped} onClick={() => buy(item)} className="shrink-0">
                    {equipped ? 'On' : `${item.cost}🪙`}
                  </Button>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- chrome */

function BackHeader({title, onExit}: {title: string; onExit: () => void}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onExit} icon={<ArrowLeft className="size-4" />} className="-ml-1.5 shrink-0">
        Lab
      </Button>
      <p className="min-w-0 truncate text-[0.95rem] font-extrabold text-mist-100">{title}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- panel */

export default function StudyPanel({onOpenAnalytics}: {onOpenAnalytics?: () => void}) {
  const [mode, setMode] = useState<Mode>('hub');
  const [rushMode, setRushMode] = useState<'blitz' | 'sudden'>('blitz');
  const [pendingHelp, setPendingHelp] = useState(0);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  void onOpenAnalytics;

  useEffect(() => {
    api
      .helpInbox()
      .then((payload) => setPendingHelp(payload.requests.filter((row) => row.status === 'pending').length))
      .catch(() => {});
    api
      .analytics()
      .then(setAnalytics)
      .catch(() => {});
  }, []);

  if (mode === 'flash') return <div className="w-full"><Flashcards onExit={() => setMode('hub')} /></div>;
  if (mode === 'decks')
    return (
      <div className="w-full">
        <div className="mb-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setMode('hub')}>
            Study Lab
          </Button>
        </div>
        <FlashcardsPanel />
      </div>
    );
  if (mode === 'insights')
    return (
      <div className="w-full">
        <div className="mb-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setMode('hub')}>
            Study Lab
          </Button>
        </div>
        <InsightsPanel />
      </div>
    );
  if (mode === 'rush')
    return (
      <div className="w-full">
        <Rush key={rushMode} mode={rushMode} onExit={() => setMode('hub')} />
      </div>
    );
  if (mode === 'daily') return <div className="w-full"><DailyRunner onExit={() => setMode('hub')} /></div>;
  if (mode === 'match') return <div className="w-full"><MatchGame onExit={() => setMode('hub')} /></div>;
  if (mode === 'help') return <div className="w-full"><HelpHub onExit={() => setMode('hub')} /></div>;
  if (mode === 'missions') return <div className="w-full"><Missions onExit={() => setMode('hub')} /></div>;
  if (mode === 'shop') return <div className="w-full"><Shop onExit={() => setMode('hub')} /></div>;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <SectionHeading
        title="Study Lab"
        subtitle="More ways to grind smarter — every run is graded by the server and pays real XP."
        icon={<GraduationCap className="size-4" />}
        action={
          analytics ? (
            <Chip className="border-pulse-500/28 bg-pulse-500/12 text-pulse-300" icon={<Brain className="size-3.5" />}>
              {analytics.accuracy}% accuracy
            </Chip>
          ) : undefined
        }
      />

      <DailyCard onOpen={() => setMode('daily')} />
      <SpinCard />

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid min-w-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <ModeCard
          icon={<Zap className="size-4.5 text-gold-300" />}
          accent="border-gold-500/28 bg-gold-500/12"
          title="Blitz · 60 seconds"
          detail="Ten questions, one minute. Answer everything you can before the buzzer."
          onClick={() => {
            setRushMode('blitz');
            setMode('rush');
          }}
        />
        <ModeCard
          icon={<Skull className="size-4.5 text-flare-300" />}
          accent="border-flare-500/28 bg-flare-500/12"
          title="Sudden Death"
          detail="No clock — but one wrong answer ends the run. How deep can you go?"
          onClick={() => {
            setRushMode('sudden');
            setMode('rush');
          }}
        />
        <ModeCard
          icon={<Brain className="size-4.5 text-nova-300" />}
          accent="border-nova-500/28 bg-nova-500/12"
          title="Flashcards"
          detail="Flip, self-grade, repeat. The deck is pulled straight from the question bank."
          onClick={() => setMode('flash')}
        />
        <ModeCard
          icon={<Layers className="size-4.5 text-pulse-300" />}
          accent="border-pulse-500/28 bg-pulse-500/12"
          title="Spaced repetition"
          detail="Swipe decks with smart intervals — due today, due tomorrow, mastered. Synced to your bank."
          onClick={() => setMode('decks')}
        />
        <ModeCard
          icon={<Target className="size-4.5 text-mint-300" />}
          accent="border-mint-500/28 bg-mint-500/12"
          title="Insights & mastery"
          detail="Accuracy over time, mastery heatmap, achievements and what to study next."
          onClick={() => setMode('insights')}
        />
        <ModeCard
          icon={<Layers className="size-4.5 text-pulse-300" />}
          accent="border-pulse-500/28 bg-pulse-500/12"
          title="Mind Match"
          detail="Mini game: flip the tiles, pair each question with its answer. Fewer flips, higher score."
          onClick={() => setMode('match')}
        />
        <ModeCard
          icon={<HandHelping className="size-4.5 text-mint-300" />}
          accent="border-mint-500/28 bg-mint-500/12"
          title="Ask a friend"
          detail="Send a question to a friend. Correct help pays them tutor points — everyone wins."
          badge={pendingHelp > 0 ? String(pendingHelp) : undefined}
          onClick={() => setMode('help')}
        />
        <ModeCard
          icon={<ListChecks className="size-4.5 text-pulse-300" />}
          accent="border-pulse-500/28 bg-pulse-500/12"
          title="Weekly missions"
          detail="Six goals that reset every Monday. Real progress, claimable rewards."
          onClick={() => setMode('missions')}
        />
        <ModeCard
          icon={<ShoppingBag className="size-4.5 text-mist-200" />}
          accent="border-white/14 bg-white/6"
          title="Coin shop"
          detail="Streak freezes, 24h double XP and avatar flairs — bought with coins you earned."
          onClick={() => setMode('shop')}
        />
      </motion.div>

      {analytics && (analytics.questions_answered > 0 || analytics.help.answered > 0) && (
        <Card className="min-w-0 p-3.5 sm:p-4">
 <p className="text-[0.68rem] font-black tracking-[0.18em] text-mist-500">Your study numbers</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {label: 'Accuracy', value: `${analytics.accuracy}%`},
              {label: 'Predicted grade', value: analytics.predicted_grade.grade},
              {label: 'Study minutes', value: String(analytics.study_minutes)},
              {label: 'Tutor points', value: String(analytics.help.points)},
            ].map((stat) => (
              <div key={stat.label} className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2">
                <p className="truncate text-[0.95rem] font-black tabular text-mist-50">{stat.value}</p>
 <p className="truncate text-[0.6rem] font-bold tracking-wide text-mist-600">{stat.label}</p>
              </div>
            ))}
          </div>
          {analytics.weakest && (
            <p className="mt-2.5 break-words text-[0.74rem] font-semibold text-mist-500">
              🎯 Weakest area: <span className="text-flare-300">{analytics.weakest.title}</span> at {analytics.weakest.accuracy}% — run flashcards on it.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
