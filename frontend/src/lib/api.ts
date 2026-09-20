/**
 * Typed REST client for the Quiz Arena API.
 *
 * The dev server proxies ``/api`` to the FastAPI backend on localhost:3000, so
 * every path here is relative — no CORS, no hard-coded host, works in preview.
 */
import type {
  ActivityItem,
  DuelMode,
  AdminOverview,
  Analytics,
  DailyChallenge,
  HelpRow,
  InboxNote,
  MatchResult,
  MatchSet,
  MissionRow,
  RushResult,
  RushSet,
  ShopItem,
  StudyCard,
  AttemptState,
  BadgeItem,
  Bootstrap,
  Config,
  Course,
  Duel,
  DuelList,
  Leaderboard,
  Notice,
  ChatMessage,
  PhoneLookup,
  PlayerSummary,
  Prize,
  PrizeClaim,
  PrizeVault,
  ShopPlaque,
  ShopState,
  ChestReward,
  Profile,
  QuestionPublic,
  Quiz,
  QuizLeaderRow,
  ResultRow,
  RewardEvent,
  RoomFinishPayload,
  RoomMessage,
  RoomQuestionPayload,
  RoomRevealPayload,
  RoomState,
  Session,
  MaterialLibrary,
  MyLearning,
  MaterialCard,
  MaterialDetail,
  MaterialProgressResult,
  MaterialPost,
  MaterialExamPrep,
  MaterialAnalytics,
  QuestRow,
  WorldMap,
  PlaytimeBank,
  GameHub,
  GameRunResult,
  GameBoardRow,
  ArenaEventSummary,
  EventLeaderboard,
  EventQuestionWindow,
  EventsListing,
  RankedHistoryRow,
  RankedLadder,
  RankedMatchState,
  RankedMeta,
  RankedReveal,
  RankedStatus,
  ReviewItem,
} from './types';

/** Shapes returned by the newer arena engines — documented in ``types.ts``. */
export type Json = Record<string, unknown>;

const TOKEN_KEY = 'arena.token';
const ROLE_KEY = 'arena.role';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  getRole(): 'student' | 'admin' | null {
    try {
      return localStorage.getItem(ROLE_KEY) as 'student' | 'admin' | null;
    } catch {
      return null;
    }
  },
  set(token: string, role: 'student' | 'admin'): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(ROLE_KEY, role);
    } catch {
      /* private mode — session lives in memory only */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {method = 'GET', body, token = tokenStore.get(), raw = false} = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {'Accept': 'application/json'};
  // FormData must set its own multipart boundary.
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(path, {method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body)});
  } catch {
    throw new ApiError('Cannot reach the arena server. Is the API running on port 3000?', 0);
  }

  const text = await response.text();
  const payload = raw ? text : text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as {detail: unknown}).detail)
        : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return payload as T;
}

const query = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

export const api = {
  /* ---------------------------------------------------------------- auth */
  loginWithPassword: (identifier: string, password: string) =>
    request<Session>('/api/auth/student', {method: 'POST', token: null, body: {identifier, password}}),
  registerStudent: (body: {username: string; phone: string; password: string; display_name?: string}) =>
    request<Session>('/api/auth/register', {method: 'POST', token: null, body}),
  loginAsAdmin: (email: string, password: string) =>
    request<Session>('/api/auth/admin', {method: 'POST', token: null, body: {email, password}}),
  lookupPhone: (phone: string) =>
    request<PhoneLookup>('/api/auth/lookup', {method: 'POST', token: null, body: {phone}}),

  /* ---------------------------------------------------------------- rooms */
  createRoom: (body: {title: string; course_id?: number | null; question_count: number; per_question_seconds: number}) =>
    request<{room: RoomState}>('/api/rooms', {method: 'POST', body}),
  myRooms: () => request<{rooms: RoomState[]}>('/api/rooms/mine'),
  joinRoom: (code: string) =>
    request<{room: RoomState; messages: RoomMessage[]}>(`/api/rooms/join/${encodeURIComponent(code.trim().toUpperCase())}`, {
      method: 'POST',
    }),
  roomDetail: (roomId: number) =>
    request<{room: RoomState; messages: RoomMessage[]}>(`/api/rooms/${roomId}`),
  startRoom: (roomId: number) =>
    request<{room: RoomState; question: RoomQuestionPayload | null}>(`/api/rooms/${roomId}/start`, {method: 'POST'}),
  answerRoom: (roomId: number, selected: string, elapsedMs: number) =>
    request<{result: {correct: boolean; points: number}; all_answered: boolean; reveal: RoomRevealPayload | null; room: RoomState}>(
      `/api/rooms/${roomId}/answer`,
      {method: 'POST', body: {selected, elapsed_ms: elapsedMs}},
    ),
  revealRoom: (roomId: number) =>
    request<{reveal: RoomRevealPayload}>(`/api/rooms/${roomId}/reveal`, {method: 'POST'}),
  nextRoom: (roomId: number) =>
    request<{room: RoomState; question?: RoomQuestionPayload; finish?: RoomFinishPayload}>(`/api/rooms/${roomId}/next`, {method: 'POST'}),
  kickRoom: (roomId: number, targetId: number) =>
    request<{room: RoomState}>(`/api/rooms/${roomId}/kick/${targetId}`, {method: 'POST'}),
  leaveRoom: (roomId: number) => request<{deleted: boolean}>(`/api/rooms/${roomId}/leave`, {method: 'POST'}),
  roomMessages: (roomId: number) => request<{messages: RoomMessage[]}>(`/api/rooms/${roomId}/messages`),

  /* -------------------------------------------------------------- ranked */
  rankedMeta: () => request<RankedMeta>('/api/ranked/meta'),
  rankedStatus: () => request<RankedStatus>('/api/ranked/status'),
  rankedJoinQueue: (courseId: number) =>
    request<{queued: boolean; match_id?: number; state?: RankedMatchState; waiting?: number}>('/api/ranked/queue', {
      method: 'POST',
      body: {course_id: courseId},
    }),
  rankedCancelQueue: () => request<{cancelled: boolean}>('/api/ranked/queue/cancel', {method: 'POST'}),
  rankedMatch: (matchId: number) => request<{match: RankedMatchState}>(`/api/ranked/match/${matchId}`),
  rankedAnswer: (matchId: number, selected: string, elapsedMs: number) =>
    request<{result: {correct: boolean; points: number}; all_answered: boolean; reveal: RankedReveal | null; match: RankedMatchState}>(
      `/api/ranked/match/${matchId}/answer`,
      {method: 'POST', body: {selected, elapsed_ms: elapsedMs}},
    ),
  rankedReview: (matchId: number) => request<{match_id: number; items: ReviewItem[]}>(`/api/ranked/match/${matchId}/review`),
  rankedHistory: () => request<{history: RankedHistoryRow[]}>('/api/ranked/history'),
  rankedLadder: () => request<RankedLadder>('/api/ranked/leaderboard'),

  /* -------------------------------------------------------------- events */
  eventsList: () => request<EventsListing>('/api/events'),
  eventDetail: (eventId: number) =>
    request<{event: ArenaEventSummary; question: EventQuestionWindow | null; leaderboard: EventLeaderboard | null}>(
      `/api/events/${eventId}`,
    ),
  joinEvent: (eventId: number) =>
    request<{event: ArenaEventSummary; question: EventQuestionWindow | null}>(`/api/events/${eventId}/join`, {method: 'POST'}),
  leaveEvent: (eventId: number) =>
    request<{left: boolean; event: ArenaEventSummary}>(`/api/events/${eventId}/leave`, {method: 'POST'}),
  answerEvent: (eventId: number, selected: string, elapsedMs: number) =>
    request<{result: {correct: boolean; points: number; finished: boolean; progress: EventQuestionWindow}; leaderboard: EventLeaderboard | null}>(
      `/api/events/${eventId}/answer`,
      {method: 'POST', body: {selected, elapsed_ms: elapsedMs}},
    ),
  eventReview: (eventId: number) => request<{event_id: number; items: ReviewItem[]}>(`/api/events/${eventId}/review`),
  adminEvents: () => request<{events: ArenaEventSummary[]}>('/api/admin/events'),
  adminCreateEvent: (body: Record<string, unknown>) =>
    request<{event: ArenaEventSummary}>('/api/admin/events', {method: 'POST', body}),
  adminUpdateEvent: (eventId: number, body: Record<string, unknown>) =>
    request<{event: ArenaEventSummary}>(`/api/admin/events/${eventId}`, {method: 'PATCH', body}),
  adminDeleteEvent: (eventId: number) => request<{ok: boolean}>(`/api/admin/events/${eventId}`, {method: 'DELETE'}),

  /* ---------------------------------------------------------------- chat */
  chatWith: (friendId: number) => request<{messages: ChatMessage[]}>(`/api/chat?with=${friendId}`),
  sendChat: (body: {to: number; kind?: 'text' | 'duel' | 'quiz'; body?: string; meta?: Record<string, unknown>}) =>
    request<ChatMessage>('/api/chat', {method: 'POST', body}),
  markChatRead: (friendId: number) =>
    request<{marked: number}>(`/api/chat/read?with=${friendId}`, {method: 'POST'}),
  editChat: (id: number, body: string) =>
    request<ChatMessage>(`/api/chat/${id}`, {method: 'PATCH', body: {body}}),
  deleteChat: (id: number) => request<ChatMessage>(`/api/chat/${id}`, {method: 'DELETE'}),
  reactChat: (id: number, emoji: string) =>
    request<ChatMessage>(`/api/chat/${id}/react`, {method: 'POST', body: {emoji}}),
  reportChat: (id: number, reason: string) =>
    request<{ok: boolean; report_id: number; status: string}>(`/api/chat/${id}/report`, {method: 'POST', body: {reason}}),
  chatUnread: () => request<{total: number; per_friend: Record<number, number>}>('/api/chat/unread'),
  me: () => request<Profile>('/api/me'),
  updateMe: (body: {name?: string; avatar_hue?: number; bio?: string; status_text?: string}) =>
    request<Profile>('/api/me', {method: 'PATCH', body}),
  uploadPhoto: (image: string) => request<Profile>('/api/me/photo', {method: 'POST', body: {image}}),
  removePhoto: () => request<Profile>('/api/me/photo', {method: 'DELETE'}),

  /* ---------------------------------------------------- study & social learning */
  studyFlashcards: (quizId?: number) =>
    request<{cards: StudyCard[]}>(`/api/study/flashcards${quizId ? `?quiz_id=${quizId}` : ''}`),
  flashLog: (reviewed: number, known: number) =>
    request<{ok: boolean; rewards: RewardEvent[]; profile: Profile}>('/api/study/flashcards/log', {method: 'POST', body: {reviewed, known}}),
  rushSet: (mode: 'blitz' | 'sudden') => request<RushSet>(`/api/study/rush?mode=${mode}`),
  rushGrade: (mode: 'blitz' | 'sudden', issuedAt: string, items: {question_id: number; answer: string}[]) =>
    request<RushResult>('/api/study/rush', {method: 'POST', body: {mode, issued_at: issuedAt, items}}),
  daily: () => request<DailyChallenge>('/api/study/daily'),
  dailySubmit: (day: string, items: {question_id: number; answer: string}[]) =>
    request<RushResult & {correct: number; perfect: boolean}>('/api/study/daily', {method: 'POST', body: {day, items}}),
  helpAsk: (to: number, questionId: number) =>
    request<{ok: boolean; request: HelpRow}>('/api/study/help', {method: 'POST', body: {to, question_id: questionId}}),
  helpInbox: () => request<{requests: HelpRow[]}>('/api/study/help/inbox'),
  helpSent: () => request<{requests: HelpRow[]}>('/api/study/help/sent'),
  helpAnswer: (id: number, answer: string) =>
    request<{ok: boolean; was_correct: boolean; rewards: RewardEvent[]; profile: Profile}>(`/api/study/help/${id}/answer`, {
      method: 'POST',
      body: {answer},
    }),
  matchSet: () => request<MatchSet>('/api/study/match'),
  matchGrade: (body: {issued_at: string; moves: number; matched: number; elapsed_ms: number}) =>
    request<MatchResult>('/api/study/match', {method: 'POST', body}),
  spin: () =>
    request<{ok: boolean; tier: number; tiers: number[]; coins: number; rewards: RewardEvent[]; profile: Profile}>('/api/study/spin', {method: 'POST'}),
  missions: () => request<{week: string; missions: MissionRow[]}>('/api/study/missions'),
  missionClaim: (key: string) =>
    request<{ok: boolean; rewards: RewardEvent[]; profile: Profile}>(`/api/study/missions/${key}/claim`, {method: 'POST'}),
  shop: () =>
    request<{items: ShopItem[]; coins: number; streak_freezes: number; flair: string; xp_boosted: boolean}>('/api/study/shop'),
  shopBuy: (sku: string) => request<{ok: boolean; profile: Profile; detail: string}>('/api/study/shop/buy', {method: 'POST', body: {sku}}),
  analytics: () => request<Analytics>('/api/study/analytics'),
  inbox: () => request<{notes: InboxNote[]; unread: number}>('/api/inbox'),
  inboxRead: () => request<{marked: number}>('/api/inbox/read', {method: 'POST'}),
  nudge: (friendId: number) => request<{ok: boolean}>(`/api/friends/${friendId}/nudge`, {method: 'POST'}),
  react: (activityId: number) => request<{ok: boolean; mine: boolean; count: number}>(`/api/activity/${activityId}/react`, {method: 'POST'}),
  dailyBonus: () =>
    request<{profile: Profile; rewards: unknown[]; season: string}>('/api/me/daily-bonus', {method: 'POST'}),

  /* ------------------------------------------------------------ catalogue */
  bootstrap: () => request<Bootstrap>('/api/bootstrap', {token: null}),
  courses: () => request<Course[]>('/api/courses', {token: null}),
  quizzes: () => request<Quiz[]>('/api/quizzes'),
  quiz: (id: number) => request<Quiz>(`/api/quizzes/${id}`),
  quizLeaderboard: (id: number) => request<QuizLeaderRow[]>(`/api/quizzes/${id}/leaderboard`, {token: null}),
  notifications: () => request<Notice[]>('/api/notifications', {token: null}),
  badges: () => request<BadgeItem[]>('/api/badges'),
  leaderboard: (scope: 'global' | 'weekly' | 'friends' | 'duels' | 'helpers' = 'global', limit = 25) =>
    request<Leaderboard>(`/api/leaderboard${query({scope, limit})}`),
  prizes: () => request<PrizeVault>('/api/prizes'),

  /* Arena shop — cosmetic only. The server owns prices, stock and loot.
     (The Study Lab's coin shop above keeps its own `shop`/`shopBuy` names.) */
  arenaShop: () => request<ShopState>('/api/shop'),
  arenaShopItem: (key: string) => request<ShopPlaque>(`/api/shop/item/${encodeURIComponent(key)}`),
  arenaBuy: (key: string) => request<{receipt: {key: string; name: string; paid_coins: number; paid_diamonds: number; serial: number | null}; profile: Profile}>('/api/shop/buy', {method: 'POST', body: {key}}),
  arenaEquip: (key: string | null, slot?: string) => request<{slot: string; equipped: Record<string, string>; profile: Profile}>('/api/shop/equip', {method: 'POST', body: {key, slot}}),
  arenaChest: (kind: string) => request<{reward: ChestReward; chests: Record<string, number>; profile: Profile}>('/api/shop/chest', {method: 'POST', body: {kind}}),
  claimPrize: (id: number, note = '') =>
    request<{ok: boolean; prize: Prize; coins: number}>(`/api/prizes/${id}/claim`, {method: 'POST', body: {note}}),

  /* ---------------------------------------------------------------- exams */
  startExam: (quizId: number) => request<AttemptState>(`/api/exams/${quizId}/start`, {method: 'POST'}),
  attempt: (attemptId: number) => request<AttemptState>(`/api/exams/attempts/${attemptId}`),
  saveAnswer: (
    attemptId: number,
    body: {question_id: number; selected: string | null; seconds_spent?: number; flagged?: boolean},
  ) =>
    request<{ok: boolean; answered: number; total: number; time_remaining: number}>(
      `/api/exams/attempts/${attemptId}/answer`,
      {method: 'POST', body},
    ),
  submitExam: (attemptId: number, submissionType: 'early' | 'auto_timer' = 'early') =>
    request<AttemptState>(`/api/exams/attempts/${attemptId}/submit`, {
      method: 'POST',
      body: {submission_type: submissionType},
    }),
  review: (attemptId: number) => request<AttemptState>(`/api/exams/attempts/${attemptId}/review`),
  myResults: () => request<ResultRow[]>('/api/results/me'),

  /* ---------------------------------------------------------------- duels */
  duels: () => request<DuelList>('/api/duels'),
  duel: (id: number) => request<Duel>(`/api/duels/${id}`),
  createDuel: (body: {
    opponent_phone?: string;
    opponent_id?: number;
    quiz_id?: number | null;
    course_id?: number | null;
    topic?: string;
    question_count?: number;
    stake_coins?: number;
    mode?: DuelMode;
    best_of?: 1 | 3 | 5;
    difficulty?: string;
    sudden_death?: boolean;
  }) => request<Duel>('/api/duels', {method: 'POST', body}),
  quickMatch: (body: {
    question_count?: number;
    stake_coins?: number;
    quiz_id?: number | null;
    course_id?: number | null;
    mode?: DuelMode;
    best_of?: 1 | 3 | 5;
    difficulty?: string;
    sudden_death?: boolean;
  } = {}) => request<Duel>('/api/duels/quick', {method: 'POST', body}),
  openDuel: (body: {topic?: string; question_count?: number; stake_coins?: number; quiz_id?: number | null; course_id?: number | null; mode?: DuelMode; best_of?: 1 | 3 | 5; difficulty?: string; sudden_death?: boolean} = {}) =>
    request<Duel>('/api/duels/open', {method: 'POST', body}),
  joinDuel: (code: string) => request<Duel>(`/api/duels/join/${encodeURIComponent(code.trim().toUpperCase())}`, {method: 'POST'}),
  acceptDuel: (id: number) => request<Duel>(`/api/duels/${id}/accept`, {method: 'POST'}),
  declineDuel: (id: number) => request<{ok: boolean}>(`/api/duels/${id}/decline`, {method: 'POST'}),
  cancelDuel: (id: number) => request<{ok: boolean}>(`/api/duels/${id}/cancel`, {method: 'POST'}),
  answerDuel: (id: number, body: {question_id: number; selected: string; elapsed_ms: number}) =>
    request<Duel>(`/api/duels/${id}/answer`, {method: 'POST', body}),

  /* ------------------------------------------------------------- flashcards */
  flashcards: {
    decks: () => request<{decks: Json[]; progress: Json}>('/api/flashcards'),
    createDeck: (body: {
      name: string;
      description?: string;
      course_id?: number | null;
      topic?: string;
      difficulty?: string;
      kind?: string;
      config?: Record<string, unknown>;
    }) =>
      request<Json>('/api/flashcards', {
        method: 'POST',
        body: {
          name: body.name,
          description: body.description ?? '',
          kind: body.kind ?? 'custom',
          config: {
            ...(body.config ?? {}),
            ...(body.course_id ? {course_id: body.course_id} : {}),
            ...(body.topic ? {topic: body.topic} : {}),
            ...(body.difficulty ? {difficulty: body.difficulty} : {}),
          },
        },
      }),
    deck: (
      id: number,
      params: {mode?: 'q_to_a' | 'a_to_q'; shuffle?: boolean; due_only?: boolean; bookmarked?: boolean; limit?: number} = {},
    ) => request<Json>(`/api/flashcards/decks/${id}${query(params)}`),
    deleteDeck: (id: number) => request<{ok: boolean}>(`/api/flashcards/decks/${id}`, {method: 'DELETE'}),
    grade: (body: {
      card_id?: number | null;
      question_id: number;
      grade: 'again' | 'hard' | 'good' | 'easy';
      mode?: 'q_to_a' | 'a_to_q';
      elapsed_ms?: number;
    }) => request<Json>('/api/flashcards/grade', {method: 'POST', body}),
    due: (params: {deck_id?: number; limit?: number} = {}) => request<Json>(`/api/flashcards/due${query(params)}`),
    stats: () => request<Json>('/api/flashcards/stats'),
    updateCard: (id: number, body: {notes?: string; bookmarked?: boolean}) =>
      request<Json>(`/api/flashcards/cards/${id}`, {method: 'PATCH', body}),
  },

  /* ------------------------------------------------------- practice & bosses */
  arena: {
    practiceModes: () => request<Json>('/api/arena/practice/modes'),
    practiceCatalog: () => request<Json>('/api/arena/practice/catalog'),
    practiceActive: () => request<Json>('/api/arena/practice/active'),
    abandonPractice: (token: string) =>
      request<Json>(`/api/arena/practice/abandon${query({token})}`, {method: 'POST'}),
    startPractice: (body: {
      mode: string;
      size?: number;
      course_id?: number | null;
      quiz_id?: number | null;
      topic?: string;
      difficulty?: string;
      lives?: number;
      time_limit_seconds?: number;
      target_score?: number;
    }) => request<Json>('/api/arena/practice/start', {method: 'POST', body}),
    answerPractice: (body: {token: string; question_id: number; selected: string | null; elapsed_ms?: number; risk?: boolean}) =>
      request<Json>('/api/arena/practice/answer', {method: 'POST', body}),
    usePowerup: (token: string, powerup: string, questionId: number) =>
      request<Json>(`/api/arena/practice/powerup${query({token, powerup, question_id: questionId})}`, {method: 'POST'}),
    finishPractice: (token: string, elapsedMs = 0) =>
      request<Json>(`/api/arena/practice/finish${query({token, elapsed_ms: elapsedMs})}`, {method: 'POST'}),
    practiceHistory: () => request<Json>('/api/arena/practice/history'),
    bossHome: () => request<Json>('/api/arena/boss'),
    startBoss: (body: {boss_key: string; size?: number; course_id?: number | null; difficulty?: string; lives?: number}) =>
      request<Json>('/api/arena/boss/start', {method: 'POST', body}),
    answerBoss: (body: {run_id: number; question_id: number; selected: string | null; elapsed_ms?: number; combo?: number}) =>
      request<Json>('/api/arena/boss/answer', {method: 'POST', body}),
    abandonBoss: (runId: number) => request<Json>(`/api/arena/boss/abandon${query({run_id: runId})}`, {method: 'POST'}),

    worldMap: () => request<WorldMap>('/api/arena/world-map'),
    claimQuest: (key: string) =>
      request<{quest: QuestRow; rewards: RewardEvent[]; profile: Profile}>(`/api/arena/quests/${encodeURIComponent(key)}/claim`, {
        method: 'POST',
        body: {},
      }),
    leaderboards: (params: {scope?: string; limit?: number; course_id?: number | null; topic?: string} = {}) =>
      request<Json>(`/api/arena/leaderboards${query(params)}`),
    season: () => request<Json>('/api/arena/season'),
    claimSeason: () => request<Json>('/api/arena/season/claim', {method: 'POST'}),
    mastery: () => request<Json>('/api/arena/mastery'),
    collection: () => request<Json>('/api/arena/collection'),
    analytics: (days = 30) => request<Json>(`/api/arena/analytics${query({days})}`),
    studyPlan: () => request<Json>('/api/arena/study-plan'),
    weeklyReport: () => request<Json>('/api/arena/report/weekly'),
    monthlyReport: () => request<Json>('/api/arena/report/monthly'),
    heatmap: (days = 90) => request<Json>(`/api/arena/heatmap${query({days})}`),

    tournaments: () => request<Json>('/api/arena/tournaments'),
    tournament: (id: number) => request<Json>(`/api/arena/tournaments/${id}`),
    joinTournament: (id: number) => request<Json>(`/api/arena/tournaments/${id}/join`, {method: 'POST'}),
    myTournaments: () => request<Json>('/api/arena/tournaments/history/me'),

    groups: () => request<Json>('/api/arena/groups'),
    createGroup: (body: {name: string; description?: string; course_id?: number | null; goal?: string}) =>
      request<Json>('/api/arena/groups', {method: 'POST', body}),
    joinGroup: (code: string) => request<Json>(`/api/arena/groups/join/${encodeURIComponent(code.trim().toUpperCase())}`, {method: 'POST'}),
    group: (id: number) => request<Json>(`/api/arena/groups/${id}`),
    groupMessages: (id: number) => request<Json>(`/api/arena/groups/${id}/messages`),
    sendGroupMessage: (id: number, body: string) =>
      request<Json>(`/api/arena/groups/${id}/messages`, {method: 'POST', body: {body}}),
    groupQuiz: (id: number, size = 10) => request<Json>(`/api/arena/groups/${id}/group-quiz${query({size})}`, {method: 'POST'}),
    groupChallenge: (id: number) => request<Json>(`/api/arena/groups/${id}/challenge`, {method: 'POST'}),

    duelStats: () => request<Json>('/api/arena/duels/stats/me'),
    duelSeries: (id: number) => request<Json>(`/api/arena/duels/${id}/series`),
    rematch: (id: number, body: {best_of?: 1 | 3 | 5; question_count?: number; stake_coins?: number; mode?: DuelMode; difficulty?: string; sudden_death?: boolean} = {}) =>
      request<Duel>(`/api/arena/duels/${id}/rematch`, {method: 'POST', body}),
    challengeFriend: (studentId: number) => request<Json>(`/api/arena/challenge/${studentId}`, {method: 'POST'}),
    share: (kind: 'score' | 'achievement' | 'streak' | 'perfect' | 'rank') => request<Json>(`/api/arena/share/${kind}`),
  },

  /* --------------------------------------------------------------- social */
  friends: () => request<{friends: PlayerSummary[]; requests: PlayerSummary[]; rivals: PlayerSummary[]}>('/api/friends'),
  addFriend: (body: {phone?: string; student_id?: number}) =>
    request<{ok: boolean; status: string}>('/api/friends', {method: 'POST', body}),
  removeFriend: (id: number) => request<{ok: boolean}>(`/api/friends/${id}`, {method: 'DELETE'}),
  searchPlayers: (q: string) => request<PlayerSummary[]>(`/api/players/search${query({q, limit: 12})}`),
  player: (id: number) => request<PlayerSummary>(`/api/players/${id}`),
  activity: () => request<ActivityItem[]>('/api/activity'),
  globalActivity: () => request<ActivityItem[]>('/api/activity/global'),

  /* ------------------------------------------------------------ materials */
  materials: {
    library: (params: {course_id?: number | null; topic?: string; search?: string; difficulty?: string; limit?: number; offset?: number} = {}) =>
      request<MaterialLibrary>(`/api/materials${query(params)}`),
    mine: () => request<MyLearning>('/api/materials/mine'),
    search: (q: string) => request<{results: MaterialCard[]; query: string}>(`/api/materials/search${query({q})}`),
    glossary: (topic = '') => request<{terms: {term: string; meaning: string; material_id: number; material_title: string}[]}>(`/api/materials/glossary${query({topic})}`),
    read: (id: number) => request<MaterialDetail>(`/api/materials/${id}`),
    progress: (id: number, body: {section_id?: number | null; seconds?: number}) =>
      request<MaterialProgressResult>(`/api/materials/${id}/progress`, {method: 'POST', body}),
    feedback: (id: number, body: {verdict: 'yes' | 'somewhat' | 'no'; comment?: string}) =>
      request<{ok: boolean}>("/api/materials/" + id + "/feedback", {method: 'POST', body}),
    highlight: (id: number, body: {text: string; colour?: string; section_id?: number | null; note?: string}) =>
      request<{id: number; text: string; colour: string; section_id: number | null}>(`/api/materials/${id}/highlights`, {method: 'POST', body}),
    removeHighlight: (id: number, highlightId: number) =>
      request<{ok: boolean}>(`/api/materials/${id}/highlights/${highlightId}`, {method: 'DELETE'}),
    note: (id: number, body: {body: string; section_id?: number | null; quote?: string}) =>
      request<{id: number; body: string; section_id: number | null; quote?: string}>(`/api/materials/${id}/notes`, {method: 'POST', body}),
    removeNote: (id: number, noteId: number) => request<{ok: boolean}>(`/api/materials/${id}/notes/${noteId}`, {method: 'DELETE'}),
    bookmark: (id: number, body: {section_id?: number | null; label?: string; snippet?: string; position?: string}) =>
      request<{id: number; label: string; section_id: number | null}>(`/api/materials/${id}/bookmarks`, {method: 'POST', body}),
    removeBookmark: (id: number, bookmarkId: number) =>
      request<{ok: boolean}>(`/api/materials/${id}/bookmarks/${bookmarkId}`, {method: 'DELETE'}),
    confusion: (id: number, body: {section_id?: number | null; quote?: string; question?: string; friend_ids?: number[]; group_id?: number | null}) =>
      request<{id: number; status: string; helpers: number}>(`/api/materials/${id}/confusions`, {method: 'POST', body}),
    resolveConfusion: (id: number, confusionId: number) =>
      request<{ok: boolean; reward: RewardEvent | null}>(`/api/materials/${id}/confusions/${confusionId}/resolve`, {method: 'POST'}),
    discussion: (id: number) => request<{posts: MaterialPost[]; allow: boolean}>(`/api/materials/${id}/discussion`),
    post: (id: number, body: {body: string; section_id?: number | null; parent_id?: number | null; kind?: 'question' | 'answer' | 'tip'; quote?: string}) =>
      request<{id: number; body: string; kind: string; reward?: RewardEvent}>(`/api/materials/${id}/discussion`, {method: 'POST', body}),
    report: (id: number, reason: string) =>
      request<{ok: boolean; report_id: number}>(`/api/materials/${id}/report`, {method: 'POST', body: {reason}}),
    examPrep: (id: number) => request<MaterialExamPrep>(`/api/materials/${id}/exam-prep`),
    flashcards: (id: number) =>
      request<{deck_id: number; name: string; cards: number; created: boolean}>(`/api/materials/${id}/flashcards`, {method: 'POST', body: {}}),
    selfTest: (id: number, size = 5) =>
      request<{material_id: number; title: string; size: number; questions: QuestionPublic[]}>(`/api/materials/${id}/self-test${query({size})}`, {method: 'POST', body: {}}),
    selfTestAnswer: (id: number, body: {question_id: number; choice: string}) =>
      request<{is_correct: boolean; chosen: string; correct: string; explanation: string; reward: RewardEvent | null; playtime: PlaytimeBank}>(
        `/api/materials/${id}/self-test/answer`,
        {method: 'POST', body},
      ),
    /* ---- staff authoring ---- */
    adminList: (params: {status?: string; course_id?: number | null} = {}) =>
      request<{items: MaterialCard[]; stats: Record<string, number>}>(`/api/admin/materials${query(params)}`),
    adminRead: (id: number) => request<MaterialDetail>(`/api/admin/materials/${id}`),
    create: (body: Record<string, unknown>) => request<MaterialDetail>('/api/admin/materials', {method: 'POST', body}),
    update: (id: number, body: Record<string, unknown>) => request<MaterialDetail>(`/api/admin/materials/${id}`, {method: 'PATCH', body}),
    remove: (id: number) => request<{ok: boolean}>(`/api/admin/materials/${id}`, {method: 'DELETE'}),
    duplicate: (id: number) => request<MaterialDetail>(`/api/admin/materials/${id}/duplicate`, {method: 'POST', body: {}}),
    publish: (id: number, status: 'draft' | 'published' | 'archived' = 'published') =>
      request<MaterialDetail>(`/api/admin/materials/${id}/publish`, {method: 'POST', body: {status}}),
    versions: (id: number) =>
      request<{material_id: number; current_version: number; versions: {id: number; version: number; note: string; author: string; created_at: string}[]}>(
        `/api/admin/materials/${id}/versions`,
      ),
    linkQuestions: (id: number, questionIds: number[], sectionId?: number | null) =>
      request<{added: number; material_id: number}>(`/api/admin/materials/${id}/link-questions`, {method: 'POST', body: {question_ids: questionIds, section_id: sectionId ?? null}}),
    analytics: (id: number) => request<MaterialAnalytics>(`/api/admin/materials/${id}/analytics`),
  },

  /* ------------------------------------------------------------- game arena */
  game: {
    hub: () => request<GameHub>('/api/game'),
    start: (mode: 'survival' | 'score_attack' | 'time_trial' | 'daily') =>
      request<{session_id: number; mode: string; remaining_seconds: number; daily_challenge: {title: string; target_seconds: number}}>(
        '/api/game/session',
        {method: 'POST', body: {mode}},
      ),
    heartbeat: (sessionId: number, seconds = 15) =>
      request<{remaining_seconds: number; out_of_time: boolean}>(`/api/game/session/${sessionId}/heartbeat?seconds=${seconds}`, {method: 'POST'}),
    finish: (sessionId: number, body: {score: number; seconds: number; combo?: number; collected?: number; wave?: number}) =>
      request<GameRunResult>(`/api/game/session/${sessionId}/finish`, {method: 'POST', body: {...body, session_id: sessionId}}),
    leaderboard: (scope: 'daily' | 'weekly' | 'friends' | 'all_time' | 'personal') =>
      request<{scope: string; rows: GameBoardRow[]}>(`/api/game/leaderboard${query({scope})}`),
    challenge: (body: {opponent_id: number; mode?: string; target_score?: number; target_seconds?: number}) =>
      request<{id: number; target_score: number; opponent: string}>('/api/game/challenge', {method: 'POST', body}),
    cosmetics: (body: {character?: string; trail?: string}) =>
      request<{character: string; trail: string}>('/api/game/cosmetics', {method: 'POST', body}),
  },

  /* ------------------------------------------------------------ study timer */
  focusStart: (body: {mode: 'material' | 'flashcards' | 'questions' | 'mixed'; planned_minutes: number}) =>
    request<{session_id: number; mode: string; planned_minutes: number}>('/api/study/sessions', {method: 'POST', body}),
  focusFinish: (body: {session_id: number; seconds: number; completed: boolean}) =>
    request<{session: {id: number; seconds: number; xp: number}; reward: RewardEvent | null; streak: {current: number; best: number}; playtime: PlaytimeBank; break_suggested: boolean}>(
      '/api/study/sessions/finish',
      {method: 'POST', body},
    ),

  /* ---------------------------------------------------------------- admin */
  admin: {
    overview: () => request<AdminOverview>('/api/admin/overview'),
    config: () => request<Config>('/api/admin/config'),
    updateConfig: (body: Partial<Config>) => request<Config>('/api/admin/config', {method: 'PATCH', body}),

    courses: () => request<Course[]>('/api/admin/courses'),
    createCourse: (body: Partial<Course>) => request<Course>('/api/admin/courses', {method: 'POST', body}),
    updateCourse: (id: number, body: Partial<Course>) => request<Course>(`/api/admin/courses/${id}`, {method: 'PATCH', body}),
    deleteCourse: (id: number) => request<{ok: boolean}>(`/api/admin/courses/${id}`, {method: 'DELETE'}),

    quizzes: () => request<Quiz[]>('/api/admin/quizzes'),
    quiz: (id: number) => request<Quiz>(`/api/admin/quizzes/${id}`),
    createQuiz: (body: Record<string, unknown>) => request<Quiz>('/api/admin/quizzes', {method: 'POST', body}),
    updateQuiz: (id: number, body: Record<string, unknown>) => request<Quiz>(`/api/admin/quizzes/${id}`, {method: 'PATCH', body}),
    setQuizStatus: (id: number, status: string) =>
      request<Quiz>(`/api/admin/quizzes/${id}/status`, {method: 'PATCH', body: {status}}),
    deleteQuiz: (id: number) => request<{ok: boolean}>(`/api/admin/quizzes/${id}`, {method: 'DELETE'}),

    questions: (quizId: number) => request<QuestionPublic[]>(`/api/admin/quizzes/${quizId}/questions`),
    bank: (courseId: number) =>
      request<{course_id: number; code: string; bank: number; drawn_copies: number}>(`/api/admin/courses/${courseId}/bank`),
    draw: (quizId: number, count: number) =>
      request<{drawn: number; requested: number; available: number; total: number; bank: number}>(
        `/api/admin/quizzes/${quizId}/draw`,
        {method: 'POST', body: {count}},
      ),
    createQuestion: (quizId: number, body: Record<string, unknown>) =>
      request<QuestionPublic>(`/api/admin/quizzes/${quizId}/questions`, {method: 'POST', body}),
    bulkQuestions: (quizId: number, questions: Record<string, unknown>[]) =>
      request<{created: number; questions: QuestionPublic[]}>(`/api/admin/quizzes/${quizId}/questions/bulk`, {
        method: 'POST',
        body: {questions},
      }),
    updateQuestion: (id: number, body: Record<string, unknown>) =>
      request<QuestionPublic>(`/api/admin/questions/${id}`, {method: 'PATCH', body}),
    deleteQuestion: (id: number) => request<{ok: boolean}>(`/api/admin/questions/${id}`, {method: 'DELETE'}),

    students: (params: {q?: string; limit?: number; offset?: number}) =>
      request<{total: number; rows: PlayerSummary[]; limit: number; offset: number}>(`/api/admin/students${query(params)}`),
    student: (id: number) => request<Profile>(`/api/admin/students/${id}`),
    createStudent: (body: Record<string, unknown>) => request<PlayerSummary>('/api/admin/students', {method: 'POST', body}),
    updateStudent: (id: number, body: Record<string, unknown>) =>
      request<PlayerSummary>(`/api/admin/students/${id}`, {method: 'PATCH', body}),
    toggleBan: (id: number) => request<{ok: boolean; is_banned: boolean}>(`/api/admin/students/${id}/ban`, {method: 'POST'}),
    adjust: (id: number, xp: number, coins: number, reason: string) =>
      request<PlayerSummary>(`/api/admin/students/${id}/adjust${query({xp, coins, reason})}`, {method: 'POST'}),
    deleteStudent: (id: number) => request<{ok: boolean}>(`/api/admin/students/${id}`, {method: 'DELETE'}),

    results: (params: {quiz_id?: number; q?: string}) =>
      request<{quiz_id: number | null; rows: Record<string, unknown>[]}>(`/api/admin/results${query(params)}`),
    deleteResult: (id: number) => request<{ok: boolean}>(`/api/admin/results/${id}`, {method: 'DELETE'}),
    clearResults: (quizId: number) => request<{ok: boolean; deleted: number}>(`/api/admin/results${query({quiz_id: quizId})}`, {method: 'DELETE'}),
    exportUrl: (quizId: number) => `/api/admin/results/export${query({quiz_id: quizId})}`,

    notifications: () => request<Notice[]>('/api/admin/notifications'),
    createNotification: (body: Record<string, unknown>) => request<Notice>('/api/admin/notifications', {method: 'POST', body}),
    deleteNotification: (id: number) => request<{ok: boolean}>(`/api/admin/notifications/${id}`, {method: 'DELETE'}),

    prizes: () => request<Prize[]>('/api/admin/prizes'),
    createPrize: (body: Record<string, unknown>) => request<Prize>('/api/admin/prizes', {method: 'POST', body}),
    updatePrize: (id: number, body: Record<string, unknown>) => request<Prize>(`/api/admin/prizes/${id}`, {method: 'PATCH', body}),
    deletePrize: (id: number) => request<{ok: boolean}>(`/api/admin/prizes/${id}`, {method: 'DELETE'}),

    claims: () => request<PrizeClaim[]>('/api/admin/claims'),
    updateClaim: (id: number, status: string, note = '') =>
      request<PrizeClaim>(`/api/admin/claims/${id}`, {method: 'PATCH', body: {status, note}}),

    badges: () => request<{badges: BadgeItem[]; awarded: Record<string, number>}>('/api/admin/badges'),

    /* ------------------------------------------------------- content studio */
    studio: {
      bank: (params: {course_id?: number | null; quiz_id?: number | null} = {}) => request<Json>(`/api/admin/bank${query(params)}`),
      search: (params: {
        q?: string;
        course_id?: number | null;
        quiz_id?: number | null;
        topic?: string;
        subtopic?: string;
        difficulty?: string;
        status?: string;
        answer?: string;
        tag?: string;
        type?: string;
        flagged?: boolean;
        drawn?: boolean;
        sort?: string;
        limit?: number;
        offset?: number;
      } = {}) => request<Json>(`/api/admin/questions${query(params)}`),
      bulkAction: (body: {
        ids: number[];
        action: string;
        value?: string;
        tags?: string[];
        quiz_id?: number | null;
        topic?: string;
        difficulty?: string;
        points?: number;
        correct?: string;
        status?: string;
      }) => request<Json>('/api/admin/questions/bulk', {method: 'POST', body}),
      order: (body: {ids: number[]; lock?: boolean}) => request<Json>('/api/admin/questions/order', {method: 'POST', body}),
      flag: (id: number, body: {reason?: string; note?: string}) =>
        request<Json>(`/api/admin/questions/${id}/flag`, {method: 'POST', body}),
      unflag: (id: number) => request<Json>(`/api/admin/questions/${id}/unflag`, {method: 'POST'}),
      reviewQueue: (params: {status?: string; limit?: number} = {}) => request<Json>(`/api/admin/review-queue${query(params)}`),
      resolveReport: (id: number, decision: 'resolved' | 'dismissed' = 'resolved') =>
        request<Json>(`/api/admin/reports/${id}${query({decision})}`, {method: 'PATCH'}),
      audit: (params: {limit?: number; target_type?: string} = {}) => request<Json>(`/api/admin/audit${query(params)}`),
      previewImport: (body: {raw?: string; quiz_id?: number | null; course_id?: number | null}) =>
        request<Json>('/api/admin/questions/preview-import', {method: 'POST', body}),

      /* Device files: the server reads .txt / .csv / .pdf / .json and validates
         every answer letter itself — invalid rows come back with reasons. */
      previewImportFile: (file: File, params: {quiz_id?: number | null; course_id?: number | null} = {}) => {
        const form = new FormData();
        form.append('file', file, file.name);
        if (params.quiz_id) form.append('quiz_id', String(params.quiz_id));
        if (params.course_id) form.append('course_id', String(params.course_id));
        return request<Json>('/api/admin/questions/import-file/preview', {method: 'POST', body: form});
      },
      importFile: (
        file: File,
        params: {
          quiz_id?: number | null;
          course_id?: number | null;
          mode?: 'append' | 'replace';
          skip_duplicates?: boolean;
          publish?: boolean;
        } = {},
      ) => {
        const form = new FormData();
        form.append('file', file, file.name);
        if (params.quiz_id) form.append('quiz_id', String(params.quiz_id));
        if (params.course_id) form.append('course_id', String(params.course_id));
        form.append('mode', params.mode ?? 'append');
        form.append('skip_duplicates', String(params.skip_duplicates ?? true));
        form.append('publish', String(params.publish ?? true));
        return request<Json>('/api/admin/questions/import-file', {method: 'POST', body: form});
      },
      importQuestions: (body: {
        raw?: string;
        quiz_id?: number | null;
        course_id?: number | null;
        mode?: 'append' | 'replace';
        skip_duplicates?: boolean;
        publish?: boolean;
      }) => request<Json>('/api/admin/questions/import', {method: 'POST', body}),
      exportQuestions: (params: {quiz_id?: number | null; course_id?: number | null; format?: 'json' | 'csv'; difficulty?: string; status?: string; answer?: string} = {}) =>
        request<string>(
          `/api/admin/questions/export${query({quiz_id: params.quiz_id, course_id: params.course_id, difficulty: params.difficulty, status: params.status, answer: params.answer, fmt: params.format})}`,
          {raw: true},
        ),
      exportUrl: (params: {quiz_id?: number | null; course_id?: number | null; format?: 'json' | 'csv'; difficulty?: string; status?: string; answer?: string} = {}) =>
        `/api/admin/questions/export${query({quiz_id: params.quiz_id, course_id: params.course_id, difficulty: params.difficulty, status: params.status, answer: params.answer, fmt: params.format})}`,
      duplicateQuestion: (id: number, body: {quiz_id?: number | null} = {}) =>
        request<QuestionPublic>(`/api/admin/questions/${id}/duplicate`, {method: 'POST', body}),
      versions: (id: number) =>
        request<{id: number; version: number; note?: string; author?: string; created_at?: string; snapshot?: Json}[]>(
          `/api/admin/questions/${id}/versions`,
        ),
      restoreVersion: (id: number, version: number) =>
        request<Json>(`/api/admin/questions/${id}/versions/${version}/restore`, {method: 'POST'}),
      analytics: (id: number) => request<Json>(`/api/admin/questions/${id}/analytics`),
      similar: (id: number) => request<Json>(`/api/admin/questions/${id}/similar`),
      usage: (id: number) => request<Json>(`/api/admin/questions/${id}/usage`),
      patch: (id: number, body: Record<string, unknown>) =>
        request<Json>(`/api/admin/questions/${id}/patch`, {method: 'PATCH', body}),
      duplicateQuiz: (id: number, body: {title?: string; as_template?: boolean; version_label?: string} = {}) =>
        request<Json>(`/api/admin/quizzes/${id}/duplicate`, {method: 'POST', body}),
      fromTemplate: (id: number, body: {title?: string; version_label?: string} = {}) =>
        request<Json>(`/api/admin/quizzes/from-template/${id}`, {method: 'POST', body}),
      builder: (id: number, body: Record<string, unknown>) =>
        request<Quiz>(`/api/admin/quizzes/${id}/builder`, {method: 'PATCH', body}),
      blueprints: () => request<{blueprints: Json[]}>(`/api/admin/blueprints`),
      createBlueprint: (body: Record<string, unknown>) => request<Json>('/api/admin/blueprints', {method: 'POST', body}),
      updateBlueprint: (id: number, body: Record<string, unknown>) =>
        request<Json>(`/api/admin/blueprints/${id}`, {method: 'PATCH', body}),
      deleteBlueprint: (id: number) => request<{ok: boolean}>(`/api/admin/blueprints/${id}`, {method: 'DELETE'}),
      previewBlueprint: (id: number) => request<Json>(`/api/admin/blueprints/${id}/preview`),
      generateFromBlueprint: (id: number, body: {title?: string; versions?: number; duration_minutes?: number; per_question_seconds?: number}) =>
        request<Json>(`/api/admin/blueprints/${id}/generate`, {method: 'POST', body}),
      topics: (courseId?: number | null) => request<Json>(`/api/admin/topics${query({course_id: courseId})}`),
      renameTopic: (body: {from: string; to: string}) => request<Json>('/api/admin/topics/rename', {method: 'POST', body}),
      tags: () => request<Json>('/api/admin/tags'),
      renameTag: (body: {from: string; to: string}) => request<Json>('/api/admin/tags/rename', {method: 'POST', body}),
      previewQuestion: (id: number) => request<Json>(`/api/admin/preview/question/${id}`),
      previewQuiz: (id: number) => request<Json>(`/api/admin/preview/quiz/${id}`),
      decksFromBank: (params: {name: string; course_id?: number | null; topic?: string; difficulty?: string; limit?: number}) =>
        request<Json>(`/api/admin/decks/from-bank${query(params)}`, {method: 'POST'}),
      challengePool: (params: {course_id?: number | null; topic?: string; difficulty?: string} = {}) =>
        request<Json>(`/api/admin/challenge-pool${query(params)}`),
      healthSnapshot: () => request<Json>('/api/admin/health-snapshot'),
      leaderboard: (limit = 20) => request<Json>(`/api/admin/students/leaderboard${query({limit})}`),
      recentVersions: (limit = 30) => request<Json>(`/api/admin/versions/recent${query({limit})}`),
    },
  },
};
