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

Art is read from `frontend/public/heroes/<slug>.webp` — bundled with the app,
never a third-party CDN — so it works offline and cannot break upstream. The
layer is decorative (`aria-hidden`), ignores clicks and is skipped for
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
