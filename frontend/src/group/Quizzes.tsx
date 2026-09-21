/**
 * Group quizzes: the whole group can take part. Staff set a quiz (title,
 * course, topic, question count up to 100, per-question and total time,
 * window, attempts, rewards, pass mark); everyone eligible sees "Upcoming"
 * and "Join". Taking the quiz opens the dedicated full-page runner (GroupQuiz),
 * never a modal. Leaderboards are paginated.
 */
import {ArrowLeft, CalendarClock, ChevronRight, Play, Plus, Trophy, Users, Zap} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Pager, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import {useCountdown} from '../lib/groupSocket';
import type {Course, GroupQuiz as GQ, GroupQuizLeaderRow, PageMeta} from '../lib/types';

type Filter = 'all' | 'upcoming' | 'live' | 'closed' | 'mine';

function toUtcIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function QuizStarts({iso, status}: {iso: string | null; status: string}) {
  const label = useCountdown(iso);
  if (status === 'live') return <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Live now</Chip>;
  if (status === 'closed') return <Chip className="border-white/12 bg-white/6 text-mist-500">Closed</Chip>;
  return <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">{label ? `Starts ${label}` : 'Scheduled'}</Chip>;
}

/* ------------------------------------------------------------- create form */
function CreateQuiz({onDone, onCancel}: {onDone: () => void; onCancel: () => void}) {
  const {groupId, notify} = useGroup();
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState<number | ''>('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [count, setCount] = useState(10);
  const [perQuestion, setPerQuestion] = useState(30);
  const [duration, setDuration] = useState(0);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [attempts, setAttempts] = useState(1);
  const [randomize, setRandomize] = useState(true);
  const [rewardXp, setRewardXp] = useState(50);
  const [rewardCoins, setRewardCoins] = useState(0);
  const [passScore, setPassScore] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.courses().then(setCourses).catch(() => setCourses([]));
  }, []);

  const submit = async () => {
    if (title.trim().length < 3) {
      notify('error', 'Add a title', 'Quizzes need a title of at least 3 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.groups.createQuiz(groupId, {
        title: title.trim(),
        course_id: courseId === '' ? null : Number(courseId),
        topic: topic.trim(),
        description: description.trim(),
        question_count: Math.min(100, Math.max(1, count)),
        per_question_seconds: perQuestion,
        duration_minutes: duration,
        starts_at: toUtcIso(startsAt),
        ends_at: toUtcIso(endsAt),
        max_attempts: attempts,
        randomize,
        reward_xp: rewardXp,
        reward_coins: rewardCoins,
        pass_score: passScore,
      });
      notify('success', 'Quiz published', 'Members can see it now.');
      onDone();
    } catch (error) {
      notify('error', 'Could not publish quiz', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} icon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
        <h2 className="text-[1rem] font-extrabold text-mist-50">Set a group quiz</h2>
      </div>

      <Card className="grid gap-3 p-4">
        <Field label="Quiz title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Government Quiz — Week 4" maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Course">
            <Select value={courseId} onChange={(e) => setCourseId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">All courses</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic (optional)">
            <TextInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Constitutional Law" maxLength={120} />
          </Field>
        </div>
        <Field label="Description (optional)">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this quiz covers…" maxLength={1000} />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={`Questions (${count})`}>
            <input type="range" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-nova-400" />
          </Field>
          <Field label={`Sec / question (${perQuestion})`}>
            <input type="range" min={5} max={120} step={5} value={perQuestion} onChange={(e) => setPerQuestion(Number(e.target.value))} className="w-full accent-nova-400" />
          </Field>
          <Field label="Attempts (0 = ∞)">
            <TextInput type="number" min={0} max={10} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} />
          </Field>
          <Field label={`Pass mark (${passScore}%)`}>
            <input type="range" min={0} max={100} step={5} value={passScore} onChange={(e) => setPassScore(Number(e.target.value))} className="w-full accent-nova-400" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts at (optional)">
            <TextInput type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ends at (optional)">
            <TextInput type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Total minutes (0 = auto)">
            <TextInput type="number" min={0} max={240} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
          <Field label="Reward XP">
            <TextInput type="number" min={0} max={5000} value={rewardXp} onChange={(e) => setRewardXp(Number(e.target.value))} />
          </Field>
          <Field label="Reward coins">
            <TextInput type="number" min={0} max={5000} value={rewardCoins} onChange={(e) => setRewardCoins(Number(e.target.value))} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[0.8rem] font-semibold text-mist-300">
          <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} className="size-4 accent-nova-400" />
          Randomize question & option order per member
        </label>
        <p className="text-[0.72rem] font-medium text-mist-600">Visibility: group members only. Leaving the start blank publishes it live immediately.</p>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void submit()} disabled={busy} icon={<Zap className="size-4" />}>
            {busy ? 'Publishing…' : 'Publish quiz'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ quiz detail */
function QuizDetail({quizId, onBack}: {quizId: number; onBack: () => void}) {
  const {groupId, openQuiz} = useGroup();
  const [quiz, setQuiz] = useState<GQ | null>(null);
  const [board, setBoard] = useState<GroupQuizLeaderRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    api.groups.quiz(groupId, quizId).then((payload) => {
      setQuiz(payload.quiz);
      setBoard(payload.leaderboard.items);
      setMeta(payload.leaderboard);
    });
  }, [groupId, quizId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (page === 1) return;
    api.groups.quizLeaderboard(groupId, quizId, {page, size: 10}).then((payload) => {
      setBoard(payload.items);
      setMeta(payload);
    });
  }, [page, groupId, quizId]);

  if (!quiz) return <Skeleton className="m-4 h-64 w-auto" />;
  const part = quiz.my_participation;
  const canJoin = quiz.status === 'live';

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
          Quizzes
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[1.05rem] font-black text-mist-50">{quiz.title}</h2>
            <p className="mt-0.5 text-[0.78rem] font-medium text-mist-500">
              {[quiz.course_title, quiz.topic].filter(Boolean).join(' · ') || 'General'} · {quiz.question_count} questions · pass {quiz.pass_score}%
            </p>
            {quiz.description && <p className="mt-1.5 text-[0.8rem] font-medium text-mist-300">{quiz.description}</p>}
          </div>
          <QuizStarts iso={quiz.starts_at} status={quiz.status} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip className="border-white/12 bg-white/6 text-mist-300" icon={<Users className="size-3.5" />}>
            {quiz.participants} joined · {quiz.submitted} submitted
          </Chip>
          {quiz.per_question_seconds > 0 && <Chip className="border-white/12 bg-white/6 text-mist-300">{quiz.per_question_seconds}s / question</Chip>}
          {(quiz.reward_xp > 0 || quiz.reward_coins > 0) && (
            <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200">
              +{quiz.reward_xp} XP{quiz.reward_coins ? ` · +${quiz.reward_coins} 🪙` : ''}
            </Chip>
          )}
          <Chip className="border-white/12 bg-white/6 text-mist-400">Max attempts: {quiz.max_attempts === 0 ? '∞' : quiz.max_attempts}</Chip>
        </div>

        {part && (
          <div className="mt-3 rounded-xl border border-nova-500/25 bg-nova-500/8 px-3 py-2">
            <p className="text-[0.76rem] font-bold text-nova-200">
              Your best: {part.correct_count}/{quiz.question_count} · {part.percentage}% {part.passed ? '· passed ✅' : ''}
              {part.position ? ` · rank #${part.position}` : ''}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {canJoin && (
            <Button variant="primary" icon={<Play className="size-4" />} onClick={() => openQuiz(quiz.id)}>
              {part && part.status === 'in_progress' ? 'Resume quiz' : 'Join quiz'}
            </Button>
          )}
          {quiz.status === 'scheduled' && <Button variant="outline" disabled icon={<CalendarClock className="size-4" />}>Starts {formatRelative(quiz.starts_at)}</Button>}
          {quiz.status === 'closed' && <Button variant="outline" disabled>Closed</Button>}
        </div>
      </Card>

      <Card className="p-3.5">
        <SectionHeading title="Leaderboard" subtitle="Top scores in this group quiz" icon={<Trophy className="size-4" />} />
        <ul className="mt-1 grid gap-1.5">
          {board.map((row) => (
            <li key={`${row.rank}-${row.student.id}`} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
              <span className="w-6 shrink-0 text-[0.78rem] font-black tabular text-mist-500">#{row.rank}</span>
              <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.student.name}</span>
              <span className="shrink-0 text-[0.72rem] font-semibold text-mist-500 tabular">
                {row.correct}/{row.total}
              </span>
              <span className={`shrink-0 text-[0.8rem] font-black tabular ${row.passed ? 'text-mint-300' : 'text-flare-300'}`}>{row.percentage}%</span>
            </li>
          ))}
          {board.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">No submissions yet.</li>}
        </ul>
        {meta && meta.pages > 1 && (
          <Pager className="mt-3" page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Leaderboard pages" />
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------- list */
export default function Quizzes() {
  const {groupId, can, room, openQuiz, intent, clearIntent} = useGroup();
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<GQ[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (intent === 'create' && can('set_quiz')) {
      setView('create');
      clearIntent();
    }
  }, [intent, can, clearIntent]);

  const load = useCallback(() => {
    setLoading(true);
    api.groups
      .quizzes(groupId, {filter, page, size: 8})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .finally(() => setLoading(false));
  }, [groupId, filter, page]);

  useEffect(load, [load]);
  useEffect(() => room.on('group_quiz_update', load), [room, load]);

  if (view === 'create')
    return (
      <CreateQuiz
        onCancel={() => setView('list')}
        onDone={() => {
          setView('list');
          setPage(1);
          load();
        }}
      />
    );
  if (view === 'detail' && detailId) return <QuizDetail quizId={detailId} onBack={() => setView('list')} />;

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading
        title="Quizzes"
        subtitle="Group quizzes everyone can join"
        icon={<Zap className="size-4" />}
        action={can('set_quiz') ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setView('create')}>Set quiz</Button> : undefined}
      />
      <Segmented
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        options={[
          {value: 'all', label: 'All'},
          {value: 'live', label: 'Live'},
          {value: 'upcoming', label: 'Upcoming'},
          {value: 'closed', label: 'Closed'},
          {value: 'mine', label: 'Mine'},
        ]}
      />

      {loading && !items.length ? (
        <div className="grid gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Zap className="size-5" />} title="No quizzes here yet" detail={can('set_quiz') ? 'Set the first group quiz.' : 'Check back soon.'} />
      ) : (
        <ul className="grid gap-2">
          {items.map((quiz) => (
            <li key={quiz.id}>
              <Card className="flex flex-col gap-2 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[0.9rem] font-extrabold text-mist-50">{quiz.title}</h3>
                    <p className="mt-0.5 text-[0.72rem] font-semibold text-mist-500">
                      {[quiz.course_title, quiz.topic].filter(Boolean).join(' · ') || 'General'} · {quiz.question_count} Qs · {quiz.participants} joined
                    </p>
                  </div>
                  <QuizStarts iso={quiz.starts_at} status={quiz.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {quiz.status === 'live' ? (
                    <Button size="sm" variant="primary" icon={<Play className="size-4" />} onClick={() => openQuiz(quiz.id)}>
                      {quiz.my_participation?.status === 'in_progress' ? 'Resume' : 'Join quiz'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => { setDetailId(quiz.id); setView('detail'); }}>
                      {quiz.status === 'closed' ? 'Results' : 'Details'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<ChevronRight className="size-4" />} onClick={() => { setDetailId(quiz.id); setView('detail'); }}>
                    Leaderboard
                  </Button>
                  {quiz.my_participation?.status === 'submitted' && (
                    <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">Score {quiz.my_participation.percentage}%</Chip>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Quiz pages" />}
    </div>
  );
}
