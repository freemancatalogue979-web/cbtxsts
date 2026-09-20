/** Shapes returned by the FastAPI backend (snake_case, exactly as served). */

export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type QuizStatus = 'draft' | 'scheduled' | 'active' | 'completed';
export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface LevelProgress {
  level: number;
  title: string;
  current_xp: number;
  level_floor: number;
  level_ceiling: number;
  into_level: number;
  needed: number;
  percent: number;
}

export interface PlayerSummary {
  id: number;
  name: string;
  initials: string;
  phone: string;
  avatar_hue: number;
  has_photo?: boolean;
  bio?: string;
  status_text?: string;
  flair?: string;
  level: number;
  title: string;
  tier: Tier;
  xp: number;
  coins: number;
  diamonds?: number;
  cosmetics?: CosmeticsRef;
  streak: number;
  duels_won: number;
  duels_played: number;
  exams_taken: number;
  best_percentage: number;
  online?: boolean;
  friendship_status?: string;
  direction?: string;
  friendship_id?: number;
  is_friend?: boolean;
}

export interface BadgeItem {
  key: string;
  name: string;
  description: string;
  icon: string;
  tier: Tier;
  xp_reward: number;
  coin_reward: number;
  awarded_at?: string;
  owned?: boolean;
}

export interface Profile {
  id: number;
  name: string;
  initials: string;
  username: string;
  /** Prestige currency: milestone-only, never bought, never converted from coins. */
  diamonds?: number;
  /** Equipped cosmetics — the avatar, aura, frame, title, theme and chat look. */
  cosmetics?: CosmeticsRef;
  phone: string;
  reg_no: string | null;
  faculty: string;
  campus: string;
  class_name: string;
  level_name: string;
  avatar_hue: number;
  has_photo: boolean;
  bio: string;
  status_text: string;
  player_code: string;
  flair: string;
  helper_points: number;
  streak_freezes: number;
  xp_boosted: boolean;
  xp: number;
  coins: number;
  weekly_xp: number;
  week_key: string;
  streak: number;
  best_streak: number;
  last_active: string | null;
  progress: LevelProgress;
  tier: Tier;
  stats: {
    exams_taken: number;
    exams_won: number;
    best_percentage: number;
    duels_played: number;
    duels_won: number;
    duels_lost: number;
    duel_win_rate: number;
    correct_answers: number;
    questions_answered: number;
    accuracy: number;
    best_run: number;
  };
  badges: BadgeItem[];
  /** The season badge this player is wearing right now (resets monthly). */
  season?: SeasonBadgeBlock;
  created_at: string;
  is_new?: boolean;
  online?: boolean;
}

export type SeasonRankKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'elite'
  | 'champion'
  | 'legend'
  | 'mythic'
  | 'celestial';

export interface SeasonRank {
  key: SeasonRankKey;
  label: string;
  glyph: 'medal' | 'shield' | 'gem' | 'star' | 'crown' | 'flame' | 'trophy' | 'sparkles' | 'zap' | 'sun';
  blurb: string;
  level_from: number;
  level_to: number;
  xp_from: number;
  xp_to: number;
  deep: string;
  bright: string;
}

export interface SeasonBadgeBlock {
  season_key: string;
  number?: number;
  label: string;
  days_left: number;
  days_total?: number;
  xp: number;
  level: number;
  rank: SeasonRank;
  next_rank: SeasonRank | null;
  progress: {level: number; xp: number; level_floor: number; level_ceiling: number; into_level: number; needed: number; percent: number};
  board_rank: number;
  /** How the month before this one ended — used to greet a new season. */
  previous?: {season_key: string | null; label: string | null; xp: number; level: number; rank: SeasonRank | null};
}

export interface Session {
  token: string;
  role: 'student' | 'admin';
  profile: Profile & {email?: string};
}

export interface Course {
  id: number;
  code: string;
  title: string;
  description: string;
  credit_units: number;
  semester: string;
  lecturer: string;
  accent: string;
  is_active: boolean;
  quiz_count?: number;
}

export interface CosmeticsRef {
  avatar?: string;
  aura?: string;
  frame?: string;
  title?: string;
  theme?: string;
  chat?: string;
  duel?: string;
  answer?: string;
}

export interface RarityMeta {
  key: string;
  label: string;
  order: number;
  ink: string;
  deep: string;
  bright: string;
}

export interface ShopItem {
  key: string;
  name: string;
  slot: string;
  slot_label: string;
  rarity: string;
  price_coins: number;
  price_diamonds: number;
  base_coins: number;
  deal_off: number;
  glyph: string;
  blurb: string;
  source: string;
  released: string;
  event?: string;
  requirement?: string | null;
  unlocked: boolean;
  available: boolean;
  owned: boolean;
  serial?: number | null;
  owners: number;
  rarity_meta: RarityMeta;
}

export interface ShopChestDef {
  key: string;
  name: string;
  glyph: string;
  rarity: string;
  blurb: string;
  loot: {coins: number[]; xp: number[]; diamonds: number[]};
  items: string;
}

export interface ShopState {
  balance: {coins: number; diamonds: number; xp: number};
  equipped: CosmeticsRef;
  items: ShopItem[];
  owned: string[];
  serials: Record<string, number>;
  chests: Record<string, number>;
  chest_defs: ShopChestDef[];
  featured: string[];
  deals: {key: string; off: number; price_coins: number; base_coins: number}[];
  deal_keys: string[];
  event: {key: string; name: string; glyph: string; blurb: string; color: string; closes_at: string; seconds_left: number} | null;
  next_event: {key: string; name: string; glyph: string; blurb: string; opens_at: string; seconds_until: number} | null;
  event_items: string[];
  vault: string[];
  slots: Record<string, string>;
  rarities: RarityMeta[];
  achievements: Record<string, string>;
  collection: {owned_count: number; total: number; diamond_items: number};
}

export interface ShopPlaque {
  key: string;
  name: string;
  rarity: string;
  rarity_meta: RarityMeta;
  released: string;
  owners: number;
  obtained_from: string;
  mine: {serial: number; acquired_at: string; source: string} | null;
}

export interface ChestReward {
  kind: string;
  name: string;
  glyph: string;
  type?: 'item' | 'xp' | 'coins';
  amount?: number;
  item?: string;
  item_name?: string;
  rarity?: string;
  diamonds?: number;
}

export interface QuestionPublic {
  id: number;
  position: number;
  text: string;
  options: Record<string, string>;
  points: number;
  difficulty: string;
  drawn?: boolean;
  correct?: OptionKey;
  /** Display letter of the answer for this attempt (option shuffle aware). */
  correct_label?: OptionKey | null;
  /** Canonical keys in the order the options are displayed. */
  display_order?: string[];
  /** Per-question countdown (seconds), only when the exam sets a budget. */
  seconds_left?: number;
  explanation?: string;
  order?: number;
  answered_by_you?: boolean;
  my_selection?: OptionKey | null;
  my_points?: number;
  /* --- wave-2 authorship fields (all optional so old payloads still type) --- */
  question_type?: string;
  topic?: string;
  subtopic?: string;
  objective?: string;
  tags?: string[];
  source?: string;
  reference?: string;
  author?: string;
  hint?: string;
  admin_notes?: string;
  media?: Record<string, string>;
  content?: Record<string, unknown>;
  status?: 'draft' | 'approved' | 'rejected' | 'archived' | string;
  visible?: boolean;
  flag_reason?: string;
  order_locked?: boolean;
  flashcard_enabled?: boolean;
  duel_enabled?: boolean;
  practice_enabled?: boolean;
  time_limit_seconds?: number;
  version?: number;
  quiz_id?: number;
  course_id?: number | null;
  usage_count?: number;
  correct_count?: number;
  wrong_count?: number;
  accuracy?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MyDuelAnswer {
  question_id: number;
  selected: OptionKey;
  is_correct: boolean;
  points: number;
  elapsed_ms: number;
}

export interface AttemptSummary {
  id: number;
  quiz_id: number;
  status: 'in_progress' | 'submitted' | 'expired';
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  score: number;
  percentage: number;
  grade: string;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  submission_type: string;
  xp_awarded: number;
  coins_awarded: number;
}

export interface Quiz {
  id: number;
  title: string;
  instructions: string;
  duration_minutes: number;
  status: QuizStatus;
  scheduled_at: string | null;
  end_at: string | null;
  shuffle_questions: boolean;
  allow_duel: boolean;
  question_count: number;
  created_at: string;
  course: Course | null;
  submission_count?: number;
  my_attempt?: AttemptSummary | null;
  questions?: QuestionPublic[];
  /* --- exam builder settings --- */
  rules?: string;
  version_label?: string;
  shuffle_options?: boolean;
  per_question_seconds?: number;
  grace_seconds?: number;
  auto_submit?: boolean;
  calculator?: boolean;
  review_before_submit?: boolean;
  max_attempts?: number;
  practice_mode?: boolean;
}

export interface ReviewRow {
  question_id: number;
  text: string;
  options: Record<string, string>;
  correct: OptionKey;
  explanation: string;
  selected: OptionKey | null;
  is_correct: boolean;
  /** Letter the answer sits on for *this* attempt after option shuffling. */
  correct_label?: OptionKey | null;
  selected_label?: OptionKey | null;
  display_order?: string[];
}

export interface AttemptState extends AttemptSummary {
  time_remaining: number;
  rank: number | null;
  rank_label: string | null;
  quiz: Quiz;
  questions: QuestionPublic[];
  answers: {question_id: number; selected: OptionKey | null; flagged: boolean; seconds_spent: number; is_correct?: boolean}[];
  review: ReviewRow[];
  leaderboard?: QuizLeaderRow[];
  rewards?: unknown[];
}

export interface QuizLeaderRow {
  rank: number;
  rank_label: string;
  student: PlayerSummary;
  result: AttemptSummary;
}

export interface ResultRow extends AttemptSummary {
  rank: number;
  rank_label: string;
  quiz: {id: number; title: string; course: string; course_title: string; total_questions: number};
}

export interface LeaderboardRow {
  rank: number;
  rank_label: string;
  id: number;
  name: string;
  initials: string;
  avatar_hue: number;
  has_photo?: boolean;
  cosmetics?: CosmeticsRef;
  level: number;
  title: string;
  tier: Tier;
  value: number;
  xp: number;
  coins: number;
  streak: number;
  duels_won: number;
  best_percentage: number;
}

export interface Leaderboard {
  scope: string;
  rows: LeaderboardRow[];
  me: LeaderboardRow;
  total_players: number;
  online: number;
}

export interface DuelPlayer {
  student_id: number;
  seat: 'challenger' | 'opponent';
  name: string;
  initials: string;
  avatar_hue: number;
  has_photo?: boolean;
  level: number;
  score: number;
  correct_count: number;
  answered_count: number;
  best_run: number;
  forfeited: boolean;
  finished_at: string | null;
  is_you: boolean;
  xp?: number;
  duels_won?: number;
}

export interface Duel {
  id: number;
  code: string;
  topic: string;
  quiz_id: number | null;
  course_id?: number | null;
  status: 'invited' | 'live' | 'finished' | 'cancelled' | 'expired';
  question_count: number;
  stake_coins: number;
  time_limit_seconds: number;
  winner_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  participants: DuelPlayer[];
  is_yours: boolean;
  questions?: QuestionPublic[];
  my_answers?: MyDuelAnswer[];
  draw?: boolean;
  reason?: string;
  challenger_name?: string;
  deadline?: string;
}

export interface DuelList {
  active: Duel[];
  history: Duel[];
  online: number;
  online_ids: number[];
  stake_default: number;
  question_count_default: number;
}

export interface Prize {
  id: number;
  title: string;
  description: string;
  tier: Tier;
  kind: 'rank' | 'coins';
  min_rank: number;
  max_rank: number;
  cost_coins: number;
  icon: string;
  stock: number;
  is_active: boolean;
  sort_order: number;
  eligible: boolean;
  claimed: boolean;
  claims: number;
}

export interface PrizeVault {
  prizes: Prize[];
  my_rank: number;
  rank_label: string;
  coins: number;
  prize_pool_note: string;
  season: string;
}

export interface Notice {
  id: number;
  title: string;
  message: string;
  kind: string;
  target_course: string;
  author: string;
  is_pinned: boolean;
  created_at: string;
}

export interface ActivityItem {
  id: number;
  kind: string;
  title: string;
  detail: string;
  amount: number;
  created_at: string;
  student?: PlayerSummary | null;
  reactions?: number;
  reacted?: boolean;
}

export interface MatchCard {
  card: string;
  pair: number;
  side: 'prompt' | 'answer';
  text: string;
}

export interface MatchSet {
  issued_at: string;
  pairs: number;
  cards: MatchCard[];
}

export interface MatchResult {
  ok: boolean;
  score: number;
  matched: number;
  pairs: number;
  perfect: boolean;
  best: number;
  rewards: RewardEvent[];
  profile: Profile;
}

export interface InboxNote {
  id: number;
  kind: string;
  title: string;
  message: string;
  meta: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export interface StudyCard extends QuestionPublic {
  quiz_title: string;
}

export interface RushSet {
  mode: 'blitz' | 'sudden';
  issued_at: string;
  seconds: number;
  questions: QuestionPublic[];
}

export interface RushResult {
  ok: boolean;
  score: number;
  total: number;
  best: number;
  rewards: RewardEvent[];
  profile: Profile;
}

export interface DailyChallenge {
  day: string;
  questions: QuestionPublic[];
  done: boolean;
  result: {score: number; correct: number} | null;
  players_today: number;
}

export interface HelpRow {
  id: number;
  status: 'pending' | 'answered';
  prompt: string;
  options: Record<string, string>;
  created_at: string;
  answered_at: string | null;
  other: PlayerSummary | null;
  helper_answer?: string;
  was_correct?: boolean;
  explanation?: string;
}

export interface MissionRow {
  key: string;
  title: string;
  detail: string;
  goal: number;
  xp: number;
  coins: number;
  progress: number;
  claimed: boolean;
}

export interface ShopItem {
  sku: string;
  name: string;
  cost: number;
  icon: string;
  blurb: string;
}

export interface Analytics {
  accuracy: number;
  predicted_grade: {grade: string; label: string};
  questions_answered: number;
  correct_answers: number;
  study_minutes: number;
  courses: {title: string; answers: number; accuracy: number}[];
  weakest: {title: string; answers: number; accuracy: number} | null;
  rush_best: Record<string, number>;
  daily_best: number;
  help: {asked: number; answered: number; correct: number; points: number};
  best_percentage: number;
}

export interface Config {
  institution: string;
  campus: string;
  faculty: string;
  season_name: string;
  prize_pool_note: string;
  grading_scale: {grade: string; min_percent: number; label: string}[];
  duels_enabled: boolean;
  exams_enabled: boolean;
  online: number;
  admin_email?: string;
  updated_at?: string | null;
}

export interface ChatMessage {
  id: number;
  sender_id: number;
  recipient_id: number;
  kind: 'text' | 'duel' | 'quiz';
  body: string;
  meta: Record<string, unknown>;
  created_at: string;
  read: boolean;
  sender_name?: string;
  /** Set when the sender edited the text; the original is kept server-side. */
  edited_at?: string | null;
  /** Tombstone: the sender deleted it, the thread keeps its place. */
  deleted?: boolean;
  /** emoji → how many people tapped it. */
  reactions?: Record<string, number>;
  /** Only your own taps, so the chips can show what you picked. */
  my_reactions?: string[];
}

/** Pre-flight answer for the sign-in card: does this number own a profile? */
export type PhoneLookup = {
  exists: boolean;
  phone?: string;
  first_name?: string;
  initials?: string;
  avatar_hue?: number;
  level?: number;
  title?: string;
  xp?: number;
  percent?: number;
  coins?: number;
  streak?: number;
  exams_taken?: number;
  duels_played?: number;
  badges?: number;
  banned?: boolean;
};

export interface Bootstrap {
  config: Config;
  quizzes: Quiz[];
  notifications: Notice[];
  leaderboard: LeaderboardRow[];
  online: number;
  players: number;
  duels_today: number;
}

export interface AdminOverview {
  players: number;
  online: number;
  courses: number;
  quizzes: number;
  active_quizzes: number;
  questions: number;
  submissions: number;
  in_progress: number;
  duels: number;
  duels_live: number;
  duels_today: number;
  prize_claims_pending: number;
  badges_awarded: number;
  xp_awarded: number;
  coins_in_circulation: number;
  top_players: PlayerSummary[];
  recent_activity: ActivityItem[];
}

export interface PrizeClaim {
  id: number;
  prize: Prize;
  student: PlayerSummary;
  status: 'pending' | 'approved' | 'delivered' | 'rejected';
  note: string;
  created_at: string;
}

/* ---------------------------------------------------------- live events --- */
export type RewardEvent =
  | {type: 'xp'; amount: number; reason?: string}
  | {type: 'coins'; amount: number; reason?: string}
  | {type: 'streak'; days: number}
  | {type: 'level_up'; level: number; title: string; tier: Tier}
  | {type: 'badge'; badge: BadgeItem}
  | {
      /* Sent with the grant that pushed the player up the seasonal ladder. */
      type: 'season_level';
      season_key: string;
      label: string;
      xp: number;
      level: number;
      levels_gained: number;
      rank: SeasonRank;
      promoted: boolean;
      previous_rank: SeasonRank;
      next_rank: SeasonRank | null;
      levels_to_next_rank: number;
      progress: SeasonBadgeBlock['progress'];
    };

export interface DuelProgressEvent {
  duel_id: number;
  student_id: number;
  question_order: number;
  correct: boolean;
  points: number;
  score: number;
  answered: number;
  total: number;
  run: number;
  elapsed_ms: number;
}

export interface ExamResultEvent {
  attempt_id: number;
  quiz_id: number;
  score: number;
  total: number;
  percentage: number;
  grade: string;
  rank: number;
  rank_label: string;
  xp: number;
  coins: number;
  rewards: RewardEvent[];
}


/* -------------------------------------------------------------- rooms */
export interface RoomMember {
  student_id: number;
  name: string;
  initials: string;
  avatar_hue: number;
  has_photo: boolean;
  is_host: boolean;
  score: number;
  correct_count: number;
}

export interface RoomState {
  id: number;
  code: string;
  title: string;
  status: 'lobby' | 'live' | 'finished';
  host_id: number;
  course_id: number | null;
  question_count: number;
  per_question_seconds: number;
  round_index: number;
  questions_total: number;
  capacity: number;
  is_host: boolean;
  created_at: string;
  members: RoomMember[];
}

export interface RoomMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_initials: string;
  sender_hue: number;
  sender_has_photo: boolean;
  body: string;
  created_at: string;
}

export interface RoomQuestionPayload {
  index: number;
  total: number;
  seconds: number;
  deadline: string;
  question: QuestionPublic;
}

export interface RoomRevealPayload {
  index: number;
  question_id: number;
  correct: string;
  explanation: string;
  correct_ids: number[];
  answered: number;
  standings: RoomMember[];
}

export interface RoomFinishPayload {
  standings: RoomMember[];
  rewards: {student_id: number; xp: number; coins: number}[];
}


/* ------------------------------------------------------ wave-2 arena types */
export type DuelMode = 'casual' | 'ranked' | 'friendly' | 'tournament';

export interface FlashcardCardPayload {
  id: number;
  deck_id: number;
  question_id: number;
  front: string;
  back: string;
  options?: Record<string, string>;
  correct?: string | null;
  explanation?: string;
  topic?: string;
  difficulty?: string;
  state?: string;
  due_on?: string | null;
  notes?: string;
  bookmarked?: boolean;
}

export interface PracticeRunPayload {
  token: string;
  mode: string;
  label: string;
  lives: number;
  seconds: number;
  xp_rate?: number;
  target_score?: number;
  questions: QuestionPublic[];
  powerups?: Record<string, number>;
}

export interface BossPayload {
  run_id: number;
  token: string;
  boss: {key: string; name: string; hp_max: number; lives: number; blurb?: string};
  questions: QuestionPublic[];
}

export interface LeaderboardScopeRow {
  rank: number;
  name: string;
  is_you?: boolean;
  value?: number;
  [key: string]: unknown;
}

/* ==========================================================================
 * Materials (reading + study progression) and the Game Arena
 * ========================================================================== */

/** One typed block inside a material section. HTML is stripped server-side. */
export interface MaterialBlock {
  type:
    | 'heading'
    | 'subheading'
    | 'paragraph'
    | 'list'
    | 'numbers'
    | 'table'
    | 'image'
    | 'note'
    | 'example'
    | 'definition'
    | 'keyterm'
    | 'tip'
    | 'summary'
    | 'reference'
    | 'quote'
    | 'video'
    | 'divider'
    | 'attachment';
  text?: string;
  title?: string;
  items?: string[];
  head?: string[];
  rows?: string[][];
  url?: string;
  caption?: string;
  term?: string;
  meaning?: string;
}

export interface MaterialSection {
  id: number;
  material_id?: number;
  position: number;
  title: string;
  estimated_minutes?: number;
  check_enabled?: boolean;
  updated_at?: string | null;
  blocks?: MaterialBlock[];
  words?: number;
  percent?: number;
}

export interface MaterialProgress {
  status: 'not_started' | 'reading' | 'completed' | string;
  percent: number;
  visited: number[];
  sections_done: number;
  total_sections: number;
  last_section_id?: number | null;
  last_section_position?: number | null;
  seconds_spent: number;
  completed_at?: string | null;
}

export interface MaterialCard {
  id: number;
  title: string;
  course_id?: number | null;
  quiz_id?: number | null;
  topic: string;
  subtopic: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimated_minutes: number;
  tags: string[];
  summary: string[];
  author: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  icon: string;
  accent: string;
  allow_discussion: boolean;
  section_count: number;
  sections?: MaterialSection[];
  views: number;
  starts: number;
  completions: number;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  progress?: MaterialProgress;
  course_title?: string;
}

export interface MaterialHighlight {
  id: number;
  section_id: number | null;
  text: string;
  colour: 'yellow' | 'blue' | 'green' | 'red' | string;
  note?: string;
}

export interface MaterialNote {
  id: number;
  section_id: number | null;
  body: string;
  quote?: string;
}

export interface MaterialBookmark {
  id: number;
  section_id: number | null;
  label: string;
  snippet?: string;
  position?: string;
}

export interface MaterialPost {
  id: number;
  student_id?: number;
  name?: string;
  body: string;
  kind: 'question' | 'answer' | 'tip' | string;
  section_id?: number | null;
  parent_id?: number | null;
  created_at?: string;
  mine?: boolean;
  resolved?: boolean;
  replies?: MaterialPost[];
}

export interface MaterialDetail extends MaterialCard {
  sections: MaterialSection[];
  progress: MaterialProgress;
  highlights: MaterialHighlight[];
  notes: MaterialNote[];
  bookmarks: MaterialBookmark[];
  questions: {linked: number; hard: number; average_accuracy: number};
  streak?: {current: number; best: number; seconds_today: number};
  course_title?: string;
  linked_question_ids?: number[];
  stats?: Record<string, unknown>;
  focus_section?: number;
}

export interface MaterialLibrary {
  items: MaterialCard[];
  total: number;
  limit: number;
  offset: number;
  topics: {topic: string; count: number}[];
}

export interface MyLearning {
  continue_reading: (Omit<MaterialCard, 'sections'> & {material_id: number})[];
  completed: (Omit<MaterialCard, 'sections'> & {material_id: number; progress: MaterialProgress})[];
  bookmarks: {id: number; material_id: number; title: string; label: string; section_id: number | null; snippet?: string}[];
  notes: {id: number; material_id: number; title: string; body: string; section_id: number | null}[];
  confusions: {id: number; material_id: number; title: string; question: string; status: string; section_id: number | null}[];
  topics: {topic: string; count: number; percent: number}[];
  summary: {reading: number; completed: number; bookmarks: number; notes: number; minutes: number; percent: number};
}

export interface MaterialProgressResult {
  progress: MaterialProgress;
  rewards: {amount?: number; reason?: string; awarded?: number; playtime_unlocked?: number[]}[];
  playtime: PlaytimeBank;
  streak: {current: number; best: number; seconds_today: number; day?: string | null};
  section_reward?: {awarded: number; reason: string} | null;
}

export interface MaterialExamPrep {
  material_id: number;
  topic: string;
  questions: QuestionPublic[];
  related: {id: number; title: string; topic: string; difficulty: string; estimated_minutes: number}[];
  tips: string[];
}

export interface MaterialAnalytics {
  material: {id: number; title: string; status: string; version: number};
  views: number;
  starts: number;
  completions: number;
  completion_rate?: number;
  average_seconds?: number;
  drop_off?: {section_id: number; title: string; readers: number; percent: number}[];
  confusions?: {section_id: number; count: number}[];
  feedback?: {yes?: number; somewhat?: number; no?: number};
  questions?: {linked: number; hardest?: {question_id: number; text: string; success_rate: number}[]};
  readers?: number;
  [key: string]: unknown;
}

export interface PlaytimeBank {
  day: string | null;
  earned_seconds: number;
  used_seconds: number;
  remaining_seconds: number;
  study_xp_today: number;
  cap_seconds: number;
  thresholds: number[];
  seconds_per_threshold: number;
}

export interface GameProfileState {
  best_score: number;
  best_survival_seconds: number;
  best_combo: number;
  runs: number;
  total_seconds: number;
  character: string;
  trail: string;
  achievements: string[];
  characters: string[];
  trails: string[];
}

export interface GameChallengeRow {
  id: number;
  from: string;
  to: string;
  mode: string;
  target_score: number;
  target_seconds: number;
  status: 'open' | 'beaten' | 'lost' | string;
  mine: boolean;
  opponent_id: number;
}

export interface GameHub {
  playtime: PlaytimeBank;
  locked: boolean;
  profile: GameProfileState;
  characters: {id: string; name: string; blurb: string; unlock_xp: number}[];
  trails: {id: string; name: string; unlock_xp: number}[];
  achievements: {key: string; name: string; blurb: string; earned: boolean}[];
  daily_challenge: {title: string; target_seconds: number; done: boolean; board: {student_id: number; name: string; score: number; you: boolean}[]};
  friends: {student_id: number; name: string; best_score: number; you: boolean}[];
  challenges: GameChallengeRow[];
  today_played_seconds: number;
  streak: {current: number; best: number; seconds_today: number; day?: string | null};
  study: {xp_today: number; next_threshold: number | null};
}

export interface GameRunResult {
  session: {id: number; score: number; seconds: number; combo: number; wave: number; collected: number; xp: number; coins: number};
  best_score: number;
  best_survival_seconds: number;
  achievements: {key: string; name: string; blurb: string}[];
  /** XP plus the season climb it caused — the run's own reward payload. */
  rewards?: RewardEvent[];
  challenges_resolved: {id: number; beaten: boolean; target_score: number}[];
  playtime: PlaytimeBank;
  study: {xp_today: number};
}

export interface GameBoardRow {
  student_id?: number;
  id?: number;
  name?: string;
  score: number;
  seconds?: number;
  mode?: string;
  day?: string | null;
  you: boolean;
}

/* ==========================================================================
 * World map — courses as worlds, topics as locations, exams as bosses
 * ========================================================================== */

export interface WorldTheme {
  key: string;
  label: string;
  emoji: string;
  sky?: string;
  ground?: string;
}

export interface MapMaterial {
  id: number;
  title: string;
  minutes: number;
  percent: number;
  status: string;
}

export interface MapNode {
  topic: string;
  questions: number;
  answered: number;
  correct: number;
  mastery: number;
  state: 'mastered' | 'learning' | 'available' | 'locked';
  materials: MapMaterial[];
  practice: {runs: number; best: number; accuracy: number};
}

export interface MapBoss {
  quiz_id: number;
  title: string;
  status: string;
  question_count: number;
  scheduled_at?: string | null;
  best_percentage: number | null;
  best_score: number | null;
  attempts: number;
}

export interface WorldRow {
  course_id: number;
  code: string;
  title: string;
  description: string;
  accent: string;
  theme: WorldTheme;
  mastery: number;
  answered: number;
  correct: number;
  percent: number;
  materials: number;
  boss: MapBoss | null;
  nodes: MapNode[];
}

export interface QuestRow {
  key: string;
  kind: 'daily' | 'weekly';
  label: string;
  detail: string;
  icon: string;
  target: number;
  reward: {xp: number; coins: number};
  progress: number;
  complete: boolean;
  claimed: boolean;
  unit?: string;
}

export interface WorldMap {
  generated_at: string;
  player: {level: number; title: string; xp: number; streak: number; coins: number};
  totals: {worlds: number; nodes: number; mastered: number; reachable: number; materials: number; bosses: number; path_percent: number};
  quests: QuestRow[];
  worlds: WorldRow[];
}
