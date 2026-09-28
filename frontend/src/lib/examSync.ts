/**
 * Offline-first exam delivery.
 *
 * Every tap is written to this phone first (localStorage), then delivered to the
 * server in batches through `/api/exams/attempts/{id}/sync`. If the network is
 * down, answers wait on the device and go out automatically when it returns —
 * nothing is lost to a dropped signal, a tunnel, or a flat MiFi.
 *
 *   outbox  — answers not yet confirmed by the server, integrity events, and a
 *             pending submit (so "Submit" works even while offline)
 *   paper   — a copy of the loaded paper, so a reload while offline can still
 *             show the questions and keep going
 *
 * The server stays in charge of grading and time: it accepts queued answers
 * only until shortly after the deadline, and this module stops taking taps at
 * 0:00. Everything here is per attempt and removed once the paper is submitted.
 */
import {api, ApiError} from './api';
import type {ExamSyncResult} from './api';
import type {AttemptState, OptionKey} from './types';

export interface PendingAnswer {
  selected: OptionKey | null;
  flagged: boolean;
  seconds: number;
  /** Local edit counter — lets a confirmation clear only what it actually sent. */
  rev: number;
}

export interface ExamEvent {
  type: 'away' | 'offline' | 'copy' | 'paste' | 'fullscreen_exit';
  seconds?: number;
  question?: number;
}

interface Outbox {
  answers: Record<string, PendingAnswer>;
  events: ExamEvent[];
  submit: 'early' | 'auto_timer' | null;
  rev: number;
}

export type SyncStatus =
  | {kind: 'saved'; pending: 0}
  | {kind: 'saving'; pending: number}
  | {kind: 'offline'; pending: number}
  | {kind: 'locked'; pending: number; message: string};

const OUTBOX = (id: number) => `arena.exam.outbox.${id}`;
const PAPER = (id: number) => `arena.exam.paper.${id}`;
const BY_QUIZ = (quizId: number) => `arena.exam.quiz.${quizId}`;
const RETRY_STEPS = [2000, 4000, 8000, 15000, 30000];

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — the in-memory copy still syncs */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** A transient failure worth retrying (no network, proxy hiccup, server restart). */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/* ------------------------------------------------------------------ paper */
export interface CachedPaper {
  state: AttemptState;
  /** Wall-clock ms when `state.time_remaining` was true. */
  savedAt: number;
}

export function cachePaper(state: AttemptState): void {
  if (state.status !== 'in_progress') return;
  // Only the unrevealed paper is stored (questions + options; never answers keys).
  write(PAPER(state.id), {state: {...state, review: []}, savedAt: Date.now()} satisfies CachedPaper);
  write(BY_QUIZ(state.quiz_id), state.id);
}

/**
 * Keep the saved copy's answers current, so a reload while offline shows every
 * answer the player gave (including ones already delivered and no longer in
 * the outbox). The clock reference (savedAt/time_remaining) is left alone.
 */
export function updateCachedAnswers(attemptId: number, rows: Record<number, {selected: OptionKey | null; flagged: boolean; seconds: number}>): void {
  const paper = read<CachedPaper>(PAPER(attemptId));
  if (!paper) return;
  const answers = Object.entries(rows).map(([id, row]) => ({
    question_id: Number(id),
    selected: row.selected,
    flagged: row.flagged,
    seconds_spent: row.seconds,
  }));
  write(PAPER(attemptId), {...paper, state: {...paper.state, answers}} satisfies CachedPaper);
}

/** The saved paper for an exam, found by its quiz id (reload from the exam list). */
export function cachedPaperForQuiz(quizId: number): CachedPaper | null {
  const id = read<number>(BY_QUIZ(quizId));
  return typeof id === 'number' ? cachedPaper(id) : null;
}

export function cachedPaper(attemptId: number): CachedPaper | null {
  return read<CachedPaper>(PAPER(attemptId));
}

/** Seconds left on a cached paper, counted down with this device's clock. */
export function cachedRemaining(paper: CachedPaper): number {
  return Math.max(0, Math.round(paper.state.time_remaining - (Date.now() - paper.savedAt) / 1000));
}

export function pendingAnswers(attemptId: number): Record<string, PendingAnswer> {
  return read<Outbox>(OUTBOX(attemptId))?.answers ?? {};
}

/** Remove every trace of a finished paper from this device. */
export function forgetAttempt(attemptId: number): void {
  const paper = read<CachedPaper>(PAPER(attemptId));
  if (paper && read<number>(BY_QUIZ(paper.state.quiz_id)) === attemptId) remove(BY_QUIZ(paper.state.quiz_id));
  remove(OUTBOX(attemptId));
  remove(PAPER(attemptId));
}

/* ------------------------------------------------------------------ engine */
export class ExamSync {
  readonly attemptId: number;
  private box: Outbox;
  private inFlight: Promise<ExamSyncResult | null> | null = null;
  private timer: number | null = null;
  private failures = 0;
  private status: SyncStatus = {kind: 'saved', pending: 0};
  private listeners = new Set<(status: SyncStatus) => void>();
  private locked: string | null = null;
  private closed = false;
  /** Called once the server confirms the paper is submitted (or closed it late). */
  onSubmitted: ((result: ExamSyncResult) => void) | null = null;

  constructor(attemptId: number) {
    this.attemptId = attemptId;
    this.box = read<Outbox>(OUTBOX(attemptId)) ?? {answers: {}, events: [], submit: null, rev: 0};
    this.box.answers ??= {};
    this.box.events ??= [];
    this.box.rev ??= 0;
    this.publish();
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  get pending(): number {
    return Object.keys(this.box.answers).length + (this.box.submit ? 1 : 0);
  }

  get submitQueued(): boolean {
    return this.box.submit !== null;
  }

  private persist(): void {
    if (!this.closed) write(OUTBOX(this.attemptId), this.box);
  }

  private publish(offline = false): void {
    const pending = this.pending;
    this.status = this.locked
      ? {kind: 'locked', pending, message: this.locked}
      : pending === 0 && this.box.events.length === 0
        ? {kind: 'saved', pending: 0}
        : offline || this.failures > 0
          ? {kind: 'offline', pending}
          : {kind: 'saving', pending};
    this.listeners.forEach((listener) => listener(this.status));
  }

  putAnswer(questionId: number, answer: Omit<PendingAnswer, 'rev'>): void {
    if (this.locked || this.closed) return;
    this.box.rev += 1;
    this.box.answers[String(questionId)] = {...answer, rev: this.box.rev};
    this.persist();
    this.publish(this.failures > 0);
    this.schedule(350);
  }

  addEvent(event: ExamEvent): void {
    if (this.closed) return;
    this.box.events = [...this.box.events, event].slice(-100);
    this.persist();
    this.schedule(1500);
  }

  /** Queue the submit; it is delivered with (after) every pending answer. */
  submit(type: 'early' | 'auto_timer'): Promise<ExamSyncResult | null> {
    if (!this.box.submit || type === 'early') this.box.submit = type;
    this.persist();
    this.publish(this.failures > 0);
    return this.flush();
  }

  /** Try now (e.g. the browser reports it is back online). */
  retryNow(): void {
    this.failures = Math.min(this.failures, 1);
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.closed || this.locked) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      // Background delivery: failures are reflected in the status, not thrown.
      this.flush().catch(() => undefined);
    }, delay);
  }

  /** Deliver everything queued. Resolves with the server reply, or null if nothing was sent / it failed. */
  flush(): Promise<ExamSyncResult | null> {
    if (this.inFlight) return this.inFlight.then(() => (this.pending || this.box.events.length ? this.flush() : null));
    if (this.closed || this.locked) return Promise.resolve(null);
    if (!this.pending && !this.box.events.length) {
      this.publish();
      return Promise.resolve(null);
    }
    const sentAnswers = {...this.box.answers};
    const sentEvents = this.box.events.slice();
    const sentSubmit = this.box.submit;
    this.publish(this.failures > 0);
    this.inFlight = (async () => {
      try {
        const result = await api.syncExam(this.attemptId, {
          answers: Object.entries(sentAnswers).map(([id, row]) => ({
            question_id: Number(id),
            selected: row.selected,
            flagged: row.flagged,
            seconds_spent: row.seconds,
          })),
          events: sentEvents,
          submit: sentSubmit,
        });
        this.failures = 0;
        // Clear only what this request carried and nobody has edited since.
        for (const [id, row] of Object.entries(sentAnswers)) {
          if (this.box.answers[id]?.rev === row.rev) delete this.box.answers[id];
        }
        this.box.events = this.box.events.slice(sentEvents.length);
        if (result.status !== 'in_progress') {
          this.box.submit = null;
          this.close();
          this.onSubmitted?.(result);
        } else {
          this.persist();
        }
        this.publish();
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 423) {
          this.locked = error.message;
          this.publish();
          return null;
        }
        if (error instanceof ApiError && error.status === 404) {
          // The paper no longer exists (deleted by staff) — nothing to deliver to.
          this.close();
          this.publish();
          return null;
        }
        this.failures += 1;
        this.publish(true);
        if (isTransient(error)) {
          this.schedule(RETRY_STEPS[Math.min(this.failures - 1, RETRY_STEPS.length - 1)]);
        } else {
          // A 4xx the batch can't get past: drop the submit flag so answers keep syncing,
          // and surface the error to the caller.
          this.box.submit = null;
          this.persist();
          throw error;
        }
        return null;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Stop syncing and forget this paper locally (after submission). */
  close(): void {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    forgetAttempt(this.attemptId);
  }

  dispose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
