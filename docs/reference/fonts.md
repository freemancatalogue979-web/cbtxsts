# Font credits and usage

## Text style: Courier Std Bold, 900 italic, no caps

The whole interface uses one typeface, **Courier Std Bold**, set in heavy italic, with no font menu:

`font-family: "Courier Std", "Courier Prime", "Courier New", Courier, monospace; font-size: 11px; font-weight: 900; font-style: italic; letter-spacing: 0.1em;`

This applies to the whole app, including inputs. Elements with their own size or weight class (titles, stats) keep that size or weight.

**Nothing is shown in all caps.** Text appears exactly as written, and a global `text-transform: none !important` rule (on every element, pseudo-element and placeholder) stops uppercase styling from coming back. Tests fail if `text-transform: uppercase` or the Tailwind `uppercase` class turns up anywhere in `src`. Inputs keep what the member types; nothing forces typed names or tags to capitals.

The API and database still store some enum values in capitals (lanes such as `JUNGLE`, results such as `WIN`, hero statuses such as `BANNED/RESTRICTED`, training and strategy categories). These values are unchanged so existing data and API clients keep working. The UI passes them through `nice()` in `frontend/src/lib/caseText.ts`, which shows "Jungle", "Win" and "Banned/restricted". Real acronyms stay as they are: MLBB, MPL, MVP, KDA, AI, VOD, EXP, BO3 and similar. Team codes and member names from data are shown exactly as they are stored.

Earlier versions let each browser pick Space Grotesk, Montserrat or the Corptic DEMO display font. That menu and those fonts have been removed. The inline script in `index.html` deletes any old `clover_font_choice` value from `localStorage` on load, so nobody is left on a font that no longer exists. The Corptic DEMO file, which was licensed for personal use only, is no longer shipped.

## Courier Std and the bundled Courier Prime

**Courier Std** is a commercial Adobe font, so it cannot be redistributed with the app. It comes first in the font stack, so any device that has it installed uses it.

Everywhere else, the bundled stand-in is **Courier Prime** by Alan Dague-Greene (Quote-Unquote Apps). It ships through `@fontsource/courier-prime` under the SIL Open Font License 1.1. The real Bold Italic face (`700-italic.css`) is loaded rather than a browser-slanted upright, along with 700, 400 italic and 400, so every device shows the same design.

Courier Std and Courier Prime both stop at Bold (700). To reach the requested 900 weight, the body adds a hairline `-webkit-text-stroke-width: 0.02em` in the text colour. This thickens each stroke without the smearing a browser-synthesised bold produces.

## Symbol fallback

Courier has no glyphs for a few symbols used in stylised member names (for example ⚝). `@fontsource/noto-sans-symbols` (SIL OFL 1.1) is next in the font stack. Every face is range-limited, so the browser downloads it only when such a character is on screen.
