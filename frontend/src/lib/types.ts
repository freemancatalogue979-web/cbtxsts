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

export interface MapBoard {
  id: number;
  name: string;
  kind: "draft" | "strategy" | "scrim-review";
  opponent: string;
  draft_id: number | null;
  data: { tokens?: { id: string; hero: string; side: string; x: number; y: number }[]; paths?: { color: string; points: number[][] }[] };
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
