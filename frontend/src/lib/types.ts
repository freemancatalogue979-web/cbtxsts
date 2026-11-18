export type Role = "admin" | "captain" | "coach" | "player" | "analyst";

export interface User {
  id: number;
  email: string;
  name: string;
  ign: string;
  role: Role;
  role_label: string;
  main_role: string;
  bio: string;
  active: boolean;
  roster: boolean;
  avatar?: string | null;
}

export interface Meta {
  team_name: string;
  team_tagline: string;
  season_patch: string;
  lanes: string[];
  roles: Record<string, string>;
  activity_categories: string[];
  activity_statuses: string[];
  hero_statuses: string[];
  hero_tiers: string[];
  pool_categories: string[];
  review_statuses: string[];
  scrim_formats: string[];
  draft_statuses: string[];
  strategy_categories: string[];
  event_kinds: string[];
  dev_categories: string[];
}

export interface Week {
  id: number;
  number: number;
  focus: string;
  objective: string;
  performance_target: string;
  notes: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  weakness_text: string;
  weakness_drills_target: number;
  progress: number;
  activity_counts: { total: number; done: number; scheduled: number };
  activities?: Activity[];
}

export interface Attachment {
  label?: string;
  url?: string;
  kind?: string;
}

export interface TournamentGameDraft {
  game_no: number;
  result: "WIN" | "LOSS" | "";
  draft: Draft;
  /** Who played this game: {LANE: user_id}. */
  lineup?: Record<string, number>;
  /** Same lineup as display names: {LANE: ign}. */
  players?: Record<string, string>;
  /** Scoreboard lines by lane. */
  player_stats?: Record<string, PlayerLine>;
  enemy_stats?: Record<string, EnemyLine>;
}

export interface TournamentPlayerStat {
  user_id: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  series: number;
  tournaments: number;
  main_lane: string;
  lanes: Record<string, number>;
  heroes: { hero: string; games: number; wins: number }[];
  /** When K/D/A was recorded: (kills + assists) / deaths. */
  kda?: number | null;
  /** Average in-game rating, when recorded. */
  rating?: number | null;
  mvps?: number;
}

export interface TournamentStatsT {
  series: { played: number; wins: number; losses: number; draws: number; win_rate: number | null };
  games: { played: number; wins: number; losses: number; win_rate: number | null; with_lineup: number; with_player_stats?: number };
  players: TournamentPlayerStat[];
  heroes: { hero: string; games: number; wins: number; losses: number; win_rate: number | null }[];
  tournaments?: number;
}

export interface PlayerTournamentStats {
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  series: number;
  tournaments: number;
  main_lane: string;
  lanes: Record<string, number>;
  heroes: { hero: string; games: number; wins: number }[];
  form: string[];
  recent: { tournament_id: number; tournament: string; match_id: number; opponent: string; game_no: number;
    lane: string; hero: string; result: string; date: string | null }[];
}

export interface TournamentMatchT {
  id: number;
  match_no: number;
  stage: string;
  scheduled_date: string | null;
  start_time: string;
  opponent: string;
  format: string;
  status: "scheduled" | "played" | "cancelled" | string;
  result: "WIN" | "LOSS" | "DRAW" | "" | string;
  score_us: number;
  score_them: number;
  notes: string;
  draft: { our_bans?: (string | null)[]; enemy_bans?: (string | null)[];
    our_picks?: Record<string, string>; enemy_picks?: Record<string, string> };
  /** One draft per game of the series (game 1, 2, 3…), sorted by game number. */
  games?: TournamentGameDraft[];
  /** Draft slots this match offers: one per game in the score (min 1), capped by the format. */
  game_slots?: number;
  max_games?: number;
  attachments: { kind: string; label: string; url: string }[];
  review_queued: boolean;
  has_review: boolean;
  review_id: number | null;
  tournament_id?: number;
  tournament_name?: string;
}

export interface Tournament {
  id: number;
  name: string;
  status: "upcoming" | "ongoing" | "finished" | string;
  review_queued: boolean;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  match_count: number;
  played_count: number;
  wins: number;
  losses: number;
  review_pending: number;
  stages: string[];
  matches?: TournamentMatchT[];
  stats?: TournamentStatsT;
  created_at: string | null;
}

export interface AssignedRef {
  id: number;
  ign: string;
  name: string;
  main_role: string;
  avatar?: string | null;
}

export interface Activity {
  id: number;
  week_id: number | null;
  week_number: number | null;
  title: string;
  description: string;
  category: string;
  date: string | null;
  time: string;
  duration_min: number;
  coach_name: string;
  assigned_player_ids: number[];
  assigned?: AssignedRef[];
  required: boolean;
  status: string;
  notes: string;
  attachments: Attachment[];
  result: string;
  score: string;
  lessons: string;
  scrim_id: number | null;
}

export interface ScrimGame {
  id: number;
  scrim_id: number;
  game_no: number;
  result: string;
  duration_min: number;
  stats: Record<string, number | string | boolean | null>;
  draft: Draft;
  /** Who played ({LANE: user_id}) — the game's own lineup, else the scrim's. */
  lineup: Record<string, number>;
  lineup_from_scrim: boolean;
  players: Record<string, string>;
  player_stats: Record<string, PlayerLine>;
  enemy_stats?: Record<string, EnemyLine>;
}

/** One player's scoreboard line. */
export interface PlayerLine {
  kills?: number; deaths?: number; assists?: number;
  rating?: number; gold?: number; damage?: number; damage_taken?: number; turret_damage?: number; mvp?: boolean;
}
export interface EnemyLine extends PlayerLine { hero?: string; name?: string }

/** How a row's hero was checked against its portrait: matched, fixed from the portrait, probably right, needs a look, or not checked. */
export type HeroCheck = "portrait" | "corrected" | "likely" | "unsure" | "unchecked";
export interface SheetRowHero {
  hero_check?: HeroCheck;
  /** where the portrait is on the screenshot: [x0, y0, x1, y1] as shares of width/height */
  portrait?: number[];
  /** what the reader said before the portrait check replaced it */
  hero_was?: string;
}

/** What the AI read from a match screenshot, ready to fill the game form. */
export interface ScoreboardRead {
  screen: "scoreboard" | "result" | "draft" | "other";
  result: "WIN" | "LOSS" | "";
  duration_min: number | null;
  lineup: Record<string, number>;
  draft: Draft;
  player_stats: Record<string, PlayerLine>;
  enemy_stats: Record<string, EnemyLine>;
  stats: Record<string, number>;
  rows: {
    ours: (SheetRowHero & { lane: string; name: string; hero: string; line: PlayerLine; placed_by: string; user_id: number | null; player: string | null })[];
    enemy: (SheetRowHero & { lane: string; name: string; hero: string; line: PlayerLine; placed_by: string })[];
  };
  checks: { tone: "ok" | "warn" | "info"; text: string }[];
  image_url: string;
}

export interface Draft {
  our_bans?: (string | null)[];
  enemy_bans?: (string | null)[];
  our_picks?: Record<string, string>;
  enemy_picks?: Record<string, string>;
}

export interface Scrim {
  id: number;
  number: number;
  opponent: string;
  date: string | null;
  time: string;
  format: string;
  server: string;
  tournament_prep: boolean;
  lineup: Record<string, number | null>;
  substitutes: number[];
  notes: string;
  expected_strategy: string;
  status: string;
  result: string | null;
  score_us: number;
  score_them: number;
  attachments: Attachment[];
  has_review: boolean;
  review_status: string | null;
  needs_review: boolean;
  games: ScrimGame[];
  created_by: number | null;
}

export interface Review {
  id: number;
  scrim_id: number | null;
  scrim_number: number | null;
  tournament_match_id: number | null;
  tournament_id: number | null;
  tournament_name: string | null;
  tournament_stage: string | null;
  opponent: string;
  date: string | null;
  duration_min: number;
  result: string;
  player_ids: number[];
  stats: Record<string, number | string>;
  draft: Draft;
  biggest_mistakes: string[];
  why_happened: string;
  should_have_done: string;
  who_involved: string;
  what_change: string;
  lesson: string;
  action_item: string;
  action_assignee_id: number | null;
  action_deadline: string | null;
  status: string;
  mandatory: boolean;
  created_by: number | null;
}

export interface Hero {
  id: number;
  name: string;
  role: string;
  hero_class: string;
  difficulty: number;
  meta_status: string;
  tier: string;
  patch: string;
  win_rate: number;
  pick_rate: number;
  ban_rate: number;
  clover_rating: number;
  notes: string;
  strong_against: string[];
  weak_against: string[];
  synergy: string[];
  specialists?: {
    user_id: number; name: string; ign: string; main_role: string;
    category: string; confidence: number; games: number; win_rate: number | null;
  }[];
  on_ban_board?: { scope: string; priority: number | null; opponent: string; patch: string; reason: string }[];
  profile?: HeroProfile | null;
}

export interface HeroProfile {
  slug: string;
  title: string;
  roles: string[];
  lanes: string[];
  specialties: string[];
  release: string;
  skins: number;
  ratings: { offense: number; durability: number; ability_effects: number; difficulty: number };
  skills: string[];
}

export interface PoolEntry {
  id: number;
  user_id: number;
  hero_id: number;
  hero_name: string;
  hero_role: string;
  hero_status: string;
  category: string;
  confidence: number;
  last_played: string | null;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  coach_notes: string;
  /** Team games played with this hero (scrims + tournaments). */
  played?: PoolPlayed;
}

export interface PoolPlayed {
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  scrim_games: number;
  tournament_games: number;
  kda: number | null;
  rating?: number | null;
  last_played: string | null;
  form: string[];
  /** The player's own solo games on this hero — only for the player and staff. */
  solo?: { games: number; wins: number; losses: number; win_rate: number | null };
}

/** One of a member's own games (ranked/classic…), from the Utility AI or added by hand. */
export interface SoloGame {
  id: number;
  played_on: string | null;
  mode: string;
  hero: string;
  lane: string;
  result: "WIN" | "LOSS" | "";
  duration_min: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  rating: number | null;
  gold: number | null;
  damage: number | null;
  damage_taken: number | null;
  turret_damage: number | null;
  mvp: boolean;
  notes: string;
  source: "manual" | "screenshot" | "document" | "sheet" | string;
  source_file: string;
  batch: string;
  created_at: string | null;
}

export interface SoloBlock {
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  kda: KdaLine | null;
  rating: { games: number; avg: number } | null;
  mvps: number;
  avg_gold?: number;
  gold_per_min?: number;
}

export interface SoloGroup extends SoloBlock { name: string; form: string[]; last_played: string | null; loss_streak: number }

export interface SoloAlert { kind: string; tone: "bad" | "warn" | "good"; title: string; detail: string; hero?: string }

export interface SoloStats {
  overall: SoloBlock;
  streak: { result: string; count: number };
  form: string[];
  heroes: SoloGroup[];
  lanes: SoloGroup[];
  modes: SoloGroup[];
  trend: { recent: SoloBlock; before: SoloBlock; win_rate: number | null; kda: number | null; rating: number | null; deaths: number | null } | null;
  alerts: SoloAlert[];
  last_played: string | null;
}

export interface SoloGap { hero: string; role: string; category: string; why: string; days?: number; games?: number; status?: "META" | "STRONG" }
export interface SoloGaps { no_data: SoloGap[]; not_playing: SoloGap[]; lane_meta: SoloGap[] }
export interface SoloGamesPayload { user: { id: number; name: string; lane?: string } | null; games: SoloGame[]; total: number; stats: SoloStats; gaps?: SoloGaps }

export interface SoloCheck { tone: "ok" | "info" | "warn"; text: string }

/** A game read from a file, not saved yet: shown so heroes can be fixed first. */
export type SoloReadGame = Omit<SoloGame, "id" | "source" | "source_file" | "batch" | "created_at"> & { look?: SheetRowHero };

export interface SoloImport {
  batch: string | null;
  file: string;
  source: string;
  read_directly: boolean;
  added: SoloGame[];
  duplicates: number;
  checks: SoloCheck[];
  /** true: nothing saved yet — check the games, then confirm */
  preview?: boolean;
  games?: SoloReadGame[];
  /** hero portraits remembered for next time */
  learned?: number;
}

export interface SoloCoaching {
  headline: string;
  summary: string;
  strengths: { title: string; detail: string }[];
  fixes: { title: string; detail: string; drill: string }[];
  heroes: Record<"keep" | "work_on" | "try", { hero: string; why: string }[]>;
  next_games: string[];
  games_used: number;
  focus: string;
}

export interface RatingLine { games: number; avg: number | null; mvps: number }

export interface KdaLine { games: number; kills: number; deaths: number; assists: number; ratio: number }

export interface PerfSummary {
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  series: number;
  main_lane: string;
  lanes: Record<string, number>;
  kda: KdaLine | null;
  rating?: RatingLine | null;
  form: string[];
}

export interface HeroPerf {
  hero: string;
  key: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  decided: number;
  scrim_games: number;
  tournament_games: number;
  kda: KdaLine | null;
  rating?: RatingLine | null;
  form: string[];
  loss_streak: number;
  last_played: string | null;
  lanes: string[];
}

export interface FocusAlert {
  kind: "struggling" | "low_kda" | "low_rating" | "cold_streak" | "no_reps" | "strength";
  tone: "bad" | "warn" | "good";
  hero: string;
  title: string;
  detail: string;
  tip: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  kda: number | null;
  pool: string | null;
}

export interface GamePlayed {
  source: "scrim" | "tournament";
  event_id: number;
  match_id: number;
  label: string;
  opponent: string;
  date: string | null;
  game_no: number;
  lane: string;
  hero: string;
  result: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  rating?: number | null;
  mvp?: boolean;
  gold?: number | null;
}

export interface PlayerPerformance {
  overall: PerfSummary;
  scrims: PerfSummary;
  tournaments: PerfSummary;
  heroes: HeroPerf[];
  focus: FocusAlert[];
  recent: GamePlayed[];
}

export interface DevEntry {
  id: number;
  user_id: number;
  date: string | null;
  source: string;
  category: string;
  rating: number | null;
  notes: string;
  created_by: number | null;
  created_by_name: string | null;
}

export interface PlayerDetail extends User {
  scrim_stats: {
    series_played: number;
    series_won: number;
    series_lost: number;
    win_rate: number | null;
    form: string[];
    recent: { scrim_id: number; number: number; opponent: string; result: string; score_us: number; score_them: number; date: string | null }[];
  };
  tournament_stats?: PlayerTournamentStats;
  performance?: PlayerPerformance;
  pool: Record<string, PoolEntry[]>;
  development: DevEntry[];
  avg_rating: number | null;
  can_rate: boolean;
  is_self: boolean;
}

export interface Ban {
  id: number;
  scope: string;
  priority: number | null;
  opponent: string;
  patch: string;
  hero_id: number | null;
  hero_name: string;
  reason: string;
  active: boolean;
}

export interface EventItem {
  id: number | string;
  title: string;
  kind: string;
  date: string | null;
  time: string;
  end_time?: string;
  location?: string;
  description?: string;
  link?: string;
  scrim_id?: number | null;
  source?: string;
  category?: string;
}

export interface StrategyNote {
  id: number;
  title: string;
  category: string;
  body: string;
  tags: string[];
  opponent: string;
  patch: string;
  pinned: boolean;
  author_id: number | null;
  updated_at: string | null;
}

export interface DraftPlan {
  id: number;
  name: string;
  opponent: string;
  patch: string;
  notes: string;
  draft: Draft;
  status: string;
  created_by: number | null;
  updated_at: string | null;
}

export interface Dashboard {
  team: { name: string; tagline: string };
  current_week: Week | null;
  next_activity: Activity | null;
  next_scrim: Scrim | null;
  upcoming_events: EventItem[];
  recent_results: Scrim[];
  performance: {
    games_analyzed: number;
    win_rate?: number;
    objective_control?: number;
    first_turtle_rate?: number;
    lord_conversion?: number | null;
    teamfight_success?: number;
    avg_game_time_min?: number;
    gold_diff_10?: number;
    kills_10?: number;
    deaths_10?: number;
    record?: { series_won: number; series_lost: number; games_won: number; games_lost: number };
  };
  weakness: {
    current_weakness: string;
    weakness_category: string;
    weakness_drills_target: number;
    season_name: string;
    drills_done: number;
    drills_remaining: number;
  } | null;
  mandatory_reviews: Scrim[];
  open_action_items: number;
  /** Your own games and heroes to work on (null if you haven't played yet). */
  my_form?: {
    user_id: number;
    overall: PerfSummary;
    scrims: PerfSummary;
    tournaments: PerfSummary;
    top_heroes: HeroPerf[];
    focus: FocusAlert[];
    /** Own ranked/classic games from Utility AI (separate from team numbers). */
    solo?: { games: number; wins: number; losses: number; win_rate: number | null; kda: number | null; form: string[]; alert: SoloAlert | null } | null;
  } | null;
  /** Staff: the most urgent hero alert per roster player. */
  squad_focus?: { user_id: number; name: string; alert: FocusAlert; more: number }[];
}

export interface ScrimSummary {
  series: { total: number; wins: number; losses: number; win_rate: number | null };
  games: { total: number; wins: number; losses: number; win_rate: number | null };
  averages: { duration_min: number | null; kills: number | null; deaths: number | null; objectives: number | null };
  opponents: { opponent: string; played: number; won: number; lost: number }[];
  blocking_losses: Scrim[];
}

export interface Settings {
  current_weakness: string;
  weakness_category: string;
  weakness_drills_target: number;
  season_name: string;
}

export interface MapToken {
  id: string;
  hero: string;
  side: "ours" | "theirs" | "neutral";
  x: number;
  y: number;
  size?: number;
}

export type MapChipPreset = "litho" | "minion" | "turret" | "retribution" | "lord" | "turtle" | "blue-buff" | "red-buff";

export interface MapChip {
  id: string;
  name: string;
  color: string;
  size: number;
  x: number;
  y: number;
  preset?: MapChipPreset;
}

export interface MapZone {
  id: string;
  x: number;
  y: number;
  /** Radius as a percentage of the map height, so the circle stays round. */
  radius: number;
  color: string;
  tokenId?: string;
  chipId?: string;
}

export interface MapStep {
  id: string;
  number: number;
  mode: "arrow" | "free";
  color: string;
  points: number[][];
  parentId?: string;
  tokenId?: string;
  chipId?: string;
}

export interface MapBoard {
  id: number;
  name: string;
  kind: "draft" | "strategy" | "scrim-review";
  opponent: string;
  draft_id: number | null;
  data: {
    tokens?: MapToken[];
    paths?: { color: string; points: number[][]; mode?: "arrow" | "free" }[];
    steps?: MapStep[];
    chips?: MapChip[];
    zones?: MapZone[];
    [key: string]: unknown;
  };
  notes: string;
  author_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  token_count?: number;
}

export interface PlayerProgress {
  user: User;
  scrim_trend: { week: string; games: number; wins: number; win_rate: number }[];
  rating_trend: { date: string; rating: number; source: string; category: string }[];
  pool: { breadth: number; by_category: Record<string, number>; avg_confidence: number; recorded_games: number; recorded_win_rate: number | null };
  meta_ready_picks: number;
  overall: { series_played: number; series_won: number; series_lost: number; win_rate: number | null; form: string[];
    recent: { scrim_id: number; number: number; opponent: string; result: string; score_us: number; score_them: number; date: string | null }[] };
}

export interface MapGuidePin {
  id: string; name: string; category: string; side: "ours" | "enemy" | "shared" | "river" | string;
  x: number; y: number; blurb: string; facts: [string, string][]; tips: string[];
}
export interface MapGuide {
  pins: MapGuidePin[];
  rotations: { role: string; steps: string[]; links: string[] }[];
  sources: string[]; note: string;
}

export interface NoticeItem {
  id: number;
  kind: "announcement" | "reminder" | string;
  title: string;
  body: string;
  link: string;
  from: string;
  read: boolean;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Training programs (activity → own weeks/tasks → per-member progress)
// ---------------------------------------------------------------------------
export interface ProgramWeekT {
  id: number;
  number: number;
  title: string;
  description: string;
  attachments: { label: string; url: string; kind: string }[];
  scheduled: { id: number; number: number; focus: string; objective: string;
    start_date: string | null; end_date: string | null; status: string } | null;
}

export interface ProgressCell {
  status: "pending" | "done";
  completed_at: string | null;
  notes: string;
  attachments: { label: string; url: string; kind: string }[];
  marked_by: number | null;
}

export interface Program {
  id: number;
  name: string;
  focus: string;
  description: string;
  status: "active" | "archived" | string;
  enrolled_ids: number[];
  enrolled: AssignedRef[];
  weeks: ProgramWeekT[];
  week_count: number;
  completion: number;
  created_at: string | null;
  matrix?: Record<string, Record<string, ProgressCell>>; // week_id -> user_id -> cell
}

// ------------------------------------------------------------ Archive
export interface MemberBrief {
  id: number;
  name: string;
  ign: string;
  main_role: string;
  role: Role;
  avatar: string | null;
}

export interface ArchiveFolderT {
  id: number;
  name: string;
  tag: string;
  owner: MemberBrief | null;
  mine: boolean;
  item_count: number;
  private_count?: number; // only present on my own locker
  created_at: string;
  updated_at: string;
}

export interface ArchiveItemT {
  id: number;
  folder_id: number;
  title: string;
  kind: "note" | "link" | "video" | "file";
  url: string;
  body: string;
  visibility: "public" | "private";
  shared: MemberBrief[]; // populated for the owner only
  mine: boolean;
  comments: number;
  file?: { name: string; kind: string; size: number; url: string };
  created_at: string;
  updated_at: string;
}

export interface ArchiveCommentT {
  id: number;
  item_id: number;
  author: MemberBrief | null;
  body: string;
  created_at: string;
}

export interface ArchiveLocker extends ArchiveFolderT {
  items: ArchiveItemT[];
}

// ---- Utility: staff match evidence -------------------------------------------------------- //
export interface UtilityGame {
  game_no: number; game_id: number | null; result: string; players: Record<string, string>;
  has_stats: boolean; has_enemy: boolean; has_draft: boolean;
}
export interface UtilityMatch {
  key: string; kind: "scrim" | "tournament"; id: number; title: string; event: string; opponent: string;
  date: string | null; status: string; result: string; score: [number | null, number | null]; format: string;
  games: UtilityGame[]; slots: number[]; max_games?: number; evidence: { url: string; label: string }[]; link: (string | number)[];
}
export interface UtilityRead { target: UtilityMatch; game_no: number; sheet: ScoreboardRead }

// ---- Dashboard insights -------------------------------------------------------------------- //
export interface InsightTeamWeek {
  games: number; wins: number; losses: number; win_rate: number | null; scrim_games: number; tournament_games: number;
  kda: number | null; rating: number | null; solo_games: number; solo_win_rate: number | null;
}
export interface InsightPersonWeek {
  team_games: number; team_win_rate: number | null; team_rating: number | null; solo_games: number;
  solo_win_rate: number | null; solo_rating: number | null; games: number; win_rate: number | null;
  kda: number | null; rating: number | null;
}
export interface InsightPerson {
  user_id: number; name: string; role: string; days: number[]; active_days: number; active_7: number;
  streak: number; solo_games: number; last_seen: string | null;
}
export interface Insights {
  scope: "staff" | "member";
  weeks: string[];
  team: InsightTeamWeek[];
  summary: {
    games: number; wins: number; losses: number; win_rate: number | null; streak: { result: string; count: number };
    solo_games: number; scrim_games: number; tournament_games: number; kda: number | null; rating: number | null;
  };
  heroes: { name: string; games: number; wins: number; win_rate: number | null }[];
  me: { user_id: number; name: string; weeks: InsightPersonWeek[] };
  activity: {
    days: string[]; daily_active: number[]; people: InsightPerson[];
    active_today: number; active_7: number; active_28: number; members: number;
  };
  players: { user_id: number; name: string; lane: string; weeks: InsightPersonWeek[] }[];
}

/* ---- Players tab: leaderboard + each member's Utility games (/players/leaderboard, /players/{id}/utility) ---- */
export interface BoardRow {
  user_id: number; ign: string; name: string; avatar: string | null; main_role: string; role: string;
  games: number; wins: number; losses: number; win_rate: number | null; mvps: number;
  team_games: number; solo_games: number; form: string[];
  kda: KdaLine | null; rating: number | null;
  score: { value: number; parts: Partial<Record<"win" | "kda" | "rating" | "volume", number>> } | null;
  heroes: { hero: string; games: number; wins: number; win_rate: number | null }[];
  games_7d: number; last_game: string | null; last_added: string | null; solo_total: number;
  nudge: string; rank: number | null;
}
export interface Leaderboard {
  period: "30" | "90" | "all"; days: number; min_games: number;
  weights: Record<"win" | "kda" | "rating" | "volume", number>;
  rows: BoardRow[]; best: number | null; least: number | null;
  awards: Partial<Record<"win_rate" | "kda" | "rating" | "grinder", { user_id: number; ign: string; label: string; value: string }>>;
  needs_data: number[];
  me: { user_id: number; rank: number | null; nudge: string; of: number; games_7d: number } | null;
}
export interface UtilityWeek {
  start: string; games: number; win_rate: number | null; team_games: number; solo_games: number;
  solo_win_rate: number | null; solo_rating: number | null; rating: number | null;
}
export interface UtilityGame {
  id: number; played_on: string | null; mode: string; hero: string; lane: string; result: string;
  kills: number | null; deaths: number | null; assists: number | null; rating: number | null; mvp: boolean; duration_min: number | null;
}
export interface UtilityProfile {
  user_id: number; ign: string; is_self: boolean;
  overall: SoloBlock; form: string[]; streak: { result: string; count: number }; trend: SoloStats["trend"];
  heroes: SoloGroup[]; lanes: SoloGroup[]; modes: SoloGroup[]; alerts: SoloAlert[];
  weeks: UtilityWeek[]; recent: UtilityGame[]; last_played: string | null; last_added: string | null;
}
