# Arsenica Sans — drop-in font files

**Arsenica Sans** is a commercial typeface by Francesco Canovaro, published
through [Zetafonts](https://www.zetafonts.com/arsenica-sans). Its files are
**not** redistributed with this repository — you need your own licence.

## Where to buy it

Arsenica Sans is sold by [Zetafonts](https://www.zetafonts.com/arsenica-sans)
and through [MyFonts](https://www.myfonts.com/collections/arsenica-font-zetafonts)
(from $45 for a single style; the complete family is $175). The **web
licence** is what you want here: it is perpetual, covers one domain, and
ships WOFF2 and WOFF files.

The free trial cut is **personal, non-commercial use only**, and it is
distributed as TTF — do not ship it in a real app.

## Install it in two steps

1. Download the webfont files from your licence.
2. Copy one here, under any of these names:

   ```
   frontend/public/fonts/arsenica-sans.woff2   ← WOFF2 (ideal)
   frontend/public/fonts/arsenica-sans.woff    ← WOFF
   frontend/public/fonts/arsenica-sans.ttf     ← TrueType
   frontend/public/fonts/arsenica-sans.otf     ← OpenType
   ```

Restart the dev server (or rebuild) and the family is picked up on the next
page load. No code change is needed.

## How it works

`frontend/src/lib/fonts.ts` looks for the file at boot and **reads its first
four bytes** before handing it to the browser, so:

- a device **with** the licensed files renders real Arsenica Sans;
- a device **without** them falls through to the bundled Space Grotesk and
  never logs a font error;
- a server that answers a missing font with the app's HTML is caught — the
  bytes are not a font, so the browser is never asked to decode them;
- the **format is taken from the file, not from its name**, so a WOFF saved
  as `.woff2` (or a TTF) still loads.

The **Profile → Font** picker shows which of the two you are actually looking
at, so the selection is never a silent lie.

The **Profile → Font** picker shows which of the two you are actually looking
at, so the selection is never a silent lie.

## Font stack

```
'Arsenica Sans', 'Space Grotesk Variable', 'Montserrat Variable', ui-sans-serif, …
```

The family name is listed first on purpose: a locally installed copy is used
too, so installing the font on your own machine is enough to preview it.
