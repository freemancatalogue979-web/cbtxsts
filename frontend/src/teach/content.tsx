/** Material viewer, quiz runner and report sheet — shared by every teacher screen. */
import {CheckCircle2, Clock, Download, ExternalLink, FileText, Flag, Link2, ListChecks, Loader2, RotateCcw, Timer, Trophy, XCircle} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError} from '../lib/api';
import {fileUrl, formatBytes, teachers, type TAttempt, type TMaterial, type TQuiz} from '../lib/teachers';
import {Badge, LoadingRows} from '../pro/ui';
import {useSession} from '../store/session';
import {Field, Sheet, VerifiedMark, timeAgo} from './ui';
import {askConfirm} from '../components/ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/* --------------------------------------------------------------- material */
export function MaterialSheet({id, onClose}: {id: number | null; onClose: () => void}) {
  const [material, setMaterial] = useState<TMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setMaterial(null);
    setError(null);
    teachers.material(id).then(setMaterial).catch((e) => setError(errText(e)));
  }, [id]);
  const file = material?.file;
  const isPdf = file?.mime === 'application/pdf';
  return (
    <Sheet
      open={id !== null}
      onClose={onClose}
      size={isPdf ? 'xl' : 'lg'}
      icon={<FileText />}
      title={material?.title ?? 'Material'}
      subtitle={material ? [material.teacher?.name ? `By ${material.teacher.name}` : '', material.topic || material.subject].filter(Boolean).join(' · ') : undefined}
      footer={
        material && (
          <>
            {material.kind === 'file' && file && (
              <>
                <a className="pro-btn" href={fileUrl(file.id)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" /> Open
                </a>
                <a className="pro-btn pro-btn-primary" href={fileUrl(file.id, true)}>
                  <Download className="size-4" /> Download
                </a>
              </>
            )}
            {material.kind === 'link' && (
              <a className="pro-btn pro-btn-primary" href={material.link} target="_blank" rel="noopener noreferrer nofollow">
                <ExternalLink className="size-4" /> Open link
              </a>
            )}
            {material.kind === 'text' && (
              <button type="button" className="pro-btn" onClick={onClose}>
                Done
              </button>
            )}
          </>
        )
      }
    >
      {error && <p className="pro-secondary">{error}</p>}
      {!material && !error && <LoadingRows rows={3} />}
      {material && (
        <div className="grid min-w-0 gap-4">
          {material.teacher?.verified && (
            <p className="pro-meta inline-flex items-center gap-1.5">
              <VerifiedMark size={14} /> From a verified teacher · updated {timeAgo(material.updated_at)}
            </p>
          )}
          {material.description && <p className="pro-body [overflow-wrap:anywhere]">{material.description}</p>}
          {material.kind === 'text' && <article className="pro-body whitespace-pre-wrap [overflow-wrap:anywhere]" style={{lineHeight: 1.7}}>{material.body}</article>}
          {material.kind === 'link' && (
            <div className="t-attach">
              <span className="t-attach-icon" data-hue="teal" style={{['--mark' as string]: 'var(--pro-h-teal)'}}>
                <Link2 />
              </span>
              <span className="min-w-0 flex-1 truncate pro-secondary">{material.link}</span>
            </div>
          )}
          {material.kind === 'file' && file && (
            <>
              <div className="t-attach">
                <span className="t-attach-icon">
                  <FileText />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{file.name}</span>
                  <span className="pro-meta">{formatBytes(file.size)}</span>
                </span>
              </div>
              {file.is_image && <img src={fileUrl(file.id)} alt={material.title} className="max-h-[60dvh] w-full rounded-xl object-contain" style={{background: 'var(--pro-sunken)'}} />}
              {isPdf && <iframe title={material.title} src={fileUrl(file.id)} className="h-[62dvh] w-full rounded-xl border max-sm:hidden" style={{borderColor: 'var(--pro-border)', background: '#fff'}} />}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------- quiz */
const LETTERS = 'ABCDEF';

function useCountdown(seconds: number | null, onZero: () => void) {
  const [left, setLeft] = useState<number | null>(seconds);
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => setLeft(seconds), [seconds]);
  useEffect(() => {
    if (seconds === null) return undefined;
    const end = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        zero.current();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return left;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function QuizRunner({quizId, onClose}: {quizId: number | null; onClose: () => void}) {
  const {toast} = useSession();
  const [quiz, setQuiz] = useState<TQuiz | null>(null);
  const [attempt, setAttempt] = useState<TAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!quizId) return;
    setQuiz(null);
    setAttempt(null);
    setAnswers({});
    setIndex(0);
    setError(null);
    teachers.quiz(quizId).then(setQuiz).catch((e) => setError(errText(e)));
  }, [quizId]);

  const start = async () => {
    if (!quiz) return;
    setBusy(true);
    try {
      const next = await teachers.startQuiz(quiz.id);
      setAttempt(next);
      setAnswers(next.answers ?? {});
      setIndex(0);
    } catch (e) {
      toast('error', 'Could not start', errText(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = useCallback(
    async (auto = false) => {
      if (!attempt || attempt.status !== 'in_progress') return;
      setBusy(true);
      try {
        const result = await teachers.submitQuiz(attempt.id, answers);
        setAttempt(result);
        if (auto) toast('info', 'Time is up', 'Your answers were submitted automatically.');
        if (quizId) teachers.quiz(quizId).then(setQuiz).catch(() => {});
      } catch (e) {
        toast('error', 'Could not submit', errText(e));
      } finally {
        setBusy(false);
      }
    },
    [attempt, answers, quizId, toast],
  );

  const running = attempt?.status === 'in_progress';
  const left = useCountdown(running ? attempt?.remaining_seconds ?? null : null, () => void submit(true));

  const choose = (questionId: number, value: string) => {
    setAnswers((current) => {
      const next = {...current, [String(questionId)]: value};
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (attempt) saveTimer.current = window.setTimeout(() => void teachers.saveAnswers(attempt.id, next).catch(() => {}), 700);
      return next;
    });
  };

  const close = async () => {
    if (running && !(await askConfirm('Leave the quiz? Your answers are saved and the timer keeps running.'))) return;
    onClose();
  };

  const questions = attempt?.questions ?? [];
  const current = questions[index];
  const answeredCount = useMemo(() => questions.filter((q) => (answers[String(q.id)] ?? '') !== '').length, [questions, answers]);

  return (
    <Sheet
      open={quizId !== null}
      onClose={close}
      size="lg"
      icon={<ListChecks />}
      title={quiz?.title ?? 'Quiz'}
      subtitle={
        running ? (
          <span className="inline-flex items-center gap-2">
            {answeredCount}/{questions.length} answered
            {left !== null && (
              <span className="inline-flex items-center gap-1 font-semibold" style={{color: left < 60 ? 'var(--pro-danger)' : 'var(--pro-text-2)'}}>
                <Timer className="size-3.5" /> {mmss(left)}
              </span>
            )}
          </span>
        ) : quiz ? (
          `${quiz.question_count} questions · ${quiz.time_limit_minutes ? `${quiz.time_limit_minutes} min` : 'untimed'} · pass ${quiz.pass_mark}%`
        ) : undefined
      }
      footer={
        running ? (
          <>
            <button type="button" className="pro-btn" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              Previous
            </button>
            {index < questions.length - 1 ? (
              <button type="button" className="pro-btn pro-btn-primary" onClick={() => setIndex((i) => i + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="pro-btn pro-btn-primary" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Submit
              </button>
            )}
          </>
        ) : attempt?.status === 'submitted' ? (
          <>
            <button type="button" className="pro-btn" onClick={() => void start()} disabled={busy}>
              <RotateCcw className="size-4" /> Try again
            </button>
            <button type="button" className="pro-btn pro-btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : quiz ? (
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void start()} disabled={busy || quiz.status !== 'published'}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {quiz.in_progress_id ? 'Resume quiz' : (quiz.my_attempts ?? 0) > 0 ? 'Retake quiz' : 'Start quiz'}
          </button>
        ) : null
      }
    >
      {error && <p className="pro-secondary">{error}</p>}
      {!quiz && !error && <LoadingRows rows={3} />}

      {quiz && !attempt && (
        <div className="grid gap-4">
          {quiz.description && <p className="pro-body">{quiz.description}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div className="t-kpi">
              <span>Questions</span>
              <b>{quiz.question_count}</b>
            </div>
            <div className="t-kpi">
              <span>Time</span>
              <b>{quiz.time_limit_minutes ? `${quiz.time_limit_minutes}m` : '—'}</b>
            </div>
            <div className="t-kpi">
              <span>Pass mark</span>
              <b>{quiz.pass_mark}%</b>
            </div>
          </div>
          {quiz.teacher && (
            <p className="pro-secondary inline-flex items-center gap-1.5">
              Set by {quiz.teacher.name} {quiz.teacher.verified && <VerifiedMark size={14} />}
            </p>
          )}
          {!!quiz.attempts?.length && (
            <div className="pro-card pro-rows">
              {quiz.attempts.map((a) => (
                <div key={a.id} className="t-row">
                  {a.passed ? <CheckCircle2 className="size-4" style={{color: 'var(--pro-success)'}} /> : <XCircle className="size-4" style={{color: 'var(--pro-danger)'}} />}
                  <span className="flex-1 font-semibold">{a.percentage}%</span>
                  <span className="pro-meta">{timeAgo(a.submitted_at)}</span>
                </div>
              ))}
            </div>
          )}
          {quiz.time_limit_minutes > 0 && (
            <p className="pro-meta inline-flex items-center gap-1.5">
              <Clock className="size-3.5" /> The timer starts when you begin and keeps running if you leave.
            </p>
          )}
        </div>
      )}

      {running && current && (
        <div className="grid min-w-0 gap-4">
          <div className="t-qnav" aria-label="Questions">
            {questions.map((q, i) => (
              <button key={q.id} type="button" onClick={() => setIndex(i)} aria-current={i === index} data-answered={(answers[String(q.id)] ?? '') !== '' ? '' : undefined} aria-label={`Question ${i + 1}`}>
                {i + 1}
              </button>
            ))}
          </div>
          <div className="grid min-w-0 gap-1">
            <p className="pro-eyebrow">
              Question {index + 1} · {current.marks} mark{current.marks > 1 ? 's' : ''}
            </p>
            <p className="pro-h3 whitespace-pre-wrap [overflow-wrap:anywhere]">{current.prompt}</p>
          </div>
          {(current.kind === 'mcq' || current.kind === 'tf') && (
            <div className="grid gap-2">
              {(current.kind === 'tf' ? ['True', 'False'] : current.options).map((option, i) => {
                const value = current.kind === 'tf' ? option.toLowerCase() : LETTERS[i];
                return (
                  <button key={option + i} type="button" className="t-option" aria-pressed={(answers[String(current.id)] ?? '').toLowerCase() === value.toLowerCase()} onClick={() => choose(current.id, value)}>
                    <b>{current.kind === 'tf' ? option[0] : LETTERS[i]}</b>
                    <span className="min-w-0 flex-1">{option}</span>
                  </button>
                );
              })}
            </div>
          )}
          {(current.kind === 'short' || current.kind === 'numeric') && (
            <Field label={current.kind === 'numeric' ? 'Your answer (a number)' : 'Your answer'}>
              <input
                className="pro-input"
                inputMode={current.kind === 'numeric' ? 'decimal' : 'text'}
                value={answers[String(current.id)] ?? ''}
                onChange={(e) => choose(current.id, e.target.value)}
                placeholder={current.kind === 'numeric' ? 'e.g. 3.5' : 'Type your answer'}
              />
            </Field>
          )}
        </div>
      )}

      {attempt?.status === 'submitted' && (
        <div className="grid min-w-0 gap-4">
          <div className="t-hero-teacher flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl" style={{background: attempt.passed ? 'var(--pro-success-soft)' : 'var(--pro-danger-soft)', color: attempt.passed ? 'var(--pro-success)' : 'var(--pro-danger)'}}>
              {attempt.passed ? <Trophy className="size-7" /> : <RotateCcw className="size-7" />}
            </span>
            <div className="min-w-0">
              <p className="pro-h2">{attempt.percentage}%</p>
              <p className="pro-secondary">
                {attempt.score} of {attempt.max_score} marks · {attempt.passed ? 'Passed' : `Pass mark is ${attempt.quiz.pass_mark}%`}
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            {attempt.questions.map((q, i) => (
              <div key={q.id} className="pro-card grid min-w-0 gap-2 p-4">
                <div className="flex items-start gap-2">
                  {q.correct ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-success)'}} /> : <XCircle className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-danger)'}} />}
                  <p className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                    {i + 1}. {q.prompt}
                  </p>
                </div>
                <p className="pro-secondary [overflow-wrap:anywhere]">
                  Your answer: <b style={{color: 'var(--pro-text)'}}>{displayAnswer(q.kind, q.options, q.given)}</b>
                  {!q.correct && (
                    <>
                      {' '}
                      · Correct: <b style={{color: 'var(--pro-success)'}}>{displayAnswer(q.kind, q.options, q.kind === 'short' ? (q.answer ?? '').split('|')[0] : q.answer)}</b>
                    </>
                  )}
                </p>
                {q.explanation && <p className="pro-meta [overflow-wrap:anywhere]">{q.explanation}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function displayAnswer(kind: string, options: string[], value?: string | null): string {
  if (value === undefined || value === null || value === '') return 'No answer';
  if (kind === 'mcq') {
    const index = LETTERS.indexOf(value.toUpperCase());
    return index >= 0 && options[index] ? `${value.toUpperCase()}. ${options[index]}` : value;
  }
  if (kind === 'tf') return value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}

/* ----------------------------------------------------------------- report */
const REASONS = ['Inappropriate or abusive', 'Spam or advertising', 'Asked for money or contact details off-platform', 'Misleading or fake', 'Copyright or plagiarism', 'Other'];

export function ReportSheet({target, onClose}: {target: {kind: string; id: number; label: string} | null; onClose: () => void}) {
  const {toast} = useSession();
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason(REASONS[0]);
    setDetail('');
  }, [target]);
  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await teachers.report(target.kind, target.id, [reason, detail.trim()].filter(Boolean).join(': ').slice(0, 400));
      toast('success', 'Report sent', 'Thanks — our team reviews every report.');
      onClose();
    } catch (e) {
      toast('error', 'Could not report', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      size="sm"
      icon={<Flag />}
      title="Report"
      subtitle={target?.label}
      footer={
        <>
          <button type="button" className="pro-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void send()} disabled={busy}>
            Send report
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-1.5" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} className="t-option" aria-pressed={reason === r} onClick={() => setReason(r)}>
              <span className="min-w-0 flex-1 text-[0.85rem]">{r}</span>
            </button>
          ))}
        </div>
        <Field label="Anything else? (optional)">
          <textarea className="pro-input" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} />
        </Field>
        <p className="pro-meta">Reports are private. The person you report isn't told who sent it.</p>
      </div>
    </Sheet>
  );
}

export function VisibilityBadge({visibility, group}: {visibility: string; group?: string}) {
  const base = {private: 'Only me', students: 'My students', group: 'Group', public: 'Public'}[visibility] ?? visibility;
  const label = visibility === 'group' && group ? group : base;
  return <Badge tone={visibility === 'public' ? 'accent' : undefined}>{label}</Badge>;
}
