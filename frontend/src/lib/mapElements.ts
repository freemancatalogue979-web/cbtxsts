import type { MapStep, MapZone } from "./types";

type AnchorKey = "tokenId" | "chipId";

/** Remove only this step; direct children keep the same start as free routes. */
export function removeStepPreservingBranches(steps: readonly MapStep[], id: string): MapStep[] {
  const removed = steps.find((step) => step.id === id);
  if (!removed) return [...steps];
  const end = removed.points[removed.points.length - 1] ?? [0, 0];
  return steps.filter((step) => step.id !== id).map((step) => step.parentId === id
    ? { ...step, parentId: undefined, points: [[...end], ...step.points.slice(1)] } : step);
}

/** Preserve a marker's attached routes at the marker's last position. */
export function detachStepAnchors(steps: readonly MapStep[], key: AnchorKey, id: string, x: number, y: number): MapStep[] {
  return steps.map((step) => step[key] === id
    ? { ...step, [key]: undefined, points: [[x, y], ...step.points.slice(1)] } : step);
}

/** Preserve a marker's attached zones at the marker's last position. */
export function detachZoneAnchors(zones: readonly MapZone[], key: AnchorKey, id: string, x: number, y: number): MapZone[] {
  return zones.map((zone) => zone[key] === id ? { ...zone, [key]: undefined, x, y } : zone);
}
