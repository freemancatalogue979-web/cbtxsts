/**
 * Digital Evolution — connecting learning progression to a living ecosystem.
 *
 * The player's journey evolves through seven biological-technological phases:
 * SEED → SPROUT → NETWORK → NEURAL CORE → CYBER TREE → KNOWLEDGE NODE → ASCENSION
 *
 * Each phase reshapes how the player's personal ecosystem is represented,
 * turning studying from a sterile number into visible digital life.
 */

export interface EvolutionStage {
  phase: number;
  key: string;
  name: string;
  glyph: string;
  minLevel: number;
  maxLevel: number;
  title: string;
  blurb: string;
  biome: string;
  color: string;
  accent: string;
  bgGradient: string;
}

export const EVOLUTION_STAGES: EvolutionStage[] = [
  {
    phase: 1,
    key: 'seed',
    name: 'Seed',
    glyph: '🌱',
    minLevel: 1,
    maxLevel: 4,
    title: 'Digital Seed',
    blurb: 'A dormant bio-tech seed pulsing with initial code in the dark soil.',
    biome: 'Neural Substrate',
    color: '#34d399',
    accent: 'emerald',
    bgGradient: 'from-emerald-950/60 via-ink-950 to-ink-900',
  },
  {
    phase: 2,
    key: 'sprout',
    name: 'Sprout',
    glyph: '🌿',
    minLevel: 5,
    maxLevel: 9,
    title: 'Fiber Sprout',
    blurb: 'Fiber-optic rootlets breaking through the digital ground, seeking knowledge energy.',
    biome: 'Bioluminescent Glade',
    color: '#2dd4bf',
    accent: 'teal',
    bgGradient: 'from-teal-950/60 via-ink-950 to-ink-900',
  },
  {
    phase: 3,
    key: 'network',
    name: 'Network',
    glyph: '🕸️',
    minLevel: 10,
    maxLevel: 19,
    title: 'Data Network',
    blurb: 'Interconnected neural vines weaving data pathways across the ecosystem.',
    biome: 'Cyber Root Network',
    color: '#38bdf8',
    accent: 'sky',
    bgGradient: 'from-sky-950/60 via-ink-950 to-ink-900',
  },
  {
    phase: 4,
    key: 'neural_core',
    name: 'Neural Core',
    glyph: '🧬',
    minLevel: 20,
    maxLevel: 29,
    title: 'Neural Core',
    blurb: 'A beating bio-synthetic heart channeling pure crystallized learning energy.',
    biome: 'Core Nexus',
    color: '#a855f7',
    accent: 'purple',
    bgGradient: 'from-purple-950/60 via-ink-950 to-ink-900',
  },
  {
    phase: 5,
    key: 'cyber_tree',
    name: 'Cyber Tree',
    glyph: '🌳',
    minLevel: 30,
    maxLevel: 39,
    title: 'Cyber Tree',
    blurb: 'Towering branches of fiber cables unfurling transparent holographic leaves.',
    biome: 'Cyber Forest Canopy',
    color: '#10b981',
    accent: 'mint',
    bgGradient: 'from-emerald-950/80 via-teal-950/40 to-ink-950',
  },
  {
    phase: 6,
    key: 'knowledge_node',
    name: 'Knowledge Node',
    glyph: '⚡',
    minLevel: 40,
    maxLevel: 49,
    title: 'Knowledge Node',
    blurb: 'A glowing bio-monolith anchoring the living digital ecosystem.',
    biome: 'Monolith Ridge',
    color: '#f59e0b',
    accent: 'gold',
    bgGradient: 'from-amber-950/70 via-ink-950 to-ink-900',
  },
  {
    phase: 7,
    key: 'ascension',
    name: 'Ascension',
    glyph: '🌌',
    minLevel: 50,
    maxLevel: 60,
    title: 'Ascended Ecosystem',
    blurb: 'Transcendence into living bio-electric cosmos — all knowledge has become energy.',
    biome: 'Celestial Biosphere',
    color: '#ec4899',
    accent: 'flare',
    bgGradient: 'from-pink-950/70 via-purple-950/60 to-ink-950',
  },
];

export function evolutionStageFor(level: number): EvolutionStage {
  const clamped = Math.max(1, Math.min(60, level));
  return (
    EVOLUTION_STAGES.find((s) => clamped >= s.minLevel && clamped <= s.maxLevel) ??
    EVOLUTION_STAGES[EVOLUTION_STAGES.length - 1]
  );
}

export function nextEvolutionStage(level: number): EvolutionStage | null {
  const current = evolutionStageFor(level);
  return EVOLUTION_STAGES.find((s) => s.phase === current.phase + 1) ?? null;
}

/** Percentage of the current evolution phase completed towards the next phase. */
export function evolutionPhaseProgress(level: number): number {
  const current = evolutionStageFor(level);
  const next = nextEvolutionStage(level);
  if (!next) return 100;
  const span = current.maxLevel - current.minLevel + 1;
  const currentInto = Math.max(0, level - current.minLevel);
  return Math.min(100, Math.round((currentInto / span) * 100));
}
