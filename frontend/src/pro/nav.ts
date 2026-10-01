/** Pro Mode navigation: the sidebar, the phone bar and the command menu share it. */
import {BarChart3, BookOpen, Briefcase, ClipboardCheck, GraduationCap, Layers, LayoutDashboard, Library, ListChecks, MessagesSquare, Presentation, Settings, Sparkles} from 'lucide-react';
import type {Tab} from '../lib/nav';
import type {Hue} from './ui';

export type ProNavItem = {id: Tab; label: string; icon: typeof LayoutDashboard; hint: string; hue?: Hue; group?: string};

export const PRO_NAV: ProNavItem[] = [
  {id: 'play', label: 'Dashboard', icon: LayoutDashboard, hint: 'Study overview', hue: 'violet', group: 'Learn'},
  {id: 'study', label: 'Study', icon: GraduationCap, hint: 'Topic workspace', hue: 'blue', group: 'Learn'},
  {id: 'courses', label: 'Courses', icon: Library, hint: 'Courses and topics', hue: 'teal', group: 'Learn'},
  {id: 'materials', label: 'Materials', icon: BookOpen, hint: 'Course reading', hue: 'amber', group: 'Learn'},
  {id: 'bank', label: 'Question Bank', icon: ListChecks, hint: 'Practise from the bank', hue: 'green', group: 'Practise'},
  {id: 'exams', label: 'Exams', icon: ClipboardCheck, hint: 'Exams and mini exams', hue: 'rose', group: 'Practise'},
  {id: 'flashcards', label: 'Flashcards', icon: Layers, hint: 'Spaced review', hue: 'blue', group: 'Practise'},
  {id: 'tutor', label: 'AI Assistant', icon: Sparkles, hint: 'Ask about your studies', hue: 'violet', group: 'Insight'},
  {id: 'analytics', label: 'Analytics', icon: BarChart3, hint: 'Your learning data', hue: 'teal', group: 'Insight'},
  {id: 'teachers', label: 'Teachers', icon: Presentation, hint: 'Find a verified teacher', hue: 'green', group: 'Teach'},
  {id: 'messages', label: 'Messages', icon: MessagesSquare, hint: 'Teachers and students', hue: 'blue', group: 'Teach'},
  {id: 'studio', label: 'Teacher Studio', icon: Briefcase, hint: 'Your teaching workspace', hue: 'violet', group: 'Teach'},
];

export const PRO_SETTINGS: ProNavItem = {id: 'settings', label: 'Settings', icon: Settings, hint: 'Appearance, reading, account'};

/** Phone bar: four daily destinations; everything else lives in the drawer. */
export const PRO_MOBILE: Tab[] = ['play', 'study', 'exams', 'tutor'];

export function proLabel(tab: Tab): string {
  if (tab === 'settings' || tab === 'profile') return 'Settings';
  return PRO_NAV.find((row) => row.id === tab)?.label ?? 'Absolute Genesis';
}

export function proHue(tab: Tab): Hue {
  return PRO_NAV.find((row) => row.id === tab)?.hue ?? 'violet';
}
