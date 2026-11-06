/** Shared lifetime-rank catalogue. The API keys here mirror app/game.py. */
export type BaseTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'obsidian' | 'mythril' | 'aurora';
export type DivisionTier = `${BaseTier}_${1 | 2 | 3}`;
export type LifetimeTier = DivisionTier | 'genesis';
/** Base metals remain valid for achievements; lifetime profiles use the 25 ranks. */
export type Tier = BaseTier | LifetimeTier;

export type TierPalette = {
  light: string;
  bright: string;
  deep: string;
  core: string;
  accent?: string;
};

export const BASE_TIER_PALETTES: Record<BaseTier, TierPalette> = {
  bronze: {light: '#ffe1b0', bright: '#ce8b55', deep: '#563322', core: '#472c29'},
  silver: {light: '#f2f8ff', bright: '#b6cce3', deep: '#455974', core: '#24334c'},
  gold: {light: '#fff4ba', bright: '#efbf54', deep: '#81531b', core: '#4c351b'},
  platinum: {light: '#e4ffff', bright: '#80e2ef', deep: '#34768a', core: '#162f4e'},
  diamond: {light: '#f4fdff', bright: '#7de3f4', deep: '#0e5f7d', core: '#08304a', accent: '#e9d5ff'},
  obsidian: {light: '#efe3ff', bright: '#9d7cf5', deep: '#2b0f5e', core: '#100723', accent: '#38bdf8'},
  mythril: {light: '#f0f9ff', bright: '#5cc8f8', deep: '#0b4a72', core: '#0a2440', accent: '#a5f3fc'},
  aurora: {light: '#ffffff', bright: '#b39cfb', deep: '#4b1d95', core: '#170a33', accent: '#5eead4'},
};

const FAMILIES: BaseTier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'obsidian', 'mythril', 'aurora'];
const ROMAN = ['I', 'II', 'III'] as const;

export const LIFETIME_TIERS: {key: LifetimeTier; label: string; family: BaseTier | 'genesis'; division: number}[] = [
  ...FAMILIES.flatMap((family) => [1, 2, 3].map((division) => ({
    key: `${family}_${division}` as LifetimeTier,
    label: `${family[0].toUpperCase()}${family.slice(1)} ${ROMAN[division - 1]}`,
    family,
    division,
  }))),
  {key: 'genesis', label: 'Genesis', family: 'genesis', division: 3},
];

export const TIER_ORDER = LIFETIME_TIERS.map((tier) => tier.key);
export const TIER_PALETTES: Record<Tier, TierPalette> = {
  ...BASE_TIER_PALETTES,
  ...Object.fromEntries(LIFETIME_TIERS.filter((tier) => tier.family !== 'genesis').map((tier) => [tier.key, BASE_TIER_PALETTES[tier.family as BaseTier]])),
  genesis: {light: '#fffbe8', bright: '#f8d568', deep: '#6d3b8f', core: '#1b1038', accent: '#f0abfc'},
} as Record<Tier, TierPalette>;

export function tierLabel(tier: Tier | string): string {
  return LIFETIME_TIERS.find((item) => item.key === tier)?.label ?? `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
}

export function tierFamily(tier: Tier | string): BaseTier | 'genesis' {
  const found = LIFETIME_TIERS.find((item) => item.key === tier);
  if (found) return found.family;
  const base = tier.split('_')[0] as BaseTier;
  return base in BASE_TIER_PALETTES ? base : 'bronze';
}

export function tierDivision(tier: Tier | string): number {
  return LIFETIME_TIERS.find((item) => item.key === tier)?.division ?? 1;
}
