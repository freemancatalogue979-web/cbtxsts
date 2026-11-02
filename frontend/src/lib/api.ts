/** Thin API client — JWT in localStorage, JSON in/out. */
export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, payload: unknown) {
    const detail = (payload as { detail?: unknown })?.detail;
    super(typeof detail === "string" ? detail : `Request failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

const TOKEN_KEY = "clover_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const attempt = async (): Promise<Response> =>
    fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await attempt();
  // backend may be mid-restart during deploys — GETs get one quick retry
  if (method === "GET" && !res.ok && res.status >= 500) {
    await new Promise((r) => setTimeout(r, 900));
    res = await attempt();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let payload: unknown = undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      setToken(null);
      // bounce to login
      window.dispatchEvent(new Event("clover:unauthorized"));
    }
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}

// A bounded newline-delimited stream keeps long AI analysis connections active.
// The server sends actual progress stages, heartbeats and one result or error;
// it never sends raw model reasoning or credentials.
async function postStream<T>(path: string, body: unknown, onStage: (stage: string) => void): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = text; }
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event("clover:unauthorized")); }
    throw new ApiError(res.status, payload);
  }
  if (!res.body) throw new Error("The analysis connection is unavailable. Check the conversation before retrying.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("The analysis response was too large.");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          let event: { type?: string; stage?: unknown; result?: T; status?: number; detail?: string };
          try { event = JSON.parse(line); } catch { throw new Error("The analysis response was interrupted."); }
          if (!event || typeof event !== "object") throw new Error("The analysis response was interrupted.");
          if (event.type === "status" && typeof event.stage === "string") onStage(event.stage);
          else if (event.type === "error") {
            if (event.status === 401) { setToken(null); window.dispatchEvent(new Event("clover:unauthorized")); }
            throw new ApiError(event.status ?? 500, { detail: event.detail ?? "The analysis could not be completed." });
          } else if (event.type === "result" && event.result && typeof event.result === "object") return event.result;
          else if (event.type !== "heartbeat") throw new Error("The analysis response was interrupted.");
        }
        newline = buffer.indexOf("\n");
      }
      if (done) throw new Error("The analysis connection ended before the reply arrived. Check the conversation before retrying.");
    }
  } finally {
    try { await reader.cancel(); } catch { /* The server may have already closed the stream. */ }
    reader.releaseLock();
  }
}

async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: form });
  const text = await res.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = text; }
  if (!res.ok) {
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event("clover:unauthorized")); }
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  postStream: <T>(path: string, body: unknown, onStage: (stage: string) => void) => postStream<T>(path, body, onStage),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => uploadForm<T>(path, form),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}
