# Grok archive restoration audit

Date: 2026-11-05
Working branch: `arena/8316d0e2-cbtxsts`

## What the archive actually contains

`CBT-PLATFORM-PROJECT.zip` contains an exported conversation history, **not a recoverable source-tree snapshot or an apply-ready patch**. The merged CBT history contains 235 messages from three conversations and 16 embedded code blocks. Historical statements that something was implemented are not proof that its original source or assets were saved.

The history was compared with the current app rather than applied over it. Current account data, progression, curriculum restrictions and subsequent fixes were preserved. Later user corrections take precedence over earlier suggestions. Raw extracted conversations and historical credentials are not included in this patch.

## Restored or strengthened in this branch

| Area / archive references | Changes |
| --- | --- |
| Group/Friends/Teacher chat parity (chat1 234–242, 254, 438–464) | A single `ChatMessageRow`, `ChatBubble`, toolbar, reply quote, status metadata, tombstone, reaction picker/chips and action builder now power the three chat renderers. Sender names, photos, timestamps and bubble geometry no longer depend on separately maintained copies. Mobile hold actions remain available; teacher attachments, reporting, moderation and friend-specific features are preserved. Moderator deletion is labelled correctly rather than presented as a personal hide. |
| Profile backdrop/customization (chat1 258–285, 292–296) | Shared original SVG scenery for equipped themes and selectable space/volcano/forest/ocean/academy/city scenes. Scene choice and motion preference are stored on the account, not merely on one device. Custom 2:1 banner-image upload/removal is available in Profile and displayed behind identity information on the public player modal. Uploads are authenticated, size/dimension checked, decoded and re-encoded to JPEG. Private/public metadata exposes a presence flag and version, not the raw image. |
| Profile presentation and access | Overall rank plate, existing seasonal/ranked standings, achievement treatments, prestige styling appropriate to the actual level-60 cap, loadout and Message action. The player modal has a bounded scroll region, an opaque sticky action footer, Escape handling, focus trapping and focus restoration. Reduced-motion settings override scenery animation. |
| Profile photo refresh | Local photo cache invalidation triggers a new fetch after replacement, and bypasses stale HTTP image caching. Existing photo upload and cosmetics are retained. |
| Multiplayer rooms (chat1 297–303, 466) | Room deadlines and reveal timestamps are persisted in SQLite instead of a process-local dictionary. The shared server ticker reveals after everyone answers or the deadline passes, leaves a reading interval, and opens/finishes subsequent rounds automatically. Questions and reveals remain private per player. REST snapshots recover questions, selected answers, locks, reveals and final results after reload/reconnect. Legacy live rooms with a lost clock resume the same deal. Rewards are not paid again when results are reopened. |
| Room interface | Live race standings with avatars/profile access, lock indicators and progress. Polling/visibility recovery supplements sockets. Clock payloads include server time. Legacy host `/next` and `/reveal` mutations now return 409 rather than race the automatic clock or prematurely finish a waiting room. |
| Team Ranked (chat1 466 and related bug reports) | Answer responses immediately update the player's locked state. The current round's private result/selection survives reload and never carries into the next question. Correct feedback/review uses the same shuffled displayed label as grading. Dashboard recovery advertises an active match even when its lobby is already marked launched. Team zero's wins are counted correctly. Client clocks use server time; finish sound plays once per match and respects either team's win. |
| Boot/font first paint | Inline first-paint font defaults and saved-choice handling match the preference module; older explicit choices are retained. Tests cover every font choice and disabled storage. **This does not mean the Arsenica Sans binary is bundled; see the blocker below.** |
| iPad/PWA demonstration boot (chat1 446–450) | Optional `start-arena.bat preview` / `./start-arena.sh preview` build and serve Vite's bundled preview instead of development modules. Same-origin API/socket proxying is retained. This is a demonstration mode, not a hardened HTTPS production deployment. The service-worker cache version was bumped. |

## Already present; preserved rather than replaced

- Country selection/flags and player-profile entry points from social/competitive screens.
- Profile photo, bio, status, avatar colour, earned cosmetics, seasonal standings and achievements.
- Dedicated chat layouts, history loading, reply jumps, mobile hold handling, teacher attachments/materials/quizzes, and AI Tutor conversation/history functionality.
- Study hub sections, CBT answer text styling, light/night design tokens, group-width containment and world-map features.
- The supported English/Mathematics catalogue. Startup deactivates unsupported legacy courses while retaining historical exam records; a destructive historical request to purge records was not replayed.
- Existing Genesis PWA artwork. The checked-in installation screenshot depicts Genesis; historical complaint screenshots were not attached to the export, so an alleged exact replacement could not be recovered.
- Newer font selections/preferences and the current branch. Old archived branch names and commits were not checked out or pushed over this work.

## Explicitly removed or excluded

- **Slingshot/Wiz prototype:** removed in response to the user's latest instruction. No new game HTML, sprite bundle or entry point remains in the frontend. The unrelated existing arcade is preserved.
- Global Challenges: later archive messages explicitly request its removal (chat3 14–15); it was not reintroduced.
- Nine Clover/MLBB, Fixiis and unrelated infrastructure/account-management work are not CBT requirements.
- Historical server addresses, credentials, provisioning/payment instructions and unsupported claims about old infrastructure were not executed.
- External Lottie animations/original `ThemeLottie` source are not present in the export. The scenery here is an original SVG adaptation, not a claimed recovery of missing animation files.

## Remaining blocker: genuinely bundled Arsenica Sans

**Not complete.** The current CSS preference names Arsenica Sans, but there is no genuine Arsenica Sans font binary in this repository, the archive or the user-linked asset repository. Consequently a fallback can still render; the preference/first-paint tests are not evidence of the actual font rendering.

The exact Sans family exists at the publisher: [3](https://www.zetafonts.com/arsenica-sans). It must not be confused with the older serif Arsenica trial. The user has been asked for WOFF2 regular/bold files or the variable font, with permission for web embedding. Once supplied, the remaining work is to bundle those files, declare the actual weight/style ranges, preload the default face as appropriate, include the licence, and test network/font loading on a clean device with no installed Arsenica family. No substitute font has been renamed to impersonate it; no missing-font URL or unlicensed specimen font was added.

## Validation

Completed against an isolated SQLite test database and a production Vite preview, not the user's live database:

- `backend/tests/archive_regressions.py`: six regressions covering private room recovery/new sessions, timeout/reveal/automatic advancement, finish/reward idempotence, duplicate answer lock, legacy clock recovery, shuffle-aware/private ranked feedback, and profile banner validation/persistence.
- `npm run typecheck` and `npm run build`.
- `npm run check:fonts`: preference/default/migration/storage and first-paint checks only; actual Arsenica loading remains blocked above.
- `npm run audit:archive`: profile containment/scroll/Escape at 320/390/768/1280 widths in day/night skins; two-player private rooms, reloads, automatic reveals/next/finish; legacy host-action guards; team-ranked active-match recovery, private feedback and answer lock after reload.
- `npm run audit:chat-profile`: real Chromium touch holds, reaction/reply/edit requests through the real API in Group/Friends/Messages renderers; exact shared bubble geometry comparison; responsive day/night containment; account-saved scenes and motion; banner upload/removal and public-profile display; unauthenticated banner access rejection. The Messages renderer is exercised with a real existing friend conversation, not a separately provisioned teacher/student relationship.
- `npm run audit:visual`: existing mobile overflow, light-skin, navigation, PWA and admin regression audit.
- Python compile check, shell syntax check and `git diff --check`.

Screenshots are generated in ignored `frontend/test-results/`. Browser tests simulate mobile/touch in Chromium; they do not claim physical iPad/Safari coverage. The Windows launcher was inspected but cannot be executed on this Linux workspace.

### Re-running

Backend unit regressions do not need a running server:

```sh
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python backend/tests/archive_regressions.py
```

Run the browser audits only against a disposable/test API database. They create accounts, friendships, groups, rooms, ranked matches and profile images. Build the frontend and run `npm run preview` with the API on port 3000, install a Playwright Chromium if needed, then run the three `audit:*` scripts above. `VISUAL_BASE_URL`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and optional JSON `PLAYWRIGHT_CHROMIUM_ARGS` configure the browser runs.

## Profile-art follow-up

The subsequent profile request adds six original AI-generated 3D-style environment
wallpapers (space, volcano, forest, ocean, academy, city), compressed WebP thumbnail
previews, layered lighting/foreground/mote animation and original bevelled vector rank
crests. Existing SVG scenery is retained as the image-error fallback. Uploaded banners,
account-saved motion, reduced motion and authentic server-provided ranks are preserved.
This is rendered 3D-style artwork with depth animation, not an interactive WebGL world.

`npm run audit:profile-art` checks all six full scenes and their thumbnails, public card
containment at four widths in both skins, reduced/stored motion settings, and distinct
Bronze/Silver/Gold/Platinum metal crests with collision-free SVG gradient IDs. This audit,
the archive and chat/profile browser audits, typecheck and production build passed.
Arsenica Sans still requires the actual licensed font binary; no font was impersonated.

## Country, dossier and World Map follow-up

- Replaced emoji-based profile/friend/leaderboard flags with 249 bundled SVG flags
  from `flag-icons` 7.6.0 (MIT; licence included). The country picker is searchable,
  displays real flags and persists to the account. The API normalizes known ISO
  codes and rejects invalid ones rather than silently saving unusable flags.
- Added visible friend profile controls, podium profile access and a full-player
  profile action from the group-specific dossier. The public dossier has country
  identity and shortcuts to statistics, achievements and highlights.
- Added moving light trails and luminous orbs above wallpaper/photo layers. Stored
  motion and OS reduced-motion settings still stop all layers.
- World Map now uses biome illustrations/vector icons and the player's actual level
  progress rather than `xp % 1000`. Existing nodes, mastery, bosses and rewards are
  preserved. Direct hash navigation now resolves the requested screen instead of
  wrongly falling back to Home; new navigation resets the old page scroll position.
- Fixed touch pointer capture on interactive children of hold menus, preserving both
  normal taps (open profile/chat) and long-press actions.

Seven backend regressions now include ISO validation/persistence. The additional
`npm run audit:country-world` covers real touch profile/chat/group-dossier access,
country search/save/reload, SVG loading, invalid-country rejection, dossier section
navigation, World Map course switching/location dialogs and responsive day/night
containment. This is a verified UI pass, not a claim that every historical screenshot
or unavailable source implementation has been recovered.

The supplied Zetafonts URL was checked: it is the correct family/licensing page, not
an uploaded webfont package. Actual Arsenica Sans embedding remains blocked until the
licensed font files are supplied. The publisher's specimen assets were not scraped.
