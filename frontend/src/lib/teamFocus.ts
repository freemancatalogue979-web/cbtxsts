import type { Settings } from "./types";

/** Keep the target as text while editing so an empty/invalid value is not silently saved as zero. */
export interface TeamFocusDraft {
  season_name: string;
  current_weakness: string;
  weakness_category: string;
  weakness_drills_target: string;
}

export function toTeamFocusDraft(settings: Settings): TeamFocusDraft {
  return { ...settings, weakness_drills_target: String(settings.weakness_drills_target) };
}

export function parseDrillTarget(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) ? number : null;
}

export function focusHasChanges(draft: TeamFocusDraft, saved: Settings): boolean {
  return draft.season_name !== saved.season_name
    || draft.current_weakness !== saved.current_weakness
    || draft.weakness_category !== saved.weakness_category
    || draft.weakness_drills_target !== String(saved.weakness_drills_target);
}

export function focusPayload(draft: TeamFocusDraft): Settings | null {
  const target = parseDrillTarget(draft.weakness_drills_target);
  return target === null ? null : {
    ...draft,
    // The dashboard treats any non-empty string as a focus. Avoid saving an
    // invisible, whitespace-only focus while preserving other text as typed.
    current_weakness: draft.current_weakness.trim() ? draft.current_weakness : "",
    weakness_drills_target: target,
  };
}
