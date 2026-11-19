"""Read an MLBB result/scoreboard screenshot and turn it into a game sheet.

The vision model only *transcribes* what it sees (two teams of rows: name, hero,
K/D/A, gold, damage, rating, MVP, plus bans/duration/victory if shown). Every
decision after that is deterministic and explained back to the human:

* which side is ours — roster IGNs and our drafted heroes, never the model's word;
* which lane each row is — the game's draft first, then who played (lineup),
  then the player's main role, then the hero's lane;
* who played — scoreboard names matched to the roster (subs are flagged);
* the draft — empty picks/bans are filled; a typed pick that the picture
  contradicts is replaced and called out;
* the team stat line — summed from the rows.

Nothing is saved here. The result fills the game form; a person checks it and
presses Save (the same permission as typing it in by hand).
"""
from __future__ import annotations

import base64
import copy
import difflib
import io
import json
import os
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import UPLOAD_DIR
from .ai_credentials import PROVIDER as MAIN_PROVIDER
from .esports_ai import ENDPOINT, MODEL, _credential, _reserve
from .hero_vision import HINT_RULE, check_rows, portrait_help
from .models import Hero, User
from .performance import clean_line, clean_lineup, hero_key
from .security import LANES
from .vision_provider import ProviderError, Reader, post_chat, reader_for, vision_chat, with_backup

# deepseek-flash reads images (JPEG/PNG/GIF/WebP) through the normal chat endpoint.
VISION_MODEL = os.getenv("CLOVER_AI_VISION_MODEL", MODEL).strip() or MODEL
IMAGE_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
SEND_LIMIT = 6 * 1024 * 1024      # bigger files are re-encoded before sending
MAX_SIDE = 2600                    # the provider resizes to ~1300×1300 px of area anyway


class ReadError(RuntimeError):
    """A problem the person can act on (shown as-is)."""

    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


SYSTEM = """You transcribe Mobile Legends: Bang Bang screenshots (post-match result screens, scoreboards, data tabs, draft screens) for a team's match records.

Return one JSON object only:
{
  "screen": "scoreboard" | "result" | "draft" | "other",
  "duration": "mm:ss or null",
  "teams": [
    {
      "side": "left" | "right",
      "victory": true | false | null,
      "kills": number | null,
      "bans": ["hero", ...],
      "objectives": {"turrets": n|null, "lords": n|null, "turtles": n|null, "gold": n|null},
      "players": [
        {"name": "in-game name exactly as printed", "hero": "hero name", "kills": n, "deaths": n, "assists": n,
         "gold": n|null, "damage": n|null, "damage_taken": n|null, "turret_damage": n|null,
         "rating": n|null, "mvp": true|false, "portrait": [x0, y0, x1, y1] | null}
      ]
    }
  ],
  "notes": ["short notes on anything unreadable or unusual"]
}

Rules:
- Two teams: the left/top team and the right/bottom team, each player row in the order shown.
- MLBB layout: the post-match data screen shows the two teams side by side (left half, right half), five rows each.
  A row reads: hero portrait, player name, K/D/A as three numbers split by "/", gold (coin icon), then the score/rating
  (e.g. 9.4) with an MVP badge on one player per team at most. Team kill totals are the big numbers at the top centre
  ("12 VS 8" = left 12, right 8) — put them in each team's "kills".
- Read each digit carefully: 1 vs 7, 3 vs 8, 5 vs 6, 0 vs 8 are the usual mistakes. A row's kills can't exceed its
  team's kills; the team's kills are the sum of its rows' kills.
- Copy every number exactly as printed. "12.3k" gold means 12300. Use null for anything not visible. Never invent a number.
- K/D/A is usually printed as kills/deaths/assists.
- "rating" is the per-player score (e.g. 8.6, 11.2). "mvp" is true only for players marked MVP (gold MVP / silver MVP-loss badge).
- "victory" is true for the team shown as VICTORY / winning, false for DEFEAT, null if not shown.
{HINT_RULE}
- Player names: copy as printed, including clan tags or symbols.
- A draft screen has picks/bans but no K/D/A: put the picked heroes as players with null numbers.
- Return only the JSON object, no commentary.""".replace("{HINT_RULE}", HINT_RULE)


# --------------------------------------------------------------------------- #
# image
# --------------------------------------------------------------------------- #
def load_upload(url: str) -> tuple[bytes, str, str]:
    """A screenshot uploaded to this app (/api/files/<name>) → (bytes, mime, name). No outside URLs."""
    name = str(url or "").strip().split("?", 1)[0]
    if name.startswith("/api/files/"):
        name = name[len("/api/files/"):]
    if not name or "/" in name or ".." in name or name.count(".") != 1:
        raise ReadError("Pick a screenshot uploaded to the app (scrim evidence or a new upload).")
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in IMAGE_EXT:
        raise ReadError("That file isn't a picture — use a PNG, JPG or WebP screenshot.")
    path = UPLOAD_DIR / name
    if not path.is_file():
        raise ReadError("That screenshot isn't on the server any more — upload it again.", 404)
    raw = path.read_bytes()
    if len(raw) > MAX_IMAGE_BYTES:
        raise ReadError("Screenshot is too big (max 20 MB).", 413)
    return raw, IMAGE_EXT[ext], name


def prepare_image(raw: bytes, mime: str) -> tuple[bytes, str]:
    """Shrink very large screenshots; small ones are sent untouched."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow is a requirement
        return raw, mime
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001 - any decoder error means "not an image"
        raise ReadError("Couldn't open that picture — is it a real screenshot?") from exc
    if len(raw) <= SEND_LIMIT and max(img.size) <= MAX_SIDE and mime != "image/gif":
        return raw, mime
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90)
    return out.getvalue(), "image/jpeg"


# --------------------------------------------------------------------------- #
# provider
# --------------------------------------------------------------------------- #
def call_model(api_key: "str | Reader", system: str, text: str, image: bytes, mime: str,
               extra: list[tuple[bytes, str]] | None = None) -> dict:
    """One vision request → the JSON object the model returned. Tests replace this.

    ``api_key`` — a plain main key, or a :class:`Reader` (Groq first, main key as backup).
    ``extra`` — more pictures after the screenshot (the hero reference sheet)."""
    reader = api_key if isinstance(api_key, Reader) else Reader(MAIN_PROVIDER, api_key)
    images = [(image, mime), *(extra or [])]
    try:
        return with_backup(reader, lambda r: _read_once(r, system, text, images))
    except ProviderError as exc:
        if exc.kind == "rejected":
            raise ReadError("Couldn't read that picture. Try a clearer, uncropped screenshot.", 502) from exc
        if exc.kind == "garbled":
            raise ReadError("That reading came back garbled. Try again.", 502) from exc
        raise ReadError("Reading isn't answering right now. Try again in a minute, or fill it in by hand.", 502) from exc


def _read_once(reader: Reader, system: str, text: str, images: list[tuple[bytes, str]]) -> dict:
    read = vision_chat(reader, system, text, images, max_tokens=4000, timeout=90)
    if read is not None:
        return read

    def part(data: bytes, kind: str) -> dict:
        return {"type": "image_url", "image_url": {"url": f"data:{kind};base64,{base64.b64encode(data).decode('ascii')}",
                                                   "detail": "high"}}
    body = {
        "model": VISION_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [{"type": "text", "text": text}, *(part(d, k) for d, k in images)]},
        ],
        "thinking": {"type": "disabled"},
        "temperature": 0,
        "max_tokens": 4000,
        "response_format": {"type": "json_object"},
    }
    return post_chat(ENDPOINT, reader.key, body, timeout=90, limit=400_000)


def reader_key(db: Session, user: User) -> Reader:
    """Who reads uploads: Gemini, then Groq, when Team Admin saved their keys; the main key backs them up."""
    main_key, _reason = _credential(db)
    reader = reader_for(db, main_key)
    if reader is None:
        raise ReadError("Reading uploads isn't set up yet — an admin adds the key in Team Admin. "
                        "You can still fill everything in by hand.", 503)
    if not _reserve(db, user.id):
        raise ReadError("Couldn't record this request. Try again.", 503)
    return reader


def ai_key(db: Session, user: User) -> str:
    api_key, reason = _credential(db)
    if not api_key:
        raise ReadError("The AI isn't set up yet — an admin adds the AI key in Team Admin. "
                        "You can still fill everything in by hand.", 503)
    if not _reserve(db, user.id):
        raise ReadError("Couldn't record this AI request. Try again.", 503)
    return api_key


# --------------------------------------------------------------------------- #
# matching helpers
# --------------------------------------------------------------------------- #
def name_key(name: Any) -> str:
    """IGN for matching: lower-case letters/digits only (symbols and spaces dropped)."""
    return re.sub(r"[^0-9a-z]+", "", str(name or "").casefold())


def names_match(seen: str, known: str) -> bool:
    a, b = name_key(seen), name_key(known)
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) >= 3 and (a in b or b in a):  # clan tags: "9cTOBI" ↔ "TOBI"
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def canon_hero(name: Any, heroes: dict[str, str]) -> str:
    key = hero_key(name)
    if not key:
        return ""
    if key in heroes:
        return heroes[key]
    close = difflib.get_close_matches(key, list(heroes), n=1, cutoff=0.82)
    return heroes[close[0]] if close else str(name).strip()[:60]


def parse_duration(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round(float(value), 1) if 0 < value < 120 else None
    m = re.match(r"^\s*(\d{1,3}):(\d{2})\s*$", str(value))
    if not m:
        return None
    return round(int(m.group(1)) + int(m.group(2)) / 60, 1)


def _int(value: Any) -> int | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    if isinstance(value, str):
        text = value.strip().lower().replace(",", "")
        mult = 1000 if text.endswith("k") else 1
        text = text.rstrip("k")
        try:
            return int(float(text) * mult)
        except ValueError:
            return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rows(team: dict) -> list[dict]:
    rows = team.get("players") if isinstance(team, dict) else None
    return [r for r in rows if isinstance(r, dict)][:5] if isinstance(rows, list) else []


def _line(row: dict) -> dict:
    data = {k: _int(row.get(k)) for k in ("kills", "deaths", "assists", "gold", "damage", "damage_taken", "turret_damage")}
    data["rating"] = row.get("rating")
    data["mvp"] = row.get("mvp") is True
    return clean_line(data)


# --------------------------------------------------------------------------- #
# interpretation
# --------------------------------------------------------------------------- #
def interpret(raw: dict, *, db: Session, lineup: dict | None, draft: dict | None, result: str = "") -> dict:
    """Model transcription + this game's draft/lineup/roster → values for the game form."""
    raw = copy.deepcopy(raw)  # rows get annotated while placing; never touch the caller's dict
    heroes = {hero_key(name): name for (name,) in db.execute(select(Hero.name)).all()}
    hero_lane = {hero_key(name): (role or "").upper() for name, role in db.execute(select(Hero.name, Hero.role)).all()}
    roster = [u for u in db.scalars(select(User).where(User.active.is_(True))).all()]
    lineup = clean_lineup(lineup)
    draft = draft if isinstance(draft, dict) else {}
    our_picks = {str(k).upper(): canon_hero(v, heroes) for k, v in (draft.get("our_picks") or {}).items() if v}
    enemy_picks = {str(k).upper(): canon_hero(v, heroes) for k, v in (draft.get("enemy_picks") or {}).items() if v}
    by_id = {u.id: u for u in roster}
    checks: list[dict] = []

    def check(tone: str, text: str) -> None:
        checks.append({"tone": tone, "text": text})

    teams = [t for t in (raw.get("teams") or []) if isinstance(t, dict)][:2] if isinstance(raw.get("teams"), list) else []
    if not teams or not any(_rows(t) for t in teams):
        raise ReadError("Couldn't find a scoreboard in that picture. Use the end-of-match result or data screen.")
    while len(teams) < 2:
        teams.append({"side": "right" if teams and teams[0].get("side") == "left" else "left", "players": []})
    for t in teams:
        for r in _rows(t):
            r["hero"] = canon_hero(r.get("hero"), heroes)

    # 1) which team is ours: roster names and our drafted heroes, against the enemy picks.
    def ours_score(team: dict) -> int:
        score = 0
        for r in _rows(team):
            if any(names_match(r.get("name", ""), u.ign or u.name) for u in roster):
                score += 3
            key = hero_key(r.get("hero"))
            score += 2 * any(hero_key(h) == key for h in our_picks.values())
            score -= 2 * any(hero_key(h) == key for h in enemy_picks.values())
        return score

    scores = [ours_score(t) for t in teams]
    if scores[0] == scores[1]:
        left_first = sorted(range(2), key=lambda i: 0 if teams[i].get("side") != "right" else 1)
        ours_i = left_first[0]
        check("warn", "Couldn't tell which team is yours from names or heroes, so the left team was taken as 9 Clover. "
                      "Check the players below.")
    else:
        ours_i = 0 if scores[0] > scores[1] else 1
    ours, theirs = teams[ours_i], teams[1 - ours_i]

    # 2) our rows → lanes.
    free = list(LANES)
    placed: dict[str, dict] = {}
    pending = []
    for r in _rows(ours):
        user = next((u for u in roster if names_match(r.get("name", ""), u.ign or u.name)), None)
        pending.append({"row": r, "user": user})

    def place(item: dict, lane: str, how: str) -> None:
        free.remove(lane)
        placed[lane] = {**item, "how": how}

    for how, lane_of in (
        ("draft", lambda it: next((ln for ln, h in our_picks.items() if hero_key(h) == hero_key(it["row"].get("hero"))), None)),
        ("lineup", lambda it: next((ln for ln, uid in lineup.items() if it["user"] and uid == it["user"].id), None)),
        ("main role", lambda it: (it["user"].main_role or "").upper() if it["user"] else None),
        ("hero lane", lambda it: hero_lane.get(hero_key(it["row"].get("hero")))),
    ):
        for it in [p for p in pending if not p.get("done")]:
            lane = lane_of(it)
            if lane in free:
                place(it, lane, how)
                it["done"] = True
    for it in [p for p in pending if not p.get("done")]:
        if free:
            place(it, free[0], "guess")
            it["done"] = True
    guessed = [ln for ln, it in placed.items() if it["how"] == "guess"]
    if guessed:
        check("warn", f"Lane guessed for {', '.join(guessed)} — check those rows.")

    # 3) who played.
    new_lineup = dict(lineup)
    for lane, it in placed.items():
        user = it["user"]
        if not user:
            if it["row"].get("name"):
                check("info", f"{lane}: '{it['row']['name']}' isn't on the roster — pick the player by hand.")
            continue
        before = lineup.get(lane)
        if before and before != user.id:
            was = by_id.get(before)
            check("warn", f"{user.ign or user.name} played {lane} (lineup had {was.ign or was.name if was else 'someone else'}).")
        new_lineup[lane] = user.id
    seen_ids = [uid for uid in new_lineup.values()]
    if len(seen_ids) != len(set(seen_ids)):  # a player can't be in two lanes: keep the scoreboard's lane
        keep: dict[int, str] = {}
        for lane, it in placed.items():
            if it["user"]:
                keep[it["user"].id] = lane
        new_lineup = {ln: uid for ln, uid in new_lineup.items() if keep.get(uid, ln) == ln}

    # 4) enemy rows → lanes.
    e_free = list(LANES)
    e_placed: dict[str, dict] = {}
    e_rows = list(_rows(theirs))
    for how, lane_of in (
        ("draft", lambda r: next((ln for ln, h in enemy_picks.items() if hero_key(h) == hero_key(r.get("hero"))), None)),
        ("hero lane", lambda r: hero_lane.get(hero_key(r.get("hero")))),
    ):
        for r in [x for x in e_rows if not x.get("_done")]:
            lane = lane_of(r)
            if lane in e_free:
                e_free.remove(lane)
                e_placed[lane] = {"row": r, "how": how}
                r["_done"] = True
    for r in [x for x in e_rows if not x.get("_done")]:
        if e_free:
            lane = e_free.pop(0)
            e_placed[lane] = {"row": r, "how": "guess"}
            r["_done"] = True

    # 5) draft: fill blanks, replace what the picture contradicts.
    new_draft = {
        "our_bans": list(draft.get("our_bans") or ["", "", "", "", ""])[:5],
        "enemy_bans": list(draft.get("enemy_bans") or ["", "", "", "", ""])[:5],
        "our_picks": dict(draft.get("our_picks") or {}),
        "enemy_picks": dict(draft.get("enemy_picks") or {}),
    }
    for side, rows_by_lane, picks, label in (("our_picks", placed, our_picks, "Our"), ("enemy_picks", e_placed, enemy_picks, "Their")):
        for lane, it in rows_by_lane.items():
            hero = it["row"].get("hero")
            if not hero:
                continue
            typed = picks.get(lane)
            if typed and hero_key(typed) != hero_key(hero):
                check("warn", f"{label} {lane}: draft said {typed}, screenshot shows {hero} — updated.")
            new_draft[side][lane] = hero
    for side, team in (("our_bans", ours), ("enemy_bans", theirs)):
        bans = [canon_hero(b, heroes) for b in (team.get("bans") or []) if b][:5] if isinstance(team.get("bans"), list) else []
        if bans and not any(new_draft[side]):
            new_draft[side] = (bans + [""] * 5)[:5]

    # 6) result + duration + team line.
    victory = ours.get("victory")
    new_result = "WIN" if victory is True else "LOSS" if victory is False else ""
    if not new_result and theirs.get("victory") in (True, False):
        new_result = "LOSS" if theirs["victory"] else "WIN"
    if new_result and result in {"WIN", "LOSS"} and new_result != result:
        check("warn", f"Form said {result.lower()}, screenshot shows a {new_result.lower()} — updated.")
    lines = {lane: _line(it["row"]) for lane, it in placed.items()}
    enemy = {}
    for lane, it in e_placed.items():
        row = _line(it["row"])
        if it["row"].get("hero"):
            row["hero"] = it["row"]["hero"]
        if it["row"].get("name"):
            row["name"] = str(it["row"]["name"]).strip()[:60]
        enemy[lane] = row

    def total(rows: dict, key: str) -> int | None:
        vals = [r.get(key) for r in rows.values()]
        return sum(vals) if vals and all(v is not None for v in vals) else None

    stats: dict[str, int] = {}
    for key, value in (("kills", total(lines, "kills") if total(lines, "kills") is not None else _int(ours.get("kills"))),
                       ("deaths", total(lines, "deaths")),
                       ("gold", total(lines, "gold")),
                       ("enemy_kills", total(enemy, "kills") if total(enemy, "kills") is not None else _int(theirs.get("kills"))),
                       ("enemy_deaths", total(enemy, "deaths")),
                       ("enemy_gold", total(enemy, "gold"))):
        if value is not None:
            stats[key] = value
    for prefix, team in (("", ours), ("enemy_", theirs)):
        obj = team.get("objectives") if isinstance(team.get("objectives"), dict) else {}
        for key in ("turrets", "lords", "turtles"):
            if (v := _int(obj.get(key))) is not None and 0 <= v <= 20:
                stats[prefix + key] = v
        if "gold" not in stats and not prefix and (v := _int(obj.get("gold"))):
            stats["gold"] = v

    mvp = next((ln for ln, ln_row in lines.items() if ln_row.get("mvp")), None)
    if mvp and placed[mvp]["user"]:
        check("ok", f"MVP: {placed[mvp]['user'].ign or placed[mvp]['user'].name} ({lines[mvp].get('rating', '—')}).")
    if len(placed) == 5 and not guessed:
        check("ok", "All five of our players matched to a lane.")
    for note in (raw.get("notes") or [])[:4] if isinstance(raw.get("notes"), list) else []:
        if isinstance(note, str) and note.strip():
            check("info", note.strip()[:200])

    def out_rows(rows_by_lane: dict, enemy_side: bool) -> list[dict]:
        out = []
        for lane in LANES:
            it = rows_by_lane.get(lane)
            if not it:
                continue
            row = it["row"]
            item = {"lane": lane, "name": str(row.get("name") or "")[:60], "hero": row.get("hero") or "",
                    "line": _line(row), "placed_by": it["how"], "hero_check": row.get("hero_check") or "unchecked"}
            if isinstance(row.get("portrait"), list):
                item["portrait"] = row["portrait"]
            if row.get("hero_was"):
                item["hero_was"] = str(row["hero_was"])[:40]
            if isinstance(row.get("doubt"), list) and row["doubt"]:
                item["doubt"] = [f for f in row["doubt"] if f in NUMBER_FIELDS][:6]
            if not enemy_side:
                user = it["user"]
                item["user_id"] = user.id if user else None
                item["player"] = (user.ign or user.name) if user else None
            out.append(item)
        return out

    return {
        "screen": raw.get("screen") if raw.get("screen") in {"scoreboard", "result", "draft", "other"} else "other",
        "result": new_result,
        "duration_min": parse_duration(raw.get("duration")),
        "lineup": {ln: new_lineup[ln] for ln in LANES if ln in new_lineup},
        "draft": new_draft,
        "player_stats": {ln: lines[ln] for ln in LANES if ln in lines and lines[ln]},
        "enemy_stats": {ln: enemy[ln] for ln in LANES if ln in enemy and enemy[ln]},
        "stats": stats,
        "rows": {"ours": out_rows(placed, False), "enemy": out_rows(e_placed, True)},
        "checks": checks,
    }


def read_scoreboard(db: Session, user: User, *, image_url: str, lineup: dict | None, draft: dict | None,
                    opponent: str = "", result: str = "") -> dict:
    raw_bytes, mime, name = load_upload(image_url)
    image, mime = prepare_image(raw_bytes, mime)
    api_key = reader_key(db, user)
    names = {u.id: (u.ign or u.name) for u in db.scalars(select(User).where(User.active.is_(True))).all()}
    clean = clean_lineup(lineup)
    draft = draft if isinstance(draft, dict) else {}
    all_heroes = [n for (n,) in db.execute(select(Hero.name).order_by(Hero.name)).all()]
    picked = [str(h) for side in ("our_picks", "enemy_picks") for h in (draft.get(side) or {}).values() if h] \
        if all(isinstance(draft.get(s) or {}, dict) for s in ("our_picks", "enemy_picks")) else []
    help_ = portrait_help(raw_bytes, all_heroes, picked)
    if help_.image:
        image, mime = help_.image, "image/jpeg"
    context = {
        "our_team": "9 Clover",
        "opponent": opponent[:120],
        "our_roster_igns": sorted(set(names.values())),
        "who_played_by_lane": {ln: names.get(uid, "") for ln, uid in clean.items()},
        "known_picks": {"ours": draft.get("our_picks") or {}, "theirs": draft.get("enemy_picks") or {}},
        **help_.hints(),
        "hero_names": all_heroes,
    }
    raw = call_model(api_key, SYSTEM, "Transcribe this screenshot. Game context:\n" + json.dumps(context, ensure_ascii=False),
                     image, mime, extra=[(help_.sheet, "image/png")] if help_.sheet else None)
    number_notes = double_check(api_key, raw_bytes, raw, {"our_roster_igns": context["our_roster_igns"]}) \
        if isinstance(raw, dict) and raw.get("screen") != "draft" else []
    number_notes += sanity(raw) if isinstance(raw, dict) else []
    rows = [r for t in (raw.get("teams") or []) if isinstance(t, dict) for r in _rows(t)] \
        if isinstance(raw, dict) and isinstance(raw.get("teams"), list) else []
    hero_notes = check_rows(raw_bytes, rows, all_heroes, candidates=picked or None, matches=help_.matches)
    out = interpret(raw, db=db, lineup=clean, draft=draft, result=result)
    out["checks"] = out.get("checks", []) + number_notes + portrait_checks(help_, out) + hero_notes
    out["heroes_seen"] = [m.out() for m in help_.matches]
    out["image_url"] = f"/api/files/{name}"
    return out


# --------------------------------------------------------------------------- #
# accuracy: zoomed second look at the numbers, then sanity checks
# --------------------------------------------------------------------------- #
DOUBLE_CHECK = os.getenv("CLOVER_SCOREBOARD_DOUBLE_CHECK", "1").strip().lower() not in {"0", "false", "no", "off"}
MIN_SIDE_FOR_ZOOM = 300          # tiny pictures have nothing to zoom into
ZOOM_WIDTH = 1500
NUMBER_FIELDS = ("kills", "deaths", "assists", "gold", "damage", "rating")

NUMBERS_SYSTEM = """You double-check the numbers on a Mobile Legends: Bang Bang post-match scoreboard.

You get two zoomed crops of the same screenshot: image 1 is the left (or top) team, image 2 is the right (or bottom) team.
For each crop, list that team's player rows top to bottom (five rows when all are visible).

Return one JSON object only:
{"left": {"kills": team kill total or null, "players": [{"name": "as printed", "kills": n, "deaths": n, "assists": n,
  "gold": n|null, "damage": n|null, "rating": n|null, "mvp": true|false}]},
 "right": {same}}

Rules:
- Copy every digit exactly as printed; look twice at 1/7, 3/8, 5/6, 0/8. "12.3k" means 12300.
- K/D/A is printed as kills/deaths/assists. Rating is the per-player score such as 8.6.
- Use null for anything cut off or unreadable. Never guess and never invent a row.
- Return only the JSON object."""


def zoom_halves(raw: bytes) -> list[tuple[bytes, str]] | None:
    """Two enlarged crops — one per team — so small digits get many more pixels."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img.load()
        img = img.convert("RGB")
    except Exception:  # noqa: BLE001
        return None
    w, h = img.size
    if min(w, h) < MIN_SIDE_FOR_ZOOM:
        return None
    if w >= h:   # landscape: teams side by side
        boxes = [(0, 0, int(w * 0.53), h), (int(w * 0.47), 0, w, h)]
    else:        # portrait: teams stacked
        boxes = [(0, 0, w, int(h * 0.53)), (0, int(h * 0.47), w, h)]
    out = []
    for box in boxes:
        part = img.crop(box)
        scale = max(1.0, ZOOM_WIDTH / part.size[0])
        if scale > 1.0:
            part = part.resize((int(part.size[0] * scale), int(part.size[1] * scale)), Image.LANCZOS)
        part.thumbnail((2400, 2400))
        buf = io.BytesIO()
        part.save(buf, "JPEG", quality=92)
        out.append((buf.getvalue(), "image/jpeg"))
    return out


def call_numbers(reader: "str | Reader", crops: list[tuple[bytes, str]], context: dict) -> dict:
    """Second, numbers-only look at the zoomed crops. Tests replace this."""
    reader = reader if isinstance(reader, Reader) else Reader(MAIN_PROVIDER, reader)
    text = "Double-check the numbers. Roster names for reference:\n" + json.dumps(context, ensure_ascii=False)
    return with_backup(reader, lambda r: _read_once(r, NUMBERS_SYSTEM, text, crops))


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*([kK])?\s*", str(value))
    if not m:
        return None
    n = float(m.group(1))
    return n * 1000 if m.group(2) else n


def reconcile(raw: dict, second: Any) -> list[dict]:
    """Merge the zoomed reading into the first one. Agreement confirms a number; a clash takes the zoomed
    value (more pixels per digit) and marks the row so the person looks at it. Returns check notes."""
    if not isinstance(second, dict) or not isinstance(raw.get("teams"), list):
        return []
    teams = [t for t in raw["teams"] if isinstance(t, dict)][:2]
    by_side = {}
    for i, t in enumerate(teams):
        side = t.get("side") if t.get("side") in {"left", "right"} else ("left" if i == 0 else "right")
        by_side.setdefault(side, t)
    agreed = fixed = filled = 0
    clashes: list[str] = []
    for side in ("left", "right"):
        team, zoom = by_side.get(side), second.get(side)
        if not isinstance(team, dict) or not isinstance(zoom, dict):
            continue
        z_rows = [r for r in (zoom.get("players") or []) if isinstance(r, dict)][:5] if isinstance(zoom.get("players"), list) else []
        rows = _rows(team)
        used: set[int] = set()
        for i, row in enumerate(rows):
            j = next((k for k, z in enumerate(z_rows) if k not in used and z.get("name") and row.get("name")
                      and names_match(str(z["name"]), str(row["name"]))), None)
            if j is None and i < len(z_rows) and i not in used and len(z_rows) == len(rows):
                j = i  # same number of rows: line them up by position
            if j is None:
                continue
            used.add(j)
            z = z_rows[j]
            for field in NUMBER_FIELDS:
                a, b = _num(row.get(field)), _num(z.get(field))
                if b is None:
                    continue
                if a is None:
                    row[field] = int(b) if field != "rating" else b
                    filled += 1
                elif abs(a - b) < (0.05 if field == "rating" else 0.5):
                    agreed += 1
                else:
                    row[field] = int(b) if field != "rating" else b
                    row.setdefault("doubt", []).append(field)
                    fixed += 1
                    if len(clashes) < 6:
                        clashes.append(f"{row.get('name') or row.get('hero') or 'a row'} {field} {a:g}→{b:g}")
        tk_a, tk_b = _num(team.get("kills")), _num(zoom.get("kills"))
        if tk_b is not None and (tk_a is None or abs(tk_a - tk_b) >= 0.5):
            team["kills"] = int(tk_b)
    notes: list[dict] = []
    if agreed or fixed or filled:
        if fixed:
            notes.append({"tone": "warn", "text": f"Double-checked every number on a zoomed-in copy: {agreed} matched, "
                                                  f"{fixed} read differently and were corrected ({'; '.join(clashes)}) — glance at those."})
        else:
            notes.append({"tone": "ok", "text": f"Double-checked every number on a zoomed-in copy: all {agreed} matched"
                                                + (f", {filled} filled in." if filled else ".")})
    return notes


def sanity(raw: dict) -> list[dict]:
    """Numbers that can't all be right at once. Marks the rows it doubts."""
    notes: list[dict] = []
    teams = [t for t in (raw.get("teams") or []) if isinstance(t, dict)][:2] if isinstance(raw.get("teams"), list) else []
    sums = []
    for t in teams:
        rows = _rows(t)
        label = "Left team" if t.get("side") != "right" else "Right team"
        kills = [_num(r.get("kills")) for r in rows]
        total = sum(k for k in kills if k is not None) if rows and all(k is not None for k in kills) else None
        printed = _num(t.get("kills"))
        sums.append((total, sum(d for d in (_num(r.get("deaths")) for r in rows) if d is not None)
                     if rows and all(_num(r.get("deaths")) is not None for r in rows) else None))
        if total is not None and printed is not None and abs(total - printed) >= 0.5:
            notes.append({"tone": "warn", "text": f"{label}: player kills add up to {total:g} but the scoreboard total says "
                                                  f"{printed:g} — one K is probably misread."})
            for r in rows:
                r.setdefault("doubt", []).append("kills")
        team_k = printed if printed is not None else total
        for r in rows:
            name = r.get("name") or r.get("hero") or "a player"
            k, a = _num(r.get("kills")), _num(r.get("assists"))
            if team_k is not None and ((k is not None and k > team_k) or (a is not None and a > team_k)):
                notes.append({"tone": "warn", "text": f"{name}: K/A higher than the team's {team_k:g} kills — check it."})
                r.setdefault("doubt", []).extend(["kills", "assists"])
            rating = _num(r.get("rating"))
            if rating is not None and not 0 < rating <= 20:
                notes.append({"tone": "warn", "text": f"{name}: rating {rating:g} isn't a real score — removed."})
                r["rating"] = None
            gold = _num(r.get("gold"))
            if gold is not None and not 300 <= gold <= 60000:
                notes.append({"tone": "warn", "text": f"{name}: {gold:g} gold looks wrong — check it."})
                r.setdefault("doubt", []).append("gold")
        if sum(1 for r in rows if r.get("mvp") is True) > 1:
            notes.append({"tone": "warn", "text": f"{label}: more than one MVP marked — only one player per team can be."})
    if len(sums) == 2:
        for (k, _), (_, d), who in ((sums[0], sums[1], "left"), (sums[1], sums[0], "right")):
            if k is not None and d is not None and abs(k - d) > 3:
                notes.append({"tone": "warn", "text": f"The {who} team's kills ({k:g}) and the other team's deaths ({d:g}) "
                                                      "don't line up — a K or D is likely misread."})
    for t in teams:
        for r in _rows(t):
            if r.get("doubt"):
                r["doubt"] = sorted(set(r["doubt"]))
    return notes


def double_check(reader, raw_bytes: bytes, raw: dict, context: dict) -> list[dict]:
    if not DOUBLE_CHECK or not isinstance(raw, dict):
        return []
    crops = zoom_halves(raw_bytes)
    if not crops:
        return []
    try:
        second = call_numbers(reader, crops, context)
    except Exception:  # noqa: BLE001 - the first reading still stands
        return [{"tone": "info", "text": "Couldn't do the zoomed-in double check this time — look over the numbers."}]
    return reconcile(raw, second)


def portrait_checks(help_, out: dict) -> list[dict]:
    """Say how the heroes were recognised, and flag any sure portrait the reading left out."""
    rows = [r for side in ("ours", "enemy") for r in ((out.get("rows") or {}).get(side) or [])]
    read = {hero_key(r.get("hero")) for r in rows if isinstance(r, dict) and r.get("hero")}
    sure = [m for m in help_.matches if m.score >= 0.8]
    missing = [m.hero for m in sure if hero_key(m.hero) not in read]
    checks: list[dict] = []
    if help_.matches:
        checks.append({"tone": "ok", "text": f"Recognised {len(help_.matches)} "
                       f"{'hero' if len(help_.matches) == 1 else 'heroes'} from their portraits: "
                       + ", ".join(m.hero for m in help_.matches[:10]) + "."})
    if rows and missing:
        checks.append({"tone": "warn", "text": "The portraits clearly show " + ", ".join(missing[:5])
                       + " but the reading doesn't have " + ("it" if len(missing) == 1 else "them") + " — check the heroes."})
    return checks
