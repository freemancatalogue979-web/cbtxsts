# Font credits and usage

## Text style: Courier by default, Montserrat and Corptic optional

Everyone can switch the interface text style from **Edit profile → Text style** (the profile menu at the bottom of the sidebar, or in the mobile drawer). The choice is stored per browser in `localStorage` under `clover_font_choice` and is applied by the inline script in `index.html` before the first paint, so there is no flash of the wrong font.

- **Courier** (default) — `font-family: Courier, "Courier New", "Courier Prime", monospace; font-size: 11px; font-weight: 700; font-style: italic; letter-spacing: 0.1em; text-transform: uppercase;` applied to the whole app, including inputs (display only; typed values are stored as typed). Elements with their own size class (titles, stats) keep that size. Anyone who never picks a font gets this.
- **Montserrat** — the previous default: 16px semibold, mixed case, no slant.
- **Corptic** — the team's display font: slanted, heavier, tighter and sized up for its small x-height. Numerals are always drawn by Montserrat.

No account or server setting is involved, so nothing about a member's choice is sent to the backend.

## Corptic DEMO

The app uses **Corptic DEMO Regular** by Pandeka Foundry (Pandeka Studio). The font is served locally from `frontend/public/fonts/CorpticDEMO-Regular.otf`; the author's original license notice is alongside it as `CorpticDEMO-LICENSE.txt`.

- [Author's FontSpace page and demo download](https://www.fontspace.com/corptic-font-f147318)
- [Full font and commercial-license options](https://creativemarket.com/PandekaStudio/291711485-Corptic-Futuristic-Modular-Display)
- The included demo was retrieved from a [public mirror](https://github.com/MadhumithraSomasundaram/SIH/blob/8e40166e860ce3fd2d35694ea9948f69f62be1a4/public/fonts/CorpticDEMO-Regular.otf). Its SHA-256 is `d0ce19f1515091908cc3ef0eb2ba9a3a1904db5a990565380e58533658bf93e3`.

**The demo is free for personal, non-commercial use only.** Commercial or corporate use requires the appropriate license from the foundry. Check that the license permits the intended web embedding and distribution before deploying it for such use; the existence of this repository does not grant those rights.

The demo contains basic Latin letters only: it has no numerals, punctuation or accented characters. The interface explicitly uses Montserrat for digits 0–9, even if a Corptic font with numbers is installed later. Other missing glyphs fall back to Montserrat or system symbol fonts. When Corptic is chosen it is bold and oblique; because the demo has only a regular face, browsers synthesize the heavier letters while Montserrat's variable font supplies its own bold numerals. A larger x-height and roomier spacing make the display font easier to read. Browsers without `font-size-adjust` use a scaled Corptic face when they support the older `size-adjust` font descriptor; browsers without either still retain the spacing and weight improvements.

## Courier

Courier is not bundled: the app uses the Courier already on the device (Courier on macOS/iOS, Courier New on Windows). Devices without either (most Android and Linux) get **Courier Prime**, a free Courier redesign by Alan Dague-Greene for Quote-Unquote Apps, bundled through `@fontsource/courier-prime` under the SIL Open Font License 1.1 (regular, bold and italic). Browsers download Courier Prime only when no local Courier is found. The default uses the real Courier Bold Italic face (Courier Bold Oblique on Apple, Courier New Bold Italic on Windows, Courier Prime Bold Italic elsewhere), so nothing is synthesized.

## Montserrat numbers and fallback

Montserrat is provided through `@fontsource-variable/montserrat` under the SIL Open Font License 1.1. It supplies numbers and remains available as a fallback for characters missing from Corptic DEMO.
