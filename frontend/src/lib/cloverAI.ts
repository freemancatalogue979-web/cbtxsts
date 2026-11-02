export type AIStatus = {
  provider_configured: boolean;
  provider_note: string;
  knowledge: string;
  patch_feed: string;
  web_search: string;
  web_search_enabled: boolean;
  web_search_daily_limit: number | null;
  account_match_history: string;
  tournament_participation: string;
  prediction_engine: string;
};

export type AISettings = {
  share_profile: boolean;
  share_account_stats: boolean;
  share_pool: boolean;
  share_scrims: boolean;
  use_history: boolean;
  coaching_goal: string;
};

export type AIContext = {
  profile: { name: string; main_role: string | null };
  linked_account: null | { name: string | null; level: number | null; rank_level: number | null; role_id: string; zone_id: string };
  pool: { hero: string; category: string; confidence: number; games_recorded: number; wins_recorded: number; losses_recorded: number }[];
  pool_truncated: boolean;
  scrims: { opponent: string; date: string | null; assignment: string; status: string; result: string | null }[];
  scrim_scan_truncated: boolean;
  scrim_note: string;
};

export type AIMemoryCategory = "strength" | "focus" | "preference" | "goal";
export type AIMemoryNote = {
  id: string; category: AIMemoryCategory; content: string; share_in_context: boolean;
  created_at: string; updated_at: string;
};

export type AILearnedMemory = {
  id: string; topic: string; content: string; source_kind: "teaching" | "research";
  source_title: string | null; source_url: string | null; published_at: string | null; retrieved_at: string | null;
  verification: "unverified"; author: "you"; conversation_id: string | null; message_id: number | null; created_at: string;
};
export type AILearnedMemoryState = { auto_learn: boolean; use_memory: boolean; limit: number; items: AILearnedMemory[] };

export type AIConversation = { id: string; title: string; created_at: string; updated_at: string };
export type AIVisual =
  | { kind: "hero"; name: string; title: string; roles: string[]; ratings: Record<string, number> }
  | { kind: "picks_chart"; title: string; bars: { label: string; value: number }[]; complete_games: number; omitted_heroes: number; incomplete_data: boolean; notice: string };
export type AISource = {
  kind: "personal" | "hero" | "community" | "match" | "web" | "draft" | "map" | "esports_feed" | "learned" | "team_item"; label: string; route?: string; knowledge_id?: string; memory_id?: string;
  url?: string | null; excerpt?: string; reviewed_at?: string; observed_at?: string | null; detail_fetched_at?: string | null; match_id?: string;
  published_at?: string | null; auto_selected?: boolean; board_id?: number; esports_selection?: AIEsportsSelection; visual?: AIVisual;
};
export type AIProposal = {
  id: string; kind: "create_draft" | "create_strategy" | "create_hero" | "update_hero" | "set_patch" | "set_draft_patch" | "create_item";
  status: "pending" | "applied" | "discarded"; payload: Record<string, unknown>; before: Record<string, unknown>;
  target_id: number | null; created_at: string; expires_at: string; resolved_at: string | null;
};
export type AIMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  mode: "user" | "ai" | "think" | "facts" | "guidance";
  note: string;
  sources: AISource[];
  proposal?: AIProposal | null;
  feedback: -1 | 0 | 1;
  created_at: string;
};
export type AIList<T> = { items: T[]; has_more: boolean };
export type AIMessagePage = { messages: AIMessage[]; has_more: boolean; conversation?: AIConversation; processing?: boolean; processing_think?: boolean };
export type AIProgressStage = "preparing" | "loading_game_data" | "loading_matches" | "checking" | "connecting" | "thinking" | "writing" | "finishing";
export type AIEsportsRegion = "id" | "ph" | "my" | "kh";
export type AIEsportsSelection = {
  source: "rone" | "aerena"; mode: "week" | "matches" | "playoffs"; region?: AIEsportsRegion;
  league_id?: string; phase?: "regular" | "playoffs" | "all"; week?: number; match_ids?: string[];
};
export type AIEsportsAttachment = { selection: AIEsportsSelection; label: string; chosen: { id: string; label: string; phase?: "regular" | "playoffs" }[] };
export const AI_ESPORTS_MATCH_LIMIT = 500;
export type AISendResult = { conversation: AIConversation; user_message: AIMessage; assistant_message: AIMessage };
export type AIExport = {
  format: string; exported_at: string; conversation: AIConversation; messages: AIMessage[];
  truncated: boolean; message_limit: number; snapshot_through: number; next_after: number | null; notice: string;
};

export type AIWebMode = "auto" | "on" | "off";
export type AIBoardSummary = { id: number; name: string; opponent: string; updated_at: string | null };
export const AI_MATCH_LIMIT = 3;
export const AI_BOARD_LIMIT = 2;
export const AI_EXPORT_LIMIT = 2000;

// A tab remembers only its open conversation ID, not chat text or attachments.
export function readAISelectedChat(storage: Pick<Storage, "getItem"> | null, userId: number): string | null {
  try {
    const id = storage?.getItem(`clover_ai_open_chat_${userId}`) ?? null;
    return id && /^[a-f0-9]{32}$/i.test(id) ? id : null;
  } catch { return null; }
}
export function saveAISelectedChat(storage: Pick<Storage, "setItem" | "removeItem"> | null, userId: number, id: string | null): void {
  try {
    if (id && /^[a-f0-9]{32}$/i.test(id)) storage?.setItem(`clover_ai_open_chat_${userId}`, id);
    else storage?.removeItem(`clover_ai_open_chat_${userId}`);
  } catch { /* Browser storage may be blocked. */ }
}

// Display preferences stay on this browser; they contain no chat content or personal context.
export type AIWorkspaceLayout = { navigationOpen: boolean; historyOpen: boolean; headerOpen: boolean };
export const AI_WORKSPACE_LAYOUT_KEY = "clover_ai_workspace_layout_v1";
export const DEFAULT_AI_WORKSPACE_LAYOUT: AIWorkspaceLayout = { navigationOpen: true, historyOpen: true, headerOpen: true };

export function readAIWorkspaceLayout(storage: Pick<Storage, "getItem"> | null): AIWorkspaceLayout {
  try {
    const value: unknown = JSON.parse(storage?.getItem(AI_WORKSPACE_LAYOUT_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_AI_WORKSPACE_LAYOUT };
    const saved = value as Record<string, unknown>;
    return {
      navigationOpen: typeof saved.navigationOpen === "boolean" ? saved.navigationOpen : DEFAULT_AI_WORKSPACE_LAYOUT.navigationOpen,
      historyOpen: typeof saved.historyOpen === "boolean" ? saved.historyOpen : DEFAULT_AI_WORKSPACE_LAYOUT.historyOpen,
      headerOpen: typeof saved.headerOpen === "boolean" ? saved.headerOpen : DEFAULT_AI_WORKSPACE_LAYOUT.headerOpen,
    };
  } catch {
    return { ...DEFAULT_AI_WORKSPACE_LAYOUT };
  }
}

export function saveAIWorkspaceLayout(storage: Pick<Storage, "setItem"> | null, layout: AIWorkspaceLayout): void {
  try {
    storage?.setItem(AI_WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private browsing or blocked storage should not prevent using the chat.
  }
}

export function toggleBoardSelection<T extends { id: number }>(selected: T[], board: T): T[] {
  if (selected.some((item) => item.id === board.id)) return selected.filter((item) => item.id !== board.id);
  return selected.length < AI_BOARD_LIMIT ? [...selected, board] : selected;
}

// Keep the send button above the fixed mobile navigation when typing begins.
export function revealAIComposer(element: Pick<HTMLElement, "scrollIntoView">, viewportWidth: number): void {
  if (viewportWidth < 768) element.scrollIntoView({ block: "center", behavior: "auto" });
}

// Selection stays local to the open chat; the server revalidates every ID on send.
export function toggleMatchSelection<T extends { id: string }>(selected: T[], match: T): T[] {
  if (selected.some((item) => item.id === match.id)) return selected.filter((item) => item.id !== match.id);
  return selected.length < AI_MATCH_LIMIT ? [...selected, match] : selected;
}

// Collect bounded, owner-authorized pages from one server-side high-water mark.
// Reject malformed/non-progressing cursors rather than silently downloading a
// duplicated, mixed-snapshot or unbounded file.
export async function collectAIExport(
  first: AIExport,
  fetchPage: (after: number, through: number) => Promise<AIExport>,
): Promise<AIExport> {
  const through = first.snapshot_through;
  if (!Number.isInteger(through) || through < 0) throw new Error("Invalid export snapshot. Try again.");
  const messages: AIMessage[] = [];
  let page = first;
  let after = 0;
  while (true) {
    if (page.snapshot_through !== through || page.conversation.id !== first.conversation.id || page.format !== first.format || page.messages.length > 500) {
      throw new Error("The export snapshot changed. Try again.");
    }
    let last = after;
    for (const item of page.messages) {
      if (!Number.isInteger(item.id) || item.id <= last || item.id > through) throw new Error("Invalid export page. Try again.");
      last = item.id;
    }
    if ((page.next_after !== null && (page.next_after !== last || !page.truncated)) || (page.next_after === null && page.truncated)) {
      throw new Error("Could not continue this export safely. Try again.");
    }
    messages.push(...page.messages);
    if (messages.length > AI_EXPORT_LIMIT) throw new Error("The export exceeded its safe size. Try again.");
    if (page.next_after === null || messages.length === AI_EXPORT_LIMIT) break;
    if (page.next_after <= after) throw new Error("Could not continue this export safely. Try again.");
    after = page.next_after;
    page = await fetchPage(after, through);
  }
  return { ...first, messages, truncated: page.next_after !== null, message_limit: AI_EXPORT_LIMIT, next_after: page.next_after };
}

export type AIKnowledgeNote = { id: string; title: string; content: string; source_url: string | null; reviewed_at: string; notice: string };
export type AIKnowledgeResponse = {
  notes: AIKnowledgeNote[];
  heroes: { id: number; name: string; roles: string[]; lanes: string[]; notice: string }[];
  hero_count: number;
  community_count: number;
  notice: string;
};
export type AIContribution = {
  id: string;
  kind: "question" | "correction" | "strategy" | "draft" | "feedback";
  title: string;
  content: string;
  source_url: string | null;
  status: "pending" | "approved" | "rejected" | "reviewed" | "removed";
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
  author?: string;
};

export function shortDate(value: string | null | undefined): string {
  if (!value) return "Date unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unknown" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Links are user-submitted and reviewed by a human; never make model-authored
// links clickable. No server fetch is performed for these links.
export function safeExternal(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.startsWith("[")) return undefined;
    // Browsers canonicalize shorthand and numeric IPv4 hosts; block private and
    // loopback ranges as defense in depth. The server validates sources as well.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
          (a === 198 && (b === 18 || b === 19))) return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}
