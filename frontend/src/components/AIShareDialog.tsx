import { Check, Copy, ExternalLink, Globe2, Link2, Loader2, MessageSquare, Share2, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { shareUrl, type AIShareAudience, type AIShareLink } from "../lib/cloverAI";
import { ErrorNote } from "./ui";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / blocked clipboard: fall back to a hidden textarea.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch { return false; }
  }
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/**
 * Make a link to one AI answer or to the whole chat, copy it, and manage earlier links.
 * `messageId` set = the dialog starts on "This answer"; the member can switch to the whole chat.
 */
export function AIShareDialog({ conversationId, messageId, onClose }: { conversationId: string; messageId?: number | null; onClose: () => void }) {
  const [scope, setScope] = useState<"message" | "chat">(messageId ? "message" : "chat");
  const [audience, setAudience] = useState<AIShareAudience>("public");
  const [link, setLink] = useState<AIShareLink | null>(null);
  const [links, setLinks] = useState<AIShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadLinks = useCallback(() => {
    api.get<{ items: AIShareLink[] }>(`/ai/shares?conversation_id=${encodeURIComponent(conversationId)}`)
      .then((r) => setLinks(r.items)).catch(() => setLinks([]));
  }, [conversationId]);
  useEffect(loadLinks, [loadLinks]);
  // A new choice needs a new link.
  useEffect(() => { setLink(null); }, [scope, audience]);

  async function create() {
    setBusy(true); setError(null);
    try {
      const made = await api.post<AIShareLink>(`/ai/conversations/${conversationId}/shares`, {
        audience, ...(scope === "message" && messageId ? { message_id: messageId } : {}),
      });
      setLink(made);
      const url = shareUrl(made.path);
      if (await copyText(url)) { setCopied(made.token); window.setTimeout(() => setCopied(null), 2200); }
      loadLinks();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function copy(item: AIShareLink) {
    if (await copyText(shareUrl(item.path))) { setCopied(item.token); window.setTimeout(() => setCopied(null), 2200); }
  }
  async function nativeShare(item: AIShareLink) {
    try { await navigator.share({ title: item.title, text: `${item.title} · 9 Clover AI`, url: shareUrl(item.path) }); } catch { /* cancelled */ }
  }
  async function revoke(item: AIShareLink) {
    if (!confirm("Turn this link off? Anyone who has it won't be able to open it any more.")) return;
    try {
      await api.del(`/ai/shares/${item.token}`);
      if (link?.token === item.token) setLink(null);
      setLinks((list) => list.filter((l) => l.token !== item.token));
    } catch (e) { setError(e); }
  }

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const option = (active: boolean) => `flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors ${active ? "border-leaf/60 bg-leaf/10" : "border-edge-2 bg-panel hover:border-leaf/30"}`;

  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-1.5">What to share</div>
        <div className="flex flex-wrap gap-2">
          {messageId ? <button type="button" className={option(scope === "message")} aria-pressed={scope === "message"} onClick={() => setScope("message")}>
            <div className="flex items-center gap-1.5 text-[12px] font-extrabold"><MessageSquare size={14} className="text-leaf" /> This answer</div>
            <div className="text-[10.5px] text-mute mt-0.5">The AI reply and the question you asked.</div>
          </button> : null}
          <button type="button" className={option(scope === "chat")} aria-pressed={scope === "chat"} onClick={() => setScope("chat")}>
            <div className="flex items-center gap-1.5 text-[12px] font-extrabold"><Share2 size={14} className="text-leaf" /> Whole chat</div>
            <div className="text-[10.5px] text-mute mt-0.5">Every message up to now. New messages stay private.</div>
          </button>
        </div>
      </div>
      <div>
        <div className="label mb-1.5">Who can open it</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={option(audience === "public")} aria-pressed={audience === "public"} onClick={() => setAudience("public")}>
            <div className="flex items-center gap-1.5 text-[12px] font-extrabold"><Globe2 size={14} className="text-sky" /> Anyone with the link</div>
            <div className="text-[10.5px] text-mute mt-0.5">No sign-in needed. Good for friends outside the team.</div>
          </button>
          <button type="button" className={option(audience === "team")} aria-pressed={audience === "team"} onClick={() => setAudience("team")}>
            <div className="flex items-center gap-1.5 text-[12px] font-extrabold"><Users size={14} className="text-amber" /> Team only</div>
            <div className="text-[10.5px] text-mute mt-0.5">They sign in to 9 Clover first.</div>
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-faint leading-relaxed">
        Your private context (pool, memories, account stats) is never shown. Shared copies show your messages, the AI's answers, cards and web links.
      </p>

      {link ? (
        <div className="rounded-xl border border-leaf/35 bg-leaf/[0.06] p-3 space-y-2.5" role="status">
          <div className="flex items-center gap-2 text-[11.5px] font-extrabold text-leaf">
            <Check size={14} /> {copied === link.token ? "Link copied — paste it anywhere" : "Link ready"}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <input readOnly className="input !py-1.5 !text-[11.5px] flex-1 min-w-0" value={shareUrl(link.path)} aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn-primary !py-1.5 !text-[11px] shrink-0" onClick={() => copy(link)}>
              {copied === link.token ? <Check size={13} /> : <Copy size={13} />} Copy
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {canNativeShare && <button type="button" className="btn-ghost !py-1.5 !text-[11px]" onClick={() => nativeShare(link)}><Share2 size={13} /> Send…</button>}
            <a className="btn-ghost !py-1.5 !text-[11px]" href={shareUrl(link.path)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Preview</a>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary w-full justify-center" disabled={busy} onClick={create}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create link & copy
        </button>
      )}
      <ErrorNote error={error} />

      {links.length > 0 && (
        <div className="border-t border-edge pt-3">
          <div className="label mb-2">Links for this chat</div>
          <ul className="space-y-1.5">
            {links.map((item) => (
              <li key={item.token} className="flex items-center gap-2 rounded-lg border border-edge bg-panel/60 px-2.5 py-2 min-w-0">
                {item.audience === "team" ? <Users size={13} className="text-amber shrink-0" /> : <Globe2 size={13} className="text-sky shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-bold truncate">{item.kind === "chat" ? "Whole chat" : "One answer"} · {item.audience === "team" ? "Team only" : "Anyone"}</div>
                  <div className="text-[10px] text-faint">{ago(item.created_at)} · {item.views} {item.views === 1 ? "view" : "views"}</div>
                </div>
                <button type="button" className="btn-ghost !p-1.5" aria-label="Copy link" title="Copy link" onClick={() => copy(item)}>
                  {copied === item.token ? <Check size={13} className="text-leaf" /> : <Copy size={13} />}
                </button>
                <button type="button" className="btn-ghost !p-1.5 hover:!text-crim" aria-label="Turn link off" title="Turn link off" onClick={() => revoke(item)}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end"><button type="button" className="btn-ghost" onClick={onClose}>Done</button></div>
    </div>
  );
}
