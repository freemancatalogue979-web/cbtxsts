import {AlertCircle, Clock, FileCheck, ListChecks, Repeat, Target, BarChart3, Activity, LineChart, Brain, Gauge, Library, Trophy} from 'lucide-react';
/** Pro analytics — the student's learning data, plainly presented. */
import {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import type {Tab} from '../lib/nav';
import {setFocus} from './focus';
import {Empty, LoadingRows, Metric, PageHeader, Progress, Section, minutesLabel, pct, studyTotals, toneFor, Bars, Seg} from './ui';

type Json = Record<string, any>;
const WINDOWS = [7, 30, 90] as const;

export default function ProAnalytics({onTab}: {onTab: (tab: Tab) => void}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [data, setData] = useState<Json | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [heat, setHeat] = useState<Json[]>([]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.arena
      .analytics(days)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [days]);

  useEffect(() => {
    api.studyLabOverview().then((d) => setLab(d as Json)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    api.arena
      .heatmap(Math.max(14, days))
      .then((d) => live && setHeat(((d as Json).data ?? []) as Json[]))
      .catch(() => live && setHeat([]));
    return () => {
      live = false;
    };
  }, [days]);

  /* daily (7/30 days) or weekly (90 days) activity — exam answers + practice */
  const activity = useMemo(() => {
    const byDay = new Map(heat.map((r) => [String(r.day), Number(r.answered ?? 0)]));
    const out: {label: string; value: number; today?: boolean; title: string}[] = [];
    if (days <= 30) {
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const v = byDay.get(key) ?? 0;
        const showLabel = days === 7 || i % 5 === 0;
        out.push({label: showLabel ? (days === 7 ? d.toLocaleDateString(undefined, {weekday: 'short'}).slice(0, 2) : String(d.getDate())) : '', value: v, today: i === 0, title: `${d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}: ${v} questions`});
      }
    } else {
      for (let w = 12; w >= 0; w -= 1) {
        let v = 0;
        const end = new Date();
        end.setDate(end.getDate() - w * 7);
        for (let k = 0; k < 7; k += 1) {
          const d = new Date(end);
          d.setDate(d.getDate() - k);
          v += byDay.get(d.toISOString().slice(0, 10)) ?? 0;
        }
        out.push({label: w % 2 === 0 ? end.toLocaleDateString(undefined, {day: 'numeric', month: 'short'}) : '', value: v, today: w === 0, title: `Week to ${end.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}: ${v} questions`});
      }
    }
    return out;
  }, [heat, days]);
  const activeDays = heat.filter((r) => Number(r.answered) > 0).length;

  const o = data?.overview ?? {};
  const totals = studyTotals(o);
  const answered = totals.answered;
  const minutes = totals.minutes;
  const timeline: Json[] = data?.accuracy_over_time ?? [];

  /* topic mastery: merge weakest + strongest into one sorted table */
  const topics = useMemo(() => {
    const map = new Map<string, Json>();
    for (const row of [...(data?.weakest_topics ?? []), ...(data?.strongest_topics ?? [])] as Json[]) map.set(String(row.key), row);
    for (const row of (data?.mastery_heatmap ?? []) as Json[]) {
      const key = String(row.topic);
      if (!map.has(key) && Number(row.answered) > 0) map.set(key, {key, accuracy: Number(row.mastery ?? 0), answered: Number(row.answered)});
    }
    return [...map.values()].sort((a, b) => Number(a.accuracy) - Number(b.accuracy));
  }, [data]);

  const openTopic = (topic: string) => {
    setFocus({topic, courseId: null});
    onTab('study');
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        icon={<BarChart3 />}
        hue="teal"
        eyebrow="Insight"
        title="Analytics"
        description="Accuracy, activity and mastery across your courses."
        actions={
          <Seg label="Time window" value={days} onChange={(d) => setDays(d)} options={WINDOWS.map((d) => ({value: d, label: `${d} days`}))} />
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Metric icon={<Target />} hue="green" label="Accuracy" value={loading ? '—' : answered ? pct(totals.accuracy) : '—'} tone={toneFor(totals.accuracy, answered)} sub={answered ? `${totals.correct} of ${answered} correct` : 'No answers yet'} />
        <Metric icon={<ListChecks />} hue="blue" label="Questions" value={loading ? '—' : answered.toLocaleString()} sub={`${Math.round((answered / Math.max(1, Number(data?.window_days ?? 30))) * 10) / 10} per day`} />
        <Metric icon={<Clock />} hue="teal" label="Study time" value={loading ? '—' : minutesLabel(minutes)} sub={answered ? `${Math.round((minutes * 60) / answered)} s per question` : 'exams and practice'} />
        <Metric icon={<FileCheck />} hue="violet" label="Exams" value={loading ? '—' : Number(o.exams ?? 0)} sub={`Best ${pct(o.best_percentage)}`} />
        <Metric icon={<Repeat />} hue="amber" label="Practice runs" value={loading ? '—' : Number(o.practice_runs ?? 0)} sub={`${Number(o.flashcards_reviewed ?? 0)} flashcards reviewed`} />
        <Metric icon={<AlertCircle />} hue="rose" label="Open mistakes" value={lab ? Number(lab.open_mistakes ?? 0) : '—'} sub={lab ? `${(lab.mastered ?? []).length} topics mastered` : ''} />
      </div>

      <Section
        icon={<Activity />}
        hue="violet"
        title="Study activity"
        description={`Questions answered in exams and practice · ${activeDays} active day${activeDays === 1 ? '' : 's'}${days > 30 ? ' · weekly totals' : ''}`}
      >
        {activity.some((d) => d.value > 0) ? (
          <Bars data={activity} label={`Questions answered, last ${days} days`} />
        ) : (
          <Empty icon={<Activity />} hue="violet" title="No activity in this window" body="Practice sessions and exams you complete will build this chart." />
        )}
      </Section>

      {timeline.length > 0 && (
        <Section icon={<LineChart />} hue="blue" title="Exam accuracy over time" description="Exam questions answered per day (bars) and accuracy (line).">
          <TimelineChart rows={timeline} />
        </Section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Section icon={<Brain />} hue="rose" title="Topic mastery" description="Weakest first, from exams and practice. Open a topic to study it.">
          {loading ? (
            <LoadingRows rows={4} />
          ) : topics.length ? (
            <ul className="pro-rows grid">
              {topics.map((row) => (
                <li key={row.key}>
                  <button type="button" className="grid w-full min-w-0 gap-1.5 rounded-lg py-3 text-left transition-colors first:pt-0 last:pb-0 hover:opacity-90" onClick={() => openTopic(String(row.key))}>
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[0.875rem] font-semibold [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}><span className="pro-dot" style={{background: `var(--pro-${toneFor(Number(row.accuracy)) ?? 'accent'})`}} />{row.key}</span>
                      <span className="pro-meta pro-num shrink-0">
                        {pct(row.accuracy)} · {row.answered}
                      </span>
                    </span>
                    <Progress value={Number(row.accuracy)} tone={toneFor(Number(row.accuracy))} label={`${row.key} accuracy`} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pro-secondary">Topics appear once you have answered at least two questions in them.</p>
          )}
        </Section>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          <Section icon={<Gauge />} hue="amber" title="By difficulty">
            {loading ? <LoadingRows rows={3} /> : <BreakdownTable rows={data?.difficulty ?? []} label="Difficulty" />}
          </Section>
          <Section icon={<Library />} hue="teal" title="By course">
            {loading ? <LoadingRows rows={3} /> : <BreakdownTable rows={data?.courses ?? []} label="Course" />}
          </Section>
        </div>
      </div>

      <Section icon={<Trophy />} hue="green" title="Exam scores">
        {loading ? (
          <LoadingRows rows={3} />
        ) : (data?.exam_trend ?? []).length ? (
          <div className="pro-scroll-x">
            <table className="pro-table min-w-[28rem]">
              <thead>
                <tr>
                  <th>Exam</th>
                  <th className="w-40">Submitted</th>
                  <th className="w-20 text-right">Grade</th>
                  <th className="w-24 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...(data?.exam_trend ?? [])].reverse().map((row: Json) => (
                  <tr key={row.attempt_id}>
                    <td className="[overflow-wrap:anywhere]">{row.quiz || 'Exam'}</td>
                    <td className="pro-meta">{row.submitted_at ? formatRelative(row.submitted_at) : '—'}</td>
                    <td className="text-right">{row.grade || '—'}</td>
                    <td className="pro-num text-right">{pct(row.percentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pro-secondary">No exams submitted in this window.</p>
        )}
      </Section>
    </div>
  );
}

function BreakdownTable({rows, label}: {rows: Json[]; label: string}) {
  if (!rows.length) return <p className="pro-secondary">No data yet.</p>;
  return (
    <table className="pro-table">
      <thead>
        <tr>
          <th>{label}</th>
          <th className="w-20 text-right">Answered</th>
          <th className="w-20 text-right">Accuracy</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="capitalize [overflow-wrap:anywhere]">{row.key}</td>
            <td className="pro-num text-right">{row.answered}</td>
            <td className="pro-num text-right" style={{color: `var(--pro-${toneFor(Number(row.accuracy), Number(row.answered)) ?? 'text'})`}}>
              {pct(row.accuracy)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Minimal SVG chart: bars = answered, line = accuracy. No chart library. */
function TimelineChart({rows}: {rows: Json[]}) {
  const W = 720;
  const H = 180;
  const pad = {l: 32, r: 8, t: 10, b: 22};
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxAnswered = Math.max(1, ...rows.map((r) => Number(r.answered ?? 0)));
  const step = innerW / Math.max(1, rows.length);
  const x = (i: number) => pad.l + step * i + step / 2;
  const yAcc = (v: number) => pad.t + innerH - (v / 100) * innerH;
  const points = rows.map((r, i) => `${x(i)},${yAcc(Number(r.accuracy ?? 0))}`).join(' ');
  const label = (day: string) => {
    const d = new Date(`${day}T00:00:00`);
    return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  };
  const every = Math.ceil(rows.length / 6);
  return (
    <figure className="min-w-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Accuracy and questions answered per day">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={yAcc(v)} y2={yAcc(v)} stroke="var(--pro-border)" strokeWidth="1" />
            <text x={pad.l - 6} y={yAcc(v) + 3} textAnchor="end" fontSize="10" fill="var(--pro-muted)">
              {v}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const h = (Number(r.answered ?? 0) / maxAnswered) * innerH * 0.9;
          return <rect key={i} x={x(i) - Math.min(10, step * 0.3)} width={Math.min(20, step * 0.6)} y={pad.t + innerH - h} height={h} rx="2" fill="var(--pro-border-strong)" />;
        })}
        {rows.length > 1 && <polyline points={points} fill="none" stroke="var(--pro-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {rows.map((r, i) => (
          <circle key={i} cx={x(i)} cy={yAcc(Number(r.accuracy ?? 0))} r="2.5" fill="var(--pro-accent)">
            <title>{`${label(String(r.day))}: ${pct(r.accuracy)} accuracy, ${r.answered} answered`}</title>
          </circle>
        ))}
        {rows.map((r, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--pro-muted)">
              {label(String(r.day))}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}
