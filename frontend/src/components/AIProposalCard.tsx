import { CheckCircle2, ChevronRight, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AIProposal } from "../lib/cloverAI";
import { shortDate } from "../lib/cloverAI";
import { navigate } from "../lib/util";
import { ErrorNote, Modal } from "./ui";

const labels: Record<AIProposal["kind"], string> = {
  create_draft: "Create draft board", create_strategy: "Create strategy", create_hero: "Add hero",
  update_hero: "Update hero", set_patch: "Update patch label", create_item: "Add team equipment",
};
const readable = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-mute">—</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-1">{value.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul> : <span className="text-mute">None</span>;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? <dl className="space-y-2 border-l border-edge-2 pl-3">{entries.map(([key, item]) => <div key={key} className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-mute">{readable(key)}</dt><dd className="mt-0.5"><Value value={item} /></dd></div>)}</dl> : <span className="text-mute">None</span>;
  }
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

type AuditEntry = { id: string; kind: AIProposal["kind"]; actor_id: number | null; target_id: number | null; before: Record<string, unknown>; after: Record<string, unknown>; created_at: string };

export function AIActionHistory() {
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setError(null); setItems(null);
    api.get<{ items: AuditEntry[] }>("/ai/actions/audit")
      .then((result) => { if (alive) setItems(result.items); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [opened, reload]);
  return <details className="rounded-xl border border-edge bg-raised/30 p-4" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer text-[13px] font-extrabold">AI platform change history</summary>
    <p className="text-[11px] text-mute mt-2">Confirmed team changes only. This history is separate from private conversations.</p>
    <ErrorNote error={error} />
    {Boolean(error) && <button type="button" className="text-[11px] text-leaf underline mt-2" onClick={() => setReload((value) => value + 1)}>Retry history</button>}
    {opened && !items && !error && <p className="text-[11px] text-mute mt-2">Loading history…</p>}
    {items?.length === 0 && <p className="text-[11px] text-mute mt-2">No confirmed AI changes yet.</p>}
    {items?.map((item) => <details key={item.id} className="rounded-lg border border-edge bg-panel p-3 mt-2"><summary className="cursor-pointer text-[11px] font-bold">{labels[item.kind] || item.kind} · {shortDate(item.created_at)}</summary>
      <p className="text-[10px] text-mute mt-2">Admin #{item.actor_id ?? "unknown"} · record #{item.target_id ?? "unknown"}</p>
      {Object.keys(item.before).length > 0 && <div className="mt-3 text-[11px]"><strong>Before</strong><div className="mt-1"><Value value={item.before} /></div></div>}
      <div className="mt-3 text-[11px]"><strong>After</strong><div className="mt-1"><Value value={item.after} /></div></div>
    </details>)}
  </details>;
}

export function AIProposalCard({ proposal, onChange }: { proposal: AIProposal; onChange: (value: AIProposal) => void }) {
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const expired = proposal.status === "pending" && Date.parse(proposal.expires_at) <= Date.now();
  const resolved = proposal.status !== "pending";

  async function resolve(action: "apply" | "discard") {
    if (busy || (action === "apply" && !reviewed)) return;
    if (action === "discard" && !window.confirm("Discard this proposal? No platform data will be changed.")) return;
    setBusy(true); setError(null);
    try {
      const updated = await api.post<AIProposal>(`/ai/actions/${proposal.id}/${action}`, action === "apply" ? { reviewed: true, confirm: true } : {});
      onChange(updated); setOpen(false); setReviewed(false);
      if (updated.kind === "set_patch" && updated.status === "applied") window.dispatchEvent(new Event("clover:meta-changed"));
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  function openResult() {
    switch (proposal.kind) {
      case "create_draft": navigate("drafts"); break;
      case "create_strategy": navigate("strategy"); break;
      case "create_hero": case "update_hero": navigate("heroes", proposal.target_id ?? ""); break;
      case "create_item": navigate("intel", "equipment"); break;
      default: break;
    }
  }

  return <div className="rounded-xl border border-leaf/25 bg-leaf/[0.04] p-3 mt-4" aria-label="AI change proposal">
    <div className="flex flex-wrap items-start gap-2"><ShieldCheck size={16} className="text-leaf mt-0.5 shrink-0" /><div className="min-w-0 flex-1"><div className="text-[12px] font-extrabold">{labels[proposal.kind]}</div>
      <p className="text-[11px] text-mute mt-1">{expired ? "Expired — ask for a new proposal." : proposal.status === "applied" ? "Applied after admin confirmation." : proposal.status === "discarded" ? "Discarded. Nothing was changed." : `Ready for admin review · expires ${shortDate(proposal.expires_at)}. Nothing has changed yet.`}</p></div>
      <span className={`text-[9px] font-bold uppercase ${proposal.status === "applied" ? "text-leaf" : "text-mute"}`}>{expired ? "Expired" : proposal.status}</span>
    </div>
    <div className="flex flex-wrap gap-2 mt-3">
      <button type="button" className="btn-ghost !text-[11px]" onClick={() => { setError(null); setOpen(true); }}>{resolved || expired ? "View details" : "Review proposal"} <ChevronRight size={13} /></button>
      {proposal.status === "applied" && proposal.kind !== "set_patch" && <button type="button" className="btn-ghost !text-[11px]" onClick={openResult}>Open result <ChevronRight size={13} /></button>}
    </div>
    {open && <Modal title={labels[proposal.kind]} onClose={() => { if (!busy) setOpen(false); }} wide>
      <div className="space-y-4">
        <p className="text-[12px] text-mute leading-relaxed">{resolved ? "This is the reviewed proposal and its outcome." : "Review every field before confirming. The AI cannot change the platform without your approval."}</p>
        {(proposal.kind === "create_item" || proposal.kind === "set_patch") && <p className="rounded-lg border border-amber/25 bg-amber/5 p-3 text-[11px] text-mute">This is a team-maintained record, not a verified live game update.</p>}
        {proposal.kind === "create_hero" && <p className="rounded-lg border border-amber/25 bg-amber/5 p-3 text-[11px] text-mute">A new hero starts with placeholder rates, rating and difficulty until edited.</p>}
        {Object.keys(proposal.before).length > 0 && <section><div className="section-pill mb-2">Current values</div><div className="rounded-lg border border-edge bg-raised/40 p-3 text-[12px]"><Value value={proposal.before} /></div></section>}
        <section><div className="section-pill section-pill--leaf mb-2">Proposed values</div><div className="rounded-lg border border-edge bg-raised/40 p-3 text-[12px]"><Value value={proposal.payload} /></div></section>
        {!resolved && !expired && <label className="flex items-start gap-2 text-[12px] text-mute leading-relaxed"><input type="checkbox" className="mt-1 accent-emerald-400" checked={reviewed} disabled={busy} onChange={(e) => setReviewed(e.target.checked)} /><span>I reviewed the fields and confirm this change to the team platform.</span></label>}
        <ErrorNote error={error} />
        {Boolean(error) && <p className="text-[10px] text-mute">If the connection was interrupted, reload this conversation to check the outcome before trying again.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!resolved && !expired && <button type="button" className="btn-ghost !text-[11px] mr-auto" disabled={busy} onClick={() => void resolve("discard")}><Trash2 size={13} /> Discard</button>}
          <button type="button" className="btn-ghost !text-[11px]" disabled={busy} onClick={() => setOpen(false)}>Close</button>
          {!resolved && !expired && <button type="button" className="btn-primary !text-[11px]" disabled={busy || !reviewed} onClick={() => void resolve("apply")}>{busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm & apply</button>}
        </div>
      </div>
    </Modal>}
  </div>;
}
