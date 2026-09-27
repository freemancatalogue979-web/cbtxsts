/** Staff: AI Tutor limits and usage. Limits are enforced by the API; the
 * player screen only displays them. */
import {Activity, AlertTriangle, Bot, Coins, Gauge, RefreshCw, Save, Users} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, Field, SectionHeading, Segmented, Skeleton, StatTile, TextInput} from '../components/ui';
import {formatNumber, formatRelative} from '../lib/format';
import {tutorAdminApi, type TutorAdminSettings, type TutorAdminUsage} from '../lib/tutor';
import {useSession} from '../store/session';

const NUMBERS: {key: keyof TutorAdminSettings; label: string; hint: string}[] = [
  {key: 'ai_daily_limit', label: 'Requests per day', hint: 'Per student. Resets at midnight UTC.'},
  {key: 'ai_monthly_limit', label: 'Requests per month', hint: 'Per student.'},
  {key: 'ai_per_minute', label: 'Requests per minute', hint: 'Stops spamming.'},
  {key: 'ai_max_concurrent', label: 'Answers at once', hint: 'Per student.'},
  {key: 'ai_max_message_chars', label: 'Max message length', hint: 'Characters.'},
  {key: 'ai_max_response_tokens', label: 'Max answer length', hint: 'Tokens (~0.75 words each).'},
  {key: 'ai_max_conversations', label: 'Chats per student', hint: 'Oldest must be deleted beyond this.'},
];

export default function TutorAdmin() {
  const {toast} = useSession();
  const [settings, setSettings] = useState<TutorAdminSettings | null>(null);
  const [provider, setProvider] = useState<{configured: boolean; model: string} | null>(null);
  const [usage, setUsage] = useState<TutorAdminUsage | null>(null);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    tutorAdminApi.settings().then((r) => { setSettings(r.settings); setProvider(r.provider); }).catch((e: Error) => toast('error', 'Could not load tutor settings', e.message));
  }, [toast]);
  useEffect(load, [load]);
  useEffect(() => {
    setUsage(null);
    tutorAdminApi.usage(Number(days)).then(setUsage).catch((e: Error) => toast('error', 'Could not load usage', e.message));
  }, [days, toast]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await tutorAdminApi.update(settings);
      setSettings(r.settings);
      toast('success', 'AI Tutor settings saved');
    } catch (error) {
      toast('error', 'Not saved', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const maxDay = Math.max(1, ...(usage?.daily.map((d) => d.requests) ?? [1]));

  return (
    <div className="space-y-4">
      <SectionHeading title="AI Tutor" subtitle="DeepSeek-powered tutor for players — limits and spend." icon={<Bot className="size-4" />} />

      <Card className="p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className={provider?.configured ? 'border-mint-400/40 bg-mint-500/12 text-mint-200' : 'border-flare-400/40 bg-flare-500/12 text-flare-200'}>
            {provider ? (provider.configured ? 'AI key connected' : 'No AI key') : '…'}
          </Chip>
          {provider && <Chip>Model: {provider.model}</Chip>}
        </div>
        {provider && !provider.configured && (
          <p className="mt-2 text-[0.8rem] text-mist-400">Add <code className="rounded bg-white/10 px-1">DEEPSEEK_API_KEY=sk-…</code> to <code className="rounded bg-white/10 px-1">backend/.env</code> and restart the API. The key stays on the server.</p>
        )}
      </Card>

      <Card className="p-3.5 sm:p-4">
        {!settings ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-3.5">
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle label="AI Tutor on" hint="Switch off to pause it for everyone." value={settings.ai_enabled} onChange={(v) => setSettings({...settings, ai_enabled: v})} />
              <Toggle label="Exam-safe mode" hint="Pauses the tutor during a player's exam and hides live exam answers." value={settings.ai_exam_safe} onChange={(v) => setSettings({...settings, ai_exam_safe: v})} />
            </div>
            <div className="grid gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-4">
              {NUMBERS.map(({key, label, hint}) => (
                <Field key={key} label={label} hint={hint}>
                  <TextInput type="number" min={0} value={settings[key] as number} onChange={(e) => setSettings({...settings, [key]: Number(e.target.value)})} />
                </Field>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" icon={<Save className="size-4" />} loading={saving} onClick={save}>Save limits</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.85rem] font-extrabold text-mist-100">Usage</p>
        <div className="flex items-center gap-2">
          <Segmented<'7' | '30' | '90'> value={days} onChange={setDays} options={[{value: '7', label: '7 days'}, {value: '30', label: '30 days'}, {value: '90', label: '90 days'}]} />
          <button className="grid size-9 place-items-center rounded-lg border border-white/10 text-mist-300 hover:bg-white/[0.06]" aria-label="Refresh" onClick={() => { setUsage(null); tutorAdminApi.usage(Number(days)).then(setUsage).catch(() => undefined); }}>
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>
      {!usage ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label="REQUESTS" value={formatNumber(usage.totals.requests)} icon={<Activity className="size-5" />} hint={`${usage.totals.failed} failed · ${usage.totals.rate_limited} limited`} />
            <StatTile label="STUDENTS" value={formatNumber(usage.totals.students)} icon={<Users className="size-5" />} tone="pulse" />
            <StatTile label="TOKENS" value={formatNumber(usage.totals.tokens)} icon={<Gauge className="size-5" />} tone="mint" hint={`${usage.totals.average_latency_ms} ms avg`} />
            <StatTile label="EST. COST" value={`$${usage.totals.estimated_cost.toFixed(3)}`} icon={<Coins className="size-5" />} tone="gold" hint="At DeepSeek list prices" />
          </div>
          <Card className="p-3.5 sm:p-4">
            <p className="mb-2 text-[0.78rem] font-extrabold text-mist-300">Requests per day</p>
            {usage.daily.length ? (
              <div className="flex h-28 items-end gap-1">
                {usage.daily.map((d) => (
                  <div key={d.day} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.requests} requests · $${d.cost.toFixed(4)}`}>
                    <div className="brand-gradient w-full max-w-6 rounded-t" style={{height: `${Math.max(4, (d.requests / maxDay) * 100)}%`}} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-[0.8rem] text-mist-500">No tutor requests in this period yet.</p>
            )}
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-3.5 sm:p-4">
              <p className="mb-2 text-[0.78rem] font-extrabold text-mist-300">Top students</p>
              {usage.top_students.length ? (
                <div className="space-y-1">
                  {usage.top_students.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[0.82rem] hover:bg-white/[0.04]">
                      <span className="min-w-0 truncate text-mist-100">{s.name}</span>
                      <span className="shrink-0 text-mist-400 tabular-nums">{s.requests} · ${s.cost.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[0.8rem] text-mist-500">Nobody yet.</p>}
            </Card>
            <Card className="p-3.5 sm:p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[0.78rem] font-extrabold text-mist-300"><AlertTriangle className="size-3.5" /> Recent errors</p>
              {usage.recent_errors.length ? (
                <div className="space-y-1">
                  {usage.recent_errors.map((e, i) => (
                    <div key={i} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[0.76rem]">
                      <span className="text-mist-500">{formatRelative(e.at)} · {e.kind}</span>
                      <p className="text-mist-200">{e.error}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[0.8rem] text-mist-500">No errors. 🎉</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
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
