# Font credits and usage

## Corptic DEMO

The app uses **Corptic DEMO Regular** by Pandeka Foundry (Pandeka Studio). The font is served locally from `frontend/public/fonts/CorpticDEMO-Regular.otf`; the author's original license notice is alongside it as `CorpticDEMO-LICENSE.txt`.

- [Author's FontSpace page and demo download](https://www.fontspace.com/corptic-font-f147318)
- [Full font and commercial-license options](https://creativemarket.com/PandekaStudio/291711485-Corptic-Futuristic-Modular-Display)
- The included demo was retrieved from a [public mirror](https://github.com/MadhumithraSomasundaram/SIH/blob/8e40166e860ce3fd2d35694ea9948f69f62be1a4/public/fonts/CorpticDEMO-Regular.otf). Its SHA-256 is `d0ce19f1515091908cc3ef0eb2ba9a3a1904db5a990565380e58533658bf93e3`.

**The demo is free for personal, non-commercial use only.** Commercial or corporate use requires the appropriate license from the foundry. Check that the license permits the intended web embedding and distribution before deploying it for such use; the existence of this repository does not grant those rights.

The demo contains basic Latin letters only: it has no numerals, punctuation or accented characters. The interface explicitly uses Montserrat for digits 0–9, even if a Corptic font with numbers is installed later. Other missing glyphs fall back to Montserrat or system symbol fonts. The regular Corptic face is used with browser-synthesized weights and the existing oblique style where needed.

## Montserrat numbers and fallback

Montserrat is provided through `@fontsource-variable/montserrat` under the SIL Open Font License 1.1. It supplies numbers and remains available as a fallback for characters missing from Corptic DEMO.
