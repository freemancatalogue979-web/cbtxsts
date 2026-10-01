/** Admin: teacher verification, account actions and Teacher Network moderation. */
import {BadgeCheck, Ban, Check, CircleHelp, Eye, EyeOff, FileText, Flag, GraduationCap, History, Loader2, RotateCcw, Search, ShieldCheck, Star, Trash2, X} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {ApiError} from '../lib/api';
import {FORMAT_LABEL, fileUrl, teacherAdmin, type AdminReport, type AdminTeacherDetail, type AdminTeacherRow} from '../lib/teachers';
import {Empty, LoadingRows} from '../pro/ui';
import {useSession} from '../store/session';
import {Field, PersonAvatar, ProScope, Sheet, Stars, StatusPill, timeAgo} from '../teach/ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong.');
type Queue = 'pending' | 'needs_info' | 'approved' | 'verified' | 'suspended' | 'rejected' | 'reported' | 'all';
const QUEUES: {id: Queue; label: string}[] = [
  {id: 'pending', label: 'Pending'},
  {id: 'needs_info', label: 'Needs info'},
  {id: 'verified', label: 'Verified'},
  {id: 'approved', label: 'Approved'},
  {id: 'suspended', label: 'Suspended'},
  {id: 'rejected', label: 'Rejected'},
  {id: 'reported', label: 'Reported'},
  {id: 'all', label: 'All'},
];

type Summary = Awaited<ReturnType<typeof teacherAdmin.summary>>;

export default function TeachersAdmin() {
  const [view, setView] = useState<'teachers' | 'reports'>('teachers');
  const [queue, setQueue] = useState<Queue>('pending');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminTeacherRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    setRows(null);
    teacherAdmin.list(queue, q).then((r) => setRows(r.items)).catch(() => setRows([]));
    teacherAdmin.summary().then(setSummary).catch(() => {});
  }, [queue, q]);
  useEffect(() => {
    const id = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  const count = (id: Queue) => (id === 'verified' ? summary?.verified : id === 'reported' ? undefined : id === 'all' ? undefined : summary?.counts[id]);

  return (
    <ProScope>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pro-eyebrow">Teacher Network</p>
          <h1 className="pro-h2">Teachers</h1>
          <p className="pro-secondary">Verify applications, manage accounts and moderate reports.</p>
        </div>
        <div className="pro-tabs" role="tablist">
          <button type="button" role="tab" className="pro-tab" aria-selected={view === 'teachers'} onClick={() => setView('teachers')}>
            Teachers
          </button>
          <button type="button" role="tab" className="pro-tab" aria-selected={view === 'reports'} onClick={() => setView('reports')}>
            Reports{summary?.open_reports ? ` · ${summary.open_reports}` : ''}
          </button>
        </div>
      </header>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Pending', summary.counts.pending ?? 0],
            ['Verified', summary.verified],
            ['Suspended', summary.counts.suspended ?? 0],
            ['Open reports', summary.open_reports],
            ['Active relationships', summary.relationships],
            ['Pending requests', summary.pending_requests],
          ].map(([k, v]) => (
            <div key={k} className="t-kpi">
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}

      {view === 'reports' ? (
        <Reports onChanged={load} onOpenTeacher={setOpenId} />
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex flex-wrap gap-1.5">
              {QUEUES.map((x) => (
                <button key={x.id} type="button" className="t-chip-btn" aria-pressed={queue === x.id} onClick={() => setQueue(x.id)}>
                  {x.label}
                  {!!count(x.id) && <span className="t-unread">{count(x.id)}</span>}
                </button>
              ))}
            </div>
            <label className="pro-search min-w-0 self-start">
              <Search />
              <input className="pro-input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, username or headline" aria-label="Search teachers" />
            </label>
          </div>
          {rows === null && <LoadingRows rows={4} />}
          {rows?.length === 0 && <Empty icon={<GraduationCap className="size-6" />} hue="violet" title="No teachers in this queue" />}
          {rows && rows.length > 0 && (
            <div className="pro-card overflow-hidden">
              {rows.map((r, i) => (
                <button key={r.id} type="button" className="t-row t-row-btn" style={{borderTop: i ? '1px solid var(--pro-border)' : undefined}} onClick={() => setOpenId(r.id)}>
                  <PersonAvatar id={r.student_id} name={r.name} hue={r.avatar_hue} hasPhoto={r.has_photo} size={42} ring={r.verified ? 'brand' : 'hue'} verified={r.verified} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{r.name}</span>
                      {r.verified && <BadgeCheck className="size-4 shrink-0" style={{color: 'var(--pro-accent-text)'}} />}
                    </span>
                    <span className="pro-meta block truncate">
                      @{r.username} · {r.specialties.map((s) => s.subject).join(', ') || 'No subjects'} · {r.submitted_at ? `submitted ${timeAgo(r.submitted_at)}` : `created ${timeAgo(r.created_at)}`}
                    </span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="pro-meta block">
                      {r.stats.active_students} students · {r.stats.review_count ? `${r.stats.rating.toFixed(1)}★` : 'no reviews'}
                    </span>
                    {!!r.stats.open_reports && <span className="pro-meta block" style={{color: 'var(--pro-danger)'}}>{r.stats.open_reports} open report{r.stats.open_reports === 1 ? '' : 's'}</span>}
                  </span>
                  <StatusPill status={r.status} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <TeacherSheet id={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </ProScope>
  );
}

/* ------------------------------------------------------------ detail */
const ACTION_INFO: Record<string, {label: string; needsMessage: boolean; tone?: 'danger' | 'primary'; icon: React.ReactNode; placeholder: string; from: string[]}> = {
  approve: {label: 'Approve & verify', needsMessage: false, tone: 'primary', icon: <Check className="size-4" />, placeholder: 'Optional welcome message', from: ['pending', 'needs_info', 'rejected']},
  needs_info: {label: 'Request info', needsMessage: true, icon: <CircleHelp className="size-4" />, placeholder: 'What should they add or fix? (shown to the teacher)', from: ['pending']},
  reject: {label: 'Reject', needsMessage: true, tone: 'danger', icon: <X className="size-4" />, placeholder: 'Why? (shown to the teacher)', from: ['pending', 'needs_info']},
  suspend: {label: 'Suspend', needsMessage: true, tone: 'danger', icon: <Ban className="size-4" />, placeholder: 'Reason (shown to the teacher)', from: ['approved', 'pending', 'needs_info']},
  reinstate: {label: 'Reinstate', needsMessage: false, tone: 'primary', icon: <RotateCcw className="size-4" />, placeholder: 'Optional message', from: ['suspended']},
  unverify: {label: 'Remove Verified badge', needsMessage: false, icon: <ShieldCheck className="size-4" />, placeholder: 'Optional reason', from: ['approved']},
  verify: {label: 'Add Verified badge', needsMessage: false, icon: <BadgeCheck className="size-4" />, placeholder: 'Optional message', from: ['approved']},
};

function TeacherSheet({id, onClose, onChanged}: {id: number | null; onClose: () => void; onChanged: () => void}) {
  const {toast} = useSession();
  const [data, setData] = useState<AdminTeacherDetail | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'profile' | 'activity' | 'history'>('profile');

  useEffect(() => {
    setData(null);
    setAction(null);
    setTab('profile');
    if (id) teacherAdmin.detail(id).then(setData).catch((e) => toast('error', 'Could not load', errText(e)));
  }, [id, toast]);

  const run = async (name: string) => {
    if (!data) return;
    setBusy(true);
    try {
      const next = await teacherAdmin.act(data.id, name, note, message);
      setData(next);
      setAction(null);
      setMessage('');
      setNote('');
      toast('success', name === 'note' ? 'Note added' : 'Done', name === 'note' ? undefined : 'The teacher was notified.');
      onChanged();
    } catch (e) {
      toast('error', 'Action failed', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const setQual = async (qid: number, status: string) => {
    try {
      await teacherAdmin.qualification(qid, status);
      if (data) setData(await teacherAdmin.detail(data.id));
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };
  const moderate = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      if (data) setData(await teacherAdmin.detail(data.id));
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };

  const available = data ? Object.entries(ACTION_INFO).filter(([key, info]) => info.from.includes(data.status) && !(key === 'verify' && data.verified) && !(key === 'unverify' && !data.verified)) : [];
  const info = action ? ACTION_INFO[action] : null;

  return (
    <Sheet open={id !== null} onClose={onClose} size="xl" icon={<GraduationCap />} title={data?.name ?? 'Teacher'} subtitle={data ? `@${data.username} · ${data.headline || 'No headline'}` : undefined}>
      {!data ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="grid min-w-0 gap-5">
          <section className="grid gap-3 rounded-2xl p-4" style={{background: 'var(--pro-hover)'}}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={data.status} />
              {data.verified && (
                <span className="pro-badge" data-tone="accent">
                  <BadgeCheck className="size-3" /> Verified
                </span>
              )}
              {data.account.is_banned && (
                <span className="pro-badge" data-tone="danger">
                  Account banned
                </span>
              )}
              <span className="pro-meta ml-auto">{data.submitted_at ? `Submitted ${timeAgo(data.submitted_at)}` : 'Not submitted'}</span>
            </div>
            {data.staff_message && (
              <p className="pro-secondary [overflow-wrap:anywhere]">
                <b style={{color: 'var(--pro-text)'}}>Last message to teacher:</b> {data.staff_message}
              </p>
            )}
            {!info ? (
              <div className="flex flex-wrap gap-2">
                {available.map(([key, a]) => (
                  <button key={key} type="button" className={`pro-btn pro-btn-sm ${a.tone === 'primary' ? 'pro-btn-primary' : ''}`} style={a.tone === 'danger' ? {color: 'var(--pro-danger)'} : undefined} onClick={() => setAction(key)}>
                    {a.icon} {a.label}
                  </button>
                ))}
                {available.length === 0 && <p className="pro-meta">No status actions for a {data.status} profile.</p>}
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="pro-h3 inline-flex items-center gap-2">
                  {info.icon} {info.label}
                </p>
                <Field label={info.needsMessage ? 'Message to teacher (required)' : 'Message to teacher (optional)'}>
                  <textarea className="pro-input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder={info.placeholder} />
                </Field>
                <Field label="Internal note (staff only)">
                  <input className="pro-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Checked degree certificate with registry" />
                </Field>
                <div className="flex gap-2">
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => setAction(null)}>
                    Cancel
                  </button>
                  <button type="button" className={`pro-btn pro-btn-sm ${info.tone === 'primary' ? 'pro-btn-primary' : ''}`} style={info.tone === 'danger' ? {color: 'var(--pro-danger)'} : undefined} disabled={busy || (info.needsMessage && !message.trim())} onClick={() => void run(action!)}>
                    {busy && <Loader2 className="size-4 animate-spin" />} Confirm
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="pro-tabs pro-tabs-fit" role="tablist">
            {(
              [
                ['profile', 'Application'],
                ['activity', 'Activity & content'],
                ['history', 'History'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" className="pro-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'profile' && (
            <div className="grid min-w-0 gap-5">
              <dl className="grid gap-x-6 gap-y-2 text-[0.86rem] sm:grid-cols-2">
                {[
                  ['Experience', `${data.experience_years} year${data.experience_years === 1 ? '' : 's'}`],
                  ['Institution', data.institution || '—'],
                  ['Languages', data.languages.join(', ') || '—'],
                  ['Formats', FORMAT_LABEL[data.formats] ?? data.formats],
                  ['Accepting students', data.accepting ? 'Yes' : 'No'],
                  ['Account joined', data.account.joined ? timeAgo(data.account.joined) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b py-1.5" style={{borderColor: 'var(--pro-border)'}}>
                    <dt className="pro-secondary">{k}</dt>
                    <dd className="text-right font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <section className="grid gap-1">
                <h3 className="pro-h3">Bio</h3>
                <p className="pro-body whitespace-pre-wrap [overflow-wrap:anywhere]">{data.bio || '—'}</p>
              </section>
              {data.experience && (
                <section className="grid gap-1">
                  <h3 className="pro-h3">Experience</h3>
                  <p className="pro-body whitespace-pre-wrap [overflow-wrap:anywhere]">{data.experience}</p>
                </section>
              )}
              <section className="grid gap-2">
                <h3 className="pro-h3">Specialties</h3>
                {data.specialties.map((s) => (
                  <p key={s.subject} className="pro-secondary [overflow-wrap:anywhere]">
                    <b style={{color: 'var(--pro-text)'}}>{s.subject}:</b> {s.topics.join(', ')}
                  </p>
                ))}
              </section>
              <section className="grid gap-2">
                <h3 className="pro-h3">Qualifications</h3>
                {data.qualifications.length === 0 && <p className="pro-secondary">None provided.</p>}
                {data.qualifications.map((qq) => (
                  <div key={qq.id} className="pro-card flex flex-wrap items-center gap-3 p-3">
                    <span className="t-attach-icon">
                      <FileText />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold [overflow-wrap:anywhere]">{qq.title}</span>
                      <span className="pro-meta">{[qq.institution, qq.year].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    {qq.file ? (
                      <a className="pro-btn pro-btn-sm" href={fileUrl(qq.file.id, false, true)} target="_blank" rel="noopener noreferrer">
                        <Eye className="size-4" /> Document
                      </a>
                    ) : (
                      <span className="pro-meta">No document</span>
                    )}
                    <span className="flex gap-1">
                      {(['verified', 'pending', 'rejected'] as const).map((s) => (
                        <button key={s} type="button" className="t-chip-btn !py-1 text-[0.72rem]" aria-pressed={qq.status === s} onClick={() => void setQual(qq.id, s)}>
                          {s === 'verified' ? 'Verified' : s === 'pending' ? 'Unchecked' : 'Rejected'}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            </div>
          )}

          {tab === 'activity' && (
            <div className="grid min-w-0 gap-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Active students', data.stats.active_students],
                  ['Students taught', data.stats.students_taught],
                  ['Rating', data.stats.review_count ? `${data.stats.rating.toFixed(1)} (${data.stats.review_count})` : '—'],
                  ['Response rate', data.stats.response_rate != null ? `${data.stats.response_rate}%` : '—'],
                ].map(([k, v]) => (
                  <div key={String(k)} className="t-kpi">
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              <section className="grid gap-2">
                <h3 className="pro-h3">Reviews</h3>
                {data.reviews.length === 0 && <p className="pro-secondary">No reviews.</p>}
                {data.reviews.map((r) => (
                  <div key={r.id} className="pro-card grid gap-1.5 p-3" style={{opacity: r.status === 'hidden' ? 0.6 : 1}}>
                    <div className="flex items-center gap-2">
                      <Stars value={r.rating} />
                      <span className="text-[0.82rem] font-semibold">{r.author}</span>
                      {r.anonymous && <span className="pro-meta">(anonymous to public)</span>}
                      <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm ml-auto" onClick={() => void moderate(() => teacherAdmin.setReview(r.id, r.status === 'hidden' ? 'visible' : 'hidden'))}>
                        {r.status === 'hidden' ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {r.status === 'hidden' ? 'Show' : 'Hide'}
                      </button>
                    </div>
                    {r.body && <p className="pro-secondary [overflow-wrap:anywhere]">{r.body}</p>}
                  </div>
                ))}
              </section>
              <ContentList title="Materials" items={data.materials.map((m) => ({id: m.id, title: m.title, status: m.status, meta: `${m.kind} · ${m.visibility}`}))} removedStatus="removed" onToggle={(m) => moderate(() => teacherAdmin.setContent('materials', m.id, m.status === 'removed' ? 'restore' : 'remove'))} />
              <ContentList title="Quizzes" items={data.quizzes.map((m) => ({id: m.id, title: m.title, status: m.status, meta: m.visibility}))} removedStatus="removed" onToggle={(m) => moderate(() => teacherAdmin.setContent('quizzes', m.id, m.status === 'removed' ? 'restore' : 'remove'))} />
              <section className="grid gap-1">
                <h3 className="pro-h3">Groups</h3>
                {data.groups.length === 0 ? <p className="pro-secondary">None.</p> : data.groups.map((g) => <p key={g.id} className="pro-secondary">{g.name} · {g.privacy}{g.capacity ? ` · cap ${g.capacity}` : ''}</p>)}
              </section>
            </div>
          )}

          {tab === 'history' && (
            <div className="grid gap-4">
              <div className="flex gap-2">
                <input className="pro-input min-w-0 flex-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Add an internal note to the history" />
                <button type="button" className="pro-btn" disabled={!note.trim() || busy} onClick={() => void run('note')}>
                  Add note
                </button>
              </div>
              <ol className="grid gap-3">
                {data.history.map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <History className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
                    <span className="min-w-0">
                      <span className="block text-[0.86rem] font-semibold">
                        {h.action.replace('_', ' ')} <span className="pro-meta font-normal">· {h.actor} · {timeAgo(h.created_at)}</span>
                      </span>
                      {h.note && <span className="pro-secondary block [overflow-wrap:anywhere]">{h.note}</span>}
                    </span>
                  </li>
                ))}
                {data.history.length === 0 && <p className="pro-secondary">No history yet.</p>}
              </ol>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ContentList({title, items, removedStatus, onToggle}: {title: string; items: {id: number; title: string; status: string; meta: string}[]; removedStatus: string; onToggle: (item: {id: number; status: string}) => void}) {
  return (
    <section className="grid gap-2">
      <h3 className="pro-h3">{title}</h3>
      {items.length === 0 && <p className="pro-secondary">None.</p>}
      {items.map((m) => (
        <div key={m.id} className="flex items-center gap-3 text-[0.86rem]" style={{opacity: m.status === removedStatus ? 0.6 : 1}}>
          <span className="min-w-0 flex-1 truncate font-semibold">{m.title}</span>
          <span className="pro-meta shrink-0">
            {m.meta} · {m.status}
          </span>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => onToggle(m)}>
            {m.status === removedStatus ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />} {m.status === removedStatus ? 'Restore' : 'Remove'}
          </button>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------ reports */
const KIND_LABEL: Record<string, string> = {
  teacher: 'Teacher',
  teacher_student: 'Person',
  teacher_group: 'Group',
  teacher_material: 'Material',
  teacher_quiz: 'Quiz',
  teacher_review: 'Review',
  chat_message: 'Message',
};

function Reports({onChanged, onOpenTeacher}: {onChanged: () => void; onOpenTeacher: (id: number) => void}) {
  const {toast} = useSession();
  const [state, setState] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [items, setItems] = useState<AdminReport[] | null>(null);
  const load = useCallback(() => {
    setItems(null);
    teacherAdmin.reports(state).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [state]);
  useEffect(load, [load]);
  const decide = async (r: AdminReport, status: 'resolved' | 'dismissed', action = 'none') => {
    if (action === 'suspend_teacher' && !window.confirm('Suspend this teacher? Their profile is hidden immediately.')) return;
    try {
      await teacherAdmin.decideReport(r.id, status, action);
      toast('success', status === 'dismissed' ? 'Report dismissed' : 'Report resolved');
      load();
      onChanged();
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };
  const actionFor = (kind: string): [string, string] | null =>
    kind === 'teacher_review' ? ['hide_review', 'Hide review'] : kind === 'teacher_material' ? ['remove_material', 'Remove material'] : kind === 'teacher_quiz' ? ['remove_quiz', 'Remove quiz'] : null;
  return (
    <div className="grid gap-3">
      <div className="flex gap-1.5">
        {(['open', 'resolved', 'dismissed'] as const).map((s) => (
          <button key={s} type="button" className="t-chip-btn" aria-pressed={state === s} onClick={() => setState(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {items === null && <LoadingRows rows={3} />}
      {items?.length === 0 && <Empty icon={<Flag className="size-6" />} hue="green" title={state === 'open' ? 'No open reports' : 'Nothing here'} />}
      {items?.map((r) => {
        const extra = actionFor(r.kind);
        return (
          <article key={r.id} className="pro-card t-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pro-badge" data-tone="warning">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{r.target.label}</span>
              <span className="pro-meta">
                by {r.reporter} · {timeAgo(r.created_at)}
              </span>
            </div>
            <p className="pro-body [overflow-wrap:anywhere]">“{r.reason}”</p>
            {r.status !== 'open' ? (
              <p className="pro-meta">
                {r.status} by {r.resolved_by || 'staff'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {r.teacher_id && (
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => onOpenTeacher(r.teacher_id!)}>
                    <GraduationCap className="size-4" /> Open teacher
                  </button>
                )}
                {extra && (
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => void decide(r, 'resolved', extra[0])}>
                    {r.kind === 'teacher_review' ? <Star className="size-4" /> : <Trash2 className="size-4" />} {extra[1]}
                  </button>
                )}
                {r.teacher_id && (
                  <button type="button" className="pro-btn pro-btn-sm" style={{color: 'var(--pro-danger)'}} onClick={() => void decide(r, 'resolved', 'suspend_teacher')}>
                    <Ban className="size-4" /> Suspend teacher
                  </button>
                )}
                <button type="button" className="pro-btn pro-btn-sm" onClick={() => void decide(r, 'resolved')}>
                  <Check className="size-4" /> Mark resolved
                </button>
                <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => void decide(r, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
