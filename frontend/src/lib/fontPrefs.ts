/**
 * Per-browser text style. DM Mono (11px, 500, 0.1em tracking, all caps) is the
 * default; Montserrat and the Corptic display font stay available as options. The choice is device-local, like
 * the AI workspace layout, so it never needs an account or network round trip.
 */

export type FontChoice = "dmmono" | "montserrat" | "corptic";

export const FONT_STORAGE_KEY = "clover_font_choice";
export const DEFAULT_FONT: FontChoice = "dmmono";

export const FONT_CHOICES: { id: FontChoice; label: string; hint: string; stack: string }[] = [
  {
    id: "dmmono",
    label: "DM Mono",
    hint: "Default · caps",
    stack: "\"DM Mono\", ui-monospace, \"SFMono-Regular\", Menlo, Consolas, monospace",
  },
  {
    id: "montserrat",
    label: "Montserrat",
    hint: "Large · mixed case",
    stack: "\"Montserrat Variable\", \"Helvetica Neue\", Arial, sans-serif",
  },
  {
    id: "corptic",
    label: "Corptic",
    hint: "Display · slanted",
    stack: "\"Corptic\", \"Montserrat Variable\", \"Helvetica Neue\", Arial, sans-serif",
  },
];

/** Anything unrecognised (old value, corrupt data, nothing saved) gets the default. */
export function parseFontChoice(value: unknown): FontChoice {
  return value === "montserrat" || value === "corptic" ? value : DEFAULT_FONT;
}

function storageOf(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try { return window.localStorage; } catch { return null; }
}

export function readFontChoice(storage?: Storage | null): FontChoice {
  const store = storageOf(storage);
  try { return parseFontChoice(store?.getItem(FONT_STORAGE_KEY)); } catch { return DEFAULT_FONT; }
}

export function saveFontChoice(storage: Storage | null, choice: FontChoice): void {
  try {
    if (!storage) return;
    // Keep storage empty while the default is selected, so a future default
    // change reaches everyone who never picked a font explicitly.
    if (parseFontChoice(choice) === DEFAULT_FONT) storage.removeItem(FONT_STORAGE_KEY);
    else storage.setItem(FONT_STORAGE_KEY, parseFontChoice(choice));
  } catch { /* Private mode or a full quota: the in-memory choice still applies. */ }
}

/** The CSS in index.css keys off this attribute, so no class juggling is needed. */
export function applyFontChoice(choice: FontChoice, root?: HTMLElement | null): void {
  const element = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (element) element.dataset.font = parseFontChoice(choice);
}
