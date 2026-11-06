import {
  Archive, Bell, BookOpenText, BrainCircuit, CalendarDays, ClipboardList, Crosshair, Dumbbell,
  Gamepad2, Home, Layers, Map, Radar, RadioTower, Settings2, ShieldBan, Swords, Trophy, Users,
  type LucideIcon,
} from "lucide-react";
import type { SectionId } from "./theme";

/**
 * One source of truth for the hub's navigation: the sidebar, the mobile drawer,
 * the bottom bar, the quick-jump palette and every page header read from here.
 */
export interface NavItem {
  id: SectionId;
  label: string;
  /** Bottom-bar label on phones. */
  short: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** One line shown in page headers and the quick-jump palette. */
  blurb: string;
  /** Extra words the quick-jump search should match. */
  keywords?: string;
  adminOnly?: boolean;
}

export type NavGroupId = "command" | "team" | "game" | "tactics" | "admin";

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: "command", label: "Command" },
  { id: "team", label: "Team ops" },
  { id: "tactics", label: "Tactics lab" },
  { id: "game", label: "Game intel" },
  { id: "admin", label: "Admin" },
];

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", short: "Home", icon: Home, group: "command", blurb: "Team pulse, next session and form", keywords: "home hub overview" },
  { id: "ai", label: "9 CLOVER AI", short: "AI", icon: BrainCircuit, group: "command", blurb: "Ask about drafts, matchups and esports", keywords: "assistant chat coach" },
  { id: "notifications", label: "Notifications", short: "Alerts", icon: Bell, group: "command", blurb: "Everything that needs your attention", keywords: "inbox alerts" },
  { id: "events", label: "Calendar", short: "Calendar", icon: CalendarDays, group: "command", blurb: "Scrims, training and tournaments by date", keywords: "events schedule" },

  { id: "training", label: "Training Center", short: "Train", icon: Dumbbell, group: "team", blurb: "Programs, weekly blocks and drills", keywords: "practice drills weeks" },
  { id: "scrims", label: "Scrims", short: "Scrims", icon: Swords, group: "team", blurb: "Book, record and review every scrim", keywords: "matches practice games" },
  { id: "tournaments", label: "Tournaments", short: "Cups", icon: Trophy, group: "team", blurb: "Competitions, brackets and results", keywords: "cups leagues" },
  { id: "reviews", label: "Match Reviews", short: "Reviews", icon: ClipboardList, group: "team", blurb: "Lessons and action items from each game", keywords: "vod analysis" },
  { id: "players", label: "Players", short: "Players", icon: Users, group: "team", blurb: "Roster, hero pools and development", keywords: "roster members squad" },

  { id: "drafts", label: "Draft Lab", short: "Drafts", icon: Layers, group: "tactics", blurb: "Pick and ban plans, tested in scrims", keywords: "pick ban draft" },
  { id: "bans", label: "Ban Board", short: "Bans", icon: ShieldBan, group: "tactics", blurb: "What leaves the pool, phase by phase", keywords: "bans priority" },
  { id: "maps", label: "Map Lab", short: "Maps", icon: Map, group: "tactics", blurb: "Rotations and objectives on the Land of Dawn", keywords: "map rotation macro board" },
  { id: "strategy", label: "Strategy", short: "Strategy", icon: BookOpenText, group: "tactics", blurb: "Playbook, opponent files and doctrine", keywords: "playbook knowledge" },
  { id: "archive", label: "Archive", short: "Archive", icon: Archive, group: "tactics", blurb: "Clips, notes and files per player", keywords: "videos files youtube" },

  { id: "heroes", label: "Hero Database", short: "Heroes", icon: Crosshair, group: "game", blurb: "Roles, builds, counters and skills", keywords: "heroes builds items" },
  { id: "intel", label: "MLBB Intel", short: "Intel", icon: Radar, group: "game", blurb: "Hero analytics and saved game data", keywords: "meta stats tier" },
  { id: "esports", label: "Esports", short: "Esports", icon: RadioTower, group: "game", blurb: "Pro fixtures, standings and playoffs", keywords: "mpl pro league" },
  { id: "mlbb", label: "My MLBB", short: "MLBB", icon: Gamepad2, group: "game", blurb: "Your linked account and stats", keywords: "account profile rank" },

  { id: "admin", label: "Team Admin", short: "Admin", icon: Settings2, group: "admin", blurb: "Accounts, roles and team focus", keywords: "settings users roles", adminOnly: true },
];

/** Bottom bar on phones: the six most used areas. */
export const MOBILE_QUICK: SectionId[] = ["dashboard", "ai", "training", "scrims", "tournaments", "esports"];

export function navItem(id: string | undefined | null): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}

export function visibleNav(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

export function groupLabel(id: NavGroupId): string {
  return NAV_GROUPS.find((group) => group.id === id)?.label ?? "";
}

/** Case-insensitive search over label, blurb, group and keywords. */
export function searchNav(items: NavItem[], query: string): NavItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items
    .map((item) => {
      const label = item.label.toLowerCase();
      const hay = `${label} ${item.short} ${item.blurb} ${groupLabel(item.group)} ${item.keywords ?? ""}`.toLowerCase();
      if (!terms.every((term) => hay.includes(term))) return null;
      // Label matches rank above description matches.
      const score = terms.reduce((sum, term) => sum + (label.startsWith(term) ? 3 : label.includes(term) ? 2 : 1), 0);
      return { item, score };
    })
    .filter((entry): entry is { item: NavItem; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export const NAV_COLLAPSED_KEY = "clover_nav_collapsed";

export function readNavCollapsed(storage: Storage | null): boolean {
  try { return storage?.getItem(NAV_COLLAPSED_KEY) === "1"; } catch { return false; }
}

export function saveNavCollapsed(storage: Storage | null, collapsed: boolean): void {
  try {
    if (collapsed) storage?.setItem(NAV_COLLAPSED_KEY, "1");
    else storage?.removeItem(NAV_COLLAPSED_KEY);
  } catch { /* private mode: keep it in memory only */ }
}
