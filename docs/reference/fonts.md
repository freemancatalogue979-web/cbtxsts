# Font credits and usage

## Text style: Montserrat only

The whole interface uses one typeface, **Montserrat**, with no font menu:

`font-family: "Montserrat Variable", sans-serif; font-size: 11px; font-weight: 400; font-style: italic; letter-spacing: 0.1em; text-transform: uppercase;`

This applies to the whole app, including inputs (display only; typed values are stored as typed). Elements with their own size or weight class (titles, stats) keep that size or weight.

Earlier versions let each browser pick Space Grotesk, Montserrat or the Corptic DEMO display font. That menu and those fonts have been removed. The inline script in `index.html` deletes any old `clover_font_choice` value from `localStorage` on load, so nobody is left on a font that no longer exists. The Corptic DEMO file, which was licensed for personal use only, is no longer shipped.

## Montserrat

**Montserrat** by Julieta Ulanovsky is bundled through `@fontsource-variable/montserrat` under the SIL Open Font License 1.1. Variable fonts cover weights 100–900 in both upright and italic. The default Regular Italic (400) uses the real italic face from `@fontsource-variable/montserrat/wght-italic.css`, not a browser-slanted upright, and every device shows the same font. The upright face is still used wherever an element explicitly sets a normal style.

## Symbol fallback

Montserrat has no glyphs for a few symbols used in stylised member names (for example ⚝). `@fontsource/noto-sans-symbols` (SIL OFL 1.1) is next in the font stack. Every face is range-limited, so the browser downloads it only when such a character is on screen.
