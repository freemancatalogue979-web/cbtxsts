/**
 * Pro dashboard — a quiet study overview.
 *
 * Everything comes from the same endpoints Standard uses (analytics, Study
 * Lab, practice, exams); nothing here is Pro-only data.
 */
import {ArrowRight, Clock3} from 'lucide-react';
import {useEffect, useState} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import type {Tab} from '../lib/nav';
import type {Quiz} from '../lib/types';
import {miniExamApi, openMiniExam, type MiniExam} from '../lib/tutor';
import {useSession} from '../store/session';
import {setFocus} from './focus';
import {Badge, Empty, LoadingRows, Metric, PageHeader, Progress, Section, greeting, minutesLabel, pct, studyTotals, toneFor} from './ui';

type Json = Record<string, any>;

export default function ProDashboard({onTab, onStartExam}: {onTab: (tab: Tab) => void; onStartExam: (quiz: Quiz) => void}) {
  const {profile} = useSession();
  const [analytics, setAnalytics] = useState<Json | null>(null);
  const [month, setMonth] = useState<Json | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [practice, setPractice] = useState<Json | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [minis, setMinis] = useState<MiniExam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      api.arena.analytics(7).then((d) => live && setAnalytics(d)),
      api.arena.analytics(30).then((d) => live && setMonth(d)),
      api.studyLabOverview().then((d) => live && setLab(d as Json)),
      api.arena.practiceActive().then((d) => live && setPractice(d)),
      api.quizzes().then((d) => live && setQuizzes(d.filter((q) => !q.is_bank))),
      miniExamApi.list().then((d) => live && setMinis(d.mini_exams ?? [])),
    ]).finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const week = analytics?.overview ?? {};
  const all = month?.overview ?? {};
  const totals = studyTotals(all);
  const weekTotals = studyTotals(week);
  const answered30 = totals.answered;
  const minutes30 = totals.minutes;
  const mastered = (lab?.mastered ?? []).length;
  const known = Number(lab?.topics_known ?? 0);
  const mastery = known ? (mastered / known) * 100 : 0;
  const firstName = (profile?.name || '').split(' ')[0];

  const run = practice?.run as Json | null;
  const miniActive = minis.find((m) => m.status === 'in_progress');
  const cont = lab?.continue as Json | null;
  const liveExams = (quizzes ?? []).filter((q) => q.status === 'active' && q.my_attempt?.status !== 'submitted').slice(0, 4);

  const weak: Json[] = (month?.weakest_topics ?? []).slice(0, 4);
  const recentExams: Json[] = (month?.exam_trend ?? []).slice(-5).reverse();
  const recentMinis = minis.filter((m) => m.status === 'submitted').slice(0, 3);

  const openTopic = (topic: string) => {
    setFocus({topic});
    onTab('study');
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:gap-8">
      <PageHeader
        eyebrow="Absolute Genesis Pro"
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}.`}
        description="Study overview for the last 30 days."
        actions={
          <>
            <button type="button" className="pro-btn" onClick={() => onTab('exams')}>
              Start an exam
            </button>
            <button type="button" className="pro-btn pro-btn-primary" onClick={() => onTab('study')}>
              Continue studying
            </button>
          </>
        }
      />

      {/* metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Accuracy"
          value={loading ? '—' : answered30 ? pct(totals.accuracy) : '—'}
          sub={weekTotals.answered ? `${pct(weekTotals.accuracy)} this week` : 'No answers this week'}
          tone={toneFor(totals.accuracy, answered30)}
        />
        <Metric label="Questions" value={loading ? '—' : answered30.toLocaleString()} sub={`${weekTotals.answered} this week`} />
        <Metric label="Mastered" value={loading ? '—' : mastered} sub={known ? `of ${known} studied` : "No topics studied yet"} />
        <Metric label="Study time" value={loading ? '—' : minutesLabel(minutes30)} sub="last 30 days" />
        <Metric label="Streak" value={loading ? '—' : `${Number(all.streak ?? profile?.streak ?? 0)} d`} sub={`Best ${Number(all.best_streak ?? 0)} d`} />
        <Metric label="Mastery" value={loading ? '—' : pct(mastery)} sub={`${Number(lab?.open_mistakes ?? 0)} open mistakes`} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          {/* continue */}
          <Section title="Continue studying">
            {loading ? (
              <LoadingRows rows={2} />
            ) : run || miniActive || cont ? (
              <div className="pro-rows grid">
                {run && (
                  <ContinueRow
                    kind="Practice"
                    title={String(run.label || 'Practice run')}
                    detail={`${Number(run.index ?? run.position ?? 0)} of ${Number(run.total ?? (run.questions?.length || 0))} answered`}
                    progress={(Number(run.index ?? 0) / Math.max(1, Number(run.total ?? run.questions?.length ?? 1))) * 100}
                    action="Resume"
                    onClick={() => onTab('bank')}
                  />
                )}
                {miniActive && (
                  <ContinueRow
                    kind="Mini exam"
                    title={miniActive.title}
                    detail={`${miniActive.answered} of ${miniActive.question_count} answered`}
                    progress={(miniActive.answered / Math.max(1, miniActive.question_count)) * 100}
                    action="Resume"
                    onClick={() => openMiniExam(miniActive.id)}
                  />
                )}
                {cont && (
                  <ContinueRow
                    kind="Topic"
                    title={String(cont.topic)}
                    detail={`${cont.state_label ?? 'In progress'} · ${pct(cont.accuracy)} accuracy`}
                    progress={Number(cont.accuracy ?? 0)}
                    action="Continue"
                    onClick={() => openTopic(String(cont.topic))}
                  />
                )}
              </div>
            ) : (
              <Empty
                title="Nothing in progress"
                body="Pick a course topic to start studying, or practise from the question bank."
                action={
                  <button type="button" className="pro-btn pro-btn-primary" onClick={() => onTab('courses')}>
                    Browse courses
                  </button>
                }
              />
            )}
          </Section>

          {/* recommended */}
          <Section title="Recommended study" description="Based on your weakest topics and open mistakes.">
            {loading ? (
              <LoadingRows rows={3} />
            ) : weak.length || lab?.recommended ? (
              <ul className="pro-rows grid">
                {lab?.recommended && !weak.some((w) => w.key === lab.recommended) && (
                  <RecRow title={`Work through ${lab.recommended}`} detail="Next step on your study path" onClick={() => openTopic(String(lab.recommended))} />
                )}
                {weak.map((row) => (
                  <RecRow
                    key={row.key}
                    title={`Review ${row.key}`}
                    detail={`${pct(row.accuracy)} accuracy over ${row.answered} questions`}
                    tone={toneFor(row.accuracy, row.answered)}
                    onClick={() => openTopic(String(row.key))}
                  />
                ))}
                {Number(lab?.open_mistakes ?? 0) > 0 && (
                  <RecRow title="Review recent mistakes" detail={`${lab?.open_mistakes} questions to revisit`} onClick={() => onTab('study')} />
                )}
              </ul>
            ) : (
              <Empty title="No recommendations yet" body="Answer a few practice questions and recommendations will appear here." />
            )}
          </Section>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          {/* exams open now */}
          <Section title="Exams" action={<button type="button" className="pro-btn pro-btn-sm pro-btn-ghost" onClick={() => onTab('exams')}>View all</button>}>
            {quizzes === null ? (
              <LoadingRows rows={2} />
            ) : liveExams.length ? (
              <ul className="pro-rows grid">
                {liveExams.map((quiz) => (
                  <li key={quiz.id} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium" style={{color: 'var(--pro-text)'}}>{quiz.title}</p>
                      <p className="pro-meta truncate">
                        {quiz.course?.code ? `${quiz.course.code} · ` : ''}
                        {quiz.question_count} questions · {quiz.duration_minutes} min
                      </p>
                    </div>
                    <button type="button" className="pro-btn pro-btn-sm" onClick={() => onStartExam(quiz)}>
                      {quiz.my_attempt?.status === 'in_progress' ? 'Resume' : 'Open'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pro-secondary">No exams are open right now.</p>
            )}
          </Section>

          {/* recent activity */}
          <Section title="Recent activity">
            {loading ? (
              <LoadingRows rows={3} />
            ) : recentExams.length || recentMinis.length ? (
              <ul className="pro-rows grid">
                {recentMinis.map((m) => (
                  <ActivityRow key={`m${m.id}`} title={m.title} detail={`Mini exam · ${m.finished_at ? formatRelative(m.finished_at) : ''}`} value={pct(m.percentage)} onClick={() => openMiniExam(m.id)} />
                ))}
                {recentExams.map((row) => (
                  <ActivityRow key={`e${row.attempt_id}`} title={String(row.quiz || 'Exam')} detail={`Exam · ${row.submitted_at ? formatRelative(row.submitted_at) : ''}`} value={pct(row.percentage)} />
                ))}
              </ul>
            ) : (
              <p className="pro-secondary">Your finished exams and mini exams will appear here.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function ContinueRow({kind, title, detail, progress, action, onClick}: {kind: string; title: string; detail: string; progress: number; action: string; onClick: () => void}) {
  return (
    <div className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="pro-eyebrow">{kind}</p>
        <p className="pro-h3 mt-1 [overflow-wrap:anywhere]">{title}</p>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Progress value={progress} label={`${title} progress`} />
          </div>
          <span className="pro-meta pro-num shrink-0">{Math.round(progress)}%</span>
        </div>
        <p className="pro-meta mt-1.5">{detail}</p>
      </div>
      <button type="button" className="pro-btn pro-btn-primary" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

function RecRow({title, detail, tone, onClick}: {title: string; detail: string; tone?: 'success' | 'warning' | 'danger'; onClick: () => void}) {
  return (
    <li>
      <button type="button" onClick={onClick} className="group flex w-full min-w-0 items-center gap-3 py-3 text-left first:pt-0">
        <span className="size-1.5 shrink-0 rounded-full" style={{background: tone ? `var(--pro-${tone})` : 'var(--pro-accent)'}} />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-medium [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{title}</span>
          <span className="pro-meta block">{detail}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" style={{color: 'var(--pro-text-2)'}} />
      </button>
    </li>
  );
}

function ActivityRow({title, detail, value, onClick}: {title: string; detail: string; value: string; onClick?: () => void}) {
  const body = (
    <>
      <Clock3 className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem]" style={{color: 'var(--pro-text)'}}>{title}</span>
        <span className="pro-meta block truncate">{detail}</span>
      </span>
      <Badge>{value}</Badge>
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className="flex w-full min-w-0 items-center gap-3 py-3 text-left first:pt-0 last:pb-0">
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">{body}</div>
      )}
    </li>
  );
}
