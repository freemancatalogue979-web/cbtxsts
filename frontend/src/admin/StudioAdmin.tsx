/**
 * Arena Studio — the advanced content console.
 *
 * Every control here talks to the existing admin API (`api.admin.studio`), which
 * is the single source of truth for answer integrity: answers are only ever
 * written by the server, and this screen can never invent one.
 */
import {Activity, AlertTriangle, BarChart3, BookOpen, Boxes, Check, Copy, Eye, Flag, Gem, History, Layers, ListChecks, RefreshCw, Search, ShieldCheck, Sparkles, Upload, X} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Modal, SectionHeading, Segmented, Select, Skeleton, StatTile, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {Course, QuestionPublic, Quiz} from '../lib/types';
import {sourceSummary} from './ContentAdmin';

type Pane = 'pulse' | 'bank' | 'review' | 'builders';

type StudioQuestion = QuestionPublic & {
  flagged?: boolean;
  flag_reason?: string;
  usage_count?: number;
  correct_count?: number;
  wrong_count?: number;
  accuracy?: number;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  answers?: string[];
  source_id?: number | null;
  quiz_id?: number;
  course_id?: number | null;
  visible?: boolean;
};

const SORTS = [
  {value: 'position', label: 'Exam order'},
  {value: 'newest', label: 'Newest first'},
  {value: 'oldest', label: 'Oldest first'},
  {value: 'hardest', label: 'Most missed'},
  {value: 'easiest', label: 'Most mastered'},
  {value: 'most_used', label: 'Most used'},
  {value: 'least_used', label: 'Least used'},
  {value: 'az', label: 'A → Z'},
];

/* ------------------------------------------------------------------ pulse */
function Pulse() {
  const {toast} = useSession();
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [bank, setBank] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    api.admin.studio
      .healthSnapshot()
      .then(setSnapshot)
      .catch((error: Error) => toast('error', 'Could not load the arena pulse', error.message));
    api.admin.studio
      .bank({})
      .then(setBank)
      .catch(() => setBank(null));
  }, [toast]);

  useEffect(load, [load]);

  if (!snapshot) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-20" />
        ))}
      </div>
    );
  }

  const health = (bank?.health ?? {}) as {warnings?: Record<string, number>; by_difficulty?: Record<string, number>; by_status?: Record<string, number>};
  const warnings = health.warnings ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="Questions" value={formatNumber(Number(snapshot.questions ?? 0))} icon={<BookOpen className="size-4" />} />
        <StatTile label="Answers · 24h" value={formatNumber(Number(snapshot.answers_24h ?? 0))} icon={<Activity className="size-4" />} />
        <StatTile label="Duels · 24h" value={formatNumber(Number(snapshot.duels_24h ?? 0))} icon={<BarChart3 className="size-4" />} />
        <StatTile label="Practice · 24h" value={formatNumber(Number(snapshot.practice_24h ?? 0))} icon={<Sparkles className="size-4" />} />
      </div>

      <Card className="min-w-0 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
 <p className="text-[0.68rem] font-black tracking-[0.18em] text-mist-500">Bank health</p>
            <p className="mt-0.5 text-[0.82rem] font-semibold text-mist-400">
              Broken answers, missing explanations and thin topic pools — surfaced before players see them.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} icon={<RefreshCw className="size-3.5" />}>
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500">Untagged topics</p>
            <p className="mt-1 font-display text-lg font-black tabular text-mist-50">{warnings.untagged ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500">No explanation</p>
            <p className="mt-1 font-display text-lg font-black tabular text-mist-50">{warnings.no_explanation ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500">Flagged</p>
            <p className="mt-1 font-display text-lg font-black tabular text-flare-300">{formatNumber(Number(snapshot.flagged ?? 0))}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500">Drafts</p>
            <p className="mt-1 font-display text-lg font-black tabular text-gold-300">{formatNumber(Number(snapshot.drafts ?? 0))}</p>
          </div>
        </div>

        {health.by_difficulty && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(health.by_difficulty).map(([level, count]) => (
              <Chip key={level} className="capitalize">
                {level}: {count}
              </Chip>
            ))}
            {health.by_status &&
              Object.entries(health.by_status).map(([status, count]) => (
                <Chip key={status} className="capitalize border-white/10 bg-white/5 text-mist-400">
                  {status}: {count}
                </Chip>
              ))}
          </div>
        )}
      </Card>

      {Array.isArray(snapshot.recent_activity) && snapshot.recent_activity.length > 0 && (
        <Card className="min-w-0 p-3.5 sm:p-4">
          <SectionHeading title="Recent activity" icon={<Activity className="size-4" />} />
          <ul className="mt-2 space-y-1.5">
            {(snapshot.recent_activity as {kind?: string; text?: string; created_at?: string}[]).slice(0, 6).map((row, index) => (
              <li key={index} className="flex items-start gap-2 text-[0.8rem] font-semibold text-mist-300">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-nova-400" />
                <span className="min-w-0 flex-1 break-words">{row.text ?? row.kind}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- bank */
function Bank() {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [rows, setRows] = useState<StudioQuestion[] | null>(null);
  const [facets, setFacets] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('');
  const [status, setStatus] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState('position');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkValue, setBulkValue] = useState('');
  const [detail, setDetail] = useState<StudioQuestion | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.admin
      .courses()
      .then(setCourses)
      .catch(() => setCourses([]));
  }, []);

  const load = useCallback(() => {
    api.admin.studio
      .search({
        q: query.trim() || undefined,
        course_id: courseId ? Number(courseId) : undefined,
        status: status || undefined,
        difficulty: difficulty || undefined,
        flagged: flaggedOnly || undefined,
        sort,
        limit: 100,
      })
      .then((payload) => {
        const data = payload as {rows?: StudioQuestion[]; facets?: Record<string, unknown>};
        setRows(data.rows ?? []);
        setFacets(data.facets ?? null);
      })
      .catch((error: Error) => toast('error', 'Search failed', error.message));
  }, [query, courseId, status, difficulty, flaggedOnly, sort, toast]);

  useEffect(() => {
    const handle = window.setTimeout(load, 280);
    return () => window.clearTimeout(handle);
  }, [load]);

  const runBulk = async (action: string, value = '') => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const result = (await api.admin.studio.bulkAction({
        ids: picked,
        action,
        value,
        status: action === 'status' ? value : undefined,
        difficulty: action === 'difficulty' ? value : undefined,
        topic: action === 'topic' ? value : undefined,
        correct: action === 'answer' ? value : undefined,
      })) as {touched?: number; errors?: {id: number; reason: string}[]};
      const touched = result.touched ?? picked.length;
      toast(
        'success',
        `${touched} question${touched === 1 ? '' : 's'} updated`,
        result.errors?.length ? `${result.errors.length} refused — ${result.errors[0].reason}` : 'Changes are live everywhere instantly.',
      );
      setPicked([]);
      setBulkValue('');
      load();
    } catch (error) {
      toast('error', 'Bulk action failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = async (row: StudioQuestion) => {
    try {
      if (row.flagged) await api.admin.studio.unflag(row.id);
      else await api.admin.studio.flag(row.id, {reason: 'Flagged in studio'});
      load();
    } catch (error) {
      toast('error', 'Could not update the flag', (error as Error).message);
    }
  };

  const showPreview = async (row: StudioQuestion) => {
    try {
      setPreview((await api.admin.studio.previewQuestion(row.id)) as Record<string, unknown>);
    } catch (error) {
      toast('error', 'Preview failed', (error as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="min-w-0 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput placeholder="Search text, topic, tags…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search the bank" />
          <Select value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter by course">
            <option value="">Every course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">Any status</option>
            {['draft', 'approved', 'rejected', 'archived'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort results">
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="max-w-40" aria-label="Filter by difficulty">
            <option value="">Any difficulty</option>
            {['easy', 'medium', 'hard'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setFlaggedOnly((value) => !value)}
            aria-pressed={flaggedOnly}
 className={`min-h-10 rounded-2xl border px-3 text-[0.74rem] font-black tracking-wide transition-colors touch-manipulation ${
              flaggedOnly ? 'border-flare-500/50 bg-flare-500/16 text-flare-200' : 'border-white/10 bg-white/4 text-mist-500'
            }`}
          >
            Flagged only
          </button>
          <Button size="sm" variant="outline" onClick={load} icon={<RefreshCw className="size-3.5" />}>
            Refresh
          </Button>
          <Chip>{rows?.length ?? 0} shown</Chip>
          {facets && typeof facets.status === 'object' && (
            <Chip className="border-white/10 bg-white/5 text-mist-400">
              facets: {Object.keys(facets.status as Record<string, number>).length} statuses
            </Chip>
          )}
        </div>
      </Card>

      {picked.length > 0 && (
        <Card className="min-w-0 border-nova-400/30 bg-nova-500/8 p-3">
 <p className="text-[0.74rem] font-black tracking-[0.16em] text-nova-200">{picked.length} selected</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="mint" onClick={() => void runBulk('publish')} loading={busy} icon={<Check className="size-3.5" />}>
              Publish
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('draft')} loading={busy}>
              Move to draft
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('archive')} loading={busy}>
              Archive
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked([])} icon={<X className="size-3.5" />}>
              Clear
            </Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <TextInput
              value={bulkValue}
              onChange={(event) => setBulkValue(event.target.value)}
              placeholder="Value for topic / difficulty (easy|medium|hard) / answer (A–D)"
              aria-label="Bulk value"
            />
            <Button size="sm" variant="outline" onClick={() => void runBulk('topic', bulkValue.trim())} disabled={!bulkValue.trim()}>
              Set topic
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('difficulty', bulkValue.trim().toLowerCase())} disabled={!bulkValue.trim()}>
              Set difficulty
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('answer', bulkValue.trim().toUpperCase())} disabled={!bulkValue.trim()}>
              Set answer
            </Button>
          </div>
          <p className="mt-1.5 text-[0.7rem] font-semibold text-mist-500">
            Bulk answer changes are validated server-side — an invalid letter is refused, never coerced to “A”.
          </p>
        </Card>
      )}

      {!rows ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search className="size-6" />} title="Nothing matches" detail="Try a broader search or clear the filters." />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className={`min-w-0 p-3 ${picked.includes(row.id) ? 'border-nova-400/40' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={picked.includes(row.id)}
                    onChange={(event) =>
                      setPicked((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))
                    }
                    className="mt-1 size-5 shrink-0 accent-fuchsia-500"
                    aria-label={`Select question ${row.id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[0.86rem] font-bold text-mist-100">{row.text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Answer {row.correct}</Chip>
                      <Chip>{row.points ?? 1} pts</Chip>
                      <Chip className="capitalize">{row.difficulty}</Chip>
                      {row.topic && <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{row.topic}</Chip>}
                      {row.status && row.status !== 'approved' && <Chip className="capitalize border-gold-500/30 bg-gold-500/12 text-gold-200">{row.status}</Chip>}
                      {row.drawn && <Chip className="border-pulse-500/25 bg-pulse-500/10 text-pulse-200">Bank copy</Chip>}
                      {row.flagged && <Chip className="border-flare-500/35 bg-flare-500/12 text-flare-200">Flagged</Chip>}
                      {typeof row.usage_count === 'number' && row.usage_count > 0 && (
                        <Chip className="tabular">
                          {row.usage_count} answers · {Math.round(row.accuracy ?? 0)}% right
                        </Chip>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Preview as player" onClick={() => void showPreview(row)} icon={<Eye className="size-3.5" />} />
                    <Button
                      size="sm"
                      variant="ghost"
                      title={row.flagged ? 'Clear flag' : 'Flag for review'}
                      onClick={() => void toggleFlag(row)}
                      icon={<Flag className={`size-3.5 ${row.flagged ? 'text-flare-400' : ''}`} />}
                    />
                    <Button size="sm" variant="ghost" title="Pay off / copy info" onClick={() => setDetail(row)} icon={<ListChecks className="size-3.5" />} />
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={`Question ${detail?.id ?? ''}`} subtitle="Where this question is used and how it behaves.">
        {detail && (
          <div className="space-y-2 text-[0.82rem] font-semibold text-mist-300">
            <p className="break-words text-mist-100">{detail.text}</p>
            <p>
              Stored answer: <span className="font-black text-mint-300">{detail.correct}</span>
              {detail.answers?.length ? ` (${detail.answers.join('')})` : ''}
            </p>
            <p>Exam id: {detail.quiz_id} · course id: {detail.course_id ?? '—'}</p>
            <p>Source copy: {detail.source_id ? `drawn from #${detail.source_id}` : 'original'}</p>
            <p>Usage: {detail.usage_count ?? 0} answers · {Math.round(detail.accuracy ?? 0)}% correct</p>
            {detail.flag_reason && <p className="text-flare-300">Flag: {detail.flag_reason}</p>}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Preview as player" subtitle="Exactly what a student sees, answer revealed.">
        {preview && (() => {
          const shown = (preview.with_answer ?? preview.as_player ?? {}) as Record<string, unknown>;
          return (
          <div className="space-y-2">
            <p className="text-[0.86rem] font-bold text-mist-100">{String(shown.text ?? '')}</p>
            {Object.entries((shown.options ?? {}) as Record<string, string>).map(([letter, text]) => {
              const label = shown.correct_label ?? shown.correct;
              const isCorrect = label === letter;
              return (
                <div
                  key={letter}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[0.82rem] font-semibold ${
                    isCorrect ? 'border-mint-500/45 bg-mint-500/12 text-mint-200' : 'border-white/8 bg-white/[0.02] text-mist-400'
                  }`}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.72rem] font-black">{letter}</span>
                  <span className="min-w-0 flex-1 break-words">{text}</span>
                  {isCorrect && <Check className="size-4 shrink-0 text-mint-400" />}
                </div>
              );
            })}
            <p className="text-[0.76rem] font-semibold text-mist-400">
              Shuffle order: {((shown.display_order as string[] | undefined) ?? []).join(' → ') || 'none'}
            </p>
            <p className="text-[0.72rem] font-semibold text-mist-500">
              Stored key: {String(shown.correct ?? '—')} · shown as {String(shown.correct_label ?? '—')}
            </p>
          </div>
          );
        })()}
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- review */
function Review() {
  const {toast} = useSession();
  const [queue, setQueue] = useState<Record<string, StudioQuestion[]> | null>(null);
  const [reports, setReports] = useState<{id: number; question_id: number; reason: string; note?: string; question_text?: string; correct?: string}[]>([]);
  const [audit, setAudit] = useState<{id: number; actor: string; action: string; target_type: string; target_id: number; created_at?: string}[] | null>(null);

  const load = useCallback(() => {
    api.admin.studio
      .reviewQueue({limit: 60})
      .then((payload) => {
        const data = payload as {drafts?: StudioQuestion[]; flagged?: StudioQuestion[]; weak?: StudioQuestion[]; reports?: typeof reports};
        setQueue({drafts: data.drafts ?? [], flagged: data.flagged ?? [], weak: data.weak ?? []});
        setReports(data.reports ?? []);
      })
      .catch((error: Error) => toast('error', 'Could not load the review queue', error.message));
    api.admin.studio
      .audit({limit: 40})
      .then((payload) => setAudit(payload as never))
      .catch(() => setAudit([]));
  }, [toast]);

  useEffect(load, [load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    try {
      await api.admin.studio.patch(id, body);
      toast('success', 'Question updated', 'Validated server-side.');
      load();
    } catch (error) {
      toast('error', 'Update refused', (error as Error).message);
    }
  };

  const decide = async (id: number, decision: 'resolved' | 'dismissed') => {
    try {
      await api.admin.studio.resolveReport(id, decision);
      toast('info', `Report ${decision}`);
      load();
    } catch (error) {
      toast('error', 'Could not update the report', (error as Error).message);
    }
  };

  const Group = ({title, rows, tone}: {title: string; rows: StudioQuestion[]; tone: string}) =>
    rows.length === 0 ? null : (
      <Card className="min-w-0 p-3.5">
 <p className={`text-[0.68rem] font-black tracking-[0.18em] ${tone}`}>
          {title} · {rows.length}
        </p>
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-2.5">
              <p className="break-words text-[0.82rem] font-bold text-mist-100">{row.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Answer {row.correct}</Chip>
                <Chip className="capitalize">{row.status ?? 'approved'}</Chip>
                {row.flag_reason && <Chip className="border-flare-500/35 bg-flare-500/12 text-flare-200">{row.flag_reason}</Chip>}
                {typeof row.accuracy === 'number' && <Chip>{Math.round(row.accuracy)}% correct</Chip>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="mint" onClick={() => void patch(row.id, {status: 'approved', flag_reason: ''})} icon={<ShieldCheck className="size-3.5" />}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => void patch(row.id, {status: 'rejected'})}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void patch(row.id, {visible: row.visible === false})}>
                  {row.visible === false ? 'Show' : 'Hide'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );

  return (
    <div className="space-y-3">
      {!queue ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <Group title="Awaiting review" rows={queue.drafts ?? []} tone="text-gold-300" />
          <Group title="Flagged" rows={queue.flagged ?? []} tone="text-flare-300" />
          <Group title="Suspiciously hard" rows={queue.weak ?? []} tone="text-pulse-300" />
          {(queue.drafts?.length ?? 0) + (queue.flagged?.length ?? 0) + (queue.weak?.length ?? 0) === 0 && (
            <EmptyState icon={<ShieldCheck className="size-6" />} title="Queue is clear" detail="Nothing needs staff attention right now." />
          )}
        </>
      )}

      {reports.length > 0 && (
        <Card className="min-w-0 p-3.5">
 <p className="text-[0.68rem] font-black tracking-[0.18em] text-nova-300">Player reports · {reports.length}</p>
          <ul className="mt-2 space-y-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-2.5">
                <p className="break-words text-[0.82rem] font-bold text-mist-100">{report.question_text}</p>
                <p className="mt-1 text-[0.74rem] font-semibold text-mist-400">
                  “{report.reason}”{report.correct ? ` · stored answer ${report.correct}` : ''}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="mint" onClick={() => void decide(report.id, 'resolved')}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(report.id, 'dismissed')}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="min-w-0 p-3.5">
 <p className="flex items-center gap-2 text-[0.68rem] font-black tracking-[0.18em] text-mist-500">
          <History className="size-3.5" /> Audit trail
        </p>
        {!audit ? (
          <Skeleton className="mt-2 h-24" />
        ) : audit.length === 0 ? (
          <p className="mt-2 text-[0.8rem] font-semibold text-mist-500">No staff actions recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {audit.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 text-[0.76rem] font-semibold text-mist-400">
                <Chip className="border-white/10 bg-white/5">{row.action}</Chip>
                <span className="min-w-0 flex-1 break-words">
                  {row.actor} → {row.target_type} #{row.target_id}
                </span>
                <span className="text-mist-600">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- builders */
function Builders() {
  const {toast} = useSession();
  const [blueprints, setBlueprints] = useState<Record<string, unknown>[] | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [pool, setPool] = useState<Record<string, unknown> | null>(null);
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState('');
  const [total, setTotal] = useState(20);
  const [deckName, setDeckName] = useState('');
  const [deckCourse, setDeckCourse] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    api.admin.studio
      .blueprints()
      .then((payload) => setBlueprints((payload.blueprints ?? payload) as Record<string, unknown>[]))
      .catch(() => setBlueprints([]));
    api.admin
      .quizzes()
      .then(setQuizzes)
      .catch(() => setQuizzes([]));
    api.admin
      .courses()
      .then(setCourses)
      .catch(() => setCourses([]));
    api.admin.studio
      .challengePool({})
      .then(setPool)
      .catch(() => setPool(null));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      await api.admin.studio.createBlueprint({
        name: name.trim(),
        course_id: courseId ? Number(courseId) : null,
        config: {total, quotas: {difficulty: {easy: Math.round(total / 3), medium: Math.round(total / 3)}}},
        is_template: false,
      });
      toast('success', 'Blueprint created');
      setName('');
      load();
    } catch (error) {
      toast('error', 'Could not create the blueprint', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runBlueprint = async (id: number, action: 'preview' | 'generate') => {
    try {
      if (action === 'preview') {
        setPreview((await api.admin.studio.previewBlueprint(id)) as Record<string, unknown>);
      } else {
        const result = (await api.admin.studio.generateFromBlueprint(id, {versions: 1, duration_minutes: 30})) as {created?: {title: string; questions: number}[]};
        toast('success', `${result.created?.length ?? 0} paper generated`, result.created?.[0] ? `${result.created[0].title} · ${result.created[0].questions} questions` : '');
        load();
      }
    } catch (error) {
      toast('error', 'Blueprint run failed', (error as Error).message);
    }
  };

  const buildDeck = async () => {
    if (deckName.trim().length < 2) return;
    setBusy(true);
    try {
      const result = (await api.admin.studio.decksFromBank({
        name: deckName.trim(),
        course_id: deckCourse ? Number(deckCourse) : null,
        limit: 60,
      })) as {cards?: number};
      toast('success', 'Arena deck published', `${result.cards ?? 0} cards are now studyable by everyone.`);
      setDeckName('');
    } catch (error) {
      toast('error', 'Could not build the deck', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const courseCode = (id: number | null | undefined) => courses.find((course) => course.id === id)?.code ?? '';

  return (
    <div className="min-w-0 space-y-3">
      <Card className="min-w-0 p-3">
        <SectionHeading title="Paper blueprints" subtitle="Quotas by topic and difficulty — each generated paper is a fixed, exam-specific set." icon={<Boxes className="size-4" />} />
        <div className="mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_5.5rem_auto]">
          <TextInput className="col-span-2 sm:col-span-1" placeholder="Blueprint name" value={name} onChange={(event) => setName(event.target.value)} aria-label="Blueprint name" />
          <Select value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Blueprint course">
            <option value="">Any course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code}
              </option>
            ))}
          </Select>
          <TextInput type="number" min={5} max={100} value={total} onChange={(event) => setTotal(Math.max(5, Number(event.target.value) || 20))} aria-label="Questions per paper" title="Questions per paper" />
          <Button className="col-span-2 sm:col-span-1" onClick={create} loading={busy} disabled={name.trim().length < 2} icon={<Sparkles className="size-4" />}>
            Create
          </Button>
        </div>

        {!blueprints ? (
          <Skeleton className="mt-2.5 h-16" />
        ) : blueprints.length === 0 ? (
          <p className="mt-2.5 text-[0.78rem] font-semibold text-mist-500">No blueprints yet — make one above and the generator does the rest.</p>
        ) : (
          <ul className="mt-2.5 min-w-0 divide-y divide-white/6 rounded-2xl border border-white/8">
            {blueprints.map((row) => {
              const config = (row.config ?? {}) as Record<string, unknown>;
              const code = courseCode(row.course_id as number | null);
              return (
                <li key={String(row.id)} className="flex min-w-0 items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.84rem] font-bold text-mist-100">{String(row.name)}</p>
                    <p className="truncate text-[0.7rem] font-semibold text-mist-500">
                      {String(config.total ?? '—')} questions · {code || 'any course'}
                      {row.is_template ? ' · template' : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" title="Preview" aria-label="Preview blueprint" onClick={() => void runBlueprint(Number(row.id), 'preview')} icon={<Eye className="size-3.5" />}>
                    <span className="hidden sm:inline">Preview</span>
                  </Button>
                  <Button size="sm" variant="mint" title="Generate a paper" aria-label="Generate a paper" onClick={() => void runBlueprint(Number(row.id), 'generate')} icon={<Layers className="size-3.5" />}>
                    <span className="hidden sm:inline">Generate</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Card className="min-w-0 p-3">
          <SectionHeading title="Deck builder" subtitle="Publish an arena-wide flashcard deck from a course bank." icon={<Layers className="size-4" />} />
          <div className="mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <TextInput className="col-span-2" placeholder="Deck name" value={deckName} onChange={(event) => setDeckName(event.target.value)} aria-label="Deck name" />
            <Select value={deckCourse} onChange={(event) => setDeckCourse(event.target.value)} aria-label="Deck course">
              <option value="">Any course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code}
                </option>
              ))}
            </Select>
            <Button onClick={buildDeck} loading={busy} disabled={deckName.trim().length < 2} icon={<Upload className="size-4" />}>
              Publish
            </Button>
          </div>
        </Card>

        <Card className="min-w-0 p-3">
          <SectionHeading title="Challenge pool" subtitle="What a duel, boss or practice run can draw from." icon={<Gem className="size-4" />} />
          {!pool ? (
            <Skeleton className="mt-2.5 h-16" />
          ) : (
            <div className="mt-2.5 grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
              {[['Eligible', Number(pool.total ?? 0)] as const, ...Object.entries((pool.eligible ?? {}) as Record<string, number>)].map(([key, value]) => (
                <div key={key} className="min-w-0 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                  <p className="truncate text-[0.62rem] font-black tracking-[0.12em] text-mist-500 uppercase">{key}</p>
                  <p className="font-display text-base font-black tabular text-mist-50">{formatNumber(value)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="min-w-0 p-3">
        <SectionHeading title="Exam tools" subtitle="Duplicate an exam (its question source comes along) or preview a paper." icon={<Copy className="size-4" />} />
        {quizzes.length === 0 ? (
          <p className="mt-2.5 text-[0.78rem] font-semibold text-mist-500">No exams yet.</p>
        ) : (
          <ul className="mt-2.5 min-w-0 divide-y divide-white/6 rounded-2xl border border-white/8">
            {quizzes.slice(0, 10).map((quiz) => (
              <li key={quiz.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.84rem] font-bold text-mist-100">{quiz.title}</p>
                  <p className="truncate text-[0.7rem] font-semibold text-mist-500">
                    <span className="capitalize">{quiz.status}</span>
                    {quiz.course ? ` · ${quiz.course.code}` : ''} · {sourceSummary(quiz)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  title="Preview"
                  aria-label={`Preview ${quiz.title}`}
                  onClick={() =>
                    void api.admin.studio
                      .previewQuiz(quiz.id)
                      .then((payload) => setPreview(payload as Record<string, unknown>))
                      .catch((error: Error) => toast('error', 'Preview failed', error.message))
                  }
                  icon={<Eye className="size-3.5" />}
                >
                  <span className="hidden sm:inline">Preview</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Duplicate"
                  aria-label={`Duplicate ${quiz.title}`}
                  onClick={() =>
                    void api.admin.studio
                      .duplicateQuiz(quiz.id, {title: `${quiz.title} (copy)`})
                      .then(() => {
                        toast(
                          'success',
                          'Exam duplicated',
                          quiz.question_source === 'course_random' ? 'Same course and draw settings — players still get fresh random papers.' : 'Its exam-specific questions were copied.',
                        );
                        load();
                      })
                      .catch((error: Error) => toast('error', 'Could not duplicate', error.message))
                  }
                  icon={<Copy className="size-3.5" />}
                >
                  <span className="hidden sm:inline">Duplicate</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Preview" subtitle="Read-only — the answer key is shown for staff only.">
        {preview && (
          <pre className="keep-dark max-h-80 overflow-auto rounded-2xl border border-white/10 bg-ink-950/70 p-3 font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap text-mist-300 [overflow-wrap:anywhere]">
            {JSON.stringify(preview, null, 2).slice(0, 6000)}
          </pre>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */
export default function StudioAdmin() {
  const [pane, setPane] = useState<Pane>('pulse');
  return (
    <div className="min-w-0 space-y-4">
      <SectionHeading
        title="Arena Studio"
        subtitle="Bank health, bulk editing, review queues, blueprints and builders — all backed by the authoritative question engine."
        icon={<Sparkles className="size-4" />}
        action={<Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">answers are server-owned</Chip>}
      />
      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          {value: 'pulse', label: 'Pulse', icon: Activity},
          {value: 'bank', label: 'Question bank', icon: BookOpen},
          {value: 'review', label: 'Review & flags', icon: AlertTriangle},
          {value: 'builders', label: 'Builders', icon: Layers},
        ]}
      />
      {pane === 'pulse' && <Pulse />}
      {pane === 'bank' && <Bank />}
      {pane === 'review' && <Review />}
      {pane === 'builders' && <Builders />}
    </div>
  );
}
