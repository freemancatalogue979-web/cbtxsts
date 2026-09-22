/** Navigation model shared by the desktop tabs and the mobile bottom bar. */
import {Activity, BookOpen, CalendarDays, Gamepad2, Gift, GraduationCap, LifeBuoy, Map, Search, Shield, Store, Swords, TrendingUp, Trophy, User, Users} from 'lucide-react';

export type Tab = 'play' | 'map' | 'study' | 'materials' | 'arena' | 'ranked' | 'events' | 'mystery' | 'duels' | 'shop' | 'friends' | 'ranks' | 'prizes' | 'feed' | 'support' | 'profile';

export const TABS: {id: Tab; label: string; short: string; icon: typeof Gamepad2}[] = [
  {id: 'play', label: 'Play', short: 'Home', icon: Trophy},
  {id: 'map', label: 'World Map', short: 'Map', icon: Map},
  {id: 'study', label: 'Study Lab', short: 'Learn', icon: GraduationCap},
  {id: 'materials', label: 'Materials', short: 'Read', icon: BookOpen},
  {id: 'arena', label: 'Game Arena', short: 'Arena', icon: Gamepad2},
  {id: 'ranked', label: 'Ranked', short: 'Ranked', icon: TrendingUp},
  {id: 'events', label: 'Events', short: 'Events', icon: CalendarDays},
  {id: 'mystery', label: 'Mystery', short: 'Cases', icon: Search},
  {id: 'duels', label: 'Duels', short: 'Duels', icon: Swords},
  {id: 'shop', label: 'Shop', short: 'Shop', icon: Store},
  {id: 'friends', label: 'Friends', short: 'Friends', icon: Users},
  {id: 'ranks', label: 'Ranks', short: 'Ranks', icon: Trophy},
  {id: 'prizes', label: 'Prizes', short: 'Prizes', icon: Gift},
  {id: 'feed', label: 'Feed', short: 'Feed', icon: Activity},
  {id: 'support', label: 'Support', short: 'Help', icon: LifeBuoy},
  {id: 'profile', label: 'Profile', short: 'You', icon: User},
];

export const ADMIN_ICON = Shield;

/**
 * The phone bar keeps four daily destinations plus a "More" sheet — anything
 * wider turns into unreadable slivers on a 320px screen, and horizontal
 * scrolling is banned. Everything else (materials, duels, friends, ranks,
 * prizes, feed, profile) lives one tap away in the sheet.
 */
export const MOBILE_TABS: Tab[] = ['play', 'map', 'study', 'duels'];

export const MORE_TABS: Tab[] = TABS.map((row) => row.id).filter((id) => !MOBILE_TABS.includes(id));

export const DESKTOP_PRIMARY_TABS: Tab[] = ['play', 'ranked', 'events', 'study', 'mystery', 'arena', 'shop'];
export const DESKTOP_MORE_TABS: Tab[] = ['map', 'materials', 'duels', 'friends', 'ranks', 'prizes', 'feed', 'support', 'profile'];
