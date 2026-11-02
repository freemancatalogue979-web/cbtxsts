import { CheckCircle2, ExternalLink, FileQuestion, Loader2, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { safeExternal, shortDate } from "../lib/cloverAI";
import type { AIContribution } from "../lib/cloverAI";
import { ErrorNote, Field } from "./ui";

const KINDS: { id: AIContribution["kind"]; label: string }[] = [
  { id: "strategy", label: "Strategy" }, { id: "correction", label: "Correction" },
  { id: "draft", label: "Draft idea" }, { id: "question", label: "Question" }, { id: "feedback", label: "Feedback" },
];
const TONES: Record<AIContribution["status"], string> = {
  pending: "text-amber border-amber/30 bg-amber/5", approved: "text-leaf border-leaf/30 bg-leaf/5",
  rejected: "text-crim border-crim/30 bg-crim/5", reviewed: "text-sky border-sky/30 bg-sky/5", removed: "text-faint border-edge-2 bg-panel",
};

function ContributionCard({ item, children }: { item: AIContribution; children?: React.ReactNode }) {
  const source = safeExternal(item.source_url);
  return <article className="rounded-lg border border-edge bg-raised/40 p-4 min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`chip !text-[9px] uppercase ${TONES[item.status]}`}>{item.status}</span>
      <span className="text-[10px] uppercase font-bold text-faint">{item.kind} · {shortDate(item.created_at)}{item.author ? ` · ${item.author}` : ""}</span>
    </div>
    <h3 className="text-[13px] font-extrabold mt-2 break-words">{item.title}</h3>
    <p className="text-[12px] text-mute leading-relaxed whitespace-pre-wrap break-words mt-1.5">{item.content}</p>
    {source && <a href={source} target="_blank" rel="noreferrer noopener" className="text-[11px] text-leaf inline-flex items-center gap-1 mt-3 hover:underline">Submitted source <ExternalLink size={11} /></a>}
    {item.review_note && <p className="text-[11px] text-faint leading-relaxed mt-3 border-t border-edge pt-3"><strong className="text-mute">Reviewer note:</strong> {item.review_note}</p>}
    {children}
  </article>;
}

export function AIContributions() {
  const [kind, setKind] = useState<AIContribution["kind"]>("strategy");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState<AIContribution[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try { const result = await api.get<AIContribution[]>("/ai/contributions"); if (id === requestId.current) setItems(result); }
    catch (e) { if (id === requestId.current) setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function withdraw(item: AIContribution) {
    if (!window.confirm("Withdraw this pending submission from the review queue?")) return;
    setError(null);
    try {
      await api.del(`/ai/contributions/${item.id}`);
      setItems((previous) => previous?.filter((row) => row.id !== item.id) ?? []);
      await load(); setNotice("Pending submission withdrawn.");
    }
    catch (e) { setError(e); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice("");
    try {
      const created = await api.post<AIContribution>("/ai/contributions", { kind, title, content, source_url: source, share_with_reviewers: consent });
      setItems((previous) => [created, ...(previous ?? []).filter((row) => row.id !== created.id)]);
      setTitle(""); setContent(""); setSource(""); setConsent(false);
      await load();
      setNotice("Sent for review. Nothing is published automatically.");
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      <div>
        <div className="section-pill section-pill--leaf">BUILD IT TOGETHER</div>
        <h2 className="text-xl font-extrabold mt-1">Share what you know.</h2>
        <p className="text-[12px] text-mute mt-1.5 leading-relaxed max-w-2xl">Found something useful or spotted a mistake? Send it to the review queue. Your private chats are never copied or submitted automatically.</p>
      </div>
      <form onSubmit={submit} className="rounded-lg border border-edge bg-panel p-4 sm:p-5 space-y-4">
        <div><div className="section-pill mb-2">Contribution type</div>
          <div className="flex flex-wrap gap-1.5">{KINDS.map((option) => <button key={option.id} type="button" onClick={() => setKind(option.id)}
            className={`rounded border px-3 py-1.5 text-[11px] font-bold transition-colors ${kind === option.id ? "border-leaf/50 text-leaf bg-leaf/10" : "border-edge text-mute bg-raised hover:border-edge-2"}`}>{option.label}</button>)}</div>
        </div>
        <Field label="Title"><input className="input" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What’s this about?" /></Field>
        <Field label="Details" hint="For corrections, include the incorrect claim and your evidence. Questions and feedback are reviewed but not published as facts.">
          <textarea className="input min-h-28" maxLength={2000} required value={content} onChange={(e) => setContent(e.target.value)} placeholder="Explain the idea, correction or question…" />
        </Field>
        <Field label="Evidence link · optional" hint="HTTPS only. Links are not automatically verified or fetched.">
          <input className="input" type="url" maxLength={2048} value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://…" />
        </Field>
        <label className="flex items-start gap-2 text-[11px] leading-relaxed text-mute">
          <input type="checkbox" className="mt-0.5 accent-emerald-400" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>I understand this submission is shared with admins for review and, if approved, may be visible to all members and sent to the external AI provider as knowledge. Published notes may remain if my account is removed; an admin can remove them. Don’t include private chat or someone else’s private data.</span>
        </label>
        <ErrorNote error={error} />
        {notice && <p className="text-[11px] text-leaf" role="status">{notice}</p>}
        <button className="btn-primary" disabled={busy || !consent || !title.trim() || !content.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send for review
        </button>
      </form>
      <section><div className="flex items-center gap-2 mb-3"><FileQuestion size={15} className="text-faint" /><h3 className="section-pill">Your submissions</h3></div>
        {items === null ? <p className="text-[12px] text-faint">Loading submissions…</p> : items.length ? <div className="space-y-2">{items.map((item) => <ContributionCard key={item.id} item={item}>
          {item.status === "pending" && <button type="button" className="text-[11px] font-semibold text-faint hover:text-crim mt-3" onClick={() => void withdraw(item)}>Withdraw submission</button>}
        </ContributionCard>)}</div> :
          <div className="border border-dashed border-edge-2 rounded-lg p-5 text-center text-[12px] text-faint">Nothing submitted yet.</div>}
      </section>
    </div>
  );
}

function ReviewCard({ item, onDone }: { item: AIContribution; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const publishable = item.kind !== "question" && item.kind !== "feedback";
  async function decide(decision: "approve" | "reject") {
    setBusy(true); setError(null);
    try {
      await api.post(`/ai/review/${item.id}`, { decision, note, reviewed });
      onDone();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <ContributionCard item={item}>
    <div className="border-t border-edge mt-4 pt-4 space-y-3">
      <label className="block"><span className="label block mb-1.5">Review note · visible to the submitter</span>
        <textarea className="input min-h-16 !text-[12px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={publishable ? "What evidence did you check?" : "Your answer or acknowledgement…"} /></label>
      <label className="flex items-start gap-2 text-[11px] text-mute leading-relaxed"><input type="checkbox" className="mt-0.5 accent-emerald-400" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>I reviewed the content and evidence. {publishable ? "Approval publishes it to the member library; review is not automatic verification." : "This response is sent to the submitter, not published as a fact."}</span></label>
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-leaf !text-[11px]" disabled={busy || !reviewed || !note.trim()} onClick={() => decide("approve")}><CheckCircle2 size={14} /> {publishable ? "Approve to library" : "Mark reviewed"}</button>
        <button type="button" className="btn-ghost !text-[11px]" disabled={busy || !reviewed || !note.trim()} onClick={() => decide("reject")}>Reject</button>
      </div>
    </div>
  </ContributionCard>;
}

export function AIReviewQueue() {
  const [items, setItems] = useState<AIContribution[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    try { const result = await api.get<AIContribution[]>("/ai/review"); if (id === requestId.current) setItems(result); }
    catch (e) { if (id === requestId.current) setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div className="space-y-5">
    <div className="flex items-start gap-3"><ShieldCheck size={22} className="text-leaf shrink-0 mt-1" /><div>
      <div className="section-pill section-pill--leaf">ADMIN REVIEW</div><h2 className="text-xl font-extrabold mt-1">Keep the library trustworthy.</h2>
      <p className="text-[12px] text-mute mt-1.5 leading-relaxed">Check sources and relevance before publishing. Questions and feedback can be acknowledged but are never published as facts. Exact duplicates are detected; no automatic fact-checking is claimed.</p>
    </div></div>
    <ErrorNote error={error} />
    {items === null ? <div className="text-[12px] text-faint">Loading review queue…</div> : items.length ?
      <div className="space-y-3">{items.map((item) => <ReviewCard key={item.id} item={item} onDone={() => { setItems((previous) => previous?.filter((row) => row.id !== item.id) ?? []); void load(); }} />)}</div> :
      <div className="rounded-lg border border-dashed border-edge-2 p-8 text-center text-[12px] text-faint">Review queue is clear.</div>}
  </div>;
}
