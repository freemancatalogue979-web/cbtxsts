/**
 * AI Tutor client: typed calls, the streaming reader and the "Ask AI Tutor"
 * bridge other screens use to open the tutor with context attached.
 *
 * Every request goes to our own backend — the AI key never reaches the browser.
 */
import {ApiError, tokenStore} from './api';

export type TutorMode =
  | 'CHAT' | 'EXPLAIN' | 'QUESTION_HELP' | 'WHY_WRONG' | 'TEACH' | 'SIMPLE' | 'EXAMPLE' | 'SUMMARY'
  | 'NOTES' | 'GLOSSARY' | 'STUDY_PLAN' | 'WHAT_TO_STUDY' | 'IMAGE_EXPLANATION';

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
}

export interface TutorStatus {
  configured: boolean;
  enabled: boolean;
  model: string;
  limits: {daily: number; monthly: number; per_minute: number; max_message_chars: number; max_upload_mb: number};
  usage: {today: number; month: number};
  remaining_today: number;
  exam_locked: string | null;
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
}
export interface Conversation {
  id: number;
  title: string;
  course_id: number | null;
  topic: string;
  archived: boolean;
  created_at: string;
  last_message_at: string | null;
  messages?: number;
}
export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  type: string;
  meta: Record<string, unknown>;
  created_at: string;
  /** client-only */
  pending?: boolean;
  failed?: boolean;
}

export interface Flashcard {
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

export type GenKind = 'flashcards' | 'practice' | 'material';
export type SavedKind = GenKind | 'notes' | 'plan';
export interface SavedItem {
  id: number;
  kind: SavedKind;
  title: string;
  course_id: number | null;
  topic: string;
  items: number;
  created_at: string;
  updated_at: string;
  data?: Deck | PracticeSet | StudyMaterial | NotesDoc;
}

export interface GenerateSource extends TutorContext {
  conversation_id?: number;
  questions?: number[];
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
  conversations: (archived = false) => call<{conversations: Conversation[]}>(`/conversations${archived ? '?archived=true' : ''}`),
  createConversation: (body: {course_id?: number | null; topic?: string} = {}) => call<Conversation>('/conversations', 'POST', body),
  conversation: (id: number) => call<Conversation & {messages: TutorMessage[]}>(`/conversations/${id}`),
  updateConversation: (id: number, body: Partial<Pick<Conversation, 'title' | 'archived' | 'course_id' | 'topic'>>) => call<Conversation>(`/conversations/${id}`, 'PATCH', body),
  deleteConversation: (id: number) => call<{ok: boolean}>(`/conversations/${id}`, 'DELETE'),
  restoreConversation: (id: number) => call<Conversation>(`/conversations/${id}/restore`, 'POST'),
  generate: (body: {kind: GenKind; count?: number; difficulty?: string; types?: string[]; source: GenerateSource; instructions?: string}) =>
    call<{kind: GenKind; data: Deck | PracticeSet | StudyMaterial; model: string; remaining_today: number}>('/generate', 'POST', {...body, kind: body.kind.toUpperCase()}),
  saved: (kind = '') => call<{items: SavedItem[]}>(`/saved${kind ? `?kind=${kind}` : ''}`),
  savedItem: (id: number) => call<SavedItem>(`/saved/${id}`),
  save: (body: {kind: SavedKind; title?: string; data: object; course_id?: number | null; topic?: string; conversation_id?: number | null}) => call<SavedItem>('/saved', 'POST', body),
  updateSaved: (id: number, body: {title?: string; data?: object}) => call<SavedItem>(`/saved/${id}`, 'PATCH', body),
  deleteSaved: (id: number) => call<{ok: boolean}>(`/saved/${id}`, 'DELETE'),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call<{id: number; title: string; sections: number; words: number}>('/uploads', 'POST', form);
  },
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
}
export interface TutorAdminUsage {
  days: number;
  totals: {requests: number; failed: number; rate_limited: number; tokens: number; estimated_cost: number; average_latency_ms: number; students: number};
  daily: {day: string; requests: number; tokens: number; cost: number}[];
  top_students: {id: number; name: string; requests: number; cost: number}[];
  recent_errors: {at: string; kind: string; error: string}[];
}
type AdminSettingsReply = {settings: TutorAdminSettings; provider: {name: string; configured: boolean; model: string; base: string}};

export const tutorAdminApi = {
  settings: () => call<AdminSettingsReply>('/api/admin/tutor/settings'),
  update: (body: Partial<TutorAdminSettings>) => call<AdminSettingsReply>('/api/admin/tutor/settings', 'PUT', body),
  usage: (days = 30) => call<TutorAdminUsage>(`/api/admin/tutor/usage?days=${days}`),
};

export interface StreamHandlers {
  onMeta?: (meta: {conversation_id: number; user_message_id: number; title: string; model: string}) => void;
  onDelta: (text: string) => void;
  onDone: (done: {message_id: number; remaining_today: number; finish?: string}) => void;
  onError: (detail: string, partial: boolean) => void;
}

/** POST a message and read the server-sent events as they arrive. Errors
 * before the stream starts (limits, exam lock, AI down…) throw ApiError. */
export async function streamMessage(
  conversationId: number,
  body: {content: string; mode?: TutorMode; context?: TutorContext; image?: string | null},
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = tokenStore.get();
  let response: Response;
  try {
    response = await fetch(`/api/tutor/conversations/${conversationId}/messages`, {
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
    else if (event === 'done') {
      finished = true;
      handlers.onDone(parsed as never);
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

export interface TutorAsk {
  /** Message to send (autoSend) or pre-fill. */
  prompt?: string;
  mode?: TutorMode;
  context?: TutorContext;
  /** Short label for the attached-context chip, e.g. "Question 4". */
  label?: string;
  autoSend?: boolean;
  newChat?: boolean;
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
