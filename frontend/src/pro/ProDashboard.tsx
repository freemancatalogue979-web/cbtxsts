/**
 * Pro dashboard — a quiet study overview.
 *
 * Everything comes from the same endpoints Standard uses (analytics, Study
 * Lab, practice, exams); nothing here is Pro-only data.
 */
import {ArrowRight, Award, BarChart3, BookOpen, CalendarDays, ClipboardCheck, Clock, Compass, FileText, Flame, Gauge, GraduationCap, History, Library, Lightbulb, ListChecks, Play, RotateCcw, Target, TrendingUp} from 'lucide-react';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import type {Tab} from '../lib/nav';
import type {Quiz} from '../lib/types';
import {miniExamApi, openMiniExam, type MiniExam} from '../lib/tutor';
import {useSession} from '../store/session';
import {setFocus} from './focus';
import {Bars, Chip, Cover, Empty, LoadingRows, Metric, Ring, Section, Tile, greeting, hueForCourse, minutesLabel, pct, studyTotals, toneFor, type Hue} from './ui';

type Json = Record<string, any>;

export default function ProDashboard({onTab, onStartExam}: {onTab: (tab: Tab) => void; onStartExam: (quiz: Quiz) => void}) {
  const {profile} = useSession();
  const [analytics, setAnalytics] = useState<Json | null>(null);
  const [month, setMonth] = useState<Json | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [practice, setPractice] = useState<Json | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [minis, setMinis] = useState<MiniExam[]>([]);
  const [heat, setHeat] = useState<Json[]>([]);
  const [plan, setPlan] = useState<Json | null>(null);
  const [catalog, setCatalog] = useState<Json[]>([]);
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
      api.arena.heatmap(30).then((d) => live && setHeat(((d as Json).data ?? []) as Json[])),
      api.arena.studyPlan().then((d) => live && setPlan(d as Json)),
      api.arena.practiceCatalog().then((d) => live && setCatalog(((d as Json).courses ?? []) as Json[])),
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
  const streak = Number(all.streak ?? profile?.streak ?? 0);

  /* last 7 days of activity (exam answers + practice), oldest → today */
  const days = useMemo(() => {
    const byDay = new Map(heat.map((row) => [String(row.day), row]));
    const out: {label: string; value: number; correct: number; today: boolean; title: string}[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      const value = Number(row?.answered ?? 0);
      out.push({label: d.toLocaleDateString(undefined, {weekday: 'short'}).slice(0, 2), value, correct: Number(row?.correct ?? 0), today: i === 0, title: `${d.toLocaleDateString(undefined, {weekday: 'long'})}: ${value} questions`});
    }
    return out;
  }, [heat]);
  const weekAnswered = days.reduce((n, d) => n + d.value, 0);
  const activeDays = days.filter((d) => d.value > 0).length;

  const goal = plan?.daily_goal as Json | undefined;
  const goalTarget = Math.max(1, Number(goal?.questions ?? 15));
  const goalDone = Number(goal?.done_today ?? 0);
  const goalPct = Math.min(100, (goalDone / goalTarget) * 100);

  const run = practice?.run as Json | null;
  const miniActive = minis.find((m) => m.status === 'in_progress');
  const cont = lab?.continue as Json | null;
  const liveExams = (quizzes ?? []).filter((q) => q.status === 'active' && q.my_attempt?.status !== 'submitted').slice(0, 4);

  const weak: Json[] = (month?.weakest_topics ?? []).slice(0, 4);
  const heatTopics: Json[] = ((month?.mastery_heatmap ?? []) as Json[]).filter((r) => Number(r.answered) > 0);
  const recentExams: Json[] = (month?.exam_trend ?? []).slice(-5).reverse();
  const recentMinis = minis.filter((m) => m.status === 'submitted').slice(0, 3);

  /* topic standing from practice as well as exams, so course coverage is honest */
  const touched = new Set(heatTopics.map((r) => String(r.topic).toLowerCase()));
  const weakFromPractice = heatTopics
    .filter((r) => Number(r.mastery) < 60)
    .sort((a, b) => Number(a.mastery) - Number(b.mastery))
    .slice(0, 3);

  const openTopic = (topic: string) => {
    setFocus({topic});
    onTab('study');
  };
  const today = new Date().toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'});

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:gap-6">
      {/* ------------------------------------------------------------ hero */}
      <header className="pro-hero" data-hue="violet">
        <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="pro-eyebrow" style={{color: 'var(--pro-accent-text)'}}>{today}</p>
            <h1 className="pro-h1 mt-1.5 [overflow-wrap:anywhere]">
              {greeting()}
              {firstName ? (
                <>
                  , <span className="pro-grad-text">{firstName}</span>
                </>
              ) : null}
            </h1>
            <p className="pro-secondary mt-1.5 max-w-xl">
              {goalDone >= goalTarget
                ? "You've hit today's goal. Anything more is a bonus: review a weak topic or try a mini exam."
                : goalDone > 0
                  ? `${goalTarget - goalDone} more questions to reach today's goal. Keep the momentum going.`
                  : 'A focused 15 questions a day compounds fast. Pick up where you left off.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip icon={<Flame />} hue="amber">
                {streak} day streak
              </Chip>
              <Chip icon={<CalendarDays />} hue="teal">
                {activeDays} of 7 days active
              </Chip>
              <Chip icon={<Target />} hue="green">
                {weekTotals.answered ? `${pct(weekTotals.accuracy)} accuracy this week` : 'No answers this week yet'}
              </Chip>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="pro-btn pro-btn-primary pro-btn-lg" onClick={() => (run ? onTab('bank') : cont ? openTopic(String(cont.topic)) : onTab('study'))}>
                <Play className="size-4" /> {run ? 'Resume practice' : 'Continue studying'}
              </button>
              <button type="button" className="pro-btn pro-btn-lg" onClick={() => onTab('exams')}>
                <ClipboardCheck className="size-4" /> Start an exam
              </button>
            </div>
          </div>
          <div className="hidden items-center gap-5 md:flex">
            <div className="grid justify-items-center gap-2">
              <Ring value={goalPct} size={132} stroke={11} hue={goalPct >= 100 ? 'green' : 'violet'} label={`${goalDone} of ${goalTarget} questions today`}>
                <span className="grid gap-0.5">
                  <span className="text-[1.75rem] font-bold tracking-tight">{Math.min(goalDone, 999)}</span>
                  <span className="pro-meta">of {goalTarget} today</span>
                </span>
              </Ring>
              <span className="pro-eyebrow">Daily goal</span>
            </div>
          </div>
        </div>
      </header>

      {/* metrics */}
      <div className="pro-stagger grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Metric
          icon={<Target />}
          hue="green"
          label="Accuracy"
          value={loading ? '—' : answered30 ? pct(totals.accuracy) : '—'}
          sub={weekTotals.answered ? `${pct(weekTotals.accuracy)} this week` : 'No answers this week'}
          tone={toneFor(totals.accuracy, answered30)}
        />
        <Metric icon={<ListChecks />} hue="blue" label="Questions" value={loading ? '—' : answered30.toLocaleString()} sub={`${weekAnswered} in the last 7 days`} spark={days.map((d) => d.value)} />
        <Metric icon={<Award />} hue="violet" label="Mastered" value={loading ? '—' : mastered} sub={known ? `of ${known} topics studied` : `${heatTopics.length} topics practised`} />
        <Metric icon={<Clock />} hue="teal" label="Study time" value={loading ? '—' : minutesLabel(minutes30)} sub="last 30 days" />
        <Metric icon={<Flame />} hue="amber" label="Streak" value={loading ? '—' : `${streak} d`} sub={`Best ${Number(all.best_streak ?? streak)} d`} />
        <Metric icon={<Gauge />} hue="rose" label="Mastery" value={loading ? '—' : pct(mastery)} sub={`${Number(lab?.open_mistakes ?? 0)} open mistakes`} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] md:gap-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 md:gap-6">
          {/* continue */}
          <Section title="Continue studying" icon={<Play />} hue="violet" description="Pick up exactly where you stopped.">
            {loading ? (
              <LoadingRows rows={2} />
            ) : run || miniActive || cont ? (
              <div className="grid gap-3">
                {run && (
                  <ContinueRow
                    kind="Practice"
                    hue="green"
                    icon={<ListChecks />}
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
                    hue="rose"
                    icon={<ClipboardCheck />}
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
                    hue="blue"
                    icon={<GraduationCap />}
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
                icon={<Compass />}
                hue="violet"
                title="Nothing in progress"
                body="Pick a course topic to start studying, or practise straight from the question bank."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" className="pro-btn pro-btn-primary" onClick={() => onTab('courses')}>
                      Browse courses
                    </button>
                    <button type="button" className="pro-btn" onClick={() => onTab('bank')}>
                      Quick practice
                    </button>
                  </div>
                }
              />
            )}
          </Section>

          {/* courses */}
          {catalog.length > 0 && (
            <Section title="Your courses" icon={<Library />} hue="teal" action={<button type="button" className="pro-btn pro-btn-sm pro-btn-ghost" onClick={() => onTab('courses')}>All courses <ArrowRight className="size-3.5" /></button>}>
              <div className="pro-stagger grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                {catalog.slice(0, 4).map((course) => {
                  const topics = (course.topics ?? []) as Json[];
                  const studied = topics.filter((t) => touched.has(String(t.topic).toLowerCase())).length;
                  const coverage = topics.length ? (studied / topics.length) * 100 : 0;
                  const hue = hueForCourse(course as {id: number; accent?: string});
                  return (
                    <button
                      key={course.id}
                      type="button"
                      className="pro-card pro-lift grid min-w-0 gap-3 p-2.5 text-left"
                      onClick={() => {
                        setFocus({courseId: Number(course.id), courseCode: String(course.code), courseTitle: String(course.title)});
                        onTab('courses');
                      }}
                    >
                      <Cover hue={hue} code={String(course.code)} glyph={<BookOpen className="size-full" />}>
                        <p className="mt-6 line-clamp-2 pr-10 text-[0.9375rem] leading-snug font-bold [overflow-wrap:anywhere]">{String(course.title)}</p>
                      </Cover>
                      <div className="flex min-w-0 items-center gap-3 px-1.5 pb-1">
                        <Ring value={coverage} size={38} stroke={4} hue={hue} label={`${Math.round(coverage)}% of topics studied`}>
                          <span className="text-[0.625rem]">{Math.round(coverage)}%</span>
                        </Ring>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.8125rem] font-semibold" style={{color: 'var(--pro-text)'}}>
                            {studied} of {topics.length} topics studied
                          </span>
                          <span className="pro-meta block truncate">{Number(course.available ?? 0)} questions in the bank</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* recommended */}
          <Section title="Recommended for you" icon={<Lightbulb />} hue="amber" description="Built from your weakest topics and open mistakes.">
            {loading ? (
              <LoadingRows rows={3} />
            ) : weak.length || weakFromPractice.length || lab?.recommended || Number(lab?.open_mistakes ?? 0) > 0 ? (
              <ul className="grid gap-1">
                {lab?.recommended && !weak.some((w) => w.key === lab.recommended) && (
                  <RecRow hue="blue" icon={<GraduationCap />} title={`Work through ${lab.recommended}`} detail="Next step on your study path" onClick={() => openTopic(String(lab.recommended))} />
                )}
                {weak.map((row) => (
                  <RecRow
                    key={row.key}
                    hue="rose"
                    icon={<TrendingUp />}
                    title={`Strengthen ${row.key}`}
                    detail={`${pct(row.accuracy)} accuracy over ${row.answered} questions`}
                    tone={toneFor(row.accuracy, row.answered)}
                    onClick={() => openTopic(String(row.key))}
                  />
                ))}
                {!weak.length &&
                  weakFromPractice.map((row) => (
                    <RecRow key={String(row.topic)} hue="rose" icon={<TrendingUp />} title={`Strengthen ${row.topic}`} detail={`${pct(Number(row.mastery))} mastery from practice`} tone={toneFor(Number(row.mastery))} onClick={() => openTopic(String(row.topic))} />
                  ))}
                {Number(lab?.open_mistakes ?? 0) > 0 && (
                  <RecRow hue="amber" icon={<RotateCcw />} title="Review recent mistakes" detail={`${lab?.open_mistakes} questions to revisit`} onClick={() => onTab('study')} />
                )}
              </ul>
            ) : (
              <Empty icon={<Lightbulb />} hue="amber" title="No recommendations yet" body="Answer a few practice questions and personalised suggestions will appear here." />
            )}
          </Section>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 md:gap-6">
          {/* week */}
          <Section title="This week" icon={<BarChart3 />} hue="blue" description={`${weekAnswered} questions across ${activeDays} active day${activeDays === 1 ? '' : 's'}`}>
            <Bars data={days} label={`Questions answered per day, last 7 days: ${days.map((d) => `${d.label} ${d.value}`).join(', ')}`} />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniFact label="Today" value={String(days[6]?.value ?? 0)} />
              <MiniFact label="Best day" value={String(Math.max(0, ...days.map((d) => d.value)))} />
              <MiniFact label="Accuracy" value={weekAnswered ? pct((days.reduce((n, d) => n + d.correct, 0) / weekAnswered) * 100) : '—'} />
            </div>
          </Section>

          {/* exams open now */}
          <Section title="Open exams" icon={<ClipboardCheck />} hue="rose" action={<button type="button" className="pro-btn pro-btn-sm pro-btn-ghost" onClick={() => onTab('exams')}>View all</button>}>
            {quizzes === null ? (
              <LoadingRows rows={2} />
            ) : liveExams.length ? (
              <ul className="grid gap-2">
                {liveExams.map((quiz) => (
                  <li key={quiz.id} className="flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-[var(--pro-hover)]" style={{borderColor: 'var(--pro-border)'}}>
                    <Tile hue={hueForCourse(quiz.course as {id?: number; accent?: string} | null)} size="md">
                      <FileText />
                    </Tile>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8438rem] font-semibold" style={{color: 'var(--pro-text)'}}>{quiz.title}</p>
                      <p className="pro-meta truncate">
                        {quiz.course?.code ? `${quiz.course.code} · ` : ''}
                        {quiz.question_count} q · {quiz.duration_minutes} min
                      </p>
                    </div>
                    <button type="button" className={`pro-btn pro-btn-sm ${quiz.my_attempt?.status === 'in_progress' ? 'pro-btn-primary' : 'pro-btn-soft'}`} onClick={() => onStartExam(quiz)}>
                      {quiz.my_attempt?.status === 'in_progress' ? 'Resume' : 'Open'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<ClipboardCheck />} hue="rose" title="No open exams" body="When your lecturers publish an exam it will appear here." />
            )}
          </Section>

          {/* recent activity */}
          <Section title="Recent results" icon={<History />} hue="teal">
            {loading ? (
              <LoadingRows rows={3} />
            ) : recentExams.length || recentMinis.length ? (
              <ul className="grid gap-1">
                {recentMinis.map((m) => (
                  <ActivityRow key={`m${m.id}`} title={m.title} detail={`Mini exam · ${m.finished_at ? formatRelative(m.finished_at) : ''}`} value={m.percentage} onClick={() => openMiniExam(m.id)} />
                ))}
                {recentExams.map((row) => (
                  <ActivityRow key={`e${row.attempt_id}`} title={String(row.quiz || 'Exam')} detail={`Exam · ${row.submitted_at ? formatRelative(row.submitted_at) : ''}`} value={Number(row.percentage)} />
                ))}
              </ul>
            ) : (
              <Empty icon={<History />} hue="teal" title="No results yet" body="Finished exams and mini exams show up here with your score." />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function MiniFact({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{background: 'var(--pro-sunken)', border: '1px solid var(--pro-border)'}}>
      <p className="pro-meta truncate">{label}</p>
      <p className="pro-num mt-0.5 text-[1.0625rem] font-bold tracking-tight" style={{color: 'var(--pro-text)'}}>{value}</p>
    </div>
  );
}

function ContinueRow({kind, title, detail, progress, action, onClick, hue, icon}: {kind: string; title: string; detail: string; progress: number; action: string; onClick: () => void; hue: Hue; icon: ReactNode}) {
  return (
    <div className="pro-lift grid min-w-0 gap-3 rounded-2xl border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" style={{borderColor: 'var(--pro-border)', background: 'var(--pro-sunken)'}} data-hue={hue}>
      <Ring value={progress} size={54} stroke={5} hue={hue} label={`${Math.round(progress)}%`}>
        <span className="[&>svg]:size-5" style={{color: 'var(--mark)'}}>{icon}</span>
      </Ring>
      <div className="min-w-0">
        <p className="pro-eyebrow" style={{color: 'var(--mark)'}}>{kind}</p>
        <p className="pro-h3 mt-0.5 [overflow-wrap:anywhere]">{title}</p>
        <p className="pro-meta mt-1">
          {detail} · {Math.round(progress)}%
        </p>
      </div>
      <button type="button" className="pro-btn pro-btn-primary" onClick={onClick}>
        {action} <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

function RecRow({title, detail, tone, onClick, hue, icon}: {title: string; detail: string; tone?: 'success' | 'warning' | 'danger'; onClick: () => void; hue: Hue; icon: ReactNode}) {
  return (
    <li>
      <button type="button" onClick={onClick} className="pro-row-btn group">
        <Tile hue={hue} size="md">
          {icon}
        </Tile>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8438rem] font-semibold [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{title}</span>
          <span className="pro-meta block" style={tone ? {color: `var(--pro-${tone})`} : undefined}>{detail}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 opacity-40 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" style={{color: 'var(--pro-text-2)'}} />
      </button>
    </li>
  );
}

function ActivityRow({title, detail, value, onClick}: {title: string; detail: string; value: number | null | undefined; onClick?: () => void}) {
  const tone = value == null ? undefined : toneFor(Number(value));
  const body = (
    <>
      <Ring value={Number(value ?? 0)} size={40} stroke={4} tone={tone} label={pct(value)}>
        <span className="text-[0.625rem]">{pct(value)}</span>
      </Ring>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8438rem] font-semibold" style={{color: 'var(--pro-text)'}}>{title}</span>
        <span className="pro-meta block truncate">{detail}</span>
      </span>
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className="pro-row-btn">
          {body}
        </button>
      ) : (
        <div className="pro-row-btn">{body}</div>
      )}
    </li>
  );
}
