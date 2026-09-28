/**
 * Staff exam insights:
 *   IntegrityChip / IntegrityModal — per-paper screen leaves, offline spells and
 *     device moves (recorded for review; nothing is failed automatically);
 *   ItemAnalysisModal — per-question correct rate, option picks and
 *     discrimination, with plain-language flags ("check the answer key").
 */
import {AlertTriangle, CheckCircle2, Clock, CloudOff, Copy, Eye, KeyRound, Smartphone, TrendingDown, TrendingUp, ChartColumnIcon, ShieldCheckIcon} from 'lucide-react';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {Button, Chip, EmptyState, Modal, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import type {IntegrityDetail, IntegritySummary, ItemAnalysis, ItemAnalysisRow} from '../lib/types';

const LEVEL_STYLE: Record<IntegritySummary['level'], string> = {
  clean: 'border-mint-500/25 bg-mint-500/10 text-mint-300',
  review: 'border-gold-500/35 bg-gold-500/12 text-gold-200',
  high: 'border-flare-500/40 bg-flare-500/14 text-flare-200',
};
const LEVEL_LABEL: Record<IntegritySummary['level'], string> = {clean: 'Clean', review: 'Review', high: 'Check'};

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Compact badge for a result row. Clean papers stay quiet (a small tick). */
export function IntegrityChip({summary, onOpen}: {summary?: IntegritySummary; onOpen: () => void}) {
  if (!summary) return null;
  if (summary.level === 'clean') {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="No integrity concerns. Open the timeline."
        aria-label="Integrity: clean. Open the timeline."
        className="grid size-7 place-items-center rounded-lg text-mint-400/70 transition-colors hover:bg-white/6 hover:text-mint-300"
      >
        <CheckCircle2 className="size-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={summary.reasons.join(' · ')}
      className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[0.7rem] font-extrabold transition-colors hover:brightness-110 ${LEVEL_STYLE[summary.level]}`}
    >
      <AlertTriangle className="size-3.5" />
      {LEVEL_LABEL[summary.level]}
    </button>
  );
}

const EVENT_VIEW: Record<string, {icon: ReactNode; label: (e: IntegrityDetail['events'][number]) => string}> = {
  away: {icon: <Eye className="size-3.5 text-gold-300" />, label: (e) => `Left the exam screen for ${duration(e.seconds ?? 0)}${e.question ? ` (question ${e.question})` : ''}`},
  offline: {icon: <CloudOff className="size-3.5 text-mist-300" />, label: (e) => `Offline for ${duration(e.seconds ?? 0)}`},
  copy: {icon: <Copy className="size-3.5 text-nova-200" />, label: (e) => `Copied text${e.question ? ` (question ${e.question})` : ''}`},
  paste: {icon: <Copy className="size-3.5 text-nova-200" />, label: (e) => `Pasted text${e.question ? ` (question ${e.question})` : ''}`},
  fullscreen_exit: {icon: <Eye className="size-3.5 text-gold-300" />, label: () => 'Left full screen'},
  device_switch: {icon: <Smartphone className="size-3.5 text-flare-300" />, label: () => 'Moved the exam to another device'},
};

function clock(iso: string): string {
  const date = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

export function IntegrityModal({attemptId, onClose}: {attemptId: number | null; onClose: () => void}) {
  const [data, setData] = useState<IntegrityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!attemptId) return;
    setData(null);
    setError(null);
    api.admin
      .resultIntegrity(attemptId)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [attemptId]);
  const s = data?.summary;
  return (
    <Modal icon={ShieldCheckIcon} tone="mint" open={attemptId !== null} onClose={onClose} title="Exam integrity" subtitle={data ? `${data.student.name} · ${data.quiz.title}` : undefined}>
      {error ? (
        <p className="text-[0.84rem] text-flare-300">{error}</p>
      ) : !data || !s ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-3 ${LEVEL_STYLE[s.level]}`}>
            <p className="text-[0.84rem] font-extrabold">
              {s.level === 'clean' ? 'Nothing unusual recorded.' : s.level === 'review' ? 'Worth a look.' : 'Check this paper.'}
            </p>
            {s.reasons.length > 0 && <p className="mt-0.5 text-[0.76rem] font-semibold opacity-85">{s.reasons.join(' · ')}</p>}
            <p className="mt-1.5 text-[0.7rem] font-medium opacity-70">
              These are signals, not proof. Phones get calls and networks drop. Nothing here changes the score.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {label: 'Screen leaves', value: String(s.focus_lost), icon: <Eye className="size-3.5" />},
              {label: 'Time away', value: duration(s.away_seconds), icon: <Clock className="size-3.5" />},
              {label: 'Offline', value: s.offline_spells ? `${s.offline_spells}× · ${duration(s.offline_seconds)}` : '0', icon: <CloudOff className="size-3.5" />},
              {label: 'Device moves', value: String(s.device_switches), icon: <Smartphone className="size-3.5" />},
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5">
                <p className="flex items-center gap-1.5 text-[0.66rem] font-bold text-mist-500">
                  {tile.icon}
                  {tile.label}
                </p>
                <p className="mt-1 text-[0.95rem] font-black tabular text-mist-100">{tile.value}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-[0.72rem] font-extrabold tracking-wide text-mist-400">Timeline</p>
            {data.events.length === 0 ? (
              <p className="text-[0.78rem] text-mist-500">No events recorded.</p>
            ) : (
              <ol className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {data.events.map((event, i) => {
                  const view = EVENT_VIEW[event.type];
                  return (
                    <li key={i} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[0.78rem] hover:bg-white/[0.03]">
                      <span className="w-16 shrink-0 text-[0.7rem] font-semibold tabular text-mist-500">{clock(event.at)}</span>
                      {view?.icon}
                      <span className="min-w-0 flex-1 text-mist-200">{view ? view.label(event) : event.type}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- item analysis */
const FLAG_VIEW: Record<string, {label: string; tone: string; help: string}> = {
  check_key: {label: 'Check answer key', tone: 'border-flare-500/40 bg-flare-500/14 text-flare-200', help: 'Strong students pick another option more than the key, or do worse than weak students. The key may be wrong or the wording misleading.'},
  too_hard: {label: 'Very hard', tone: 'border-gold-500/35 bg-gold-500/12 text-gold-200', help: '20% or fewer get it right.'},
  weak: {label: 'Weak question', tone: 'border-gold-500/30 bg-gold-500/10 text-gold-200', help: 'Barely separates strong from weak students.'},
  too_easy: {label: 'Very easy', tone: 'border-white/14 bg-white/6 text-mist-300', help: '90% or more get it right.'},
  unused_option: {label: 'Unused option', tone: 'border-white/14 bg-white/6 text-mist-300', help: 'A wrong option nobody picks. Replace it with a better distractor.'},
};

function RateBar({rate}: {rate: number}) {
  const pct = Math.round(rate * 100);
  const tone = pct >= 90 ? 'bg-mist-400' : pct >= 40 ? 'bg-mint-400' : pct > 20 ? 'bg-gold-400' : 'bg-flare-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${tone}`} style={{width: `${pct}%`}} />
      </div>
      <span className="w-9 text-right text-[0.74rem] font-black tabular text-mist-200">{pct}%</span>
    </div>
  );
}

function ItemCard({row}: {row: ItemAnalysisRow}) {
  const [open, setOpen] = useState(row.flags.includes('check_key'));
  const answered = Math.max(1, row.answered);
  const d = row.discrimination;
  return (
    <li className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
      <button type="button" className="block w-full text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.flags.map((flag) => (
            <Chip key={flag} className={FLAG_VIEW[flag]?.tone ?? ''}>
              {flag === 'check_key' && <KeyRound className="size-3" />}
              {FLAG_VIEW[flag]?.label ?? flag}
            </Chip>
          ))}
          {row.topic && <span className="text-[0.68rem] font-semibold text-mist-500">{row.topic}</span>}
          <span className="ml-auto text-[0.68rem] font-semibold tabular text-mist-500">{row.seen} saw it</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[0.82rem] font-bold leading-snug text-mist-100">{row.text}</p>
        <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-3">
          <RateBar rate={row.correct_rate} />
          <span
            title="Discrimination: correct rate of the top 27% of papers minus the bottom 27%. Higher is better."
            className={`inline-flex items-center gap-1 text-[0.72rem] font-extrabold tabular ${d === null ? 'text-mist-500' : d < 0 ? 'text-flare-300' : d < 0.2 ? 'text-gold-300' : 'text-mint-300'}`}
          >
            {d !== null && d < 0 ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
            {d === null ? '—' : d.toFixed(2)}
          </span>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 border-t border-white/8 pt-3">
          {Object.entries(row.options).map(([key, text]) => {
            const count = row.picks[key] ?? 0;
            const share = count / answered;
            const isKey = key === row.correct;
            return (
              <div key={key} className="grid grid-cols-[1.5rem_1fr_3.5rem] items-center gap-2 text-[0.76rem]">
                <span className={`grid size-6 place-items-center rounded-md text-[0.7rem] font-black ${isKey ? 'bg-mint-500/25 text-mint-200' : 'bg-white/6 text-mist-400'}`}>{key}</span>
                <div className="min-w-0">
                  <p className={`truncate ${isKey ? 'font-bold text-mint-200' : 'text-mist-300'}`}>{text}</p>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/6">
                    <div className={`h-full rounded-full ${isKey ? 'bg-mint-400' : 'bg-white/30'}`} style={{width: `${Math.round(share * 100)}%`}} />
                  </div>
                </div>
                <span className="text-right font-bold tabular text-mist-400">
                  {count} · {Math.round(share * 100)}%
                </span>
              </div>
            );
          })}
          <p className="pt-1 text-[0.7rem] text-mist-500">
            Key: {row.correct} · blank: {row.blank}
            {row.avg_seconds !== null ? ` · avg ${Math.round(row.avg_seconds)}s` : ''}
          </p>
          {row.flags.map((flag) => (
            <p key={flag} className="text-[0.72rem] leading-relaxed text-mist-400">
              <span className="font-bold text-mist-300">{FLAG_VIEW[flag]?.label}:</span> {FLAG_VIEW[flag]?.help}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

export function ItemAnalysisModal({
  target,
  onClose,
}: {
  target: {kind: 'quiz' | 'course'; id: number; title: string; course?: {id: number; title: string} | null} | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ItemAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged');
  /* Random course-bank exams: the whole course usually has far more data. */
  const [scope, setScope] = useState<'quiz' | 'course'>('quiz');
  useEffect(() => {
    setScope(target?.kind ?? 'quiz');
  }, [target]);
  useEffect(() => {
    if (!target) return;
    setData(null);
    setError(null);
    const load =
      target.kind === 'course'
        ? api.admin.courseItemAnalysis(target.id)
        : scope === 'course' && target.course
          ? api.admin.courseItemAnalysis(target.course.id)
          : api.admin.quizItemAnalysis(target.id);
    load
      .then((result) => {
        setData(result);
        setFilter(result.summary.flagged ? 'flagged' : 'all');
      })
      .catch((err: Error) => setError(err.message));
  }, [target, scope]);
  const rows = useMemo(() => (data ? (filter === 'flagged' ? data.questions.filter((r) => r.flags.length) : data.questions) : []), [data, filter]);
  return (
    <Modal icon={ChartColumnIcon} tone="pulse"
      open={target !== null}
      onClose={onClose}
      size="lg"
      title="Question stats"
      subtitle={
        target
          ? `${scope === 'course' && target.course ? `${target.course.title} (all exams)` : target.title}${data ? ` · ${data.attempts} submitted paper${data.attempts === 1 ? '' : 's'}` : ''}`
          : undefined
      }
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      {target?.kind === 'quiz' && target.course && (
        <Segmented
          className="mb-3"
          value={scope}
          onChange={setScope}
          options={[
            {value: 'quiz', label: 'This exam'},
            {value: 'course', label: 'Whole course'},
          ]}
        />
      )}
      {error ? (
        <p className="text-[0.84rem] text-flare-300">{error}</p>
      ) : !data ? (
        <Skeleton className="h-64" />
      ) : data.attempts === 0 ? (
        <EmptyState icon={<TrendingUp className="size-6" />} title="No submitted papers yet" detail="Stats appear once students submit." />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              {label: 'Questions', value: data.summary.questions},
              {label: 'Flagged', value: data.summary.flagged},
              {label: 'Check key', value: data.summary.check_key},
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 text-center">
                <p className="text-[1.05rem] font-black tabular text-mist-50">{tile.value}</p>
                <p className="text-[0.66rem] font-bold text-mist-500">{tile.label}</p>
              </div>
            ))}
          </div>
          {data.attempts < 5 && (
            <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.74rem] text-mist-400">
              Flags start at 5 submitted papers. Numbers below are early.
            </p>
          )}
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              {value: 'flagged', label: `Needs attention (${data.summary.flagged})`},
              {value: 'all', label: `All (${data.summary.questions})`},
            ]}
          />
          {rows.length === 0 ? (
            <p className="py-6 text-center text-[0.8rem] text-mist-500">Nothing flagged. These questions are working well.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <ItemCard key={row.id} row={row} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
