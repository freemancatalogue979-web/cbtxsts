/**
 * Cosmetics — the client half of the arena shop.
 *
 * The server owns *what exists* (prices, rarity, what a player owns). This file
 * owns *how it looks*: every catalogue key maps to a portrait, an aura, a frame,
 * a profile theme, a chat bubble, a victory or an answer effect. Keys that are
 * not in here simply render as the default look, so an older client never breaks
 * on a newer catalogue.
 */

export type CosmeticSlot = 'avatar' | 'aura' | 'frame' | 'title' | 'theme' | 'chat' | 'duel' | 'answer';

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

export interface AuraSpec {
  /** Two halo colours, drawn as a soft glow behind the portrait. */
  glow: string;
  ring: string;
  /** Little motes drifting around the avatar. */
  particles: string;
  label: string;
}

export const AURAS: Record<string, AuraSpec> = {
  aura_blue: {glow: 'rgba(56,189,248,0.55)', ring: '#38bdf8', particles: '#7dd3fc', label: 'Blue glow'},
  aura_green: {glow: 'rgba(52,211,153,0.5)', ring: '#34d399', particles: '#6ee7b7', label: 'Green particles'},
  aura_gold: {glow: 'rgba(251,191,36,0.5)', ring: '#fbbf24', particles: '#fde68a', label: 'Golden particles'},
  aura_fire: {glow: 'rgba(249,115,22,0.6)', ring: '#f97316', particles: '#fdba74', label: 'Fire aura'},
  aura_ice: {glow: 'rgba(125,211,252,0.55)', ring: '#7dd3fc', particles: '#e0f2fe', label: 'Ice aura'},
  aura_lightning: {glow: 'rgba(250,204,21,0.6)', ring: '#facc15', particles: '#fef08a', label: 'Lightning aura'},
  aura_royal: {glow: 'rgba(217,70,239,0.55)', ring: '#e879f9', particles: '#f5d0fe', label: 'Royal aura'},
  aura_storm: {glow: 'rgba(99,102,241,0.55)', ring: '#818cf8', particles: '#c7d2fe', label: 'Storm aura'},
  aura_phoenix: {glow: 'rgba(251,113,133,0.6)', ring: '#fb7185', particles: '#fecdd3', label: 'Phoenix aura'},
  aura_galaxy: {glow: 'rgba(124,58,237,0.65)', ring: '#a78bfa', particles: '#c4b5fd', label: 'Galaxy aura'},
  aura_dragon: {glow: 'rgba(16,185,129,0.6)', ring: '#34d399', particles: '#a7f3d0', label: 'Dragon aura'},
  aura_void: {glow: 'rgba(30,27,75,0.85)', ring: '#6d28d9', particles: '#a78bfa', label: 'Void aura'},
  aura_neural: {glow: 'rgba(168,85,247,0.7)', ring: '#c084fc', particles: '#e9d5ff', label: 'Neural aura'},
  aura_bioluminescent: {glow: 'rgba(20,184,166,0.65)', ring: '#2dd4bf', particles: '#99f6e4', label: 'Bioluminescent spores'},
};

export interface FrameSpec {
  ring: string;
  glow: string;
  label: string;
  /** The two vault frames get a slow spin so they read as animated. */
  animated?: boolean;
}

export const FRAMES: Record<string, FrameSpec> = {
  frame_rookie: {ring: '#4ade80', glow: 'rgba(74,222,128,0.35)', label: 'Rookie ring'},
  frame_scholar: {ring: '#38bdf8', glow: 'rgba(56,189,248,0.35)', label: 'Scholar ring'},
  frame_champion: {ring: '#fbbf24', glow: 'rgba(251,191,36,0.4)', label: 'Champion ring'},
  frame_iron_will: {ring: '#94a3b8', glow: 'rgba(148,163,184,0.4)', label: 'Iron will'},
  frame_dark_academy: {ring: '#7c3aed', glow: 'rgba(124,58,237,0.5)', label: 'Dark Academy'},
  frame_knowledge_crown: {ring: '#facc15', glow: 'rgba(250,204,21,0.55)', label: 'Knowledge crown', animated: true},
  frame_founder: {ring: '#f43f5e', glow: 'rgba(244,63,94,0.5)', label: 'Arena founder', animated: true},
  frame_cyber_roots: {ring: '#10b981', glow: 'rgba(16,185,129,0.5)', label: 'Cyber roots'},
  frame_void_core: {ring: '#8b5cf6', glow: 'rgba(139,92,246,0.55)', label: 'Void frame', animated: true},
  frame_digital_relic: {ring: '#06b6d4', glow: 'rgba(6,182,212,0.6)', label: 'Digital relic', animated: true},
};

/** Avatars are portraits, not photos: an emoji in a rarity-tinted disc. */
export const AVATARS: Record<string, string> = {
  avatar_mage: '🧙',
  avatar_ninja: '🥷',
  avatar_robot: '🤖',
  avatar_fox: '🦊',
  avatar_scientist: '🧪',
  avatar_astronaut: '🧑‍🚀',
  avatar_dragon: '🐉',
  avatar_cyber: '🦾',
  avatar_pirate: '🏴‍☠️',
  avatar_royal: '👑',
  avatar_ancient: '📚',
  avatar_shadow_scholar: '🕶️',
  avatar_legendary_scholar: '🎓',
  avatar_cyber_wolf: '🐺',
  avatar_biome_guardian: '🌱',
};

/** Profile themes: a wash + an accent class for the profile card. */
export const THEMES: Record<string, {className: string; label: string; swatch: string}> = {
  theme_ancient_library: {className: 'cosy-library', label: 'Ancient Library', swatch: '#b45309'},
  theme_ocean: {className: 'cosy-ocean', label: 'Ocean', swatch: '#0284c7'},
  theme_jungle: {className: 'cosy-jungle', label: 'Jungle', swatch: '#15803d'},
  theme_volcano: {className: 'cosy-volcano', label: 'Volcano', swatch: '#dc2626'},
  theme_royal: {className: 'cosy-royal', label: 'Royal', swatch: '#7c3aed'},
  theme_space: {className: 'cosy-space', label: 'Space', swatch: '#4f46e5'},
  theme_haunted: {className: 'cosy-haunted', label: 'Haunted Library', swatch: '#6d28d9'},
  theme_castle: {className: 'cosy-castle', label: 'Fantasy Castle', swatch: '#a16207'},
  theme_futuristic: {className: 'cosy-city', label: 'Futuristic City', swatch: '#06b6d4'},
  theme_golden_academy: {className: 'cosy-golden', label: 'Golden Academy', swatch: '#f59e0b'},
  theme_cyber_forest: {className: 'cosy-cyber-forest', label: 'Cyber Forest', swatch: '#059669'},
  theme_neon_jungle: {className: 'cosy-neon-jungle', label: 'Neon Jungle', swatch: '#7c3aed'},
  theme_techno_nature: {className: 'cosy-techno-nature', label: 'Techno-Nature', swatch: '#0d9488'},
};

/** Chat bubbles: a class on your own messages. */
export const CHAT_BUBBLES: Record<string, {className: string; label: string}> = {
  chat_sky: {className: 'bubble-sky', label: 'Sky bubble'},
  chat_sunset: {className: 'bubble-sunset', label: 'Sunset bubble'},
  chat_neon: {className: 'bubble-neon', label: 'Neon bubble'},
  chat_dragon: {className: 'bubble-dragon', label: 'Dragon bubble'},
};

/** The line the win screen shouts. */
export const VICTORY_LINES: Record<string, {line: string; sub: string; className: string}> = {
  duel_classic: {line: 'Victory', sub: 'A clean finish.', className: 'victory-classic'},
  duel_confetti: {line: 'Victory!', sub: 'The arena throws paper.', className: 'victory-confetti'},
  duel_dragon: {line: 'Dragon victory', sub: 'Wings out, duel closed.', className: 'victory-dragon'},
  duel_galaxy: {line: 'Galaxy victory', sub: 'The board folded into stars.', className: 'victory-galaxy'},
};

/** The headline over a correct answer. */
export const ANSWER_EFFECTS: Record<string, {line: string; className: string}> = {
  answer_sparkle: {line: 'Correct!', className: 'fx-answer-sparkle'},
  answer_perfect: {line: 'Perfect!', className: 'fx-answer-perfect'},
  answer_perfect_knowledge: {line: 'Perfect knowledge!', className: 'fx-answer-knowledge'},
};

/** Title cosmetics — the text a player wears under their name. */
export const TITLE_LABELS: Record<string, string> = {
  title_novice: 'Novice',
  title_question_hunter: 'Question hunter',
  title_knowledge_seeker: 'Knowledge seeker',
  title_quiz_warrior: 'Quiz warrior',
  title_course_master: 'Course master',
  title_exam_slayer: 'Exam slayer',
  title_the_undefeated: 'The undefeated',
  title_arena_champion: 'Arena champion',
  title_diamond_scholar: 'Diamond scholar',
  title_the_dark_scholar: 'The dark scholar',
  title_digital_evolution: 'Digital evolution',
  title_biome_master: 'Biome master',
};

/* ------------------------------------------------------------------ helpers */

export function auraOf(ref?: CosmeticsRef | null): AuraSpec | null {
  const key = ref?.aura;
  return key ? AURAS[key] ?? null : null;
}

export function frameOf(ref?: CosmeticsRef | null): FrameSpec | null {
  const key = ref?.frame;
  return key ? FRAMES[key] ?? null : null;
}

export function portraitOf(ref?: CosmeticsRef | null): string | null {
  const key = ref?.avatar;
  return key ? AVATARS[key] ?? null : null;
}

export function titleOf(ref?: CosmeticsRef | null): string | null {
  const key = ref?.title;
  return key ? TITLE_LABELS[key] ?? null : null;
}

export function themeOf(ref?: CosmeticsRef | null): {className: string; label: string} | null {
  const key = ref?.theme;
  return key ? THEMES[key] ?? null : null;
}

export function bubbleOf(ref?: CosmeticsRef | null): string | null {
  const key = ref?.chat;
  return key ? CHAT_BUBBLES[key]?.className ?? null : null;
}

export function victoryOf(ref?: CosmeticsRef | null): {line: string; sub: string; className: string} | null {
  const key = ref?.duel;
  return key ? VICTORY_LINES[key] ?? null : null;
}

export function answerEffectOf(ref?: CosmeticsRef | null): {line: string; className: string} | null {
  const key = ref?.answer;
  return key ? ANSWER_EFFECTS[key] ?? null : null;
}

/**
 * The aura reads best on leaderboards and profiles, where an avatar sits still.
 * This returns the inline styles so any surface can wear one without new CSS.
 */
export function auraStyle(ref?: CosmeticsRef | null): {boxShadow: string} | undefined {
  const aura = auraOf(ref);
  if (!aura) return undefined;
  return {boxShadow: `0 0 0 3px ${aura.ring}66, 0 0 22px 6px ${aura.glow}`};
}

export function frameStyle(ref?: CosmeticsRef | null): {boxShadow: string} | undefined {
  const frame = frameOf(ref);
  if (!frame) return undefined;
  return {boxShadow: `0 0 0 3px ${frame.ring}, 0 0 18px 2px ${frame.glow}`};
}
