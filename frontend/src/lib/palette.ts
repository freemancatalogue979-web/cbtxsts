/**
 * Tiny bridge between the command palette and whichever panel owns a result.
 *
 * The palette lives in the shell while materials live in their own panel, so the
 * jump is posted as a DOM event: the panel subscribes when it mounts and the
 * shell only has to switch tab first.
 */
export const OPEN_MATERIAL_EVENT = 'arena:open-material';

export function jumpToMaterial(materialId: number): void {
  // Wait one frame so the panel is mounted (and subscribed) before we shout.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(OPEN_MATERIAL_EVENT, {detail: materialId}));
  }, 60);
}
