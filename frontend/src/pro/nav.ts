/** Pro Mode navigation: the sidebar, the phone bar and the command menu share it. */
import {BarChart3, BookOpen, ClipboardCheck, GraduationCap, Layers, LayoutDashboard, Library, ListChecks, Settings, Sparkles} from 'lucide-react';
import type {Tab} from '../lib/nav';

export type ProNavItem = {id: Tab; label: string; icon: typeof LayoutDashboard; hint: string};

export const PRO_NAV: ProNavItem[] = [
  {id: 'play', label: 'Dashboard', icon: LayoutDashboard, hint: 'Study overview'},
  {id: 'study', label: 'Study', icon: GraduationCap, hint: 'Topic workspace'},
  {id: 'courses', label: 'Courses', icon: Library, hint: 'Courses and topics'},
  {id: 'materials', label: 'Materials', icon: BookOpen, hint: 'Course reading'},
  {id: 'bank', label: 'Question Bank', icon: ListChecks, hint: 'Practise from the bank'},
  {id: 'exams', label: 'Exams', icon: ClipboardCheck, hint: 'Exams and mini exams'},
  {id: 'flashcards', label: 'Flashcards', icon: Layers, hint: 'Spaced review'},
  {id: 'tutor', label: 'AI Assistant', icon: Sparkles, hint: 'Ask about your studies'},
  {id: 'analytics', label: 'Analytics', icon: BarChart3, hint: 'Your learning data'},
];

export const PRO_SETTINGS: ProNavItem = {id: 'settings', label: 'Settings', icon: Settings, hint: 'Appearance, reading, account'};

/** Phone bar: four daily destinations; everything else lives in the drawer. */
export const PRO_MOBILE: Tab[] = ['play', 'study', 'exams', 'tutor'];

export function proLabel(tab: Tab): string {
  if (tab === 'settings' || tab === 'profile') return 'Settings';
  return PRO_NAV.find((row) => row.id === tab)?.label ?? 'Absolute Genesis';
}
