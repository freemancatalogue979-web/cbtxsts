import type { MapChip, MapToken, MapZone } from "./types";

export const MIN_ZONE_RADIUS = 4;
export const MAX_ZONE_RADIUS = 100;
export const DEFAULT_ZONE_RADIUS = 24;

/** Resolve the center dynamically; saved coordinates are a fallback for detached or legacy zones. */
export function zoneCenter(zone: MapZone, tokens: readonly MapToken[], chips: readonly MapChip[]): [number, number] {
  const token = zone.tokenId ? tokens.find((item) => item.id === zone.tokenId) : undefined;
  const chip = zone.chipId ? chips.find((item) => item.id === zone.chipId) : undefined;
  return token ? [token.x, token.y] : chip ? [chip.x, chip.y] : [zone.x, zone.y];
}

/** Map x/y percentages have different physical scales on a rectangular map. */
export function zoneDistance(center: readonly number[], point: readonly number[], aspect: number): number {
  return Math.hypot((point[0] - center[0]) * aspect, point[1] - center[1]);
}

export function zoneRadius(center: readonly number[], point: readonly number[], aspect: number): number {
  return Math.round(Math.max(MIN_ZONE_RADIUS, Math.min(MAX_ZONE_RADIUS, zoneDistance(center, point, aspect))) * 10) / 10;
}

type GeometryTarget = { kind: "path" | "step" | "zone"; id: string };
type HitZone = { id: string; center: readonly number[]; radius: number };
type HitLine = { kind: "path" | "step"; id: string; points: number[][] };

/** Distance to the full line, not just sampled points, in map-height units. */
export function distanceToPath(x: number, y: number, points: number[][], aspect: number): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1][0] * aspect, ay = points[i - 1][1];
    const bx = points[i][0] * aspect, by = points[i][1];
    const px = x * aspect, py = y;
    const dx = bx - ax, dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

/** Find the closest outline, preferring later-drawn items on ties, then a zone fill. */
export function closestMapItem(
  point: readonly number[], aspect: number, tolerance: number, zones: readonly HitZone[], lines: readonly HitLine[],
): GeometryTarget | null {
  let best = tolerance, hit: GeometryTarget | null = null;
  for (const zone of zones) {
    const distance = Math.abs(zoneDistance(zone.center, point, aspect) - zone.radius);
    if (distance <= best) { best = distance; hit = { kind: "zone", id: zone.id }; }
  }
  for (const line of lines) {
    const distance = distanceToPath(point[0], point[1], line.points, aspect);
    if (distance <= best) { best = distance; hit = { kind: line.kind, id: line.id }; }
  }
  if (hit) return hit;
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    if (zoneDistance(zone.center, point, aspect) <= zone.radius) return { kind: "zone", id: zone.id };
  }
  return null;
}
