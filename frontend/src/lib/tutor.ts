/**
 * AI Tutor client: typed calls, the streaming reader and the "Ask AI Tutor"
 * bridge other screens use to open the tutor with context attached.
 *
 * Every request goes to our own backend — the AI key never reaches the browser.
 */
import {ApiError, tokenStore} from './api';

export type TutorMode =
  | 'CHAT' | 'EXPLAIN' | 'QUESTION_HELP' | 'WHY_WRONG' | 'TEACH' | 'SIMPLE' | 'EXAMPLE' | 'SUMMARY'
  | 'NOTES' | 'GLOSSARY' | 'STUDY_PLAN' | 'WHAT_TO_STUDY' | 'IMAGE_EXPLANATION'
  | 'HINT' | 'SIMILAR' | 'PROGRESS' | 'SOCRATIC' | 'EXAM_REVISION';

export interface TutorContext {
  course_id?: number | null;
  topic?: string;
  question_id?: number;
  selected?: string | null;
  material_id?: number;
  section_id?: number;
  upload_id?: number;
  selected_text?: string;
  summary_length?: 'quick' | 'detailed' | 'revision';
  socratic?: boolean;
}

export interface LearningProfile {
  explanation_style: 'simple' | 'balanced' | 'detailed' | 'socratic';
  difficulty: 'easy' | 'medium' | 'hard';
  language: string;
  goals: string;
}
export type TutorFeatures = Record<'images' | 'materials' | 'flashcards' | 'practice' | 'study_plans' | 'quiz' | 'saving' | 'uploads', boolean>;

export interface TutorStatus {
  configured: boolean;
  enabled: boolean;
  model: string;
  limits: {daily: number; monthly: number; per_minute: number; max_message_chars: number; max_upload_mb: number};
  usage: {today: number; month: number};
  remaining_today: number;
  exam_locked: string | null;
  provider?: string;
  user_disabled?: boolean;
  features?: TutorFeatures;
  exam?: {active: boolean; mode: string | null};
  profile?: LearningProfile;
}

export interface TutorCourse {
  id: number;
  code: string;
  title: string;
  topics: {id: number; name: string}[];
}
export interface TutorUpload {
  id: number;
  title: string;
  sections: number;
  status?: 'processing' | 'ready' | 'failed';
  error?: string | null;
}
export interface Conversation {
  id: number;
  title: string;
  course_id: number | null;
  topic: string;
  archived: boolean;
  archived_at?: string | null;
  /** Temporary chats stay out of the history unless switched to permanent. */
  temporary?: boolean;
  context_type?: string;
  created_at: string;
  last_message_at: string | null;
  messages?: number;
  snippet?: string;
}
export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  type: string;
  meta: Record<string, unknown>;
  created_at: string;
  feedback?: number;
  /** client-only */
  pending?: boolean;
  failed?: boolean;
}

export interface Flashcard {
  id?: number;
  next_review_at?: string | null;
  interval_days?: number;
  front: string;
  back: string;
  topic?: string;
  difficulty?: string;
}
export interface Deck {
  title: string;
  cards: Flashcard[];
}
export interface PracticeQuestion {
  id?: number;
  times_answered?: number;
  times_correct?: number;
  type: 'mcq' | 'true_false' | 'short_answer' | 'calculation' | 'scenario';
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  topic?: string;
  difficulty?: string;
}
export interface PracticeSet {
  title: string;
  questions: PracticeQuestion[];
  attempts?: number;
  best_score?: number;
  last_score?: number | null;
}
export interface PlanItem {
  id?: number;
  topic: string;
  activity: string;
  duration: number;
  status?: 'pending' | 'completed' | 'skipped';
}
export interface StudyPlan {
  title: string;
  overview?: string;
  tips?: string[];
  exam_date?: string | null;
  minutes_per_day?: number;
  days: {date: string; items: PlanItem[]}[];
  progress?: {done: number; total: number; skipped: number};
}
export interface PracticeResult {
  answered: number;
  correct: number;
  score: number | null;
  best: number;
  attempts: number;
  topics: {topic: string; answered: number; correct: number; accuracy: number}[];
  weak: string[];
  strong: string[];
}
export interface StudyDashboard {
  counts: Record<'flashcards' | 'cards_due' | 'practice' | 'material' | 'notes' | 'plan', number>;
  flashcards_due: number;
  weak: {topic: string; accuracy: number; attempted: number; course_id?: number | null}[];
  strong: {topic: string; accuracy: number; attempted: number}[];
  accuracy: number | null;
  attempted: number;
  repeated_mistakes: {question_id: number; text: string; topic: string; times: number}[];
  upcoming: {exam: string; at: string | null}[];
  today_plan: {id: number; plan_id: number; plan: string; topic: string; activity: string; duration: number; status: string}[];
  recommended: {topic: string; course_id?: number | null; reason: string; activity: string; minutes: number} | null;
}
export interface StudyMaterial {
  title: string;
  overview?: string;
  objectives?: string[];
  sections: {heading: string; content: string}[];
  definitions?: {term: string; meaning: string}[];
  examples?: string[];
  common_mistakes?: string[];
  exam_tips?: string[];
  summary?: string;
  practice_questions?: {question: string; answer: string}[];
}
export interface NotesDoc {
  title: string;
  content: string;
}

export type GenKind = 'flashcards' | 'practice' | 'material' | 'plan';
export type SavedKind = GenKind | 'notes';
export interface SavedItem {
  id: number;
  key?: string;
  due?: number;
  attempts?: number;
  best_score?: number;
  exam_date?: string | null;
  done?: number;
  kind: SavedKind;
  title: string;
  course_id: number | null;
  topic: string;
  items: number;
  created_at: string;
  updated_at: string;
  data?: Deck | PracticeSet | StudyMaterial | NotesDoc | StudyPlan;
}
export type SavedCounts = StudyDashboard['counts'];

export interface GenerateSource extends TutorContext {
  conversation_id?: number;
  message_id?: number;
  questions?: number[];
  missed?: string[];
  similar_to?: {question: string};
  plan?: {exam_date?: string; minutes_per_day?: number; days?: number; subjects?: string; topics?: string; difficulty?: string};
}
export interface GenerateReply {
  kind: GenKind;
  data: Deck | PracticeSet | StudyMaterial | StudyPlan;
  model: string;
  remaining_today: number;
  set_id?: number;
  plan_id?: number;
  source?: {source_type: string; source_id: number | null; course_id: number | null; topic: string};
}
export interface RouteReply {
  route: 'generate';
  kind: 'flashcards' | 'practice' | 'quiz' | 'plan';
  count: number | null;
  text: string;
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path.startsWith('/api/') ? path : `/api/tutor${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...(body !== undefined && !isForm ? {'Content-Type': 'application/json'} : {}),
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the arena server. Check your connection and try again.', 0);
  }
  return readJson<T>(response);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.ok ? 'The server sent an unexpected reply.' : `The server had a problem (${response.status}). Try again in a moment.`, response.status);
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? String((payload as {detail: unknown}).detail) : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return payload as T;
}

export const tutorApi = {
  status: () => call<TutorStatus>('/status'),
  options: () => call<{courses: TutorCourse[]; uploads: TutorUpload[]}>('/options'),
  conversations: (archived = false, q = '') =>
    call<{conversations: Conversation[]}>(`/conversations?${q ? `q=${encodeURIComponent(q)}` : archived ? 'archived=true' : ''}`),
  createConversation: (body: {course_id?: number | null; topic?: string; context_type?: string; temporary?: boolean} = {}) => call<Conversation>('/conversations', 'POST', body),
  conversation: (id: number) => call<Conversation & {messages: TutorMessage[]}>(`/conversations/${id}`),
  updateConversation: (id: number, body: Partial<Pick<Conversation, 'title' | 'archived' | 'course_id' | 'topic' | 'temporary'>>) => call<Conversation>(`/conversations/${id}`, 'PATCH', body),
  deleteConversation: (id: number) => call<{ok: boolean}>(`/conversations/${id}`, 'DELETE'),
  restoreConversation: (id: number) => call<Conversation>(`/conversations/${id}/restore`, 'POST'),
  cancel: (requestId: string) => call<{ok: boolean; cancelled: boolean}>(`/streams/${requestId}/cancel`, 'POST'),
  feedback: (messageId: number, body: {rating: 1 | -1 | 0; reason?: string; comment?: string}) => call<{ok: boolean; rating: number}>(`/messages/${messageId}/feedback`, 'POST', body),
  profile: () => call<LearningProfile>('/profile'),
  saveProfile: (body: Partial<LearningProfile>) => call<LearningProfile>('/profile', 'PUT', body),
  generate: (body: {kind: GenKind | 'quiz'; count?: number; difficulty?: string; types?: string[]; source: GenerateSource; instructions?: string}) =>
    call<GenerateReply>('/generate', 'POST', {...body, kind: body.kind.toUpperCase()}),
  saved: (kind = '', q = '') => call<{items: SavedItem[]; counts: SavedCounts}>(`/saved?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  savedItem: (kind: SavedKind, id: number) => call<SavedItem>(`/saved/${kind}/${id}`),
  save: (body: {kind: SavedKind; title?: string; data?: object; course_id?: number | null; topic?: string; conversation_id?: number | null; set_id?: number; plan_id?: number; source_type?: string; source_id?: number | null}) =>
    call<SavedItem>('/saved', 'POST', body),
  updateSaved: (kind: SavedKind, id: number, body: {title?: string; data?: object}) => call<SavedItem>(`/saved/${kind}/${id}`, 'PATCH', body),
  deleteSaved: (kind: SavedKind, id: number) => call<{ok: boolean}>(`/saved/${kind}/${id}`, 'DELETE'),
  duplicateSaved: (kind: SavedKind, id: number) => call<SavedItem>(`/saved/${kind}/${id}/duplicate`, 'POST'),
  reviewCard: (cardId: number, rating: 'know' | 'dont_know') => call<{id: number; next_review_at: string; interval_days: number}>(`/flashcards/${cardId}/review`, 'POST', {rating}),
  practiceResults: (setId: number, answers: {question_id: number; correct: boolean}[]) => call<PracticeResult>(`/practice-sets/${setId}/results`, 'POST', {answers}),
  updatePlanItem: (planId: number, itemId: number, body: {status?: string; date?: string}) => call<SavedItem>(`/plans/${planId}/items/${itemId}`, 'PATCH', body),
  dashboard: () => call<StudyDashboard>('/dashboard'),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call<{id: number; title: string; sections: number; words: number; status: string}>('/uploads', 'POST', form);
  },
  uploadStatus: (id: number) => call<{id: number; title: string; status: string; error?: string | null; sections: number; words: number}>(`/uploads/${id}`),
  deleteUpload: (id: number) => call<{ok: boolean}>(`/uploads/${id}`, 'DELETE'),
};

export interface TutorAdminSettings {
  ai_enabled: boolean;
  ai_daily_limit: number;
  ai_monthly_limit: number;
  ai_per_minute: number;
  ai_max_concurrent: number;
  ai_max_message_chars: number;
  ai_max_response_tokens: number;
  ai_max_conversations: number;
  ai_exam_safe: boolean;
  ai_provider: string;
  ai_model: string;
  ai_exam_mode: string;
  ai_monthly_budget_usd: number;
  ai_retention_deleted_days: number;
  ai_retention_logs_days: number;
  ai_retention_unsaved_days: number;
  ai_feat_images: boolean;
  ai_feat_materials: boolean;
  ai_feat_flashcards: boolean;
  ai_feat_practice: boolean;
  ai_feat_study_plans: boolean;
  ai_feat_quiz: boolean;
  ai_feat_saving: boolean;
  ai_feat_uploads: boolean;
  ai_agent_enabled: boolean;
  ai_agent_max_steps: number;
  ai_staff_daily_limit: number;
  ai_mini_exam_daily_limit: number;
  ai_exam_feedback: boolean;
}
export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  active: boolean;
  model: string;
  default_model: string;
  fallbacks: string[];
  pricing: Record<string, {input: number; cached: number; output: number}>;
  key_env: string;
  /** Where the key comes from: typed in the admin panel, the server's .env, or none. */
  key_source?: 'admin' | 'env' | '';
  /** Masked, e.g. "AQ.A…9Q2x" — the full key never leaves the server. */
  key_hint?: string;
  key_updated_at?: string | null;
  key_updated_by?: string | null;
  env_key_present?: boolean;
}
export type AdminRange = {range: string; start?: string; end?: string};
export interface TutorOverview {
  range: {from: string; to: string; label: string};
  totals: {
    requests: number; successful: number; failed: number; rate_limited: number; invalid_json: number; cancelled: number; active_users: number;
    input_tokens: number; output_tokens: number; cached_tokens: number; tokens: number; estimated_cost: number; average_latency_ms: number;
    average_response_chars: number; failure_rate: number; conversations: number; month_cost: number;
  };
  daily: {day: string; requests: number; tokens: number; cost: number}[];
  by_feature: {kind: string; requests: number; cost: number}[];
  by_model: {provider: string; model: string; requests: number; input_tokens: number; output_tokens: number; cached_tokens: number; cost: number; pricing: {input: number; cached: number; output: number}}[];
  top_students: {id: number; name: string; username: string; requests: number; cost: number}[];
}
export interface TutorAdminUser {
  id: number; name: string; username: string; banned: boolean; ai_disabled: boolean; daily_limit: number; monthly_limit: number;
  custom_quota: boolean; today: number; month: number; note: string; requests?: number; tokens?: number; cost?: number; last_used?: string | null;
}
export interface TutorAdminUserDetail extends TutorAdminUser {
  by_feature: {kind: string; requests: number}[];
  conversations: {id: number; title: string; messages: number; context_type: string; archived: boolean; deleted: boolean; last_message_at: string | null}[];
  saved: SavedCounts;
}
export interface TutorQuality {
  range: string;
  feedback: {helpful: number; not_helpful: number; negative_rate: number};
  reasons: {reason: string; count: number}[];
  reported_topics: {topic: string; count: number}[];
  recent_negative: {at: string; reason: string; comment: string; topic: string; course_id: number | null}[];
  failed_requests: number;
  failure_rate: number;
  invalid_json: number;
  invalid_json_rate: number;
}
export interface TutorLog {
  id: number; at: string; request_id: string; user: {id: number; name: string}; kind: string; provider: string; model: string; status: string;
  input_tokens: number; output_tokens: number; cached_tokens: number; cost: number; latency_ms: number; course_id: number | null; error: string;
}
type AdminSettingsReply = {
  settings: TutorAdminSettings;
  provider: {name: string; id: string; configured: boolean; model: string};
  providers: ProviderInfo[];
  exam_modes: string[];
  features: string[];
  key_result?: {ok: boolean; message: string};
};
const qs = (r: AdminRange, extra: Record<string, string | number | undefined> = {}) => {
  const p = new URLSearchParams();
  p.set('range', r.range);
  if (r.start) p.set('start', r.start);
  if (r.end) p.set('end', r.end);
  Object.entries(extra).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)));
  return p.toString();
};

export const tutorAdminApi = {
  settings: () => call<AdminSettingsReply>('/api/admin/tutor/settings'),
  update: (body: Partial<TutorAdminSettings>) => call<AdminSettingsReply>('/api/admin/tutor/settings', 'PUT', body),
  saveKey: (provider: string, key: string) => call<AdminSettingsReply>(`/api/admin/tutor/keys/${provider}`, 'PUT', {key}),
  removeKey: (provider: string) => call<AdminSettingsReply>(`/api/admin/tutor/keys/${provider}`, 'DELETE'),
  test: () => call<{ok: boolean; provider: string; model: string; reply?: string; latency_ms?: number; error?: string}>('/api/admin/tutor/test', 'POST'),
  overview: (r: AdminRange) => call<TutorOverview>(`/api/admin/tutor/overview?${qs(r)}`),
  users: (r: AdminRange, q = '') => call<{range: string; users: TutorAdminUser[]}>(`/api/admin/tutor/users?${qs(r, {q})}`),
  user: (id: number) => call<TutorAdminUserDetail>(`/api/admin/tutor/users/${id}`),
  userSettings: (id: number, body: {disabled?: boolean; daily_limit?: number | null; monthly_limit?: number | null; note?: string}) => call<TutorAdminUser>(`/api/admin/tutor/users/${id}/settings`, 'PUT', body),
  resetQuota: (id: number) => call<TutorAdminUser>(`/api/admin/tutor/users/${id}/reset-quota`, 'POST'),
  conversations: (q = '') => call<{conversations: {id: number; title: string; student: {id: number; name: string; username: string}; messages: number; context_type: string; archived: boolean; deleted: boolean; last_message_at: string | null}[]}>(`/api/admin/tutor/conversations?q=${encodeURIComponent(q)}`),
  courses: (r: AdminRange) => call<{range: string; general_requests: number; courses: {id: number; code: string; title: string; requests: number; students: number; cost: number; top_topics: {topic: string; chats: number}[]}[]}>(`/api/admin/tutor/courses?${qs(r)}`),
  quality: (r: AdminRange) => call<TutorQuality>(`/api/admin/tutor/quality?${qs(r)}`),
  logs: (r: AdminRange, filters: {status?: string; kind?: string; user_id?: number; page?: number}) => call<{range: string; total: number; page: number; per_page: number; logs: TutorLog[]}>(`/api/admin/tutor/logs?${qs(r, filters)}`),
  models: () => call<{providers: ProviderInfo[]}>('/api/admin/tutor/models'),
  cleanup: () => call<{ok: boolean; removed: {conversations: number; events: number; practice_sets: number}}>('/api/admin/tutor/cleanup', 'POST'),
};

export interface StreamHandlers {
  onMeta?: (meta: {conversation_id: number; user_message_id: number; request_id: string; title: string; model: string; context?: Record<string, unknown>}) => void;
  onDelta: (text: string) => void;
  onDone: (done: {message_id: number; remaining_today: number; finish?: string}) => void;
  onError: (detail: string, partial: boolean) => void;
  onCancelled?: (info: {message_id: number | null}) => void;
  /** "make 10 flashcards" etc. — the server asks the app to open a tool */
  onRoute?: (route: RouteReply) => void;
  /** the agent is using a platform tool (running → ok / error / denied) */
  onTool?: (tool: ToolEvent) => void;
  /** things the agent made for the student (a mini exam card…) */
  onActions?: (actions: AgentAction[]) => void;
}

export interface ToolEvent {
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error' | 'denied' | 'invalid';
  summary?: string;
  ms?: number;
}

export interface MiniExamCard {
  type: 'mini_exam';
  id: number;
  title: string;
  question_count: number;
  duration_minutes: number;
  difficulty: string;
  topics: string[];
  course?: string | null;
}
export interface ProposalCard {
  type: 'proposal';
  id: number;
  kind: 'topics' | 'questions' | 'classification' | string;
  title: string;
  course?: string | null;
  count: number;
}
export interface TaskCard {
  type: 'task';
  id: number;
  title: string;
  course: string;
  status: string;
  estimate?: {calls?: number; cost?: number; minutes?: number; materials?: number; bank_questions?: number};
}
export type AgentAction = MiniExamCard | ProposalCard | TaskCard;

/** POST a message and read the server-sent events as they arrive. Errors
 * before the stream starts (limits, exam lock, AI down…) throw ApiError. */
export function streamMessage(
  conversationId: number,
  body: {content: string; mode?: TutorMode; context?: TutorContext; image?: string | null; route?: boolean},
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamRequest(`/api/tutor/conversations/${conversationId}/messages`, body, handlers, signal);
}

/** Ask again (optionally simpler / with an example / shorter / more detailed). */
export function streamRegenerate(conversationId: number, style: '' | 'simpler' | 'example' | 'shorter' | 'detailed', handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  return streamRequest(`/api/tutor/conversations/${conversationId}/regenerate`, {style}, handlers, signal);
}

async function streamRequest(url: string, body: object, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const token = tokenStore.get();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    throw new ApiError('Cannot reach the arena server. Check your connection and try again.', 0);
  }
  if (!response.ok || !response.body) {
    await readJson(response);
    throw new ApiError('The tutor did not answer. Try again.', response.status);
  }
  if ((response.headers.get('Content-Type') || '').includes('application/json')) {
    const route = await readJson<RouteReply>(response);
    if (route && route.route === 'generate') handlers.onRoute?.(route);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const handle = (block: string) => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'meta') handlers.onMeta?.(parsed as never);
    else if (event === 'delta') handlers.onDelta(String(parsed.text ?? ''));
    else if (event === 'tool') handlers.onTool?.(parsed as never);
    else if (event === 'actions') handlers.onActions?.((parsed.actions as AgentAction[]) ?? []);
    else if (event === 'done') {
      finished = true;
      handlers.onDone(parsed as never);
    } else if (event === 'cancelled') {
      finished = true;
      handlers.onCancelled?.(parsed as never);
    } else if (event === 'error') {
      finished = true;
      handlers.onError(String(parsed.detail ?? 'Something went wrong.'), Boolean(parsed.partial));
    }
  };
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    if (!finished) handlers.onError('The connection dropped while the tutor was answering. Try again.', true);
    return;
  }
  if (!finished && !signal?.aborted) handlers.onError('The answer stopped early. Try again.', true);
}

/** Read an image file as a data URL (validated again on the server). */
export function readImage(file: File, maxMb = 4): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, WEBP or GIF image.'));
    if (file.size > maxMb * 1024 * 1024) return reject(new Error(`Images must be ${maxMb} MB or smaller.`));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

/* --------------------------------------------------------------- bridge */
export const ASK_TUTOR_EVENT = 'arena:ask-tutor';

/* ------------------------------------------------------------- mini exams */
/** App-level route opener: the tutor lives inside the dashboard, the exam is its own screen. */
export const OPEN_MINI_EXAM_EVENT = 'ag:open-mini-exam';
export function openMiniExam(id: number): void {
  window.dispatchEvent(new CustomEvent(OPEN_MINI_EXAM_EVENT, {detail: {id}}));
}

export type MiniExamStatus = 'ready' | 'in_progress' | 'submitted' | 'expired';
export interface MiniExamQuestion {
  question_id: number;
  position: number;
  text: string;
  image_url: string | null;
  options: {key: string; text: string}[];
  topic: string;
  difficulty: string;
  marks: number;
  selected: string | null;
  correct?: string;
  is_correct?: boolean | null;
  explanation?: string;
}
export interface MiniExamTopicRow {topic: string; correct: number; total: number; wrong: number; skipped: number; percentage: number}
export interface MiniExamAction {type: 'review' | 'mini_exam' | 'flashcards'; topic: string; label: string}
export interface MiniExamAnalysis {
  score: number;
  total: number;
  percentage: number;
  correct: number;
  wrong: number;
  skipped: number;
  questions: number;
  topics: MiniExamTopicRow[];
  difficulty: {level: string; correct: number; total: number; percentage: number}[];
  weak_topics: string[];
  strong_topics: string[];
  avg_seconds: number | null;
  time_used_seconds: number | null;
  previous_percentage: number | null;
  change: number | null;
  recommended_actions: MiniExamAction[];
  ai?: MiniExamFeedback;
}
export interface MiniExamFeedback {headline: string; summary: string; mistake_patterns: string[]; recommended_actions: string[]}
export interface MiniExam {
  id: number;
  title: string;
  status: MiniExamStatus;
  created_by: string;
  course: {id: number; code: string; title: string} | null;
  topics: string[];
  difficulty: string;
  question_count: number;
  duration_minutes: number;
  started_at: string | null;
  deadline_at: string | null;
  finished_at: string | null;
  seconds_left: number | null;
  answered: number;
  created_at: string | null;
  score?: number;
  total?: number;
  percentage?: number;
  analysis?: MiniExamAnalysis;
  questions?: MiniExamQuestion[];
}

export const miniExamApi = {
  list: () => call<{mini_exams: MiniExam[]}>('/api/ai/mini-exams'),
  create: (body: {course_id: number; topics?: string[]; difficulty?: string; question_count: number; duration_minutes?: number; focus?: 'mixed' | 'weak' | 'new'}) =>
    call<MiniExam>('/api/ai/mini-exams', 'POST', body),
  get: (id: number) => call<MiniExam>(`/api/ai/mini-exams/${id}`),
  start: (id: number) => call<MiniExam>(`/api/ai/mini-exams/${id}/start`, 'POST'),
  answer: (id: number, question_id: number, selected: string | null, seconds: number) =>
    call<{question_id: number; selected: string | null; answered: number; seconds_left: number | null}>(`/api/ai/mini-exams/${id}/answer`, 'POST', {question_id, selected, seconds}),
  finish: (id: number) => call<MiniExam>(`/api/ai/mini-exams/${id}/finish`, 'POST'),
  feedback: (id: number) => call<{feedback: MiniExamFeedback; cached: boolean}>(`/api/ai/mini-exams/${id}/feedback`, 'POST'),
  remove: (id: number) => call<{ok: boolean}>(`/api/ai/mini-exams/${id}`, 'DELETE'),
};

/* ------------------------------------------------------- staff assistant */
export interface StaffToolInfo {name: string; label: string; status: string; summary?: string; ms?: number}
/** One entry in the assistant's visible work log, in the order it happened. */
export type WorkStep =
  | {kind: 'thought'; step: number; text: string}
  | {kind: 'note'; text: string}
  | {kind: 'tool'; tool: StaffToolInfo};
export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
  display?: string;
  files?: {id: number; title: string; words?: number}[];
  tools?: StaffToolInfo[];
  actions?: AgentAction[];
  failed?: boolean;
  /** stopped by the staff member before it finished */
  stopped?: boolean;
  /** thinking mode was on for this turn */
  thinking?: boolean;
  /** model reasoning, replayed with the history (DeepSeek requires it in thinking mode) */
  reasoning?: string;
  work?: WorkStep[];
  meta?: {cost?: number; ms?: number; at?: string};
}

export interface StaffStreamHandlers {
  onMeta?: (meta: {request_id: string; model: string; thinking: boolean}) => void;
  onStatus?: (text: string) => void;
  onThinking?: (thought: {step: number; text: string}) => void;
  onNote?: (text: string) => void;
  onTool?: (tool: StaffToolInfo) => void;
  onActions?: (actions: AgentAction[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (done: {usage?: {cost?: number}; tools?: StaffToolInfo[]; model?: string; ms?: number}) => void;
  onCancelled?: () => void;
  onError?: (detail: string) => void;
}

/** POST to the staff assistant and read its server-sent events live. Errors
 * before the stream starts (limits, no key) throw ApiError. The turn itself
 * runs on the server: if the connection drops, this re-attaches and replays
 * from the last event seen. Abort the signal to stop reading (and call
 * aiStaffApi.stopAgent to actually stop the work). */
export async function streamStaffAgent(
  body: {messages: {role: 'user' | 'assistant'; content: string; reasoning?: string}[]; course_id?: number | null; thinking?: boolean},
  handlers: StaffStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return followStaffAgent(
    (token) =>
      fetch('/api/admin/ai/agent/stream', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        body: JSON.stringify(body),
        signal,
      }),
    null,
    handlers,
    signal,
  );
}

/** Re-attach to a turn that is (or was recently) running on the server. */
export async function resumeStaffAgent(requestId: string, handlers: StaffStreamHandlers, signal?: AbortSignal): Promise<void> {
  return followStaffAgent(null, requestId, handlers, signal);
}

async function followStaffAgent(
  open: ((token: string | null) => Promise<Response>) | null,
  knownId: string | null,
  handlers: StaffStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let requestId = knownId;
  let seen = 0;
  let finished = false;
  let retries = 0;
  const wrapped: StaffStreamHandlers = {
    ...handlers,
    onMeta: (meta) => {
      requestId = meta.request_id;
      handlers.onMeta?.(meta);
    },
  };
  for (;;) {
    const token = tokenStore.get();
    let response: Response;
    try {
      response =
        open && !requestId
          ? await open(token)
          : await fetch(`/api/admin/ai/agent/${requestId}/events?after=${seen}`, {headers: {Accept: 'text/event-stream', ...(token ? {Authorization: `Bearer ${token}`} : {})}, signal});
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (requestId && retries < 8) {
        retries += 1;
        await new Promise((r) => setTimeout(r, Math.min(8000, 800 * retries)));
        continue;
      }
      throw new ApiError('Cannot reach the arena server. Check your connection and try again.', 0);
    }
    if (!response.ok || !response.body) {
      if (requestId && response.status === 404) {
        handlers.onError?.('That reply is no longer available on the server.');
        return;
      }
      await readJson(response);
      throw new ApiError('The assistant did not answer. Try again.', response.status);
    }
    const result = await readStaffEvents(response, wrapped, signal, (id) => (seen = Math.max(seen, id)));
    if (result === 'finished') finished = true;
    if (finished || signal?.aborted) return;
    // dropped mid-turn: the server keeps working — re-attach and replay the rest
    if (!requestId || retries >= 8) {
      handlers.onError?.('The connection dropped while the assistant was working. Try again.');
      return;
    }
    retries += 1;
    handlers.onStatus?.('Reconnecting — the assistant is still working…');
    await new Promise((r) => setTimeout(r, Math.min(6000, 600 * retries)));
  }
}

async function readStaffEvents(response: Response, handlers: StaffStreamHandlers, signal: AbortSignal | undefined, onId: (id: number) => void): Promise<'finished' | 'dropped'> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const handle = (block: string) => {
    let event = 'message';
    let data = '';
    let id = 0;
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line.startsWith('id:')) id = Number(line.slice(3).trim()) || 0;
    }
    if (id) onId(id);
    if (!data) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'meta') handlers.onMeta?.(parsed as never);
    else if (event === 'status') handlers.onStatus?.(String(parsed.text ?? ''));
    else if (event === 'thinking') handlers.onThinking?.(parsed as never);
    else if (event === 'note') handlers.onNote?.(String(parsed.text ?? ''));
    else if (event === 'tool') handlers.onTool?.(parsed as never);
    else if (event === 'actions') handlers.onActions?.((parsed.actions as AgentAction[]) ?? []);
    else if (event === 'delta') handlers.onDelta?.(String(parsed.text ?? ''));
    else if (event === 'done') {
      finished = true;
      handlers.onDone?.(parsed as never);
    } else if (event === 'cancelled') {
      finished = true;
      handlers.onCancelled?.();
    } else if (event === 'error') {
      finished = true;
      handlers.onError?.(String(parsed.detail ?? 'Something went wrong.'));
    }
  };
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handle(buffer);
  } catch (error) {
    if ((error as Error).name === 'AbortError' || signal?.aborted) return 'finished';
  }
  return finished ? 'finished' : 'dropped';
}
export interface Proposal {
  id: number;
  kind: string;
  course_id: number | null;
  course?: string | null;
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  count: number;
  created_at: string | null;
  decided_at: string | null;
  result: Record<string, unknown>;
  payload?: {items?: Record<string, unknown>[]; rationale?: string; [key: string]: unknown};
  task_id?: number | null;
}
export interface AIStaffStatus {
  configured: boolean;
  provider: string;
  model: string;
  agent_enabled: boolean;
  pending_proposals: number;
  used_today: number;
  daily_limit: number;
  cost_today?: number;
  cost_month?: number;
  budget_month?: number;
  requests_today?: number;
  tools: {student: string[]; staff: string[]};
}
export interface AICourseCard {id: number; code: string; title: string; active: boolean; bank: number; topics: number; materials: number; pending: number; attempts: number}
export interface AIInsightIssue {id: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; prompt: string; action: string; count: number | null}
export interface AIInsights {
  courses: AICourseCard[];
  course?: {id: number; code: string; title: string; active: boolean};
  score?: number;
  issues?: AIInsightIssue[];
  bank?: {total: number; by_difficulty: Record<string, number>; by_status: Record<string, number>; drafts: number; flagged: number};
  coverage?: {topic: string; questions: number; curated: boolean}[];
  materials?: {total: number; published: number};
  exams?: {total: number; live: number};
  topics?: number;
  performance?: {attempts: number; average: number; topics: {topic: string; accuracy: number | null; answers: number}[]; flagged: {id: number; text: string; topic: string; correct: string; correct_rate: number; flags: string[]}[]};
  weakest?: {id: number; text: string; accuracy: number}[];
  most_missed?: {id: number; text: string; wrong: number}[];
  duplicates?: unknown[];
}
export interface ToolCallRow {id: number; tool: string; role: string; status: string; summary: string; ms: number; at: string; student_id: number | null; admin_id: number | null; arguments?: Record<string, unknown>}
export interface AIUsageReport {
  days: number;
  total_cost: number;
  features: {feature: string; requests: number; input: number; output: number; cache_hit: number; cache_rate: number; cost: number}[];
  daily: {day: string; cost: number; requests: number}[];
}

export type AITaskStatus = 'queued' | 'running' | 'done' | 'stopped' | 'failed' | 'cancelled' | 'interrupted';
export interface AITaskParams {
  course_id?: number;
  material_ids?: number[];
  build_topics?: boolean;
  classify_questions?: boolean;
  map_materials?: boolean;
  reclassify_difficulty?: boolean;
  only_untagged?: boolean;
  generate_questions?: number;
  write_materials?: boolean;
  remove_duplicates?: boolean;
  difficulty?: {easy: number; medium: number; hard: number};
  topics?: string[];
  topic_count?: number;
  instructions?: string;
  max_cost?: number;
}
export interface AITaskEstimate {materials: number; characters: number; passages: number; bank_questions: number; calls: number; input_tokens: number; output_tokens: number; cost: number; minutes: number; max_cost: number; model: string; provider: string}
export interface AITaskProposal {id: number; kind: string; title: string; count: number; status: 'pending' | 'approved' | 'rejected' | 'missing'}
export interface AITask {
  id: number;
  course_id: number | null;
  course?: string | null;
  title: string;
  status: AITaskStatus;
  stage: string;
  progress: {stage?: string; done?: number; total?: number; label?: string; percent?: number; stages?: string[]};
  result: {
    read?: {materials: number; passages: number; characters: number};
    topics?: {total: number; new: number; names: string[]};
    classify?: {questions: number; changed: number; unmatched: number};
    generate?: {asked: number; made: number; duplicates?: number; invalid?: number};
    [key: string]: unknown;
  };
  error: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  params: AITaskParams & {estimate?: AITaskEstimate};
  cancel_requested: boolean;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  log: {at: string; level: 'info' | 'warn'; text: string}[];
  proposals: AITaskProposal[];
}
export interface AITaskLimits {max_questions: number; default_max_cost: number; hard_max_cost: number; workers: number}
export interface AITaskApproval {approved: number; topics: number; questions: number; classified: number; materials: number; edited?: number; deleted?: number; new_materials?: number; errors: string[]}

export const aiStaffApi = {
  tasks: (courseId?: number | null) => call<{tasks: AITask[]; limits: AITaskLimits}>(`/api/admin/ai/tasks${courseId ? `?course_id=${courseId}` : ''}`),
  task: (id: number) => call<AITask>(`/api/admin/ai/tasks/${id}`),
  estimateTask: (params: AITaskParams) => call<{estimate: AITaskEstimate; title: string}>('/api/admin/ai/tasks/estimate', 'POST', params),
  startTask: (params: AITaskParams) => call<AITask>('/api/admin/ai/tasks', 'POST', params),
  cancelTask: (id: number) => call<AITask>(`/api/admin/ai/tasks/${id}/cancel`, 'POST'),
  approveTask: (id: number, confirm = false) => call<AITaskApproval>(`/api/admin/ai/tasks/${id}/approve-all`, 'POST', {confirm}),
  status: () => call<AIStaffStatus>('/api/admin/ai/status'),
  chat: (messages: {role: 'user' | 'assistant'; content: string}[], course_id?: number | null) =>
    call<{reply: string; tools: StaffToolInfo[]; actions: AgentAction[]; usage: {cost: number}; request_id: string}>('/api/admin/ai/agent', 'POST', {messages, course_id}),
  stopAgent: (requestId: string) => call<{ok: boolean; stopped: boolean}>(`/api/admin/ai/agent/${requestId}/stop`, 'POST'),
  proposals: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') => call<{proposals: Proposal[]}>(`/api/admin/ai/proposals?status=${status}`),
  proposal: (id: number) => call<Proposal>(`/api/admin/ai/proposals/${id}`),
  approve: (id: number, body: {selected?: number[]; items?: Record<string, unknown>[]; confirm?: boolean}) => call<Proposal>(`/api/admin/ai/proposals/${id}/approve`, 'POST', body),
  reject: (id: number, reason: string) => call<Proposal>(`/api/admin/ai/proposals/${id}/reject`, 'POST', {reason}),
  usage: (days = 30) => call<AIUsageReport>(`/api/admin/ai/usage?days=${days}`),
  insights: (courseId?: number | null) => call<AIInsights>(`/api/admin/ai/insights${courseId ? `?course_id=${courseId}` : ''}`),
  toolCalls: (limit = 100) => call<{calls: ToolCallRow[]}>(`/api/admin/ai/tool-calls?limit=${limit}`),
};

export interface TutorAsk {
  /** Message to send (autoSend) or pre-fill. */
  prompt?: string;
  mode?: TutorMode;
  context?: TutorContext;
  /** Short label for the attached-context chip, e.g. "Question 4". */
  label?: string;
  autoSend?: boolean;
  newChat?: boolean;
  /** Open as a temporary chat (not saved unless the student keeps it). */
  temporary?: boolean;
}

let pendingAsk: TutorAsk | null = null;

/** Open the AI Tutor tab from anywhere with context attached. The shell
 * switches tab; the panel picks the request up when it mounts. */
export function askTutor(ask: TutorAsk): void {
  pendingAsk = ask;
  window.dispatchEvent(new CustomEvent(ASK_TUTOR_EVENT, {detail: ask}));
}

export function takePendingAsk(): TutorAsk | null {
  const ask = pendingAsk;
  pendingAsk = null;
  return ask;
}

export function downloadText(filename: string, text: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([text], {type: `${type};charset=utf-8`}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[^\w.\- ]+/g, '').trim() || 'download.md';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function materialToMarkdown(m: StudyMaterial): string {
  const out = [`# ${m.title}`, ''];
  if (m.overview) out.push(m.overview, '');
  if (m.objectives?.length) out.push('## Learning objectives', ...m.objectives.map((o) => `- ${o}`), '');
  m.sections.forEach((s) => out.push(`## ${s.heading}`, s.content, ''));
  if (m.definitions?.length) out.push('## Key definitions', ...m.definitions.map((d) => `- **${d.term}** — ${d.meaning}`), '');
  if (m.examples?.length) out.push('## Examples', ...m.examples.map((e) => `- ${e}`), '');
  if (m.common_mistakes?.length) out.push('## Common mistakes', ...m.common_mistakes.map((e) => `- ${e}`), '');
  if (m.exam_tips?.length) out.push('## Exam tips', ...m.exam_tips.map((e) => `- ${e}`), '');
  if (m.summary) out.push('## Summary', m.summary, '');
  if (m.practice_questions?.length) out.push('## Practice questions', ...m.practice_questions.map((q, i) => `${i + 1}. ${q.question}\n   - Answer: ${q.answer}`), '');
  return out.join('\n');
}
