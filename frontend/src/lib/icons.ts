/** Maps the icon slugs stored by the API onto lucide components. */
import {
  Award,
  BookOpen,
  Brain,
  Crown,
  Flame,
  Gift,
  GraduationCap,
  Headphones,
  Laptop,
  Medal,
  ShoppingBag,
  Sparkles,
  Star,
  Swords,
  Target,
  Trophy,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  award: Award,
  book: BookOpen,
  book_open: BookOpen,
  brain: Brain,
  crown: Crown,
  flame: Flame,
  gift: Gift,
  graduation: GraduationCap,
  graduation_cap: GraduationCap,
  headphones: Headphones,
  laptop: Laptop,
  medal: Medal,
  shopping: ShoppingBag,
  shopping_bag: ShoppingBag,
  sparkles: Sparkles,
  star: Star,
  swords: Swords,
  target: Target,
  trophy: Trophy,
  users: Users,
  wallet: Wallet,
  zap: Zap,
  first_steps: Flame,
  sharp_shooter: Target,
  perfectionist: Crown,
  scholar: GraduationCap,
  speed_demon: Zap,
  duelist: Swords,
  champion: Trophy,
  socialite: Users,
  collector: Gift,
  streaker: Flame,
  veteran: Medal,
  top_rank: Crown,
  night_owl: Sparkles,
  comeback: Flame,
  legend: Star,
  deity: Crown,
};

export function iconFor(slug: string | undefined, fallback: LucideIcon = Sparkles): LucideIcon {
  if (!slug) return fallback;
  return ICONS[slug.toLowerCase()] ?? fallback;
}

export const TIER_ICON_COLOR: Record<string, string> = {
  bronze: 'text-gold-500',
  silver: 'text-mist-200',
  gold: 'text-gold-300',
  platinum: 'text-pulse-300',
};

export const TIER_GRADIENT: Record<string, string> = {
  bronze: 'from-gold-600/70 to-gold-400/70',
  silver: 'from-mist-500/60 to-mist-200/70',
  gold: 'from-gold-500 to-gold-300',
  platinum: 'from-pulse-600 to-nova-400',
};
