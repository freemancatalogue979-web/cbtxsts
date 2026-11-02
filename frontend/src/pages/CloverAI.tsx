import {
  ArrowDownRight, BookOpenText, BrainCircuit, Check, ChevronRight, CircleHelp, Download, ExternalLink,
  History, Lightbulb, Loader2, LockKeyhole, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen,
  Paperclip, PenLine, Plus, Send, Settings2, ShieldCheck, Sparkles, Swords, ThumbsDown, ThumbsUp, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, qs } from "../lib/api";
import { AI_EXPORT_LIMIT, collectAIExport, readAISelectedChat, revealAIComposer, safeExternal, saveAISelectedChat, shortDate } from "../lib/cloverAI";
import type { AIBoardSummary, AIContext, AIConversation, AIExport, AIKnowledgeNote, AIList, AIMessage, AIMessagePage, AIProgressStage, AIProposal, AISendResult, AISettings, AISource, AIStatus, AIWebMode, AIWorkspaceLayout } from "../lib/cloverAI";
import { teamCode, type EsportsMatch } from "../lib/esports";
import type { User } from "../lib/types";
import { navigate } from "../lib/util";
import { BrandImg } from "../components/Logo";
import { ErrorNote, Field, Modal } from "../components/ui";
import { AIDataControls } from "../components/AIDataControls";
import { AIMatchPicker } from "../components/AIMatchPicker";
import { AIBoardPicker } from "../components/AIBoardPicker";
import { AIWebControls } from "../components/AIWebControls";
import { AIKnowledge } from "../components/AIKnowledge";
import { AIContributions, AIReviewQueue } from "../components/AIContributions";
import { AIActionHistory, AIProposalCard } from "../components/AIProposalCard";

type Tab = "chat" | "knowledge" | "contribute" | "review";
const SUGGESTIONS = [
  { label: "Review my hero pool", hint: "Find a focused practice plan", icon: Swords, prompt: "Review my recorded hero pool and suggest a practical practice plan. Tell me if I need to enable access to my pool." },
  { label: "Improve my rotations", hint: "Build better map habits", icon: Lightbulb, prompt: "How can I improve my early-game rotations? Give me a simple MLBB practice checklist." },
  { label: "Explore ranked builds", hint: "Research the latest advice", icon: CircleHelp, prompt: "Help me find a current ranked build. Ask me which hero, role and server I play, and use current sources where available." },
  { label: "Look at my scrims", hint: "Use my recorded assignments", icon: BrainCircuit, prompt: "What can we learn from my recent recorded scrim assignments? Be clear about what isn’t recorded." },
];

const THINK_STAGES: Record<AIProgressStage, string> = {
  preparing: "Preparing your context…",
  checking: "Checking the available context…",
  connecting: "Starting deeper analysis…",
  thinking: "Clover is thinking deeply…",
  writing: "Putting the analysis together…",
  finishing: "Finishing your reply…",
};

function ThinkingIndicator({ stage, startedAt }: { stage: AIProgressStage | null; startedAt: number | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-xl border border-leaf/25 bg-leaf/[0.05] px-3.5 py-3 max-w-md">
    <span className="relative grid h-8 w-8 place-items-center rounded-md border border-leaf/25 bg-leaf/10 text-leaf shrink-0">
      <BrainCircuit size={16} className="motion-safe:animate-pulse" />
    </span>
    <span className="min-w-0"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-extrabold text-text">
      <span>{stage ? THINK_STAGES[stage] : "Clover is still working on your analysis…"}</span>
      {startedAt !== null && <span aria-hidden="true" className="text-[10px] font-semibold text-mute tabular-nums">{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>}
    </span><span className="block text-[10px] leading-relaxed text-mute mt-1">Deep analysis can take a few minutes. Reopen this conversation to check the reply.</span></span>
  </div>;
}

function HistoryPanel({ conversations, searchResults, selected, filter, setFilter, hasMore, onMore, onSelect, onNew, disabled, searching, searchError, onRetry }: {
  conversations: AIConversation[]; searchResults: AIConversation[]; selected: string | null; filter: string; setFilter: (v: string) => void;
  hasMore: boolean; onMore: () => void; onSelect: (id: string) => void; onNew: () => void; disabled: boolean;
  searching: boolean; searchError: unknown; onRetry: () => void;
}) {
  const term = filter.trim();
  const active = term.length >= 2;
  const visible = active ? searchResults : term ? [] : conversations;
  return <div className="h-full flex flex-col p-3 min-w-0">
    <div className="flex items-center justify-between px-1 mb-3"><div><div className="section-pill">YOUR SPACE</div><div className="text-[13px] font-extrabold mt-1">Conversations</div></div><LockKeyhole size={15} className="text-faint" /></div>
    <button type="button" className="btn-ghost w-full !justify-start !text-[12px] !py-2.5 border-dashed" disabled={disabled} onClick={onNew}><Plus size={15} className="text-crim" /> New conversation</button>
    <label className="block mt-3"><span className="sr-only">Search all your chats</span><input className="input !text-[11px]" placeholder="Search your chats…" maxLength={100} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
    <div className="mt-3 flex-1 overflow-y-auto min-h-0 space-y-1" aria-live="polite">
      {searching && <p className="text-[11px] text-faint px-2 py-2 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Searching your chats…</p>}
      {!searching && visible.map((item) => <button key={item.id} disabled={disabled} onClick={() => onSelect(item.id)}
        className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors min-w-0 ${selected === item.id ? "bg-crim/10 border border-crim/25" : "border border-transparent hover:bg-raised"}`}>
        <div className={`text-[11px] font-bold truncate ${selected === item.id ? "text-text" : "text-mute"}`}>{item.title}</div>
        <div className="text-[10px] text-faint mt-1">{shortDate(item.updated_at)}</div>
      </button>)}
      {!searching && !visible.length && !searchError && <p className="text-[11px] text-faint px-2 py-3">{term.length === 1 ? "Type at least two characters to search." : active ? "No private chats match." : "Your private chats will appear here."}</p>}
      {Boolean(searchError) && active && <div className="px-2 py-2"><ErrorNote error={searchError} /><button type="button" className="text-[11px] text-leaf underline mt-2" onClick={onRetry}>Retry search</button></div>}
      {hasMore && !searching && (active || !term) && <button type="button" className="text-[11px] text-leaf px-2 py-2 hover:underline" disabled={disabled} onClick={onMore}>{active ? "Load more results" : "Load more chats"}</button>}
    </div>
    <div className="border-t border-edge mt-3 pt-3 px-1 text-[10px] leading-relaxed text-faint">Search includes your own chat titles and messages only.</div>
  </div>;
}

function SourceChips({ sources, conversationId, messageId, onManageMemory }: {
  sources: AISource[]; conversationId: string | null; messageId: number; onManageMemory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<AIKnowledgeNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>(null);
  async function showNote(id: string) {
    setOpen(true); setLoading(true); setNote(null); setError(null);
    try { setNote(await api.get<AIKnowledgeNote>(`/ai/knowledge/${id}`)); }
    catch (e) { setError(e); }
    finally { setLoading(false); }
  }
  async function saveResearch(index: number) {
    if (!conversationId || saving !== null) return;
    setSaving(index); setError(null); setNotice("");
    try {
      const result = await api.post<{ status: "saved" | "duplicate" }>(`/ai/conversations/${conversationId}/messages/${messageId}/research-memory`, { source_index: index });
      setSaved((previous) => [...previous, index]);
      setNotice(result.status === "duplicate" ? "This finding is already in your private memory." : "Finding saved privately with its source. It remains unverified.");
    } catch (e) { setError(e); }
    finally { setSaving(null); }
  }
  if (!sources.length) return null;
  return <div className="mt-4 pt-3 border-t border-edge/70">
    <details>
      <summary className="cursor-pointer text-[11px] font-bold text-mute hover:text-leaf">Sources & research · {sources.length}</summary>
      <div className="flex flex-wrap gap-1.5 mt-2">{sources.map((source, index) => {
        const external = safeExternal(source.url);
        const isInternal = Boolean(source.knowledge_id || source.route || source.memory_id);
        const text = <><span className="truncate">{source.label}</span>{source.reviewed_at && <span className="text-mute shrink-0">· {shortDate(source.reviewed_at)}</span>}{source.kind === "match" && <span className="text-mute shrink-0">· {source.auto_selected ? "auto · " : ""}saved {shortDate(source.observed_at)}</span>}{source.kind === "web" && <span className="text-mute shrink-0">· {source.published_at ? `published ${shortDate(source.published_at)}` : "date unknown"}</span>}{source.kind === "esports_feed" && <span className="text-mute shrink-0">· retrieved {shortDate(source.observed_at)}</span>}{isInternal ? <ChevronRight size={10} className="shrink-0" /> : external ? <ExternalLink size={10} className="shrink-0" /> : null}</>;
        const cls = "max-w-full inline-flex items-center gap-1 rounded border border-edge-2 bg-panel/70 px-2 py-1 text-[10px] text-mute font-semibold";
        if (source.knowledge_id) return <button type="button" key={`${source.label}-${index}`} className={`${cls} hover:text-leaf`} onClick={() => void showNote(source.knowledge_id!)}>{text}</button>;
        if (source.memory_id) return <button type="button" key={`${source.label}-${index}`} className={`${cls} hover:text-leaf`} onClick={onManageMemory}>{text}</button>;
        if (source.route) return <button type="button" key={`${source.label}-${index}`} className={`${cls} hover:text-leaf`} onClick={() => navigate(source.route!)}>{text}</button>;
        if (external) return <a key={`${source.label}-${index}`} className={`${cls} hover:text-leaf`} href={external} target="_blank" rel="noreferrer noopener"
          title={source.kind === "match" ? `Saved ${shortDate(source.observed_at)} · player detail saved ${shortDate(source.detail_fetched_at)} · source-reported and not independently verified` : source.kind === "web" ? `Retrieved ${shortDate(source.observed_at)} · check publication date and server region` : undefined}>{text}</a>;
        return <span key={`${source.label}-${index}`} className={cls}>{text}</span>;
      })}</div>
      {sources.map((source, index) => source.kind === "web" && source.excerpt ? <div key={`excerpt-${index}`} className="rounded-lg border border-edge bg-panel/60 p-3 mt-2">
        <div className="text-[10px] font-extrabold text-mute">{source.label} · unverified excerpt</div>
        <p className="text-[11px] text-text/90 leading-relaxed break-words mt-1">{source.excerpt}</p>
        <button type="button" disabled={!conversationId || saving !== null || saved.includes(index)} onClick={() => void saveResearch(index)}
          className="text-[10px] text-leaf font-bold inline-flex items-center gap-1 mt-2 disabled:opacity-60" aria-label={`Save finding from ${source.label} to memory`}>
          {saving === index ? <Loader2 size={12} className="animate-spin" /> : <BrainCircuit size={12} />}{saved.includes(index) ? "Saved to memory" : "Save finding to memory"}
        </button>
      </div> : null)}
      {notice && <p role="status" className="text-[11px] text-leaf mt-2">{notice}</p>}
      {!open && <ErrorNote error={error} />}
    </details>
    {open && <Modal title="Reviewed community source" onClose={() => setOpen(false)}>
      {loading && <p className="text-[12px] text-faint">Loading source…</p>}
      <ErrorNote error={error} />
      {note && <div className="space-y-3"><h3 className="text-[14px] font-extrabold break-words">{note.title}</h3>
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-mute">{note.content}</p>
        <p className="text-[10px] leading-relaxed text-faint">Reviewed {shortDate(note.reviewed_at)} · {note.notice}</p>
        {safeExternal(note.source_url) && <a href={safeExternal(note.source_url)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] text-leaf hover:underline">View submitted source <ExternalLink size={11} /></a>}
      </div>}
    </Modal>}
  </div>;
}

function MessageBubble({ message, conversationId, onFeedback, onManageMemory, onProposal }: { message: AIMessage; conversationId: string | null; onFeedback: (id: number, rating: -1 | 0 | 1) => void; onManageMemory: () => void; onProposal: (id: number, proposal: AIProposal) => void }) {
  if (message.role === "user") return <div className="flex justify-end"><div className="max-w-[92%] sm:max-w-[78%] rounded-2xl rounded-tr-sm border border-crim/25 bg-crim/10 px-4 py-3 text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words">{message.content}
    {message.sources.some((source) => ["match", "draft", "map"].includes(source.kind)) && <div className="mt-2 pt-2 border-t border-crim/20 text-[10px] font-semibold text-mute whitespace-normal">Attached: {message.sources.filter((source) => ["match", "draft", "map"].includes(source.kind)).map((source) => source.match_id || source.label).join(" · ")}</div>}
  </div></div>;
  return <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
    <div className="rounded-lg bg-raised border border-edge p-1 shrink-0"><BrandImg size={24} /></div>
    <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-edge bg-raised/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] tracking-[0.14em] uppercase font-extrabold">9 Clover AI</span>
        <span className={`rounded-sm border px-2 py-0.5 text-[9px] font-bold uppercase ${message.mode === "ai" || message.mode === "think" || message.mode === "guidance" ? "border-leaf/25 text-leaf bg-leaf/5" : "border-amber/25 text-amber bg-amber/5"}`}>{message.mode === "ai" ? "AI response" : message.mode === "think" ? "Deep analysis" : message.mode === "guidance" ? "Next step" : "Local facts only"}</span>
      </div>
      <div className="ai-markdown text-[12px] sm:text-[13px] text-text/90 leading-relaxed break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]}
          components={{ a: ({ children }) => <span>{children}</span> }}>{message.content}</ReactMarkdown>
      </div>
      {message.note && <p className="text-[10px] text-faint leading-relaxed mt-3">{message.note}</p>}
      {message.proposal && <AIProposalCard proposal={message.proposal} onChange={(value) => onProposal(message.id, value)} />}
      <SourceChips sources={message.sources} conversationId={conversationId} messageId={message.id} onManageMemory={onManageMemory} />
      <div className="flex flex-wrap items-center gap-1 mt-3 text-faint">
        <span className="text-[10px] mr-1">Helpful?</span>
        <button type="button" title="Helpful" aria-label="Mark response helpful" aria-pressed={message.feedback === 1} onClick={() => onFeedback(message.id, message.feedback === 1 ? 0 : 1)} className={`p-1.5 rounded hover:bg-overlay ${message.feedback === 1 ? "text-leaf" : "text-faint"}`}><ThumbsUp size={13} /></button>
        <button type="button" title="Not helpful" aria-label="Mark response not helpful" aria-pressed={message.feedback === -1} onClick={() => onFeedback(message.id, message.feedback === -1 ? 0 : -1)} className={`p-1.5 rounded hover:bg-overlay ${message.feedback === -1 ? "text-crim" : "text-faint"}`}><ThumbsDown size={13} /></button>
        <span className="text-[10px] w-full sm:w-auto sm:ml-1">Feedback is private.</span>
      </div>
    </div>
  </div>;
}

export function CloverAIPage({ me, desktopLayout, onToggleDesktopLayout }: {
  me: User; desktopLayout: AIWorkspaceLayout; onToggleDesktopLayout: (key: keyof AIWorkspaceLayout) => void;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [context, setContext] = useState<AIContext | null>(null);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [searchResults, setSearchResults] = useState<AIConversation[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<unknown>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const [selectedFromSearch, setSelectedFromSearch] = useState<AIConversation | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [think, setThink] = useState(false);
  const [activeThink, setActiveThink] = useState(false);
  const [thinkStage, setThinkStage] = useState<AIProgressStage>("preparing");
  const [thinkStarted, setThinkStarted] = useState<number | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{ text: string; afterId: number } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<{ think: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [attachedMatches, setAttachedMatches] = useState<EsportsMatch[]>([]);
  const [attachedDrafts, setAttachedDrafts] = useState<AIBoardSummary[]>([]);
  const [attachedMaps, setAttachedMaps] = useState<AIBoardSummary[]>([]);
  const [webMode, setWebMode] = useState<AIWebMode>("auto");
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const selectedRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const exportLock = useRef(false);
  const requestVersion = useRef(0);
  const olderVersion = useRef(0);
  const searchVersion = useRef(0);
  const mobileHistoryRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldScroll = useRef(false);
  const current = conversations.find((item) => item.id === selected) || (selectedFromSearch?.id === selected ? selectedFromSearch : undefined);
  const workspaceReady = Boolean(status && settings && context);
  const waiting = busy || Boolean(remoteBusy);
  const waitingForThink = busy ? activeThink : Boolean(remoteBusy?.think);
  const showPending = busy && pendingQuestion && !messages.some((message) => message.role === "user" && message.id > pendingQuestion.afterId && message.content === pendingQuestion.text);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<AIStatus>("/ai/status"), api.get<AISettings>("/ai/settings"), api.get<AIContext>("/ai/context"),
      api.get<AIList<AIConversation>>("/ai/conversations"),
    ]).then(([s, p, c, chats]) => {
      if (!alive) return;
      setStatus(s); setSettings(p); setContext(c); setConversations(chats.items); setHasMoreChats(chats.has_more);
      let stored: string | null = null;
      try { stored = readAISelectedChat(window.sessionStorage, me.id); } catch { /* Storage may be blocked. */ }
      const initial = stored || chats.items[0]?.id || null; selectedRef.current = initial; setSelected(initial);
    }).catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [me.id, reloadKey]);

  useEffect(() => {
    if (!workspaceReady) return;
    try { saveAISelectedChat(window.sessionStorage, me.id, selected); } catch { /* Storage may be blocked. */ }
  }, [selected, workspaceReady, me.id]);

  useEffect(() => {
    const version = ++searchVersion.current;
    const term = filter.trim();
    setSearchResults([]); setSearchHasMore(false); setSearchError(null);
    if (term.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.post<AIList<AIConversation>>("/ai/conversations/search", { q: term })
        .then((result) => { if (searchVersion.current === version) { setSearchResults(result.items); setSearchHasMore(result.has_more); } })
        .catch((e) => { if (searchVersion.current === version) setSearchError(e); })
        .finally(() => { if (searchVersion.current === version) setSearching(false); });
    }, 250);
    return () => { window.clearTimeout(timer); if (searchVersion.current === version) searchVersion.current++; };
  }, [filter, searchRevision, me.id]);

  useEffect(() => {
    selectedRef.current = selected;
    setRemoteBusy(null);
    if (!selected) { setMessages([]); setHasMoreMessages(false); setLoadingChat(false); return; }
    let alive = true;
    const version = ++requestVersion.current;
    setLoadingChat(true); setError(null); shouldScroll.current = true;
    api.get<AIMessagePage>(`/ai/conversations/${selected}/messages`).then((result) => {
      if (alive && requestVersion.current === version) {
        setMessages(result.messages); setHasMoreMessages(result.has_more);
        if (result.conversation) setSelectedFromSearch(result.conversation);
        setRemoteBusy(result.processing ? { think: Boolean(result.processing_think) } : null);
      }
    }).catch((e) => {
      if (!alive || requestVersion.current !== version) return;
      setError(e);
      if (e instanceof ApiError && e.status === 404) {
        const fallback = conversations.find((chat) => chat.id !== selected)?.id ?? null;
        selectedRef.current = fallback; setSelected(fallback);
      }
    }).finally(() => { if (alive && requestVersion.current === version) setLoadingChat(false); });
    return () => { alive = false; };
  }, [selected]);

  useEffect(() => {
    // A long analysis can outlive a refresh or a dropped connection. The owner
    // can reopen the chat and wait for the existing request without sending it twice.
    if (!selected || !remoteBusy || busy) return;
    let alive = true;
    const chat = selected;
    const timer = window.setTimeout(() => {
      api.get<AIMessagePage>(`/ai/conversations/${chat}/messages`).then((result) => {
        if (!alive || selectedRef.current !== chat) return;
        setMessages(result.messages); setHasMoreMessages(result.has_more);
        if (result.conversation) {
          setSelectedFromSearch(result.conversation);
          setConversations((previous) => [result.conversation!, ...previous.filter((item) => item.id !== chat)]);
        }
        setRemoteBusy(result.processing ? { think: Boolean(result.processing_think) } : null);
        if (!result.processing) { shouldScroll.current = true; setError(null); }
      }).catch((e) => {
        if (!alive || selectedRef.current !== chat) return;
        setError(e);
        setRemoteBusy(e instanceof ApiError && (e.status === 401 || e.status === 404) ? null : { ...remoteBusy });
      });
    }, 4000);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [selected, remoteBusy, busy]);

  useLayoutEffect(() => {
    // Wait for the conversation (or the reply) to actually render before scrolling.
    if (!loadingChat && shouldScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      shouldScroll.current = false;
    }
  }, [messages, selected, busy, loadingChat]);

  useEffect(() => {
    if (showHistory && window.innerWidth < 1024) mobileHistoryRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [showHistory]);

  function selectChat(id: string) {
    if (selectedRef.current !== id) { setAttachedMatches([]); setAttachedDrafts([]); setAttachedMaps([]); olderVersion.current++; setLoadingMore(false); }
    setSelectedFromSearch(searchResults.find((item) => item.id === id) ?? null);
    selectedRef.current = id; setSelected(id); setShowHistory(false); setError(null);
  }
  function newChat() {
    // A new row is created when the first message is sent; avoids empty-chat clutter.
    selectedRef.current = null; requestVersion.current++; olderVersion.current++; setSelected(null); setMessages([]); setHasMoreMessages(false); setLoadingMore(false);
    setAttachedMatches([]); setAttachedDrafts([]); setAttachedMaps([]); setSelectedFromSearch(null); setShowHistory(false); setError(null);
  }
  async function moreChats() {
    try {
      const result = await api.get<AIList<AIConversation>>(`/ai/conversations?offset=${conversations.length}`);
      setConversations((prev) => [...prev, ...result.items.filter((row) => !prev.some((old) => old.id === row.id))]);
      setHasMoreChats(result.has_more);
    } catch (e) { setError(e); }
  }
  async function moreSearch() {
    const term = filter.trim();
    if (term.length < 2 || searching || !searchHasMore) return;
    const version = searchVersion.current;
    setSearching(true); setSearchError(null);
    try {
      const result = await api.post<AIList<AIConversation>>("/ai/conversations/search", { q: term, offset: searchResults.length });
      if (searchVersion.current === version) {
        setSearchResults((previous) => [...previous, ...result.items.filter((row) => !previous.some((old) => old.id === row.id))]);
        setSearchHasMore(result.has_more);
      }
    } catch (e) { if (searchVersion.current === version) setSearchError(e); }
    finally { if (searchVersion.current === version) setSearching(false); }
  }
  async function olderMessages() {
    if (!selected || !messages.length || loadingMore) return;
    const chat = selected, version = ++olderVersion.current;
    setLoadingMore(true);
    try {
      const result = await api.get<AIMessagePage>(`/ai/conversations/${chat}/messages?before=${messages[0].id}`);
      if (selectedRef.current === chat && olderVersion.current === version) {
        setMessages((prev) => [...result.messages.filter((row) => !prev.some((old) => old.id === row.id)), ...prev]);
        setHasMoreMessages(result.has_more);
      }
    } catch (e) { if (selectedRef.current === chat && olderVersion.current === version) setError(e); }
    finally { if (olderVersion.current === version) setLoadingMore(false); }
  }
  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || remoteBusy || exporting || sendingRef.current || !workspaceReady || (selected && loadingChat)) return;
    sendingRef.current = true;
    const matches = attachedMatches, drafts = attachedDrafts, maps = attachedMaps;
    const submittedDraft = draft.trim() === question ? draft : "";
    const useThink = think && Boolean(status?.provider_configured);
    setActiveThink(useThink); setThinkStage("preparing"); setThinkStarted(useThink ? Date.now() : null);
    setPendingQuestion({ text: question, afterId: messages.at(-1)?.id ?? 0 });
    // Attachments are one-message-only. Capture them before clearing the composer.
    if (submittedDraft) setDraft("");
    setAttachedMatches([]); setAttachedDrafts([]); setAttachedMaps([]);
    shouldScroll.current = true;
    setBusy(true); setError(null);
    let chatId = selected;
    try {
      if (!chatId) {
        const chat = await api.post<AIConversation>("/ai/conversations");
        chatId = chat.id; selectedRef.current = chat.id; setSelected(chat.id);
        setConversations((prev) => [chat, ...prev]);
      }
      const payload = {
        text: question, match_ids: matches.map((match) => match.id),
        draft_ids: drafts.map((board) => board.id), map_ids: maps.map((board) => board.id),
        share_board_context: drafts.length + maps.length > 0, web_mode: webMode, think: useThink,
      };
      const endpoint = `/ai/conversations/${chatId}/messages`;
      const result = useThink ? await api.postStream<AISendResult>(`${endpoint}/stream`, payload, (stage) => {
        if (Object.prototype.hasOwnProperty.call(THINK_STAGES, stage)) setThinkStage(stage as AIProgressStage);
      }) : await api.post<AISendResult>(endpoint, payload);
      if (selectedRef.current === chatId) {
        requestVersion.current++;
        setLoadingChat(false); setRemoteBusy(null); shouldScroll.current = true;
        setMessages((prev) => [...prev.filter((row) => row.id !== result.user_message.id && row.id !== result.assistant_message.id), result.user_message, result.assistant_message]);
      }
      setConversations((prev) => [result.conversation, ...prev.filter((row) => row.id !== result.conversation.id)]);
      setSelectedFromSearch(result.conversation); setSearchRevision((value) => value + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The message could not be sent.";
      const attachmentNote = matches.length + drafts.length + maps.length ? " Reattach any matches or boards if needed." : "";
      setError(new Error(`${message} Your message may already be saved; check the conversation before retrying.${attachmentNote}`));
      if (selectedRef.current === chatId && submittedDraft) setDraft((previous) => previous || submittedDraft);
      // The server may have saved the question before a network interruption.
      // Reload without automatically resending it or restoring revoked attachments.
      if (chatId && selectedRef.current === chatId) {
        try {
          const result = await api.get<AIMessagePage>(`/ai/conversations/${chatId}/messages`);
          requestVersion.current++; setLoadingChat(false); shouldScroll.current = true; setMessages(result.messages); setHasMoreMessages(result.has_more);
          setRemoteBusy(result.processing ? { think: Boolean(result.processing_think) } : null);
        } catch { /* Keep the original error and the unsent text. */ }
      }
    } finally { sendingRef.current = false; setBusy(false); setActiveThink(false); setPendingQuestion(null); setThinkStarted(null); }
  }
  function submit(e: FormEvent) { e.preventDefault(); void send(draft); }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); }
  }
  async function removeChat() {
    if (!selected || !window.confirm("Delete this conversation and all its messages from the app? Learned memories remain until you delete them in Manage context. Existing backups or provider logs may retain copies.")) return;
    const id = selected;
    try {
      await api.del(`/ai/conversations/${id}`);
      setConversations((prev) => prev.filter((item) => item.id !== id));
      setSearchRevision((value) => value + 1);
      if (selectedRef.current === id) newChat();
    } catch (e) { setError(e); }
  }
  async function exportChat() {
    if (!selected || busy || exporting || exportLock.current) return;
    if (!window.confirm("Download this private conversation as a plaintext JSON file? Anyone with access to the file can read it, even if you later delete the chat.")) return;
    exportLock.current = true; setExporting(true); setError(null);
    try {
      const first = await api.get<AIExport>(`/ai/conversations/${selected}/export`);
      const result = await collectAIExport(first, (after, through) =>
        api.get<AIExport>(`/ai/conversations/${selected}/export${qs({ after, through })}`));
      if (result.truncated && !window.confirm(`This conversation has more than ${AI_EXPORT_LIMIT} messages. This file will include only its oldest ${AI_EXPORT_LIMIT} messages. Download this partial export?`)) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `9-clover-ai-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setError(e); }
    finally { exportLock.current = false; setExporting(false); }
  }
  async function saveRename(e: FormEvent) {
    e.preventDefault();
    if (!selected || !rename?.trim()) return;
    try {
      const updated = await api.patch<AIConversation>(`/ai/conversations/${selected}`, { title: rename.trim() });
      setConversations((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)]);
      setSelectedFromSearch(updated); setSearchRevision((value) => value + 1); setRename(null);
    } catch (e2) { setError(e2); }
  }
  const giveFeedback = useCallback(async (id: number, rating: -1 | 0 | 1) => {
    const chat = selectedRef.current;
    if (!chat) return;
    try {
      const updated = await api.patch<AIMessage>(`/ai/conversations/${chat}/messages/${id}/feedback`, { rating });
      if (selectedRef.current === chat) setMessages((prev) => prev.map((msg) => msg.id === id ? updated : msg));
    } catch (e) { setError(e); }
  }, []);

  const tabs: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare }, { id: "knowledge", label: "Knowledge", icon: BookOpenText },
    { id: "contribute", label: "Contribute", icon: Lightbulb }, ...(me.role === "admin" ? [{ id: "review" as const, label: "Review", icon: ShieldCheck }] : []),
  ];
  const searchActive = filter.trim().length >= 2;
  const historyProps = {
    conversations, searchResults, selected, filter, setFilter, searching, searchError,
    hasMore: searchActive ? searchHasMore : hasMoreChats,
    onMore: () => void (searchActive ? moreSearch() : moreChats()),
    onSelect: selectChat, onNew: newChat, disabled: busy || exporting,
    onRetry: () => setSearchRevision((value) => value + 1),
  };
  const panelHeight = `h-[min(740px,calc(100vh-235px))] min-h-[560px] sm:min-h-[600px] ${
    desktopLayout.headerOpen ? "" : "md:h-[calc(100dvh-125px)] md:min-h-[480px]"
  }`;
  return <div className="space-y-4 pb-3">
    <header className="relative overflow-hidden rounded-xl border border-edge bg-panel" style={{ backgroundImage: "radial-gradient(circle at 85% -40%, rgba(52,211,153,.14), transparent 42%), radial-gradient(circle at 0% 0%, rgba(225,29,72,.12), transparent 35%)" }}>
      <h1 className="sr-only">9 CLOVER AI</h1>
      <div id="ai-workspace-intro" className={`${desktopLayout.headerOpen ? "" : "md:hidden"} flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6 pb-4`}>
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl border border-edge-2 bg-ink/70 p-1.5 shrink-0"><BrandImg size={40} /></div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="section-pill section-pill--leaf">YOUR MLBB INTELLIGENCE</span><span className="text-[9px] uppercase font-extrabold tracking-wider text-faint">· Member workspace</span></div>
            <p aria-hidden="true" className="text-[22px] sm:text-3xl font-extrabold tracking-tight leading-tight mt-1">9 CLOVER <span className="text-leaf">AI</span></p>
            <p className="text-[11px] sm:text-[12px] text-mute mt-1.5">Your game. Your questions. Your edge.</p>
          </div>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold ${status?.provider_configured ? "border-leaf/25 text-leaf bg-leaf/5" : "border-amber/25 text-amber bg-amber/5"}`} title={status?.provider_note}>
          <span className={`h-1.5 w-1.5 rounded-full ${status?.provider_configured ? "bg-leaf" : "bg-amber"}`} />
          {status ? (status.provider_configured ? "AI configured" : "Basic mode") : "Checking AI"}
        </div>
      </div>
      <div className={`flex items-center ${desktopLayout.headerOpen ? "border-t border-edge/70" : "border-t border-edge/70 md:border-t-0"}`}>
        <nav aria-label="AI workspace sections" className="flex gap-1 overflow-x-auto min-w-0 flex-1 px-3 sm:px-5">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
            className={`flex items-center gap-1.5 px-3 py-3 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider border-b-2 whitespace-nowrap ${tab === id ? "border-leaf text-text" : "border-transparent text-faint hover:text-mute"}`}><Icon size={14} />{label}</button>)}
        </nav>
        <div role="group" aria-label="Desktop layout controls" className="hidden md:flex items-center gap-1.5 shrink-0 pr-3 py-1.5">
          <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[10px]" aria-controls="site-desktop-navigation" aria-expanded={desktopLayout.navigationOpen}
            aria-label={desktopLayout.navigationOpen ? "Hide site navigation" : "Show site navigation"} title={desktopLayout.navigationOpen ? "Hide site navigation" : "Show site navigation"}
            onClick={() => onToggleDesktopLayout("navigationOpen")}>
            {desktopLayout.navigationOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}<span className="hidden lg:inline">{desktopLayout.navigationOpen ? "Hide nav" : "Show nav"}</span>
          </button>
          <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[10px]" aria-controls="ai-workspace-intro" aria-expanded={desktopLayout.headerOpen}
            aria-label={desktopLayout.headerOpen ? "Hide AI header" : "Show AI header"} title={desktopLayout.headerOpen ? "Hide AI header" : "Show AI header"}
            onClick={() => onToggleDesktopLayout("headerOpen")}>
            {desktopLayout.headerOpen ? <PanelTopClose size={15} /> : <PanelTopOpen size={15} />}<span className="hidden lg:inline">{desktopLayout.headerOpen ? "Hide header" : "Show header"}</span>
          </button>
        </div>
      </div>
    </header>

    {tab === "chat" ? <div className={`grid gap-3 ${desktopLayout.historyOpen ? "lg:grid-cols-[228px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)]"}`}>
      <aside id="ai-desktop-history" aria-label="Conversation history" className={`${desktopLayout.historyOpen ? "hidden lg:block" : "hidden"} rounded-xl border border-edge bg-panel ${panelHeight}`}><HistoryPanel {...historyProps} /></aside>
      <aside id="ai-mobile-history" ref={mobileHistoryRef} aria-label="Conversation history" className={`${showHistory ? "" : "hidden"} lg:hidden rounded-xl border border-edge bg-panel h-72`}><HistoryPanel {...historyProps} /></aside>
      <section aria-label="AI conversation" className={`rounded-xl border border-edge bg-panel min-w-0 flex flex-col ${panelHeight}`}>
        <div className={`flex flex-wrap items-center gap-2 max-[430px]:gap-y-1 sm:gap-3 border-b border-edge px-3 sm:px-4 py-3 max-[430px]:py-2 ${desktopLayout.headerOpen ? "" : "md:py-2"}`}>
          <button className="btn-ghost lg:hidden !p-2" type="button" aria-controls="ai-mobile-history" aria-expanded={showHistory}
            aria-label={showHistory ? "Close conversation history" : "Open conversation history"} onClick={() => setShowHistory(!showHistory)}><History size={15} /></button>
          <button type="button" className="btn-ghost hidden lg:inline-flex !p-2 !text-[10px]" aria-controls="ai-desktop-history" aria-expanded={desktopLayout.historyOpen}
            aria-label={desktopLayout.historyOpen ? "Hide conversation history" : "Show conversation history"} title={desktopLayout.historyOpen ? "Hide conversation history" : "Show conversation history"}
            onClick={() => onToggleDesktopLayout("historyOpen")}><History size={15} /><span className="hidden lg:inline">{desktopLayout.historyOpen ? "Hide chats" : "Show chats"}</span></button>
          <div className={`min-w-[160px] flex-1 ${desktopLayout.headerOpen ? "" : "md:min-w-0"}`}><div className={desktopLayout.headerOpen ? "" : "md:hidden"}><div className="section-pill">PRIVATE CONVERSATION</div></div><div className={`text-[12px] font-extrabold truncate mt-1 ${desktopLayout.headerOpen ? "" : "md:mt-0"}`}>{current?.title || "New conversation"}</div></div>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            {selected && <><button type="button" className="btn-ghost !p-2" aria-label="Download conversation" title="Download conversation" disabled={busy || exporting} onClick={() => void exportChat()}>{exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}</button>
              <button type="button" className="btn-ghost !p-2" aria-label="Rename conversation" disabled={busy || exporting} onClick={() => setRename(current?.title ?? "")}><PenLine size={14} /></button>
              <button type="button" className="btn-ghost !p-2 hover:!text-crim" aria-label="Delete conversation" disabled={busy || exporting} onClick={() => void removeChat()}><Trash2 size={14} /></button></>}
            <button type="button" aria-label="Your context" className="btn-ghost !p-2 sm:!px-3 sm:!py-2" onClick={() => setShowControls(true)}><Settings2 size={15} /><span className="hidden sm:inline text-[11px]">Your context</span></button>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 min-h-0">
          {loadingChat ? <div className="h-full grid place-items-center text-[12px] text-faint"><span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Loading conversation…</span></div> : messages.length || showPending ?
            <div className={`${desktopLayout.historyOpen && desktopLayout.navigationOpen ? "max-w-3xl" : "max-w-4xl"} mx-auto space-y-5`} aria-live="polite">
              {hasMoreMessages && <button type="button" className="btn-ghost !text-[10px] mx-auto flex" disabled={loadingMore} onClick={() => void olderMessages()}>{loadingMore ? "Loading…" : "Load earlier messages"}</button>}
              {messages.map((message) => <MessageBubble key={message.id} message={message} conversationId={selected} onFeedback={giveFeedback} onManageMemory={() => setShowControls(true)} onProposal={(id, proposal) => setMessages((previous) => previous.map((item) => item.id === id ? { ...item, proposal } : item))} />)}
              {showPending && pendingQuestion && <div className="flex justify-end"><div className="max-w-[92%] sm:max-w-[78%] rounded-2xl rounded-tr-sm border border-crim/25 bg-crim/10 px-4 py-3 text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words">{pendingQuestion.text}</div></div>}
              {waiting && (waitingForThink ? <ThinkingIndicator stage={busy ? thinkStage : null} startedAt={busy ? thinkStarted : null} /> : <div role="status" className="flex items-center gap-2 text-[11px] text-mute"><Loader2 size={14} className="animate-spin motion-reduce:animate-none text-leaf" /> 9 Clover AI is working…</div>)}
            </div> :
            <div className="min-h-full flex flex-col justify-center max-w-2xl mx-auto py-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-leaf uppercase"><Sparkles size={13} /> Made for your game</div>
              <h2 className="text-[22px] sm:text-[28px] leading-tight font-extrabold mt-2">What are we working on, <span className="text-leaf">{me.ign || me.name}</span>?</h2>
              <p className="text-[12px] text-mute leading-relaxed mt-2 max-w-lg">Ask about MLBB, explore ideas, or use your own data for coaching. You choose what personal context to share.</p>
              <div className="grid sm:grid-cols-2 gap-2 mt-6">{SUGGESTIONS.map(({ label, hint, icon: Icon, prompt }) => <button key={label} type="button" disabled={waiting || !workspaceReady} onClick={() => void send(prompt)} className="group text-left rounded-lg border border-edge bg-raised/40 hover:bg-raised hover:border-leaf/30 p-3 transition-colors min-w-0">
                <span className="flex items-center gap-2"><Icon size={15} className="text-leaf" /><span className="text-[12px] font-extrabold flex-1">{label}</span><ArrowDownRight size={13} className="text-faint group-hover:text-leaf" /></span>
                <span className="text-[10px] text-faint block mt-2">{hint}</span>
              </button>)}</div>
              {waiting && <div className="mt-4">{waitingForThink ? <ThinkingIndicator stage={busy ? thinkStage : null} startedAt={busy ? thinkStarted : null} /> : <div role="status" className="flex items-center gap-2 text-[11px] text-mute"><Loader2 size={14} className="animate-spin motion-reduce:animate-none text-leaf" /> 9 Clover AI is working…</div>}</div>}
            </div>}
        </div>
        <div className="px-3 sm:px-4 pb-3 pt-2 border-t border-edge/70">
          {status && !status.provider_configured && <p className="text-[10px] text-amber leading-relaxed mb-1">
            The AI provider isn’t configured or its key can’t be unlocked. {me.role === "admin" ? <button type="button" className="underline font-bold" onClick={() => navigate("admin")}>Set it up in Team Admin</button> : "Ask an admin to configure it in Team Admin."} Until then, only local facts are available.
          </p>}
          <ErrorNote error={error} />
          {!workspaceReady && Boolean(error) && <button type="button" className="text-[11px] text-leaf underline mt-2" onClick={() => { setError(null); setReloadKey((value) => value + 1); }}>Retry loading AI controls</button>}
          {attachedMatches.length > 0 && <div className="mt-2 rounded-lg border border-leaf/20 bg-leaf/5 p-2.5" aria-label="Attached match context">
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-extrabold uppercase tracking-wider text-leaf mr-1">Saved matches</span>{attachedMatches.map((match) => <button type="button" key={match.id} disabled={waiting || exporting}
              aria-label={`Remove ${teamCode(match.team1)} vs ${teamCode(match.team2)} from chat`} onClick={() => setAttachedMatches((previous) => previous.filter((item) => item.id !== match.id))}
              className="max-w-full inline-flex items-center gap-1 rounded-md border border-edge-2 bg-panel px-2 py-1 text-[10px] font-semibold text-mute hover:text-crim disabled:opacity-50"><span className="truncate">{teamCode(match.team1)} vs {teamCode(match.team2)}</span><X size={11} className="shrink-0" /></button>)}</div>
            <p className="text-[10px] text-faint mt-1.5 leading-relaxed">Included with your next message only, then cleared. Earlier chat history may still mention them.</p>
          </div>}
          {(attachedDrafts.length > 0 || attachedMaps.length > 0) && <div className="mt-2 rounded-lg border border-leaf/20 bg-leaf/5 p-2.5" aria-label="Attached board context">
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-extrabold uppercase tracking-wider text-leaf mr-1">Saved boards</span>
              {attachedDrafts.map((board) => <button type="button" key={`draft-${board.id}`} disabled={waiting || exporting} aria-label={`Remove draft ${board.name} from chat`} onClick={() => setAttachedDrafts((previous) => previous.filter((item) => item.id !== board.id))}
                className="max-w-full inline-flex items-center gap-1 rounded-md border border-edge-2 bg-panel px-2 py-1 text-[10px] font-semibold text-mute hover:text-crim disabled:opacity-50"><span className="truncate">Draft · {board.name}</span><X size={11} className="shrink-0" /></button>)}
              {attachedMaps.map((board) => <button type="button" key={`map-${board.id}`} disabled={waiting || exporting} aria-label={`Remove map ${board.name} from chat`} onClick={() => setAttachedMaps((previous) => previous.filter((item) => item.id !== board.id))}
                className="max-w-full inline-flex items-center gap-1 rounded-md border border-edge-2 bg-panel px-2 py-1 text-[10px] font-semibold text-mute hover:text-crim disabled:opacity-50"><span className="truncate">Map · {board.name}</span><X size={11} className="shrink-0" /></button>)}
            </div><p className="text-[10px] text-mute mt-1.5 leading-relaxed">The latest saved board contents and notes, including team edits, are shared with your next message only, then cleared. Earlier chat history may still mention them.</p>
          </div>}
          <form onSubmit={submit} className="rounded-xl border border-edge-2 bg-raised/80 mt-2 focus-within:border-leaf/50">
            <textarea aria-label="Ask 9 Clover AI" className="w-full resize-none bg-transparent outline-none px-3.5 pt-3 text-[12px] sm:text-[13px] placeholder:text-faint min-h-16 max-h-40" rows={2}
              maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keyDown}
              onFocus={(e) => revealAIComposer(e.currentTarget, window.innerWidth)} placeholder="Ask anything about MLBB…" />
            <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
                <button type="button" aria-pressed={think} aria-label="Think mode" onClick={() => setThink((value) => !value)}
                  disabled={waiting || exporting || !workspaceReady || !status?.provider_configured}
                  title={status?.provider_configured ? "Use deeper analysis for your questions" : "Configure the AI provider to use Think mode"}
                  className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[10px] font-extrabold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf disabled:opacity-50 ${think ? "border-leaf/60 bg-leaf/15 text-leaf" : "border-edge-2 bg-panel text-mute hover:border-leaf/40 hover:text-text"}`}><BrainCircuit size={13} /> Think</button>
                <button type="button" onClick={() => setShowMatchPicker(true)} disabled={waiting || exporting || !workspaceReady} className="text-[10px] text-faint hover:text-leaf inline-flex items-center gap-1.5 disabled:opacity-50"><Paperclip size={12} /> Attach match</button>
                <button type="button" onClick={() => setShowBoardPicker(true)} disabled={waiting || exporting || !workspaceReady} className="text-[10px] text-faint hover:text-leaf inline-flex items-center gap-1.5 disabled:opacity-50"><Paperclip size={12} /> Attach boards</button>
                <button type="button" onClick={() => setShowControls(true)} className="text-[10px] text-faint hover:text-leaf inline-flex items-center gap-1.5"><LockKeyhole size={12} /> Manage context</button>
              </div>
              <div className="flex items-center gap-2"><span className="text-[10px] text-faint hidden sm:block">Enter to send · Shift + Enter for a new line</span>
                <button type="submit" disabled={!draft.trim() || waiting || exporting || !workspaceReady || (Boolean(selected) && loadingChat)} aria-label="Send message" className="rounded-lg bg-leaf text-ink p-2 hover:bg-emerald-300 disabled:opacity-40 transition-colors"><Send size={15} /></button></div>
            </div>
          </form>
          {think && <p className="text-[10px] text-mute leading-relaxed mt-2">Think stays on until you switch it off or reload. Deeper analysis can take minutes and may use more credits; closing the tab won’t stop an active request.</p>}
          <AIWebControls mode={webMode} onChange={setWebMode} enabled={Boolean(status?.web_search_enabled)} disabled={waiting || exporting || !workspaceReady} dailyLimit={status?.web_search_daily_limit ?? 10} />
          {me.role === "admin" && <p className="text-[10px] text-leaf mt-2">Ask Clover to prepare drafts, strategies, heroes, patch labels or equipment changes for your review. Attach an existing draft to change its patch.</p>}
          <p className="text-[10px] text-mute leading-relaxed mt-2">Explicit teachings can be saved privately. Relevant memories, your question, enabled context, attached boards and esports evidence may be sent to the external AI provider. <button type="button" className="text-leaf underline" onClick={() => setShowControls(true)}>Manage memory & context</button>. Named MPL questions may retrieve a public Rone feed even with web search off. Avoid sharing secrets.</p>
        </div>
      </section>
    </div> : <div className="rounded-xl border border-edge bg-panel p-4 sm:p-6 min-h-[400px]">
      {tab === "knowledge" ? <AIKnowledge canModerate={me.role === "admin"} /> : tab === "contribute" ? <AIContributions /> : <div className="space-y-5"><AIActionHistory /><AIReviewQueue /></div>}
    </div>}

    {showMatchPicker && <Modal title="Attach saved matches" onClose={() => setShowMatchPicker(false)} wide>
      <AIMatchPicker initial={attachedMatches} onCancel={() => setShowMatchPicker(false)} onApply={(items) => { setAttachedMatches(items); setShowMatchPicker(false); }} />
    </Modal>}
    {showBoardPicker && <Modal title="Attach saved boards" onClose={() => setShowBoardPicker(false)} wide>
      <AIBoardPicker initialDrafts={attachedDrafts} initialMaps={attachedMaps} onCancel={() => setShowBoardPicker(false)} onApply={(drafts, maps) => { setAttachedDrafts(drafts); setAttachedMaps(maps); setShowBoardPicker(false); }} />
    </Modal>}
    {showControls && <Modal title="Your AI data controls" onClose={() => setShowControls(false)} wide>
      {settings ? <AIDataControls settings={settings} context={context} onChange={setSettings} onClearAttachments={() => { setAttachedMatches([]); setAttachedDrafts([]); setAttachedMaps([]); }} /> : <p className="text-[12px] text-faint">Data controls could not be loaded. Reopen the workspace to try again.</p>}
    </Modal>}
    {rename !== null && <Modal title="Rename conversation" onClose={() => setRename(null)}><form onSubmit={saveRename} className="space-y-4">
      <Field label="Conversation title"><input className="input" value={rename} maxLength={120} onChange={(e) => setRename(e.target.value)} autoFocus /></Field>
      <ErrorNote error={error} /><div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setRename(null)}><X size={14} /> Cancel</button><button className="btn-primary" disabled={!rename.trim()}><Check size={14} /> Save</button></div>
    </form></Modal>}
  </div>;
}
