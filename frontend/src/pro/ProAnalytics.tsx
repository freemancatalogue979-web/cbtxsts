/** Pro analytics — the student's learning data, plainly presented. */
import {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import type {Tab} from '../lib/nav';
import {setFocus} from './focus';
import {Empty, LoadingRows, Metric, PageHeader, Progress, Section, minutesLabel, pct, toneFor} from './ui';

type Json = Record<string, any>;
const WINDOWS = [7, 30, 90] as const;

export default function ProAnalytics({onTab}: {onTab: (tab: Tab) => void}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [data, setData] = useState<Json | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);

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

  const o = data?.overview ?? {};
  const answered = Number(o.answered ?? 0);
  const minutes = (Number(o.average_seconds ?? 0) * answered) / 60;
  const timeline: Json[] = data?.accuracy_over_time ?? [];

  /* topic mastery: merge weakest + strongest into one sorted table */
  const topics = useMemo(() => {
    const map = new Map<string, Json>();
    for (const row of [...(data?.weakest_topics ?? []), ...(data?.strongest_topics ?? [])] as Json[]) map.set(String(row.key), row);
    return [...map.values()].sort((a, b) => Number(a.accuracy) - Number(b.accuracy));
  }, [data]);

  const openTopic = (topic: string) => {
    setFocus({topic, courseId: null});
    onTab('study');
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        title="Analytics"
        description="Accuracy, activity and mastery across your courses."
        actions={
          <div className="inline-flex rounded-lg border p-0.5" style={{borderColor: 'var(--pro-border)'}} role="group" aria-label="Time window">
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className="rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors"
                style={days === d ? {background: 'var(--pro-accent-soft)', color: 'var(--pro-text)'} : {color: 'var(--pro-text-2)'}}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Accuracy" value={loading ? '—' : pct(o.accuracy)} tone={toneFor(Number(o.accuracy ?? 0), answered)} sub={answered ? `${Number(o.correct ?? 0)} of ${answered} correct` : 'No answers yet'} />
        <Metric label="Questions" value={loading ? '—' : answered.toLocaleString()} sub={`${Number(o.questions_per_day ?? 0)} per day`} />
        <Metric label="Study time" value={loading ? '—' : minutesLabel(minutes)} sub={`${Number(o.average_seconds ?? 0).toFixed(1)} s per question`} />
        <Metric label="Exams" value={loading ? '—' : Number(o.exams ?? 0)} sub={`Best ${pct(o.best_percentage)}`} />
        <Metric label="Practice runs" value={loading ? '—' : Number(o.practice_runs ?? 0)} sub={`${Number(o.flashcards_reviewed ?? 0)} flashcards reviewed`} />
        <Metric label="Open mistakes" value={lab ? Number(lab.open_mistakes ?? 0) : '—'} sub={lab ? `${(lab.mastered ?? []).length} topics mastered` : ''} />
      </div>

      <Section title="Accuracy over time" description="Daily accuracy (line) and questions answered (bars).">
        {loading ? <LoadingRows rows={2} /> : timeline.length ? <TimelineChart rows={timeline} /> : <Empty title="No activity in this window" />}
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Section title="Topic mastery" description="Weakest first. Open a topic to study it.">
          {loading ? (
            <LoadingRows rows={4} />
          ) : topics.length ? (
            <ul className="pro-rows grid">
              {topics.map((row) => (
                <li key={row.key}>
                  <button type="button" className="grid w-full min-w-0 gap-1.5 py-3 text-left first:pt-0 last:pb-0" onClick={() => openTopic(String(row.key))}>
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[0.875rem] [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{row.key}</span>
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
          <Section title="By difficulty">
            {loading ? <LoadingRows rows={3} /> : <BreakdownTable rows={data?.difficulty ?? []} label="Difficulty" />}
          </Section>
          <Section title="By course">
            {loading ? <LoadingRows rows={3} /> : <BreakdownTable rows={data?.courses ?? []} label="Course" />}
          </Section>
        </div>
      </div>

      <Section title="Exam scores">
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
