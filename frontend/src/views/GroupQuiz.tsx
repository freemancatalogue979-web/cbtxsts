/**
 * The dedicated group-quiz runner. It fills the viewport — timer and progress
 * are pinned, the question sits in the middle, and the answer choices plus the
 * action button are docked at the bottom — so it never becomes an endless
 * scroll. Grading is server-side: each answer is posted, honest feedback comes
 * back, then the next question loads. Pacing is per-question with an overall
 * attempt deadline when the quiz sets one.
 */
import {Check, ChevronLeft, Clock, Trophy, X, Zap} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Button, Card, Chip, ProgressBar} from '../components/ui';
import {api} from '../lib/api';
import {parseTime} from '../lib/groupSocket';
import {useSession} from '../store/session';
import type {GroupQuizAnswerResult, GroupQuizSummary, GroupQuizWindow, OptionKey} from '../lib/types';

const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];
type Phase = 'loading' | 'quiz' | 'feedback' | 'result' | 'error';

function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function GroupQuiz({groupId, quizId, onExit}: {groupId: number; quizId: number; onExit: () => void}) {
  const {toast} = useSession();
  const [phase, setPhase] = useState<Phase>('loading');
  const [title, setTitle] = useState('Group quiz');
  const [win, setWin] = useState<GroupQuizWindow | null>(null);
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const [feedback, setFeedback] = useState<GroupQuizAnswerResult | null>(null);
  const [summary, setSummary] = useState<GroupQuizSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [attemptLeft, setAttemptLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const shownAtRef = useRef<number>(Date.now());
  const indexRef = useRef(0);
  const totalRef = useRef(0);
  const perQuestionRef = useRef(0);

  const startQuestion = useCallback((window: GroupQuizWindow) => {
    setWin(window);
    setSelected(null);
    setFeedback(null);
    indexRef.current = window.index;
    totalRef.current = window.total;
    perQuestionRef.current = window.per_question_seconds || 0;
    shownAtRef.current = Date.now();
    setSecondsLeft(window.per_question_seconds || 0);
    setAttemptLeft(window.deadline_at ? Math.max(0, Math.round((parseTime(window.deadline_at) - Date.now()) / 1000)) : null);
    setPhase('quiz');
  }, []);

  /* Join (or resume) the attempt once. */
  useEffect(() => {
    let alive = true;
    api.groups
      .joinQuiz(groupId, quizId)
      .then((payload) => {
        if (!alive) return;
        setTitle(payload.quiz.title);
        if (!payload.question) {
          setPhase('result');
          return;
        }
        startQuestion(payload);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setError(err.message);
        setPhase('error');
      });
    return () => {
      alive = false;
    };
  }, [groupId, quizId, startQuestion]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.groups.submitQuiz(groupId, quizId);
      setSummary(result);
      setPhase('result');
      if (result.xp_awarded > 0 || result.coins_awarded > 0) {
        toast('success', result.passed ? 'Passed!' : 'Quiz submitted', `+${result.xp_awarded} XP${result.coins_awarded ? ` · +${result.coins_awarded} coins` : ''}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }, [groupId, quizId, toast]);

  const advance = useCallback(async () => {
    const nextIndex = indexRef.current + 1;
    if (nextIndex >= totalRef.current) {
      await finish();
      return;
    }
    setBusy(true);
    try {
      const next = await api.groups.quizQuestion(groupId, quizId, nextIndex);
      if (!next.question) {
        await finish();
        return;
      }
      startQuestion(next);
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }, [groupId, quizId, finish, startQuestion]);

  const lockIn = useCallback(async () => {
    if (!win?.question || !selected) return;
    setBusy(true);
    try {
      const result = await api.groups.answerQuiz(groupId, quizId, {
        question_id: win.question.id,
        selected,
        elapsed_ms: Date.now() - shownAtRef.current,
      });
      setFeedback(result);
      setPhase('feedback');
    } catch (err) {
      toast('error', 'Could not lock answer', (err as Error).message);
      /* A conflict usually means it is already answered — move on. */
      await advance();
    } finally {
      setBusy(false);
    }
  }, [win, selected, groupId, quizId, toast, advance]);

  /* Per-question countdown; auto-locks (or skips) when it hits zero. */
  useEffect(() => {
    if (phase !== 'quiz' || perQuestionRef.current <= 0) return undefined;
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          if (selected) void lockIn();
          else void advance();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, win?.index, selected, lockIn, advance]);

  /* Overall attempt deadline; force-submit when it runs out. */
  useEffect(() => {
    if (attemptLeft === null || phase === 'result' || phase === 'error') return undefined;
    const id = window.setInterval(() => {
      setAttemptLeft((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          window.clearInterval(id);
          void finish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [attemptLeft !== null, phase, finish]);

  const question = win?.question ?? null;
  const letters = question ? LETTERS.filter((letter) => question.options[letter]) : [];
  const correctKey = (feedback?.question.correct_label ?? feedback?.question.correct ?? feedback?.answer ?? null) as OptionKey | null;

  return (
    <div className="aurora relative flex h-dvh flex-col overflow-hidden">
      <div className="grid-lines pointer-events-none fixed inset-0 opacity-50" />

      {/* pinned header: back · timer · progress */}
      <header className="print-hide safe-top relative z-20 shrink-0 border-b border-white/8 bg-ink-950/75 px-2 py-2 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExit} icon={<ChevronLeft className="size-4" />} className="shrink-0">
            <span className="hidden sm:inline">Exit</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{title}</p>
            {win && phase !== 'result' && (
              <p className="text-[0.68rem] font-semibold text-mist-500 tabular">
                Question {Math.min(indexRef.current + 1, totalRef.current)} of {totalRef.current}
              </p>
            )}
          </div>
          {phase !== 'result' && phase !== 'error' && (
            <div className="flex shrink-0 items-center gap-1.5">
              {perQuestionRef.current > 0 && (
                <Chip className={`border-white/12 ${secondsLeft <= 5 ? 'border-flare-500/40 bg-flare-500/15 text-flare-200' : 'bg-white/6 text-mist-200'}`} icon={<Clock className="size-3.5" />}>
                  {clockText(secondsLeft)}
                </Chip>
              )}
              {attemptLeft !== null && (
                <Chip className={`border-white/12 ${attemptLeft <= 30 ? 'border-flare-500/40 bg-flare-500/15 text-flare-200' : 'bg-white/6 text-mist-300'}`} icon={<Clock className="size-3.5" />}>
                  {clockText(attemptLeft)}
                </Chip>
              )}
            </div>
          )}
        </div>
        {win && phase !== 'result' && phase !== 'error' && (
          <ProgressBar value={totalRef.current ? ((indexRef.current + (phase === 'feedback' ? 1 : 0)) / totalRef.current) * 100 : 0} className="mt-2" />
        )}
      </header>

      {/* body */}
      {phase === 'loading' && (
        <div className="grid flex-1 place-items-center">
          <Chip className="border-white/12 bg-white/6 text-mist-400" icon={<Zap className="size-4 animate-pulse" />}>Loading your questions…</Chip>
        </div>
      )}

      {phase === 'error' && (
        <div className="grid flex-1 place-items-center p-6">
          <Card className="max-w-sm p-5 text-center">
            <p className="text-[1rem] font-extrabold text-mist-50">Quiz unavailable</p>
            <p className="mt-1 text-[0.82rem] font-medium text-mist-400">{error ?? 'Something went wrong.'}</p>
            <Button className="mt-3" variant="outline" onClick={onExit}>Back to group</Button>
          </Card>
        </div>
      )}

      {(phase === 'quiz' || phase === 'feedback') && question && (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
            <div className="mx-auto max-w-2xl">
              <Card className="p-4">
                <div className="flex items-start gap-2">
                  <Chip className="shrink-0 border-nova-500/25 bg-nova-500/10 text-nova-200">{question.points} pt{question.points === 1 ? '' : 's'}</Chip>
                  <p className="min-w-0 flex-1 text-[0.98rem] leading-relaxed font-bold text-mist-50 sm:text-[1.05rem]">{question.text}</p>
                </div>
              </Card>

              <ul className="mt-3 grid gap-2">
                {letters.map((letter) => {
                  const isChosen = selected === letter;
                  const isCorrect = phase === 'feedback' && correctKey === letter;
                  const isWrong = phase === 'feedback' && isChosen && correctKey !== letter;
                  return (
                    <li key={letter}>
                      <button
                        type="button"
                        disabled={phase === 'feedback' || busy}
                        onClick={() => setSelected(letter)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                          isCorrect
                            ? 'border-mint-500/50 bg-mint-500/15'
                            : isWrong
                              ? 'border-flare-500/50 bg-flare-500/15'
                              : isChosen
                                ? 'border-nova-400/60 bg-nova-500/15'
                                : 'border-white/10 bg-ink-900/50 hover:border-nova-400/40'
                        } ${phase === 'feedback' ? 'cursor-default' : ''}`}
                      >
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-lg text-[0.82rem] font-black ${
                            isCorrect ? 'bg-mint-500/25 text-mint-100' : isWrong ? 'bg-flare-500/25 text-flare-100' : isChosen ? 'bg-nova-500/30 text-white' : 'bg-white/8 text-mist-300'
                          }`}
                        >
                          {letter}
                        </span>
                        <span className="min-w-0 flex-1 text-[0.9rem] font-semibold text-mist-100">{question.options[letter]}</span>
                        {isCorrect && <Check className="size-5 shrink-0 text-mint-300" />}
                        {isWrong && <X className="size-5 shrink-0 text-flare-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {phase === 'feedback' && feedback && (
                <Card className={`mt-3 p-3.5 ${feedback.correct ? 'border-mint-500/30 bg-mint-500/8' : 'border-flare-500/30 bg-flare-500/8'}`}>
                  <div className="flex items-center gap-2">
                    {feedback.correct ? <Check className="size-5 text-mint-300" /> : <X className="size-5 text-flare-300" />}
                    <p className={`text-[0.9rem] font-extrabold ${feedback.correct ? 'text-mint-200' : 'text-flare-200'}`}>
                      {feedback.correct ? `Correct · +${feedback.points}` : 'Not quite'}
                    </p>
                    <span className="ml-auto text-[0.74rem] font-bold text-mist-400 tabular">Score {feedback.score}</span>
                  </div>
                  {feedback.explanation && <p className="mt-1.5 text-[0.82rem] leading-relaxed font-medium text-mist-300">{feedback.explanation}</p>}
                </Card>
              )}
            </div>
          </main>

          {/* docked action */}
          <footer className="print-hide safe-bottom relative z-20 shrink-0 border-t border-white/8 bg-ink-950/80 px-3 py-2.5 backdrop-blur sm:px-5">
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              <span className="hidden text-[0.72rem] font-semibold text-mist-500 sm:block">
                {feedback ? `${feedback.answered}/${feedback.total} answered` : selected ? 'Lock in your answer' : 'Choose an answer'}
              </span>
              {phase === 'quiz' ? (
                <Button className="ml-auto" variant="primary" disabled={!selected || busy} onClick={() => void lockIn()} icon={<Check className="size-4" />}>
                  {busy ? 'Checking…' : 'Lock in'}
                </Button>
              ) : (
                <Button className="ml-auto" variant="primary" disabled={busy} onClick={() => void advance()} icon={<Zap className="size-4" />}>
                  {busy ? 'Loading…' : indexRef.current + 1 >= totalRef.current ? 'Finish quiz' : 'Next question'}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}

      {phase === 'result' && summary && (
        <div className="grid flex-1 place-items-center overflow-y-auto p-4">
          <Card className="w-full max-w-md p-5 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-[inset_0_2px_0_rgba(255,255,255,0.45)]">
              <Trophy className="size-7" />
            </span>
            <h2 className="mt-3 text-[1.15rem] font-black text-mist-50">{summary.passed ? 'Passed!' : 'Quiz complete'}</h2>
            <p className="mt-0.5 text-[0.82rem] font-medium text-mist-400">{title}</p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-white/5 px-2 py-3">
                <p className="text-[0.6rem] font-bold tracking-wider text-mist-500">SCORE</p>
                <p className="text-[1.3rem] font-black tabular text-mist-50">{summary.percentage}%</p>
              </div>
              <div className="rounded-xl bg-mint-500/10 px-2 py-3">
                <p className="text-[0.6rem] font-bold tracking-wider text-mint-300">CORRECT</p>
                <p className="text-[1.3rem] font-black tabular text-mint-200">{summary.correct}</p>
              </div>
              <div className="rounded-xl bg-flare-500/10 px-2 py-3">
                <p className="text-[0.6rem] font-bold tracking-wider text-flare-300">WRONG</p>
                <p className="text-[1.3rem] font-black tabular text-flare-200">{summary.wrong}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {summary.position && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200" icon={<Trophy className="size-3.5" />}>Rank #{summary.position}</Chip>}
              {summary.xp_awarded > 0 && <Chip className="border-nova-500/30 bg-nova-500/12 text-nova-200">+{summary.xp_awarded} XP</Chip>}
              {summary.coins_awarded > 0 && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">+{summary.coins_awarded} 🪙</Chip>}
              <Chip className="border-white/12 bg-white/6 text-mist-400">Pass mark {summary.pass_score}%</Chip>
            </div>

            <Button className="mt-4" variant="primary" block onClick={onExit}>Back to group quizzes</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
