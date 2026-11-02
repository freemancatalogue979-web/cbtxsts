import { Database, Gamepad2, Loader2, LockKeyhole, RotateCcw, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AIContext, AISettings } from "../lib/cloverAI";
import { ErrorNote } from "./ui";
import { AIMemoryNotes } from "./AIMemoryNotes";

function Toggle({ label, description, checked, disabled, onChange }: {
  label: string; description: string; checked: boolean; disabled: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-edge/70 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold text-text">{label}</div>
        <p className="text-[11px] leading-relaxed text-mute mt-1">{description}</p>
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}
        className={`relative w-9 h-5 mt-0.5 rounded-full transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-crim disabled:opacity-50 ${checked ? "bg-leaf" : "bg-edge-2"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export function AIDataControls({ settings, context, onChange, onClearMatches }: {
  settings: AISettings; context: AIContext | null; onChange: (value: AISettings) => void; onClearMatches: () => void;
}) {
  const [goal, setGoal] = useState(settings.coaching_goal);
  const [busy, setBusy] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesRevision, setNotesRevision] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => setGoal(settings.coaching_goal), [settings.coaching_goal]);

  async function save(patch: Partial<AISettings>) {
    setBusy(true); setError(null); setNotice("");
    try {
      const updated = await api.patch<AISettings>("/ai/settings", patch);
      onChange(updated);
      setNotice("Your AI controls are saved.");
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!window.confirm("Delete all your coaching notes and coaching goal, turn off automatic profile, pool, scrim and chat-history context, and remove attached matches from this open chat? This affects future requests; anything already sent cannot be recalled. Your profile and saved conversations will stay.")) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const updated = await api.del<AISettings>("/ai/settings/memory");
      onChange(updated); onClearMatches(); setGoal(""); setNotesRevision((value) => value + 1); setNotice("Coaching notes, automatic context and this chat’s match selection are cleared for future requests. Saved chats remain until you delete them.");
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  const poolCount = context?.pool.length ?? 0;
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-leaf/20 bg-leaf/5 p-4 flex gap-3">
        <ShieldCheck size={19} className="text-leaf shrink-0 mt-0.5" />
        <div>
          <div className="text-[13px] font-extrabold">Your data, your call.</div>
          <p className="text-[11px] text-mute leading-relaxed mt-1">Automatic profile, pool and scrim context are off by default; recent chat history is on by default. Individually enabled notes can also be included in a DeepSeek request. Your current question is sent when the provider is used.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-edge bg-raised/60 p-3 min-w-0">
          <Gamepad2 size={15} className="text-crim mb-2" /><div className="label">Linked MLBB</div>
          <div className="text-[12px] font-bold mt-1 truncate">{context?.linked_account?.name || (context?.linked_account ? "Account linked" : "Not linked")}</div>
          <div className="text-[10px] text-faint mt-1">Cached snapshot, not live rank</div>
        </div>
        <div className="rounded-lg border border-edge bg-raised/60 p-3">
          <Database size={15} className="text-leaf mb-2" /><div className="label">Your pool</div>
          <div className="text-[12px] font-bold mt-1">{poolCount}{context?.pool_truncated ? "+" : ""} recorded entries</div>
          <div className="text-[10px] text-faint mt-1">Manually recorded, not match history</div>
        </div>
        <div className="rounded-lg border border-edge bg-raised/60 p-3">
          <UsersRound size={15} className="text-sky mb-2" /><div className="label">Scrim assignments</div>
          <div className="text-[12px] font-bold mt-1">{context?.scrims.length ?? 0} in recent sample</div>
          <div className="text-[10px] text-faint mt-1">Assignment doesn’t prove play</div>
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-panel px-4">
        <Toggle label="Profile & linked account" checked={settings.share_profile} disabled={busy || notesBusy}
          description="Your name, main lane, coaching goal and cached linked-account snapshot. Account ID and server are included only when your question asks about them. Rone login tokens are never pulled automatically."
          onChange={() => save({ share_profile: !settings.share_profile })} />
        <Toggle label="Hero pool" checked={settings.share_pool} disabled={busy || notesBusy}
          description="Up to 25 of your own recorded picks, confidence and entered game counts. Coach notes are excluded."
          onChange={() => save({ share_pool: !settings.share_pool })} />
        <Toggle label="Scrim assignments" checked={settings.share_scrims} disabled={busy || notesBusy}
          description="Up to 5 recent scrims where you’re listed in the lineup or substitutes. Notes, drafts and other players’ records are excluded."
          onChange={() => save({ share_scrims: !settings.share_scrims })} />
        <Toggle label="Recent conversation history" checked={settings.use_history} disabled={busy || notesBusy}
          description="Include up to 8 recent messages (6,500 characters) from this chat. Turning it off does not delete stored conversations."
          onChange={() => save({ use_history: !settings.use_history })} />
      </div>
      <AIMemoryNotes revision={notesRevision} disabled={busy} onBusyChange={setNotesBusy} />
      <label className="block">
        <span className="text-[12px] font-bold">Coaching goal <span className="font-medium text-faint">· optional</span></span>
        <textarea className="input mt-2 min-h-20 !text-[12px]" maxLength={600} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. I want to make better jungle rotations." />
        <span className="text-[11px] text-faint block mt-1">Only shared when Profile & linked account is switched on.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary !text-[12px]" type="button" disabled={busy || notesBusy || goal === settings.coaching_goal} onClick={() => save({ coaching_goal: goal })}>
          {busy && <Loader2 className="animate-spin" size={14} />} Save goal
        </button>
        <button className="btn-ghost !text-[12px]" type="button" disabled={busy || notesBusy} onClick={clear}><RotateCcw size={14} /> Clear saved AI context</button>
      </div>
      {notice && <p role="status" className="text-[11px] text-leaf">{notice}</p>}
      <ErrorNote error={error} />
      <div className="flex gap-2 text-[11px] text-faint leading-relaxed">
        <LockKeyhole size={14} className="shrink-0 mt-0.5" />
        <p>Other accounts, including admins, have no direct chat access in the AI workspace. Admins can reset account passwords, and server operators can read the app database. Chats, coaching goals and coaching notes aren’t encrypted by this feature. DeepSeek may retain submitted data; deleting a chat doesn’t erase existing backups or provider logs. Avoid sharing passwords or tokens.</p>
      </div>
    </div>
  );
}
