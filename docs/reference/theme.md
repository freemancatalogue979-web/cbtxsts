# Visual theme: colour, hero wallpaper and text style

The hub is not locked to one colour. Every area gets its own accent and an MLBB
hero backdrop, so the place you are in is recognisable at a glance, and members
can pin a single colour or calm the effects down.

## Where the colours come from

`frontend/src/lib/theme.ts` is the single source of truth:

- `ACCENTS` — eight accents (`crimson`, `emerald`, `cyan`, `violet`, `fuchsia`,
  `amber`, `azure`, `lime`). Each has a light `text` shade for small text on
  panels, a darker `solid` shade for filled buttons with white labels, a `dim`
  surface and a `glow` triplet for tints. `frontend/tests/theme.test.mjs` checks
  text contrast of at least 5.5:1 on every dark surface and 4.5:1 for white text
  on the solid shade.
- `SECTION_THEMES` — the accent plus hero art for each area (dashboard, AI,
  training, scrims, tournaments, esports, My MLBB, reviews, heroes, intel,
  players, bans, drafts, maps, strategy, archive, events, notifications, admin,
  login).

The palette is applied as CSS custom properties in `frontend/src/index.css`
(`html[data-accent="…"]`). Components keep using the existing `crim` utility
classes, which now resolve to the live accent, so no screen hardcodes a colour.

Two colours deliberately do **not** move:

- `--color-danger` stays rose, so errors and bad statistics are never confused
  with a decorative accent.
- `--color-leaf` stays emerald for "good" values and the local-facts label.

## Hero wallpaper

`frontend/src/components/AmbientBackdrop.tsx` draws, behind the shell:

1. A drifting shelf of four MLBB hero portraits on a 3D plane.
2. A large spotlight portrait for the current area, masked into the page.
3. A faint tactical grid, an accent wash and a vignette that keeps text the
   brightest thing on screen.

### Sharp on every screen, including 4K

The bundled portraits in `frontend/public/heroes/<slug>.webp` are 240×390, so
they always paint (offline included) but can't fill a 4K screen. The wallpaper
therefore follows three rules:

1. **No blur.** Art layers use colour lifts only; blur filters are banned (a test
   enforces it).
2. **Never upscale.** Bundled portraits are capped at their native pixel size for
   the screen's device-pixel ratio (`--art-dpr`), so they stay crisp on 1x, 2x
   and 3x displays. Phones show a frieze of small, crisp portraits instead of a
   stretched spotlight.
3. **Upgrade on big screens.** At 1024 px and wider the wallpaper upgrades to a
   sharper source once it has fully loaded, in this order:
   - `frontend/public/heroes/hi/<slug>.webp` — the optional repo HD pack, listed
     in `frontend/public/heroes/hi/manifest.json`;
   - the official catalogue painting (≈1080 px wide) from the same MLBB Intel art
     index the rest of the app uses.

   If neither loads, the bundled portrait stays. HD art is still capped so that a
   ~1080 px source is never stretched past its pixels.

To build the HD pack so the sharp art lives in the repo (best: no runtime
dependency on the image host):

```bash
cd frontend
CLOVER_APP_URL=https://your-hub.example CLOVER_TOKEN=<signed-in member token> npm run hero-art:hd
# or from a saved catalogue JSON
npm run hero-art:hd -- --catalog ./catalog.json
```

Only WebP files at least 720 px wide are kept; existing files are not replaced
unless `--force` is passed. Commit `frontend/public/heroes/hi/` afterwards. Check
that you have permission to redistribute the artwork before committing it.

The layer is decorative (`aria-hidden`), ignores clicks and is skipped for
`prefers-reduced-motion`. On phones fewer, softer layers are used and cards
become more opaque so text keeps priority.

## Member controls

**Edit profile → Colour theme** (also reachable from the palette button beside
your name):

- `Auto` (default) — colour and art follow the current area.
- One of the eight accents — pinned everywhere.
- `Hero backdrop` — turn the MLBB art off for a flatter, quieter page.
- `Live motion` — stop the drift and pointer parallax (reduced-motion users get
  this automatically).

Choices are device-local (`clover_theme_accent`, `clover_theme_backdrop`,
`clover_theme_motion`) and are applied by the inline bootstrap in
`frontend/index.html` before the first paint, so there is no flash of the wrong
colour. Defaults are never written, so future design changes still reach members
who never picked anything.
