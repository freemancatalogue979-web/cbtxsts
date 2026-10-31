import type { MapChip, MapChipPreset } from "./types";

export type ChipSettings = Pick<MapChip, "name" | "color" | "size" | "preset">;
type Preset = { id: MapChipPreset; name: string; label: string; color: string; description: string };
type Bounds = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
type OccupiedMarker = { x: number; y: number; size: number };

export const CHIP_PRESETS: readonly Preset[] = [
  { id: "litho", name: "Litho", label: "Litho", description: "Lithowanderer", color: "#34d399" },
  { id: "minion", name: "Minion", label: "Minion", description: "Minion", color: "#7db5f5" },
  { id: "turret", name: "Turret", label: "Turret", description: "Turret", color: "#f5b942" },
  { id: "retribution", name: "Retribution", label: "Retri", description: "Retribution", color: "#fb923c" },
  { id: "lord", name: "Lord", label: "Lord", description: "Lord", color: "#a78bfa" },
  { id: "turtle", name: "Turtle", label: "Turtle", description: "Turtle", color: "#38bdf8" },
];

const CHIP_ALIASES: Record<string, MapChipPreset> = {
  litho: "litho", lithowanderer: "litho", minion: "minion", minions: "minion",
  turret: "turret", turrets: "turret", retri: "retribution", retribution: "retribution",
  lord: "lord", turtle: "turtle",
};

/** Older custom chips with recognizable names get the same portrait, too. */
export function chipPreset(chip: Pick<MapChip, "name" | "preset">): Preset | undefined {
  const id = chip.preset ?? CHIP_ALIASES[(chip.name ?? "").trim().toLowerCase()];
  return CHIP_PRESETS.find((preset) => preset.id === id);
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Pick a visible point, preferring free slots near the viewport center. */
export function chipSpawnPoint(
  frame: Bounds | undefined,
  surface: Bounds | undefined,
  size: number,
  zoom: number,
  occupied: readonly OccupiedMarker[],
): { x: number; y: number } {
  if (!frame || !surface || !surface.width || !surface.height) return { x: 50, y: 50 };

  const radius = size * zoom / 2;
  const padX = Math.min(frame.width / 2, radius + 6), padY = Math.min(frame.height / 2, radius + 6);
  const spacing = size * zoom + 10;
  const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0],
    [-0.5, -1], [0.5, -1], [-0.5, 1], [0.5, 1], [-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1]];
  let best = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2, clearance: -Infinity };
  for (const [dx, dy] of offsets) {
    const px = clamp(frame.left + frame.width / 2 + dx * spacing, frame.left + padX, frame.right - padX);
    const py = clamp(frame.top + frame.height / 2 + dy * spacing, frame.top + padY, frame.bottom - padY);
    const clearance = occupied.reduce((nearest, item) => Math.min(nearest, Math.hypot(
      px - (surface.left + surface.width * item.x / 100), py - (surface.top + surface.height * item.y / 100),
    ) - radius - item.size * zoom / 2), Infinity);
    if (clearance > best.clearance) best = { x: px, y: py, clearance };
    if (clearance >= 8) break;
  }
  return {
    x: Math.round(clamp((best.x - surface.left) / surface.width * 100, 0, 100) * 10) / 10,
    y: Math.round(clamp((best.y - surface.top) / surface.height * 100, 0, 100) * 10) / 10,
  };
}
