/** How sure we are about a hero read from a screenshot, as a small chip next to the hero. */
import type { HeroCheck } from "../lib/types";

export type HeroCheckState = HeroCheck | "edited" | "confirmed";

export const CHECK_CHIP: Record<HeroCheck | "edited" | "confirmed", { label: string; cls: string; tip: string } | null> = {
  portrait: { label: "Matched", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "The portrait matches this hero." },
  corrected: { label: "Fixed", cls: "border-amber/50 bg-amber/10 text-amber", tip: "The portrait clearly showed another hero, so it was changed." },
  likely: { label: "Likely", cls: "border-sky/40 bg-sky/10 text-sky", tip: "Probably right; the portrait is a close match." },
  unsure: { label: "Check · tap if right", cls: "border-danger/50 bg-danger/10 text-danger", tip: "Couldn't confirm this hero from the portrait." },
  edited: { label: "Changed", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "You picked this hero; it will be learned for next time." },
  confirmed: { label: "Looks right", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "You confirmed this hero; it will be learned for next time." },
  unchecked: null,
};
