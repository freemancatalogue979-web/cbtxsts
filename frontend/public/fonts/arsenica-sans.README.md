# Arsenica Sans — drop-in font files

**Arsenica Sans** is a commercial typeface by Francesco Canovaro, published
through [Zetafonts](https://www.zetafonts.com/arsenica-sans). Its files are
**not** redistributed with this repository — you need your own licence.

## Install it in two steps

1. From your Zetafonts purchase (or any licensed copy), download the webfont
   files: the **WOFF2** variable font is ideal; a WOFF2 of the regular + bold
   weights works too.
2. Copy them here, renamed:

   ```
   frontend/public/fonts/arsenica-sans.woff2   ← variable or regular+bold
   frontend/public/fonts/arsenica-sans.woff    ← optional fallback
   ```

Restart the dev server (or rebuild) and the family is picked up on the next
page load. No code change is needed.

## How it works

`frontend/src/lib/fonts.ts` probes `/fonts/arsenica-sans.woff2` (then `.woff`)
before registering the face, so:

- a device **with** the licensed files renders real Arsenica Sans;
- a device **without** them falls through to the bundled Space Grotesk and
  never logs a 404.

The **Profile → Font** picker shows which of the two you are actually looking
at, so the selection is never a silent lie.

## Font stack

```
'Arsenica Sans', 'Space Grotesk Variable', 'Montserrat Variable', ui-sans-serif, …
```

The family name is listed first on purpose: a locally installed copy is used
too, so installing the font on your own machine is enough to preview it.
