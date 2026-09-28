/**
 * Staff AI assistant — asks the platform (through permission-checked tools)
 * about courses, the question bank, materials and class results, and PROPOSES
 * changes. Nothing it drafts touches the bank until a staff member approves it
 * here, optionally after editing.
 */
import {
  ArrowUp, Bot, Check, CheckCircle2, ClipboardCheck, FileQuestion, History, Inbox, ListTree, Loader2, Pencil, RefreshCw, ShieldCheck,
  Sparkles, Tags, Trash2, Wand2, X, XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Card, Field, Modal, Segmented, Skeleton, TextArea, TextInput} from '../components/ui';
import {ToolTrail} from '../components/tutor/AgentBits';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {Markdown} from '../lib/markdown';
import {aiStaffApi, type AgentTurn, type AIStaffStatus, type Proposal, type ProposalCard, type ToolCallRow, type ToolEvent} from '../lib/tutor';
import type {Course} from '../lib/types';
import {useSession} from '../store/session';

type View = 'chat' | 'review' | 'audit';
const THREAD_KEY = 'ag.staff.assistant';
const KIND: Record<string, {label: string; icon: typeof Tags}> = {
  questions: {label: 'Questions', icon: FileQuestion},
  topics: {label: 'Topics', icon: ListTree},
  classification: {label: 'Classification', icon: Tags},
};
const STARTERS: [string, string][] = [
  ['Bank health', 'Analyse the question bank for this course: coverage per topic, difficulty balance, and what is missing.'],
  ['Duplicates', 'Find duplicate or near-duplicate questions in this course.'],
  ['Fill a gap', 'Draft 8 good questions for the weakest-covered topic in this course, with explanations.'],
  ['Topics from notes', 'Read the course materials and propose a clean topic list for this course.'],
  ['Missing explanations', 'Which questions in this course have no explanation? Draft explanations for up to 10 of them.'],
  ['Class results', 'How is the class doing in this course? Which questions and topics are hardest?'],
];
const errText = (e: unknown) => (e as Error).message || 'Something went wrong.';

export default function AIAssistant({onPending}: {onPending?: (n: number) => void}) {
  const [view, setView] = useState<View>('chat');
  const [status, setStatus] = useState<AIStaffStatus | null>(null);
  const [openProposal, setOpenProposal] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadStatus = useCallback(() => {
    aiStaffApi.status().then((s) => { setStatus(s); onPending?.(s.pending_proposals); }).catch(() => undefined);
  }, [onPending]);
  useEffect(loadStatus, [loadStatus, refreshKey]);

  const changed = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            {value: 'chat', label: 'Assistant'},
            {value: 'review', label: status?.pending_proposals ? `Review · ${status.pending_proposals}` : 'Review'},
            {value: 'audit', label: 'Tool log'},
          ]}
        />
        {status && (
          <span className="ml-auto flex items-center gap-1.5 text-[0.72rem] font-bold text-mist-500">
            <span className={`size-2 rounded-full ${status.configured ? 'bg-mint-400' : 'bg-flare-400'}`} />
            {status.configured ? `${status.provider} · ${status.model}` : 'No AI key'} · {status.used_today}/{status.daily_limit || '∞'} today
          </span>
        )}
      </div>
      {view === 'chat' && <Chat status={status} onProposal={setOpenProposal} onUsed={changed} />}
      {view === 'review' && <Review key={refreshKey} onOpen={setOpenProposal} />}
      {view === 'audit' && <Audit />}
      <ProposalModal id={openProposal} onClose={() => setOpenProposal(null)} onDecided={changed} />
    </div>
  );
}

/* ------------------------------------------------------------------ chat */
function Chat({status, onProposal, onUsed}: {status: AIStaffStatus | null; onProposal: (id: number) => void; onUsed: () => void}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [turns, setTurns] = useState<AgentTurn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(THREAD_KEY) || '[]') as AgentTurn[];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.admin.courses().then((list) => {
      setCourses(list);
      setCourseId((c) => c ?? list[0]?.id ?? null);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    sessionStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-30)));
    endRef.current?.scrollIntoView({block: 'end', behavior: 'smooth'});
  }, [turns, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: AgentTurn[] = [...turns, {role: 'user', content}];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const res = await aiStaffApi.chat(next.filter((t) => !t.failed).slice(-12).map(({role, content: c}) => ({role, content: c})), courseId);
      setTurns((list) => [...list, {role: 'assistant', content: res.reply, tools: res.tools, actions: res.actions}]);
    } catch (e) {
      setTurns((list) => [...list, {role: 'assistant', content: errText(e), failed: true}]);
      toast('error', 'Assistant unavailable', errText(e));
    } finally {
      setBusy(false);
      onUsed();
    }
  };

  const course = courses.find((c) => c.id === courseId);
  return (
    <Card className="flex min-h-[28rem] flex-col overflow-hidden p-0 lg:min-h-[34rem]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/6 px-3 py-2">
        <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Wand2 className="size-3.5" /></span>
        <p className="text-[0.82rem] font-extrabold text-mist-50">Staff assistant</p>
        <select
          value={courseId ?? ''}
          onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)}
          className="ag-select ml-auto h-8 max-w-[15rem] min-w-0 appearance-none truncate rounded-full border border-white/12 bg-white/[0.04] pr-9 pl-3 text-[0.74rem] font-bold text-mist-100"
          aria-label="Course"
        >
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
        {turns.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} label="Clear conversation" onClick={() => setTurns([])} />
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {turns.length === 0 && (
          <div className="mx-auto max-w-xl py-4 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-nova-400/25 to-pulse-500/20 text-nova-200"><Sparkles className="size-6" /></span>
            <p className="mt-2 text-[0.95rem] font-extrabold text-mist-50">What should we work on{course ? ` in ${course.code}` : ''}?</p>
            <p className="mx-auto mt-1 max-w-md text-[0.78rem] text-mist-400">
              I read courses, materials, the question bank and results through safe tools. Anything I draft waits in <b className="text-mist-200">Review</b> until you approve it.
            </p>
            <div className="mt-4 grid gap-1.5 text-left sm:grid-cols-2">
              {STARTERS.map(([label, prompt]) => (
                <button key={label} onClick={() => void send(prompt)} disabled={!status?.configured} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 transition hover:border-white/16 hover:bg-white/[0.05] disabled:opacity-40">
                  <p className="text-[0.78rem] font-extrabold text-mist-100">{label}</p>
                  <p className="line-clamp-2 text-[0.7rem] text-mist-500">{prompt}</p>
                </button>
              ))}
            </div>
            {status && !status.configured && <p className="mt-3 text-[0.74rem] font-bold text-flare-300">Add an AI key under Models first.</p>}
          </div>
        )}
        {turns.map((turn, i) => turn.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-nova-600/35 px-3.5 py-2 text-[0.86rem] whitespace-pre-wrap text-mist-50">{turn.content}</div>
          </div>
        ) : (
          <div key={i} className="flex gap-2">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Bot className="size-3.5" /></span>
            <div className="min-w-0 flex-1">
              <div className={`rounded-2xl rounded-tl-md border px-3.5 py-2.5 ${turn.failed ? 'border-flare-400/30 bg-flare-500/[0.07]' : 'border-white/8 bg-white/[0.03]'}`}>
                {turn.tools && turn.tools.length > 0 && <ToolTrail tools={turn.tools as ToolEvent[]} />}
                <Markdown text={turn.content} />
              </div>
              {(turn.actions ?? []).filter((a): a is ProposalCard => a.type === 'proposal').map((p) => (
                <button key={p.id} onClick={() => onProposal(p.id)} className="mt-2 flex w-full items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2.5 text-left transition hover:bg-amber-500/10">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/15 text-amber-200"><ClipboardCheck className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.62rem] font-extrabold tracking-[0.14em] text-amber-200/80 uppercase">Needs your approval · {KIND[p.kind]?.label ?? p.kind}</span>
                    <span className="block truncate text-[0.84rem] font-bold text-mist-50">{p.title}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[0.7rem] font-extrabold text-mist-50">Review</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 pl-9 text-[0.78rem] text-mist-400">
            <Loader2 className="size-3.5 animate-spin text-nova-300" /> Checking the platform…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-white/6 p-2.5"
        onSubmit={(e) => { e.preventDefault(); void send(draft); }}
      >
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
          rows={1}
          placeholder={course ? `Ask about ${course.code}…` : 'Ask about any course…'}
          className="max-h-40 min-h-11 flex-1 resize-none !py-2.5"
          disabled={!status?.configured}
        />
        <Button type="submit" icon={<ArrowUp className="size-4" />} label="Send" disabled={!draft.trim() || busy || !status?.configured} loading={busy} />
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- review */
function Review({onOpen}: {onOpen: (id: number) => void}) {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const load = useCallback(() => {
    setRows(null);
    aiStaffApi.proposals(filter).then((r) => setRows(r.proposals)).catch(() => setRows([]));
  }, [filter]);
  useEffect(load, [load]);

  return (
    <Card className="p-2 sm:p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <div className="flex rounded-full border border-white/10 p-0.5 text-[0.72rem] font-bold">
          {(['pending', 'approved', 'rejected'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 capitalize ${filter === f ? 'bg-white/10 text-mist-50' : 'text-mist-500 hover:text-mist-300'}`}>{f}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} label="Refresh" onClick={load} />
      </div>
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? (
        <div className="py-10 text-center">
          <Inbox className="mx-auto size-8 text-mist-600" />
          <p className="mt-2 text-[0.84rem] font-bold text-mist-300">{filter === 'pending' ? 'Nothing waiting for review' : `No ${filter} proposals`}</p>
          <p className="text-[0.74rem] text-mist-500">Ask the assistant to draft questions, topics or classifications.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/6">
          {rows.map((p) => {
            const K = KIND[p.kind]?.icon ?? Sparkles;
            return (
              <button key={p.id} onClick={() => onOpen(p.id)} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-white/[0.03]">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-nova-500/12 text-nova-200"><K className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.84rem] font-bold text-mist-50">{p.title}</span>
                  <span className="block truncate text-[0.7rem] text-mist-500">{KIND[p.kind]?.label ?? p.kind} · {p.count} item{p.count === 1 ? '' : 's'}{p.course ? ` · ${p.course}` : ''} · {p.created_at ? formatRelative(p.created_at) : ''}</span>
                </span>
                <StatusPill status={p.status} />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function StatusPill({status}: {status: Proposal['status']}) {
  const tone = status === 'pending' ? 'bg-amber-400/15 text-amber-200' : status === 'approved' ? 'bg-mint-500/15 text-mint-200' : 'bg-white/8 text-mist-400';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.64rem] font-extrabold uppercase ${tone}`}>{status}</span>;
}

type Item = Record<string, unknown>;

function ProposalModal({id, onClose, onDecided}: {id: number | null; onClose: () => void; onDecided: () => void}) {
  const {toast} = useSession();
  const [p, setP] = useState<Proposal | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    setP(null);
    setEditing(null);
    setRejecting(false);
    setReason('');
    if (!id) return;
    aiStaffApi.proposal(id).then((row) => {
      setP(row);
      const list = (row.payload?.items ?? []) as Item[];
      setItems(list);
      // near-duplicates / already-existing topics start unticked
      setPicked(new Set(list.map((it, i) => (it.possible_duplicate || it.exists ? -1 : i)).filter((i) => i >= 0)));
    }).catch((e) => { toast('error', "Couldn't open proposal", errText(e)); onClose(); });
  }, [id, onClose, toast]);

  const pending = p?.status === 'pending';
  const approve = async () => {
    if (!p) return;
    setBusy('approve');
    try {
      const res = await aiStaffApi.approve(p.id, {items, selected: [...picked].sort((a, b) => a - b)});
      const r = res.result as {created?: number; updated?: number; skipped_existing?: unknown[]; errors?: unknown[]};
      const skipped = (r.skipped_existing?.length ?? 0) + (r.errors?.length ?? 0);
      toast('success', 'Approved and saved', [r.created ? `${r.created} created` : '', r.updated ? `${r.updated} updated` : '', skipped ? `${skipped} skipped` : ''].filter(Boolean).join(' · ') || undefined);
      onDecided();
      onClose();
    } catch (e) {
      toast('error', 'Not approved', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const reject = async () => {
    if (!p) return;
    setBusy('reject');
    try {
      await aiStaffApi.reject(p.id, reason);
      toast('info', 'Proposal rejected');
      onDecided();
      onClose();
    } catch (e) {
      toast('error', 'Not rejected', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const patch = (index: number, change: Item) => setItems((list) => list.map((it, i) => (i === index ? {...it, ...change} : it)));
  const toggle = (index: number) => setPicked((s) => { const n = new Set(s); if (n.has(index)) n.delete(index); else n.add(index); return n; });

  const K = KIND[p?.kind ?? '']?.icon ?? Sparkles;
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={p?.title ?? 'Proposal'}
      subtitle={p ? `${KIND[p.kind]?.label ?? p.kind}${p.course ? ` · ${p.course}` : ''} · drafted by AI${p.created_at ? ` ${formatRelative(p.created_at)}` : ''}` : 'Loading…'}
      icon={K}
      tone={pending ? 'amber' : p?.status === 'approved' ? 'mint' : 'nova'}
      size="lg"
      footer={p && pending ? (
        rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" onClick={() => void reject()} loading={busy === 'reject'} icon={<XCircle className="size-4" />}>Reject proposal</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setRejecting(true)} icon={<X className="size-4" />}>Reject</Button>
            <Button variant="mint" onClick={() => void approve()} loading={busy === 'approve'} disabled={picked.size === 0} icon={<ShieldCheck className="size-4" />}>
              Approve {picked.size} of {items.length}
            </Button>
          </>
        )
      ) : undefined}
    >
      {!p ? <Skeleton className="h-48" /> : (
        <div className="space-y-3">
          {p.summary && <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.8rem] text-mist-300"><b className="text-mist-100">Why: </b>{p.summary}</p>}
          {!pending && (
            <p className="flex items-center gap-2 text-[0.8rem] font-bold text-mist-300">
              <StatusPill status={p.status} /> {p.decided_at ? formatRelative(p.decided_at) : ''}
              {p.status === 'rejected' && Boolean((p.result as {reason?: string}).reason) && <span className="font-normal text-mist-500">— {(p.result as {reason?: string}).reason}</span>}
            </p>
          )}
          {rejecting && (
            <Field label="Reason (optional)" hint="Helps the team see why this was declined.">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not in this semester's syllabus" autoFocus />
            </Field>
          )}
          {pending && items.length > 1 && (
            <div className="flex items-center gap-2 text-[0.74rem] font-bold text-mist-400">
              <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked(new Set(items.map((_, i) => i)))}>Select all</button>
              <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked(new Set())}>Select none</button>
              <span className="ml-auto">{picked.size} selected</span>
            </div>
          )}
          <div className="space-y-2">
            {items.map((item, i) => (
              <ItemCard
                key={i}
                kind={p.kind}
                item={item}
                index={i}
                selectable={pending}
                selected={picked.has(i)}
                onToggle={() => toggle(i)}
                editing={editing === i}
                onEdit={() => setEditing(editing === i ? null : i)}
                onChange={(change) => patch(i, change)}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ItemCard({kind, item, index, selectable, selected, onToggle, editing, onEdit, onChange}: {
  kind: string; item: Item; index: number; selectable: boolean; selected: boolean; onToggle: () => void; editing: boolean; onEdit: () => void; onChange: (c: Item) => void;
}) {
  const s = (k: string) => String(item[k] ?? '');
  const flag = item.possible_duplicate ? `Looks ${item.possible_duplicate}% like an existing question` : item.exists ? 'Topic already exists' : '';
  return (
    <div className={`rounded-xl border transition ${selected ? 'border-nova-400/35 bg-nova-500/[0.05]' : 'border-white/8 bg-white/[0.02]'}`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {selectable && (
          <button onClick={onToggle} role="checkbox" aria-checked={selected} aria-label={`Include item ${index + 1}`} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition ${selected ? 'border-nova-400 bg-nova-500 text-white' : 'border-white/20 hover:border-white/40'}`}>
            {selected && <Check className="size-3.5" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {kind === 'questions' && (
            <>
              <p className="text-[0.84rem] leading-snug font-bold text-mist-50"><span className="text-mist-500">{index + 1}.</span> {s('text')}</p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {(['A', 'B', 'C', 'D'] as const).filter((L) => s(`option_${L.toLowerCase()}`)).map((L) => (
                  <p key={L} className={`rounded-lg px-2 py-1 text-[0.76rem] ${s('correct') === L ? 'bg-mint-500/12 text-mint-100' : 'text-mist-300'}`}><b>{L}.</b> {s(`option_${L.toLowerCase()}`)}</p>
                ))}
              </div>
              {s('explanation') && <p className="mt-1.5 text-[0.74rem] text-mist-400"><b className="text-mist-300">Why: </b>{s('explanation')}</p>}
              <p className="mt-1 text-[0.66rem] font-bold text-mist-500">{[s('topic'), s('difficulty')].filter(Boolean).join(' · ')}</p>
            </>
          )}
          {kind === 'topics' && (
            <>
              <p className="text-[0.86rem] font-bold text-mist-50">{s('name')}</p>
              {s('description') && <p className="text-[0.76rem] text-mist-400">{s('description')}</p>}
              {Array.isArray(item.learning_objectives) && item.learning_objectives.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[0.74rem] text-mist-300">{(item.learning_objectives as string[]).map((o) => <li key={o}>{o}</li>)}</ul>
              )}
            </>
          )}
          {kind === 'classification' && (
            <>
              <p className="text-[0.8rem] font-bold text-mist-100"><span className="text-mist-500">#{s('question_id')}</span> {s('text')}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries((item.after as Record<string, string>) ?? {}).map(([k, v]) => (
                  <span key={k} className="rounded-lg bg-white/[0.04] px-2 py-0.5 text-[0.7rem] text-mist-300">
                    <b className="text-mist-400 capitalize">{k}</b> <s className="text-mist-600">{(item.before as Record<string, string>)?.[k] || '—'}</s> → <b className="text-mint-200">{v}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {flag && <p className="mt-1 text-[0.68rem] font-bold text-amber-300">{flag}</p>}
        </div>
        {selectable && kind !== 'classification' && (
          <Button size="sm" variant="ghost" icon={editing ? <CheckCircle2 className="size-3.5" /> : <Pencil className="size-3.5" />} label={editing ? 'Done editing' : 'Edit'} onClick={onEdit} />
        )}
      </div>
      {editing && kind === 'questions' && (
        <div className="grid gap-2 border-t border-white/6 px-3 py-3">
          <Field label="Question"><TextArea rows={2} value={s('text')} onChange={(e) => onChange({text: e.target.value})} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['a', 'b', 'c', 'd'] as const).map((L) => (
              <Field key={L} label={`Option ${L.toUpperCase()}`}><TextInput value={s(`option_${L}`)} onChange={(e) => onChange({[`option_${L}`]: e.target.value})} /></Field>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Correct">
              <div className="flex gap-1">
                {(['A', 'B', 'C', 'D'] as const).map((L) => (
                  <button key={L} onClick={() => onChange({correct: L})} className={`h-10 flex-1 rounded-lg text-[0.8rem] font-extrabold ${s('correct') === L ? 'bg-mint-500 text-white' : 'border border-white/12 text-mist-300 hover:bg-white/[0.05]'}`}>{L}</button>
                ))}
              </div>
            </Field>
            <Field label="Topic"><TextInput value={s('topic')} onChange={(e) => onChange({topic: e.target.value})} /></Field>
            <Field label="Difficulty">
              <div className="flex gap-1">
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <button key={d} onClick={() => onChange({difficulty: d})} className={`h-10 flex-1 rounded-lg text-[0.72rem] font-bold capitalize ${s('difficulty') === d ? 'bg-nova-500 text-white' : 'border border-white/12 text-mist-300 hover:bg-white/[0.05]'}`}>{d}</button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Explanation"><TextArea rows={2} value={s('explanation')} onChange={(e) => onChange({explanation: e.target.value})} /></Field>
        </div>
      )}
      {editing && kind === 'topics' && (
        <div className="grid gap-2 border-t border-white/6 px-3 py-3">
          <Field label="Topic name"><TextInput value={s('name')} onChange={(e) => onChange({name: e.target.value})} /></Field>
          <Field label="Description"><TextArea rows={2} value={s('description')} onChange={(e) => onChange({description: e.target.value})} /></Field>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- audit */
function Audit() {
  const [rows, setRows] = useState<ToolCallRow[] | null>(null);
  const load = useCallback(() => {
    setRows(null);
    aiStaffApi.toolCalls().then((r) => setRows(r.calls)).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  return (
    <Card className="p-2 sm:p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[0.72rem] font-bold text-mist-500">
        <History className="size-4" /> Every tool the AI used, with who it acted for.
        {Object.entries(counts).map(([k, v]) => <span key={k} className="rounded-full bg-white/[0.05] px-2 py-0.5">{v} {k}</span>)}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} label="Refresh" onClick={load} />
      </div>
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <p className="py-8 text-center text-[0.8rem] text-mist-500">No tool calls yet.</p> : (
        <div className="divide-y divide-white/6">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className={`size-2 shrink-0 rounded-full ${r.status === 'ok' ? 'bg-mint-400' : r.status === 'denied' ? 'bg-flare-400' : 'bg-amber-400'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8rem] text-mist-100"><code className="text-nova-200">{r.tool}</code> · {r.role}{r.student_id ? ` #${r.student_id}` : r.admin_id ? ` (staff #${r.admin_id})` : ''}</span>
                <span className="block truncate text-[0.68rem] text-mist-500">{formatRelative(r.at)} · {r.ms} ms{r.summary ? ` · ${r.summary}` : ''}</span>
              </span>
              <span className="shrink-0 text-[0.66rem] font-extrabold text-mist-500 uppercase">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
