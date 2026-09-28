/** Staff: AI Tutor control room — overview, settings, usage, costs, users,
 * conversations (titles only), models, limits, logs and feature switches.
 * Everything is enforced by the API; this screen only edits and reports. */
import {Activity, AlertTriangle, Ban, Bot, Check, ChevronLeft, ChevronRight, Coins, Cpu, Eraser, Gauge, KeyRound, LayoutDashboard, ListFilter, MessagesSquare, PlugZap, RefreshCw, RotateCcw, Save, ScrollText, Search, Settings2, SlidersHorizontal, ThumbsDown, ToggleRight, Users, X, Eye, EyeOff, Trash2} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Button, Card, Chip, Field, Modal, SectionHeading, Select, Skeleton, StatTile, TextInput} from '../components/ui';
import {formatNumber, formatRelative} from '../lib/format';
import {
  tutorAdminApi, type AdminRange, type ProviderInfo, type TutorAdminSettings, type TutorAdminUser, type TutorAdminUserDetail, type TutorLog,
  type TutorOverview, type TutorQuality,
} from '../lib/tutor';
import {useSession} from '../store/session';

type Tab = 'overview' | 'settings' | 'usage' | 'costs' | 'users' | 'conversations' | 'models' | 'limits' | 'logs' | 'features';
const TABS: {id: Tab; label: string; icon: typeof Bot}[] = [
  {id: 'overview', label: 'Overview', icon: LayoutDashboard},
  {id: 'settings', label: 'Settings', icon: Settings2},
  {id: 'usage', label: 'Usage', icon: Activity},
  {id: 'costs', label: 'Costs', icon: Coins},
  {id: 'users', label: 'Users', icon: Users},
  {id: 'conversations', label: 'Conversations', icon: MessagesSquare},
  {id: 'models', label: 'Models', icon: Cpu},
  {id: 'limits', label: 'Limits', icon: Gauge},
  {id: 'logs', label: 'Logs', icon: ScrollText},
  {id: 'features', label: 'Features', icon: ToggleRight},
];

const LIMITS: {key: keyof TutorAdminSettings; label: string; hint: string}[] = [
  {key: 'ai_daily_limit', label: 'Requests per day', hint: 'Per student. Resets at midnight UTC.'},
  {key: 'ai_monthly_limit', label: 'Requests per month', hint: 'Per student.'},
  {key: 'ai_per_minute', label: 'Requests per minute', hint: 'Stops spamming.'},
  {key: 'ai_max_concurrent', label: 'Answers at once', hint: 'Per student.'},
  {key: 'ai_max_message_chars', label: 'Max message length', hint: 'Characters a student can send.'},
  {key: 'ai_max_response_tokens', label: 'Max answer length', hint: 'Tokens (~0.75 words each).'},
  {key: 'ai_max_conversations', label: 'Chats per student', hint: 'Oldest must be deleted beyond this.'},
];
const FEATURES: {key: keyof TutorAdminSettings; label: string; hint: string}[] = [
  {key: 'ai_feat_images', label: 'Image questions', hint: 'Students can attach a photo of a question.'},
  {key: 'ai_feat_uploads', label: 'Document uploads', hint: 'Students upload their own PDFs / notes.'},
  {key: 'ai_feat_materials', label: 'Study material generator', hint: 'Structured notes on any topic.'},
  {key: 'ai_feat_flashcards', label: 'Flashcards', hint: 'Generated decks + spaced review.'},
  {key: 'ai_feat_practice', label: 'Practice questions', hint: 'AI practice sets (never the official bank).'},
  {key: 'ai_feat_quiz', label: 'AI quiz', hint: '"Quiz me" one question at a time.'},
  {key: 'ai_feat_study_plans', label: 'Study plans', hint: 'Day-by-day plans from results + exam date.'},
  {key: 'ai_feat_saving', label: 'Saving to My AI Resources', hint: 'Off = students can view but not keep results.'},
];
const EXAM_MODES: Record<string, [string, string]> = {
  AI_DISABLED: ['AI off during exams', 'The tutor is fully paused while a student has an exam open.'],
  CONCEPT_ONLY: ['Concepts only', 'General explanations allowed; live exam questions are never shown to the AI.'],
  HINT_ONLY: ['Hints only', 'The AI sees the question but never the answer, and may only give hints.'],
  FULL_ASSISTANCE: ['Full assistance', 'No exam restrictions (for open-book or practice exams).'],
};
const RANGES: [string, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Custom']];

const money = (n: number, digits = 3) => `$${(n || 0).toFixed(digits)}`;
const pct = (n: number) => `${Math.round((n || 0) * 10) / 10}%`;
const errText = (e: unknown) => (e as Error).message || 'Something went wrong.';

export default function TutorAdmin() {
  const {toast} = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<AdminRange>({range: '7d'});
  const [settings, setSettings] = useState<TutorAdminSettings | null>(null);
  const [saved, setSaved] = useState<TutorAdminSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    tutorAdminApi.settings().then((r) => {
      setSettings(r.settings);
      setSaved(r.settings);
      setProviders(r.providers ?? []);
    }).catch((e) => toast('error', 'Could not load tutor settings', errText(e)));
  }, [toast]);
  useEffect(load, [load]);

  const dirty = useMemo(() => !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved]);
  const save = async () => {
    if (!settings || !saved) return;
    const changes = Object.fromEntries(Object.entries(settings).filter(([k, v]) => saved[k as keyof TutorAdminSettings] !== v));
    setSaving(true);
    try {
      const r = await tutorAdminApi.update(changes);
      setSettings(r.settings);
      setSaved(r.settings);
      setProviders(r.providers ?? providers);
      toast('success', 'AI Tutor settings saved');
    } catch (error) {
      toast('error', 'Not saved', errText(error));
    } finally {
      setSaving(false);
    }
  };
  const active = providers.find((p) => p.active);
  const set = (patch: Partial<TutorAdminSettings>) => setSettings((s) => (s ? {...s, ...patch} : s));
  const editing = tab === 'settings' || tab === 'limits' || tab === 'features' || tab === 'models' || tab === 'costs';

  return (
    <div className="space-y-3">
      <SectionHeading
        title="AI Tutor"
        subtitle="Control, limits, spend and quality for the players' AI Tutor."
        icon={<Bot className="size-4" />}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className={active?.configured ? 'border-mint-400/40 bg-mint-500/12 text-mint-200' : 'border-flare-400/40 bg-flare-500/12 text-flare-200'}>
              {active ? (active.configured ? `${active.name} connected` : `${active.name}: no key`) : '…'}
            </Chip>
            {settings && !settings.ai_enabled && <Chip className="border-gold-400/40 bg-gold-500/12 text-gold-200">Switched off</Chip>}
          </div>
        }
      />
      <nav className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" aria-label="AI Tutor sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={(e) => { setTab(t.id); e.currentTarget.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'}); }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.76rem] font-bold transition-colors ${tab === t.id ? 'bg-nova-500/20 text-white ring-1 ring-nova-400/50' : 'text-mist-400 hover:bg-white/[0.05] hover:text-mist-200'}`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </nav>

      {(tab === 'usage' || tab === 'costs' || tab === 'users' || tab === 'logs' || tab === 'overview') && <RangePicker value={range} onChange={setRange} />}

      {!settings ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          {tab === 'overview' && <OverviewTab range={range} providers={providers} settings={settings} onGo={setTab} />}
          {tab === 'settings' && <SettingsTab settings={settings} set={set} />}
          {tab === 'usage' && <UsageTab range={range} />}
          {tab === 'costs' && <CostsTab range={range} settings={settings} set={set} />}
          {tab === 'users' && <UsersTab range={range} />}
          {tab === 'conversations' && <ConversationsTab />}
          {tab === 'models' && <ModelsTab providers={providers} settings={settings} set={set} onProviders={setProviders} />}
          {tab === 'limits' && <LimitsTab settings={settings} set={set} />}
          {tab === 'logs' && <LogsTab range={range} />}
          {tab === 'features' && <FeaturesTab settings={settings} set={set} />}
        </>
      )}

      {editing && dirty && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 rounded-xl border border-nova-400/40 bg-ink-900/95 px-3 py-2 shadow-2xl backdrop-blur lg:bottom-3">
          <p className="text-[0.8rem] font-bold text-mist-100">Unsaved changes</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setSettings(saved)}>Undo</Button>
            <Button size="sm" icon={<Save className="size-4" />} loading={saving} onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ helpers */
function RangePicker({value, onChange}: {value: AdminRange; onChange: (r: AdminRange) => void}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-white/10 bg-ink-950/80 p-1">
        {RANGES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => onChange(id === 'custom' ? {range: 'custom', start: value.start ?? today, end: value.end ?? today} : {range: id})}
            className={`shrink-0 rounded-md px-2.5 py-1 text-[0.74rem] font-bold ${value.range === id ? 'bg-nova-500/25 text-white' : 'text-mist-400 hover:text-mist-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {value.range === 'custom' && (
        <div className="flex items-center gap-1.5">
          <TextInput type="date" max={today} value={value.start ?? ''} onChange={(e) => onChange({...value, start: e.target.value})} className="!h-8 w-[9.5rem] text-[0.78rem]" aria-label="From" />
          <span className="text-mist-500">→</span>
          <TextInput type="date" max={today} value={value.end ?? ''} onChange={(e) => onChange({...value, end: e.target.value})} className="!h-8 w-[9.5rem] text-[0.78rem]" aria-label="To" />
        </div>
      )}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [T | null, () => void] {
  const {toast} = useSession();
  const [data, setData] = useState<T | null>(null);
  const run = useCallback(() => {
    setData(null);
    fn().then(setData).catch((e) => {
      toast('error', 'Could not load', errText(e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return [data, run];
}

function Toggle({label, hint, value, onChange}: {label: string; hint: string; value: boolean; onChange: (v: boolean) => void}) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.06]" role="switch" aria-checked={value}>
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${value ? 'bg-mint-500' : 'bg-white/15'}`}>
        <span className={`size-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.84rem] font-bold text-mist-50">{label}</span>
        <span className="block text-[0.72rem] text-mist-500">{hint}</span>
      </span>
    </button>
  );
}

function Panel({title, icon, children, action}: {title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode}) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.8rem] font-extrabold text-mist-200">{icon}{title}</p>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Bars({rows, value, label}: {rows: {day: string}[]; value: (r: never) => number; label: (r: never) => string}) {
  const max = Math.max(1, ...rows.map((r) => value(r as never)));
  if (!rows.length) return <p className="py-6 text-center text-[0.8rem] text-mist-500">No requests in this period.</p>;
  return (
    <div className="flex h-28 items-end gap-1">
      {rows.map((r) => (
        <div key={r.day} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={label(r as never)}>
          <div className="brand-gradient w-full max-w-6 rounded-t" style={{height: `${Math.max(4, (value(r as never) / max) * 100)}%`}} />
        </div>
      ))}
    </div>
  );
}

function Row({left, right, sub}: {left: React.ReactNode; right: React.ReactNode; sub?: React.ReactNode}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[0.82rem] hover:bg-white/[0.04]">
      <span className="min-w-0">
        <span className="block truncate text-mist-100">{left}</span>
        {sub && <span className="block truncate text-[0.7rem] text-mist-500">{sub}</span>}
      </span>
      <span className="shrink-0 text-mist-400 tabular-nums">{right}</span>
    </div>
  );
}

/* ------------------------------------------------------------ overview */
function OverviewTab({range, providers, settings, onGo}: {range: AdminRange; providers: ProviderInfo[]; settings: TutorAdminSettings; onGo: (t: Tab) => void}) {
  const [ov] = useLoad(() => tutorAdminApi.overview(range), [range.range, range.start, range.end]);
  const [quality] = useLoad(() => tutorAdminApi.quality(range), [range.range, range.start, range.end]);
  const active = providers.find((p) => p.active);
  const t = ov?.totals;
  return (
    <div className="space-y-3">
      {active && !active.configured && (
        <Card className="border-flare-400/30 p-3 text-[0.8rem] text-mist-300">
          <p className="flex items-center gap-1.5 font-bold text-flare-200"><KeyRound className="size-4" /> No AI key on the server</p>
          Add <code className="rounded bg-white/10 px-1">{active.key_env}=…</code> to <code className="rounded bg-white/10 px-1">backend/.env</code> and restart the API. Keys stay on the server.
        </Card>
      )}
      {!t ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="REQUESTS" value={formatNumber(t.requests)} icon={<Activity className="size-5" />} hint={`${t.successful} ok · ${t.failed} failed`} />
          <StatTile label="ACTIVE STUDENTS" value={formatNumber(t.active_users)} icon={<Users className="size-5" />} tone="pulse" hint={`${t.conversations} new chats`} />
          <StatTile label="TOKENS" value={formatNumber(t.tokens)} icon={<Gauge className="size-5" />} tone="mint" hint={`${formatNumber(t.cached_tokens)} cached`} />
          <StatTile label="EST. COST" value={money(t.estimated_cost)} icon={<Coins className="size-5" />} tone="gold" hint={`${money(t.month_cost, 2)} this month`} />
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Status" icon={<PlugZap className="size-3.5" />}>
          <div className="space-y-1 text-[0.8rem]">
            <Row left="Tutor" right={settings.ai_enabled ? <span className="text-mint-300">On</span> : <span className="text-gold-300">Off</span>} />
            <Row left="Provider" right={active ? `${active.name} · ${active.model}` : '—'} />
            <Row left="Exam mode" right={EXAM_MODES[settings.ai_exam_mode]?.[0] ?? settings.ai_exam_mode} />
            <Row left="Daily limit" right={`${settings.ai_daily_limit} / student`} />
            <Row left="Monthly budget" right={settings.ai_monthly_budget_usd ? money(settings.ai_monthly_budget_usd, 2) : 'No cap'} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="soft" onClick={() => onGo('settings')}>Settings</Button>
            <Button size="sm" variant="ghost" onClick={() => onGo('models')}>Test connection</Button>
          </div>
        </Panel>
        <Panel title="Performance" icon={<Gauge className="size-3.5" />}>
          {!t ? <Skeleton className="h-24" /> : (
            <div className="space-y-1">
              <Row left="Average answer time" right={`${formatNumber(t.average_latency_ms)} ms`} />
              <Row left="Average answer length" right={`${formatNumber(t.average_response_chars)} chars`} />
              <Row left="Failure rate" right={pct(t.failure_rate)} />
              <Row left="Rate-limited" right={formatNumber(t.rate_limited)} />
              <Row left="Stopped by students" right={formatNumber(t.cancelled)} />
            </div>
          )}
        </Panel>
        <Panel title="Quality" icon={<ThumbsDown className="size-3.5" />} action={<button className="text-[0.72rem] font-bold text-nova-300" onClick={() => onGo('usage')}>Details</button>}>
          {!quality ? <Skeleton className="h-24" /> : (
            <div className="space-y-1">
              <Row left="👍 Helpful" right={quality.feedback.helpful} />
              <Row left="👎 Not helpful" right={`${quality.feedback.not_helpful} (${pct(quality.feedback.negative_rate)})`} />
              <Row left="Invalid AI JSON" right={`${quality.invalid_json} (${pct(quality.invalid_json_rate)})`} />
              <Row left="Most reported" right={quality.reported_topics[0]?.topic ?? '—'} />
            </div>
          )}
        </Panel>
      </div>
      {ov && (
        <Panel title={`Requests per day · ${ov.range.label}`}>
          <Bars rows={ov.daily} value={(d: TutorOverview['daily'][number]) => d.requests} label={(d: TutorOverview['daily'][number]) => `${d.day}: ${d.requests} requests · ${money(d.cost, 4)}`} />
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ settings */
function SettingsTab({settings, set}: {settings: TutorAdminSettings; set: (p: Partial<TutorAdminSettings>) => void}) {
  const {toast} = useSession();
  const [cleaning, setCleaning] = useState(false);
  return (
    <div className="space-y-3">
      <Panel title="General">
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle label="AI Tutor on" hint="Switch off to pause it for every student." value={settings.ai_enabled} onChange={(v) => set({ai_enabled: v})} />
          <Toggle label="Exam protection" hint="Apply the exam mode below whenever a student has an exam open." value={settings.ai_exam_safe} onChange={(v) => set({ai_exam_safe: v})} />
        </div>
      </Panel>
      <Panel title="During exams">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(EXAM_MODES).map(([id, [label, hint]]) => (
            <button key={id} disabled={!settings.ai_exam_safe} onClick={() => set({ai_exam_mode: id})} className={`rounded-xl border px-3 py-2.5 text-left disabled:opacity-40 ${settings.ai_exam_mode === id ? 'border-nova-400/70 bg-nova-500/15' : 'border-white/10 hover:bg-white/[0.05]'}`}>
              <span className="flex items-center gap-1.5 text-[0.84rem] font-bold text-mist-50">{settings.ai_exam_mode === id && <Check className="size-3.5 text-nova-300" />}{label}</span>
              <span className="block text-[0.72rem] text-mist-500">{hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[0.72rem] text-mist-500">The server decides the mode from the student's open attempt — the app can't override it. Official answers of live exam questions are never sent to the AI unless Full assistance is chosen.</p>
      </Panel>
      <Panel title="Data retention" action={
        <Button size="sm" variant="ghost" icon={<Eraser className="size-4" />} loading={cleaning} onClick={async () => {
          setCleaning(true);
          try {
            const r = await tutorAdminApi.cleanup();
            toast('success', 'Cleanup done', `${r.removed.conversations} chats · ${r.removed.events} log rows · ${r.removed.practice_sets} unsaved sets removed`);
          } catch (e) {
            toast('error', 'Cleanup failed', errText(e));
          } finally {
            setCleaning(false);
          }
        }}>Run cleanup now</Button>
      }>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="Deleted chats kept (days)" hint="Then removed for good."><TextInput type="number" min={1} value={settings.ai_retention_deleted_days} onChange={(e) => set({ai_retention_deleted_days: Number(e.target.value)})} /></Field>
          <Field label="Request logs kept (days)" hint="Usage totals stay."><TextInput type="number" min={7} value={settings.ai_retention_logs_days} onChange={(e) => set({ai_retention_logs_days: Number(e.target.value)})} /></Field>
          <Field label="Unsaved AI sets kept (days)" hint="Practice/plans never saved."><TextInput type="number" min={1} value={settings.ai_retention_unsaved_days} onChange={(e) => set({ai_retention_unsaved_days: Number(e.target.value)})} /></Field>
        </div>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- usage */
function UsageTab({range}: {range: AdminRange}) {
  const deps = [range.range, range.start, range.end];
  const [ov] = useLoad(() => tutorAdminApi.overview(range), deps);
  const [courses] = useLoad(() => tutorAdminApi.courses(range), deps);
  const [quality] = useLoad(() => tutorAdminApi.quality(range), deps);
  const t = ov?.totals;
  return (
    <div className="space-y-3">
      {!t ? <Skeleton className="h-24" /> : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="SUCCESSFUL" value={formatNumber(t.successful)} icon={<Check className="size-5" />} tone="mint" />
          <StatTile label="FAILED" value={formatNumber(t.failed)} icon={<AlertTriangle className="size-5" />} tone="flare" hint={pct(t.failure_rate)} />
          <StatTile label="INPUT / OUTPUT" value={`${formatNumber(t.input_tokens)} / ${formatNumber(t.output_tokens)}`} icon={<Gauge className="size-5" />} hint={`${formatNumber(t.cached_tokens)} cached input`} />
          <StatTile label="AVG TIME" value={`${formatNumber(t.average_latency_ms)} ms`} icon={<Activity className="size-5" />} tone="pulse" hint={`${formatNumber(t.average_response_chars)} chars avg`} />
        </div>
      )}
      {ov && <Panel title="Requests per day"><Bars rows={ov.daily} value={(d: TutorOverview['daily'][number]) => d.requests} label={(d: TutorOverview['daily'][number]) => `${d.day}: ${d.requests} requests · ${formatNumber(d.tokens)} tokens`} /></Panel>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="By feature">
          {!ov ? <Skeleton className="h-24" /> : ov.by_feature.length ? ov.by_feature.map((f) => <Row key={f.kind} left={f.kind.replace(/_/g, ' ').toLowerCase()} right={`${f.requests} · ${money(f.cost)}`} />) : <p className="text-[0.8rem] text-mist-500">Nothing yet.</p>}
        </Panel>
        <Panel title="By course">
          {!courses ? <Skeleton className="h-24" /> : (
            <>
              {courses.courses.map((c) => <Row key={c.id} left={`${c.code} — ${c.title}`} sub={c.top_topics.length ? `Top: ${c.top_topics.map((x) => x.topic).join(', ')}` : undefined} right={`${c.requests} · ${c.students} students`} />)}
              <Row left={<span className="text-mist-400">No course selected</span>} right={courses.general_requests} />
            </>
          )}
        </Panel>
      </div>
      <QualityPanel quality={quality} />
    </div>
  );
}

function QualityPanel({quality}: {quality: TutorQuality | null}) {
  return (
    <Panel title="Answer quality" icon={<ThumbsDown className="size-3.5" />}>
      {!quality ? <Skeleton className="h-24" /> : (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-1">
            <Row left="Negative feedback rate" right={pct(quality.feedback.negative_rate)} />
            <Row left="Failed requests" right={`${quality.failed_requests} (${pct(quality.failure_rate)})`} />
            <Row left="Invalid JSON from AI" right={`${quality.invalid_json} (${pct(quality.invalid_json_rate)})`} />
          </div>
          <div>
            <p className="mb-1 text-[0.7rem] font-extrabold tracking-wide text-mist-500 uppercase">Reasons given</p>
            {quality.reasons.length ? quality.reasons.map((r) => <Row key={r.reason} left={r.reason.replace(/_/g, ' ')} right={r.count} />) : <p className="text-[0.78rem] text-mist-500">No 👎 yet.</p>}
          </div>
          <div>
            <p className="mb-1 text-[0.7rem] font-extrabold tracking-wide text-mist-500 uppercase">Most reported topics</p>
            {quality.reported_topics.length ? quality.reported_topics.map((r) => <Row key={r.topic} left={r.topic} right={r.count} />) : <p className="text-[0.78rem] text-mist-500">None.</p>}
          </div>
          {quality.recent_negative.length > 0 && (
            <div className="lg:col-span-3">
              <p className="mb-1 text-[0.7rem] font-extrabold tracking-wide text-mist-500 uppercase">Recent comments</p>
              <div className="space-y-1">
                {quality.recent_negative.filter((n) => n.comment).slice(0, 8).map((n, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[0.76rem]">
                    <span className="text-mist-500">{formatRelative(n.at)} · {n.reason.replace(/_/g, ' ')}{n.topic ? ` · ${n.topic}` : ''}</span>
                    <p className="text-mist-200">{n.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- costs */
function CostsTab({range, settings, set}: {range: AdminRange; settings: TutorAdminSettings; set: (p: Partial<TutorAdminSettings>) => void}) {
  const [ov] = useLoad(() => tutorAdminApi.overview(range), [range.range, range.start, range.end]);
  const t = ov?.totals;
  const budget = settings.ai_monthly_budget_usd;
  const used = t ? Math.min(100, budget ? (t.month_cost / budget) * 100 : 0) : 0;
  return (
    <div className="space-y-3">
      {!t ? <Skeleton className="h-24" /> : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label={`COST · ${ov!.range.label.toUpperCase()}`} value={money(t.estimated_cost)} icon={<Coins className="size-5" />} tone="gold" />
          <StatTile label="THIS MONTH" value={money(t.month_cost, 2)} icon={<Coins className="size-5" />} tone="gold" hint={budget ? `of ${money(budget, 2)} budget` : 'No budget cap'} />
          <StatTile label="PER REQUEST" value={money(t.requests ? t.estimated_cost / t.requests : 0, 5)} icon={<Activity className="size-5" />} />
          <StatTile label="PER STUDENT" value={money(t.active_users ? t.estimated_cost / t.active_users : 0, 4)} icon={<Users className="size-5" />} tone="pulse" />
        </div>
      )}
      <Panel title="Monthly budget">
        <div className="grid items-end gap-3 sm:grid-cols-[14rem_1fr]">
          <Field label="Stop AI requests above (USD / month)" hint="0 = no cap. Students see a friendly 'temporarily unavailable'.">
            <TextInput type="number" min={0} step="0.5" value={budget} onChange={(e) => set({ai_monthly_budget_usd: Number(e.target.value)})} />
          </Field>
          {budget > 0 && t && (
            <div>
              <div className="mb-1 flex justify-between text-[0.74rem] text-mist-400"><span>{money(t.month_cost, 2)} used</span><span>{Math.round(used)}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className={`h-full ${used >= 90 ? 'bg-flare-400' : used >= 70 ? 'bg-gold-400' : 'bg-mint-400'}`} style={{width: `${used}%`}} /></div>
            </div>
          )}
        </div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="By model (list prices per 1M tokens)">
          {!ov ? <Skeleton className="h-20" /> : ov.by_model.length ? ov.by_model.map((m) => (
            <Row key={`${m.provider}-${m.model}`} left={`${m.provider} · ${m.model}`} sub={`in $${m.pricing.input} · cached $${m.pricing.cached} · out $${m.pricing.output} — ${formatNumber(m.input_tokens)} in / ${formatNumber(m.output_tokens)} out`} right={`${m.requests} · ${money(m.cost)}`} />
          )) : <p className="text-[0.8rem] text-mist-500">No paid requests yet.</p>}
        </Panel>
        <Panel title="Top students by cost">
          {!ov ? <Skeleton className="h-20" /> : ov.top_students.length ? ov.top_students.map((s) => <Row key={s.id} left={s.name} sub={`@${s.username}`} right={`${s.requests} · ${money(s.cost)}`} />) : <p className="text-[0.8rem] text-mist-500">Nobody yet.</p>}
        </Panel>
      </div>
      {ov && <Panel title="Cost per day"><Bars rows={ov.daily} value={(d: TutorOverview['daily'][number]) => d.cost} label={(d: TutorOverview['daily'][number]) => `${d.day}: ${money(d.cost, 4)}`} /></Panel>}
    </div>
  );
}

/* --------------------------------------------------------------- users */
function UsersTab({range}: {range: AdminRange}) {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const [data, reload] = useLoad(() => tutorAdminApi.users(range, q), [range.range, range.start, range.end, q]);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2.5">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 focus-within:border-nova-400/60">
        <Search className="size-4 text-mist-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, username or phone" className="min-w-0 flex-1 bg-transparent text-[0.82rem] text-mist-100 placeholder:text-mist-600 focus:outline-none" aria-label="Search students" />
      </label>
      <Card className="p-1.5 sm:p-2">
        {!data ? <Skeleton className="h-40" /> : data.users.length ? (
          <div className="divide-y divide-white/6">
            {data.users.map((u) => (
              <button key={u.id} onClick={() => setOpen(u.id)} className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-white/[0.04]">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[0.84rem] font-bold text-mist-50">
                    {u.name}
                    {u.ai_disabled && <Chip className="border-flare-400/40 text-flare-200">AI off</Chip>}
                    {u.custom_quota && <Chip>custom quota</Chip>}
                  </span>
                  <span className="block truncate text-[0.7rem] text-mist-500">@{u.username} · today {u.today}/{u.daily_limit || '∞'} · month {u.month}{u.last_used ? ` · last ${formatRelative(u.last_used)}` : ''}</span>
                </span>
                <span className="shrink-0 text-right text-[0.76rem] text-mist-400 tabular-nums">
                  {u.requests ?? 0} req<br />{money(u.cost ?? 0)}
                </span>
                <ChevronRight className="size-4 shrink-0 text-mist-600" />
              </button>
            ))}
          </div>
        ) : <p className="py-8 text-center text-[0.8rem] text-mist-500">{q ? 'No students match.' : 'No students have used the tutor in this period.'}</p>}
      </Card>
      <UserModal id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}

function UserModal({id, onClose, onChanged}: {id: number | null; onClose: () => void; onChanged: () => void}) {
  const {toast} = useSession();
  const [user, setUser] = useState<TutorAdminUserDetail | null>(null);
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setUser(null);
    if (id) tutorAdminApi.user(id).then((u) => {
      setUser(u);
      setDaily(u.custom_quota ? String(u.daily_limit) : '');
      setMonthly(u.custom_quota ? String(u.monthly_limit) : '');
      setNote(u.note ?? '');
    }).catch((e) => toast('error', 'Could not load student', errText(e)));
  }, [id, toast]);
  const act = async (what: string, fn: () => Promise<TutorAdminUser>, msg: string) => {
    setBusy(what);
    try {
      const next = await fn();
      setUser((u) => (u ? {...u, ...next} : u));
      toast('success', msg);
      onChanged();
    } catch (e) {
      toast('error', 'Not saved', errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={!!id} onClose={onClose} title={user ? user.name : 'Student'} subtitle={user ? `@${user.username} · private chat text is never shown here` : undefined}>
      {!user ? <Skeleton className="h-48" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Today', `${user.today}/${user.daily_limit || '∞'}`], ['This month', `${user.month}/${user.monthly_limit || '∞'}`], ['Chats', user.conversations.length]].map(([l, v]) => (
              <div key={String(l)} className="rounded-lg bg-white/[0.04] px-2 py-2">
                <p className="text-[0.64rem] font-bold tracking-wide text-mist-500 uppercase">{l}</p>
                <p className="text-[0.95rem] font-extrabold text-mist-50 tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={user.ai_disabled ? 'mint' : 'outline'} icon={<Ban className="size-4" />} loading={busy === 'toggle'} onClick={() => act('toggle', () => tutorAdminApi.userSettings(user.id, {disabled: !user.ai_disabled}), user.ai_disabled ? 'AI Tutor enabled for this student' : 'AI Tutor disabled for this student')}>
              {user.ai_disabled ? 'Enable AI' : 'Disable AI'}
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} loading={busy === 'reset'} onClick={() => act('reset', () => tutorAdminApi.resetQuota(user.id), "Today's quota reset")}>Reset today's quota</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Custom daily limit" hint="Empty = use the global limit. 0 = unlimited."><TextInput type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="Global" /></Field>
            <Field label="Custom monthly limit" hint="Empty = global."><TextInput type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="Global" /></Field>
          </div>
          <Field label="Staff note (optional)"><TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. premium — tutorial group lead" /></Field>
          <div className="flex justify-end">
            <Button size="sm" icon={<Save className="size-4" />} loading={busy === 'quota'} onClick={() => act('quota', () => tutorAdminApi.userSettings(user.id, {daily_limit: daily === '' ? null : Number(daily), monthly_limit: monthly === '' ? null : Number(monthly), note}), 'Quota saved')}>Save quota</Button>
          </div>
          <div>
            <p className="mb-1 text-[0.7rem] font-extrabold tracking-wide text-mist-500 uppercase">Usage by feature</p>
            <div className="flex flex-wrap gap-1">{user.by_feature.length ? user.by_feature.map((f) => <Chip key={f.kind}>{f.kind.toLowerCase().replace(/_/g, ' ')} · {f.requests}</Chip>) : <span className="text-[0.78rem] text-mist-500">No requests.</span>}</div>
          </div>
          <div>
            <p className="mb-1 text-[0.7rem] font-extrabold tracking-wide text-mist-500 uppercase">Conversations (titles only)</p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {user.conversations.length ? user.conversations.map((c) => (
                <Row key={c.id} left={c.title} sub={`${c.context_type}${c.archived ? ' · archived' : ''}${c.deleted ? ' · deleted' : ''}`} right={`${c.messages} msg · ${formatRelative(c.last_message_at)}`} />
              )) : <p className="text-[0.78rem] text-mist-500">No chats.</p>}
            </div>
          </div>
          <p className="text-[0.72rem] text-mist-500">Saved resources: {user.saved.notes} notes · {user.saved.material} materials · {user.saved.flashcards} decks · {user.saved.practice} practice sets · {user.saved.plan} plans</p>
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------- conversations */
function ConversationsTab() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const [data] = useLoad(() => tutorAdminApi.conversations(q), [q]);
  return (
    <div className="space-y-2.5">
      <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-[0.76rem] text-mist-400">For privacy, staff see chat titles, counts and dates only — never what students wrote.</p>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 focus-within:border-nova-400/60">
        <Search className="size-4 text-mist-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or student" className="min-w-0 flex-1 bg-transparent text-[0.82rem] text-mist-100 placeholder:text-mist-600 focus:outline-none" aria-label="Search conversations" />
      </label>
      <Card className="p-1.5 sm:p-2">
        {!data ? <Skeleton className="h-40" /> : data.conversations.length ? (
          <div className="divide-y divide-white/6">
            {data.conversations.map((c) => (
              <Row key={c.id} left={c.title} sub={`${c.student.name} (@${c.student.username}) · ${c.context_type}${c.archived ? ' · archived' : ''}${c.deleted ? ' · deleted' : ''}`} right={`${c.messages} msg · ${formatRelative(c.last_message_at)}`} />
            ))}
          </div>
        ) : <p className="py-8 text-center text-[0.8rem] text-mist-500">No conversations.</p>}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- models */
function ModelsTab({providers, settings, set, onProviders}: {providers: ProviderInfo[]; settings: TutorAdminSettings; set: (p: Partial<TutorAdminSettings>) => void; onProviders: (p: ProviderInfo[]) => void}) {
  const {toast} = useSession();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const chosen = providers.find((p) => p.id === settings.ai_provider);
  const suggestions = (id: string) => (id === 'gemini' ? ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-pro'] : ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat']);
  return (
    <div className="space-y-3">
      <Panel title="Provider">
        <div className="grid gap-1.5 sm:grid-cols-3">
          <button onClick={() => set({ai_provider: '', ai_model: ''})} className={`rounded-xl border px-3 py-2.5 text-left ${!settings.ai_provider ? 'border-nova-400/70 bg-nova-500/15' : 'border-white/10 hover:bg-white/[0.05]'}`}>
            <span className="block text-[0.84rem] font-bold text-mist-50">Automatic</span>
            <span className="block text-[0.72rem] text-mist-500">Uses AI_PROVIDER / whichever key is set.</span>
          </button>
          {providers.map((p) => (
            <button key={p.id} onClick={() => set({ai_provider: p.id, ai_model: ''})} className={`rounded-xl border px-3 py-2.5 text-left ${settings.ai_provider === p.id ? 'border-nova-400/70 bg-nova-500/15' : 'border-white/10 hover:bg-white/[0.05]'}`}>
              <span className="flex items-center gap-1.5 text-[0.84rem] font-bold text-mist-50">{p.name}{p.active && <Chip className="border-mint-400/40 text-mint-200">in use</Chip>}</span>
              <span className={`block text-[0.72rem] ${p.configured ? 'text-mint-300' : 'text-flare-300'}`}>{p.configured ? 'Key set' : 'No key yet — add one below'}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="API keys" icon={<KeyRound className="size-3.5" />}>
        <div className="space-y-2">
          {providers.map((p) => <KeyRow key={p.id} provider={p} onProviders={onProviders} />)}
          <p className="text-[0.72rem] leading-relaxed text-mist-500">
            A new key is checked with a one-word test first and used from the next AI request — no restart. A key the provider refuses is not saved, so the old one keeps working.
            Keys are stored only on the server and are never shown again in full.
          </p>
        </div>
      </Panel>
      <Panel title="Model">
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
          <Field label="Model name" hint={`Empty = default (${(chosen ?? providers.find((p) => p.active))?.default_model ?? '—'}). Fallbacks: ${(chosen ?? providers.find((p) => p.active))?.fallbacks.join(', ') || 'none'}.`}>
            <TextInput list="tutor-models" value={settings.ai_model} onChange={(e) => set({ai_model: e.target.value.trim()})} placeholder="Default" maxLength={80} />
            <datalist id="tutor-models">{suggestions(settings.ai_provider || providers.find((p) => p.active)?.id || 'deepseek').map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Button size="sm" variant="soft" icon={<PlugZap className="size-4" />} loading={testing} onClick={async () => {
            setTesting(true);
            setResult(null);
            try {
              const r = await tutorAdminApi.test();
              setResult(r.ok ? `✅ ${r.provider} · ${r.model} answered "${r.reply}" in ${r.latency_ms} ms` : `❌ ${r.error}`);
            } catch (e) {
              setResult(`❌ ${errText(e)}`);
              toast('error', 'Test failed', errText(e));
            } finally {
              setTesting(false);
            }
          }}>Test saved setup</Button>
        </div>
        {result && <p className="mt-2 rounded-lg bg-white/[0.04] px-3 py-2 text-[0.78rem] text-mist-200">{result}</p>}
      </Panel>
      <Panel title="Pricing (AI_PRICING_CONFIG · USD per 1M tokens)">
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id}>
              <p className="text-[0.74rem] font-extrabold text-mist-400">{p.name}</p>
              {Object.entries(p.pricing).map(([model, price]) => <Row key={model} left={model} right={`in $${price.input} · cached $${price.cached} · out $${price.output}`} />)}
            </div>
          ))}
          <p className="text-[0.72rem] text-mist-500">Change prices in <code className="rounded bg-white/10 px-1">backend/app/services/ai_providers.py</code> or with AI_PRICE_INPUT / AI_PRICE_CACHED / AI_PRICE_OUTPUT.</p>
        </div>
      </Panel>
    </div>
  );
}

/** One provider's key: status, paste a new key (Save & test), or remove the saved one. */
function KeyRow({provider: p, onProviders}: {provider: ProviderInfo; onProviders: (p: ProviderInfo[]) => void}) {
  const {toast} = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [result, setResult] = useState<{ok: boolean; message: string} | null>(null);
  const where = p.key_source === 'admin' ? 'Saved here' : p.key_source === 'env' ? "From the server's .env" : 'No key';
  const help = p.id === 'gemini' ? 'Free key: aistudio.google.com → Get API key' : 'Key: platform.deepseek.com → API keys (add a small balance)';

  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      const r = await tutorAdminApi.saveKey(p.id, value);
      onProviders(r.providers);
      setResult(r.key_result ?? {ok: true, message: 'Key saved.'});
      toast(r.key_result?.ok === false ? 'info' : 'success', r.key_result?.ok === false ? 'Key saved — check the note' : `${p.name} key saved`);
      setValue('');
      setOpen(false);
    } catch (e) {
      setResult({ok: false, message: errText(e)});
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('remove');
    setResult(null);
    try {
      const r = await tutorAdminApi.removeKey(p.id);
      onProviders(r.providers);
      setResult(r.key_result ?? {ok: true, message: 'Removed.'});
    } catch (e) {
      setResult({ok: false, message: errText(e)});
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[0.84rem] font-bold text-mist-50">{p.name}</span>
        {p.active && <Chip className="border-mint-400/40 text-mint-200">in use</Chip>}
        <span className={`text-[0.72rem] ${p.configured ? 'text-mint-300' : 'text-flare-300'}`}>
          {where}
          {p.key_hint ? <code className="ml-1 rounded bg-white/10 px-1 text-mist-200">{p.key_hint}</code> : null}
        </span>
        <span className="ml-auto flex gap-1.5">
          {p.key_source === 'admin' && (
            <Button size="sm" variant="ghost" label="Remove saved key" loading={busy === 'remove'} onClick={remove} icon={<Trash2 className="size-4 text-flare-300" />} />
          )}
          <Button size="sm" variant="soft" icon={<KeyRound className="size-4" />} onClick={() => { setOpen((o) => !o); setResult(null); }}>
            {p.configured ? 'Change key' : 'Add key'}
          </Button>
        </span>
      </div>
      {p.key_source === 'admin' && p.key_updated_at && (
        <p className="mt-0.5 text-[0.68rem] text-mist-500">
          Updated {formatRelative(p.key_updated_at)}{p.key_updated_by ? ` by ${p.key_updated_by}` : ''}{p.env_key_present ? ' · overrides the .env key' : ''}
        </p>
      )}
      {open && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void save();
          }}
        >
          <Field label={`New ${p.name} key`} hint={help}>
            <div className="flex gap-1.5">
              <TextInput
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={p.id === 'gemini' ? 'AQ.Ab… or AIza…' : 'sk-…'}
                autoComplete="off"
                spellCheck={false}
                maxLength={400}
                autoFocus
              />
              <Button type="button" size="md" variant="outline" label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((s) => !s)} icon={show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} />
            </div>
          </Field>
          <div className="flex items-end gap-1.5">
            <Button type="submit" size="sm" icon={<Save className="size-4" />} loading={busy === 'save'} disabled={!value.trim()}>Save &amp; test</Button>
            <Button type="button" size="sm" variant="ghost" label="Cancel" onClick={() => { setOpen(false); setValue(''); }} icon={<X className="size-4" />} />
          </div>
        </form>
      )}
      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[0.76rem] ${result.ok ? 'bg-mint-500/10 text-mint-200' : 'bg-flare-500/10 text-flare-200'}`}>
          {result.ok ? '✅ ' : '⚠️ '}
          {result.message}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- limits */
function LimitsTab({settings, set}: {settings: TutorAdminSettings; set: (p: Partial<TutorAdminSettings>) => void}) {
  return (
    <Panel title="Limits" icon={<SlidersHorizontal className="size-3.5" />}>
      <div className="grid gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {LIMITS.map(({key, label, hint}) => (
          <Field key={key} label={label} hint={hint}>
            <TextInput type="number" min={0} value={settings[key] as number} onChange={(e) => set({[key]: Number(e.target.value)} as Partial<TutorAdminSettings>)} />
          </Field>
        ))}
      </div>
      <p className="mt-2 text-[0.72rem] text-mist-500">Staff accounts are not limited. Give individual students a higher or lower quota in Users. The monthly spending cap is under Costs.</p>
    </Panel>
  );
}

/* ----------------------------------------------------------------- logs */
function LogsTab({range}: {range: AdminRange}) {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, kind, range.range, range.start, range.end]);
  const [data, reload] = useLoad(() => tutorAdminApi.logs(range, {status, kind, page}), [range.range, range.start, range.end, status, kind, page]);
  const [open, setOpen] = useState<TutorLog | null>(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <ListFilter className="size-4 text-mist-500" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!h-8 w-auto text-[0.78rem]" aria-label="Status">
          <option value="">All statuses</option>
          {['ok', 'error', 'rate_limited', 'invalid_json', 'cancelled', 'refused'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!h-8 w-auto text-[0.78rem]" aria-label="Feature">
          <option value="">All features</option>
          {['CHAT', 'QUESTION_HELP', 'WHY_WRONG', 'EXPLAIN', 'HINT', 'SUMMARY', 'FLASHCARDS', 'PRACTICE', 'MATERIAL', 'PLAN', 'IMAGE_EXPLANATION', 'TITLE', 'SUMMARY_MEMORY'].map((k) => <option key={k} value={k}>{k.toLowerCase().replace(/_/g, ' ')}</option>)}
        </Select>
        <button className="grid size-8 place-items-center rounded-lg border border-white/10 text-mist-300 hover:bg-white/[0.06]" aria-label="Refresh" onClick={reload}><RefreshCw className="size-3.5" /></button>
        {data && <span className="ml-auto text-[0.74rem] text-mist-500">{formatNumber(data.total)} requests</span>}
      </div>
      <Card className="p-1.5 sm:p-2">
        {!data ? <Skeleton className="h-48" /> : data.logs.length ? (
          <div className="divide-y divide-white/6">
            {data.logs.map((l) => (
              <button key={l.id} onClick={() => setOpen(l)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.04]">
                <span className={`size-2 shrink-0 rounded-full ${l.status === 'ok' ? 'bg-mint-400' : l.status === 'cancelled' ? 'bg-mist-500' : l.status === 'rate_limited' ? 'bg-gold-400' : 'bg-flare-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8rem] text-mist-100">{l.kind.toLowerCase().replace(/_/g, ' ')} · {l.user.name}</span>
                  <span className="block truncate text-[0.68rem] text-mist-500">{formatRelative(l.at)} · {l.model || l.provider} · {l.latency_ms} ms{l.error ? ` · ${l.error}` : ''}</span>
                </span>
                <span className="shrink-0 text-[0.72rem] text-mist-400 tabular-nums">{formatNumber(l.input_tokens + l.output_tokens)} tok · {money(l.cost, 4)}</span>
              </button>
            ))}
          </div>
        ) : <p className="py-8 text-center text-[0.8rem] text-mist-500">No requests match.</p>}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="grid size-8 place-items-center rounded-lg border border-white/10 text-mist-300 disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="size-4" /></button>
          <span className="text-[0.76rem] text-mist-400">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="grid size-8 place-items-center rounded-lg border border-white/10 text-mist-300 disabled:opacity-30" aria-label="Next page"><ChevronRight className="size-4" /></button>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Request details" subtitle="Prompts and answers are never logged." size="sm">
        {open && (
          <div className="space-y-0.5">
            {([
              ['Time', new Date(open.at).toLocaleString()], ['Request ID', open.request_id], ['Student', `${open.user.name} (#${open.user.id})`], ['Feature', open.kind],
              ['Provider / model', `${open.provider} · ${open.model}`], ['Status', open.status], ['Tokens', `${open.input_tokens} in (${open.cached_tokens} cached) · ${open.output_tokens} out`],
              ['Cost', money(open.cost, 5)], ['Latency', `${open.latency_ms} ms`], ['Course', open.course_id ?? '—'],
            ] as [string, React.ReactNode][]).map(([k, v]) => <Row key={k} left={k} right={<span className="break-all">{v}</span>} />)}
            {open.error && <p className="mt-2 rounded-lg bg-flare-500/10 px-3 py-2 text-[0.76rem] break-words text-flare-100">{open.error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- features */
function FeaturesTab({settings, set}: {settings: TutorAdminSettings; set: (p: Partial<TutorAdminSettings>) => void}) {
  return (
    <Panel title="Features students can use">
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURES.map(({key, label, hint}) => (
          <Toggle key={key} label={label} hint={hint} value={Boolean(settings[key])} onChange={(v) => set({[key]: v} as Partial<TutorAdminSettings>)} />
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[0.72rem] text-mist-500"><X className="size-3" /> Switched-off tools disappear from the student app and are refused by the server.</p>
    </Panel>
  );
}
