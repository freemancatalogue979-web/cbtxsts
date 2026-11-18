"""Utility AI: a member's file → their solo games.

Screenshots (match history, scoreboard, result screen) go to the vision model.
PDFs, Word documents and text go to the model as text. Spreadsheets/CSV with
recognisable column headers are read directly — no AI call at all; anything
else in a sheet is sent to the model as a table."""
from __future__ import annotations

import csv
import html
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from .ai_credentials import GROQ, PROVIDER as MAIN_PROVIDER
from .ai_scoreboard import IMAGE_EXT, ReadError, prepare_image, reader_key
from .ai_scoreboard import call_model as _vision_call
from .config import UPLOAD_DIR
from .esports_ai import ENDPOINT, MODEL
from .hero_vision import HINT_RULE, check_rows, portrait_help
from .models import User, utcnow
from .solo_games import clean_game, hero_names
from .vision_provider import ProviderError, Reader, groq_chat, post_chat, with_backup

DOC_EXT = {"pdf", "docx", "txt", "md", "json"}
SHEET_EXT = {"csv", "tsv", "xlsx"}
SUPPORTED = set(IMAGE_EXT) | DOC_EXT | SHEET_EXT
MAX_FILE = 25 * 1024 * 1024
MAX_TEXT = 40_000      # characters sent to the model from one document
MAX_ROWS = 2_000       # rows read from one spreadsheet
MAX_GAMES = 300        # games kept from one file

# Spreadsheet header → field. Matched on lower-case letters/digits only.
HEADERS = {
    "hero": "hero", "heroes": "hero", "heroname": "hero", "character": "hero", "champion": "hero", "pick": "hero",
    "result": "result", "outcome": "result", "winloss": "result", "wl": "result", "win": "result", "victory": "result",
    "k": "kills", "kills": "kills", "kill": "kills",
    "d": "deaths", "deaths": "deaths", "death": "deaths",
    "a": "assists", "assists": "assists", "assist": "assists",
    "kda": "kda", "kdaline": "kda",
    "rating": "rating", "score": "rating", "matchrating": "rating", "performance": "rating", "mvpscore": "rating",
    "gold": "gold", "totalgold": "gold", "networth": "gold",
    "damage": "damage", "herodamage": "damage", "dmg": "damage", "damagedealt": "damage",
    "damagetaken": "damage_taken", "taken": "damage_taken", "dmgtaken": "damage_taken",
    "turretdamage": "turret_damage", "towerdamage": "turret_damage",
    "mvp": "mvp",
    "date": "date", "day": "date", "played": "date", "playedon": "date", "matchdate": "date", "time": "date",
    "mode": "mode", "gamemode": "mode", "matchtype": "mode", "type": "mode", "queue": "mode",
    "lane": "lane", "role": "lane", "position": "lane",
    "duration": "duration", "length": "duration", "minutes": "duration", "gametime": "duration", "mins": "duration",
    "notes": "notes", "note": "notes", "comment": "notes", "comments": "notes",
}

SYSTEM = """You extract a Mobile Legends: Bang Bang player's OWN games from what they upload: a match-history screen, a post-match scoreboard or result screen, a stats page, a document or a table.

Return one JSON object only:
{
  "source": "history" | "scoreboard" | "result" | "stats" | "document" | "table" | "other",
  "player_found": true | false,
  "games": [
    {"date": "YYYY-MM-DD or as printed or null", "mode": "Ranked|Classic|Brawl|Custom|… or null",
     "hero": "hero name", "lane": "EXP|JUNGLE|MID|GOLD|ROAM or null", "result": "WIN" | "LOSS" | null,
     "duration": "mm:ss or null", "kills": n|null, "deaths": n|null, "assists": n|null, "rating": n|null,
     "gold": n|null, "damage": n|null, "damage_taken": n|null, "turret_damage": n|null, "mvp": true|false,
     "notes": "short, only if printed (e.g. medal, Savage)", "portrait": [x0, y0, x1, y1] | null}
  ],
  "notes": ["short notes on anything unreadable, cut off or unusual"]
}

Rules:
- Only this player's games. On a 10-player scoreboard, take ONLY the row of the player named in "player" (often highlighted); if that player isn't on it, return "player_found": false and no games.
- A match-history list has one game per row: include every visible row.
- Copy numbers exactly as printed; "12.3k" means 12300. Use null for anything not shown. Never invent a number, date or hero.
- K/D/A is printed as kills/deaths/assists. "rating" is the per-game score (e.g. 7.8, 11.2). "mvp" is true only for MVP badges.
- Victory/VICTORY/win → "WIN", Defeat/DEFEAT/loss → "LOSS".
{HINT_RULE}
- Return only the JSON object.""".replace("{HINT_RULE}", HINT_RULE)


# --------------------------------------------------------------------------- #
# the file
# --------------------------------------------------------------------------- #
def resolve(url: str) -> tuple[Path, str, str]:
    """A file uploaded to this app (/api/files/<name>) → (path, name, ext). No outside URLs."""
    name = str(url or "").strip().split("?", 1)[0]
    if name.startswith("/api/files/"):
        name = name[len("/api/files/"):]
    if not name or "/" in name or "\\" in name or ".." in name or name.count(".") != 1:
        raise ReadError("Pick a file uploaded to the app.")
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in SUPPORTED:
        raise ReadError("Use a screenshot (PNG/JPG/WebP), a PDF, a Word document (.docx), a text file, "
                        "or a spreadsheet (.xlsx/.csv).")
    path = UPLOAD_DIR / name
    if not path.is_file():
        raise ReadError("That file isn't on the server any more — upload it again.", 404)
    if path.stat().st_size > MAX_FILE:
        raise ReadError("That file is too big (max 25 MB).", 413)
    return path, name, ext


def _decode(raw: bytes) -> str:
    """UTF-8 (with or without BOM), UTF-16 (Excel's "Unicode text"), else Latin-1."""
    encodings = ("utf-16", "utf-8-sig") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig",)
    for enc in encodings:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def pdf_text(path: Path) -> str:
    from pypdf import PdfReader
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            reader.decrypt("")
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:40])
    except Exception as exc:  # noqa: BLE001 - any parser error means "can't read it"
        raise ReadError("Couldn't open that PDF. Export it again or upload screenshots instead.") from exc
    if len(text.strip()) < 20:
        raise ReadError("That PDF has no text in it (it's probably scanned pictures). "
                        "Upload the pages as screenshots instead.")
    return text


def docx_text(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "replace")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ReadError("Couldn't open that Word file. Save it as .docx (or PDF) and try again.") from exc
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"</w:tc>", "\t", xml)
    xml = re.sub(r"</w:p>|<w:br[^>]*/>", "\n", xml)
    text = html.unescape(re.sub(r"<[^>]+>", "", xml))
    return re.sub(r"\n{3,}", "\n\n", text)


def sheet_rows(path: Path, ext: str) -> list[list[str]]:
    if ext == "xlsx":
        try:
            from openpyxl import load_workbook
            wb = load_workbook(path, read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001
            raise ReadError("Couldn't open that spreadsheet. Save it as .xlsx or .csv and try again.") from exc
        rows: list[list[str]] = []
        try:
            for ws in wb.worksheets:
                for values in ws.iter_rows(values_only=True):
                    cells = ["" if v is None else (v.isoformat()[:10] if hasattr(v, "isoformat") else str(v)) for v in values]
                    if any(c.strip() for c in cells):
                        rows.append(cells)
                    if len(rows) >= MAX_ROWS:
                        break
                if len(rows) >= MAX_ROWS:
                    break
        finally:
            wb.close()
        return rows
    text = _decode(path.read_bytes())
    delimiter = "\t" if ext == "tsv" else ","
    if ext == "csv":
        try:
            delimiter = csv.Sniffer().sniff(text[:4000], delimiters=",;\t|").delimiter
        except csv.Error:
            pass
    return [row for row in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c.strip() for c in row)][:MAX_ROWS]


def _header_key(cell: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(cell or "").lower())


def table_games(rows: list[list[str]]) -> list[dict] | None:
    """Rows with a recognisable header → raw game dicts, read directly (no AI)."""
    for h, header in enumerate(rows[:10]):
        fields = [HEADERS.get(_header_key(c), "") for c in header]
        known = {f for f in fields if f}
        if len(known) >= 2 and ("hero" in known or "kda" in known or {"kills", "deaths"} <= known):
            games = []
            for row in rows[h + 1:]:
                data: dict[str, Any] = {}
                for field, cell in zip(fields, row):
                    if field and str(cell).strip() != "":
                        data[field] = str(cell).strip()
                if data:
                    games.append(data)
            return games
    return None


def rows_text(rows: list[list[str]]) -> str:
    return "\n".join("\t".join(str(c) for c in row) for row in rows)


# --------------------------------------------------------------------------- #
# the model
# --------------------------------------------------------------------------- #
def call_vision(api_key: "str | Reader", system: str, text: str, image: bytes, mime: str,
                extra: list[tuple[bytes, str]] | None = None) -> dict:
    return _vision_call(api_key, system, text, image, mime, extra=extra)


def call_text(api_key: "str | Reader", system: str, text: str) -> dict:
    """One JSON chat request (temperature 0: transcription, not writing). Tests replace this."""
    reader = api_key if isinstance(api_key, Reader) else Reader(MAIN_PROVIDER, api_key)

    def once(r: Reader) -> dict:
        if r.provider == GROQ:
            return groq_chat(r.key, system, text, max_tokens=8000, timeout=120)
        body = {"model": MODEL, "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}],
                "thinking": {"type": "disabled"}, "temperature": 0, "max_tokens": 8000,
                "response_format": {"type": "json_object"}}
        return post_chat(ENDPOINT, r.key, body, timeout=120, limit=800_000)

    try:
        return with_backup(reader, once)
    except ProviderError as exc:
        if exc.kind == "garbled":
            raise ReadError("Couldn't make sense of that file. Try again.", 502) from exc
        raise ReadError("Couldn't read that file right now. Try again in a minute, or add the games by hand.", 502) from exc


def _context(user: User, heroes: dict[str, str]) -> dict:
    return {"player": user.ign or user.name, "player_account_name": user.name, "main_lane": user.main_role or None,
            "hero_names": sorted(heroes.values())}


# --------------------------------------------------------------------------- #
# file → games
# --------------------------------------------------------------------------- #
def extract(db: Session, user: User, url: str) -> dict:
    """Read one uploaded file. Returns cleaned games (not saved) and notes for the person."""
    path, name, ext = resolve(url)
    heroes = hero_names(db)
    checks: list[dict] = []
    raw_games: list[dict] = []
    used_ai = False
    source = "screenshot" if ext in IMAGE_EXT else "sheet" if ext in SHEET_EXT else "document"
    reply: dict = {}

    if ext in SHEET_EXT:
        rows = sheet_rows(path, ext)
        if not rows:
            raise ReadError("That spreadsheet is empty.")
        direct = table_games(rows)
        if direct is not None:
            raw_games = direct
            checks.append({"tone": "ok", "text": f"Read {len(direct)} {'row' if len(direct) == 1 else 'rows'} from the sheet."})
        else:
            used_ai = True
            prompt = {**_context(user, heroes), "kind": "table", "content": rows_text(rows)[:MAX_TEXT]}
            reply = call_text(reader_key(db, user), SYSTEM, json.dumps(prompt, ensure_ascii=False))
    elif ext in DOC_EXT:
        text = pdf_text(path) if ext == "pdf" else docx_text(path) if ext == "docx" else _decode(path.read_bytes())
        if not text.strip():
            raise ReadError("That document is empty.")
        if len(text) > MAX_TEXT:
            checks.append({"tone": "warn", "text": "Long document — only the first part was read. Split it if games are missing."})
        used_ai = True
        prompt = {**_context(user, heroes), "kind": "document", "content": text[:MAX_TEXT]}
        reply = call_text(reader_key(db, user), SYSTEM, json.dumps(prompt, ensure_ascii=False))
    else:
        raw_bytes = path.read_bytes()
        image, mime = prepare_image(raw_bytes, IMAGE_EXT[ext])
        used_ai = True
        api_key = reader_key(db, user)
        help_ = portrait_help(raw_bytes, sorted(heroes.values()))
        if help_.image:
            image, mime = help_.image, "image/jpeg"
        prompt = {**_context(user, heroes), "kind": "screenshot", **help_.hints()}
        reply = call_vision(api_key, SYSTEM, json.dumps(prompt, ensure_ascii=False), image, mime,
                            extra=[(help_.sheet, "image/png")] if help_.sheet else None)
        if isinstance(reply, dict) and isinstance(reply.get("games"), list):
            # each game's hero re-checked at its own portrait (a history list repeats heroes: not unique)
            checks.extend(check_rows(raw_bytes, [g for g in reply["games"] if isinstance(g, dict)],
                                     sorted(heroes.values()), matches=help_.matches, unique=False))
        if help_.matches:
            seen = ", ".join(m.hero for m in help_.matches[:10])
            checks.append({"tone": "ok", "text": f"Recognised from the portraits: {seen}."})

    if used_ai:
        raw_games = [g for g in (reply.get("games") or []) if isinstance(g, dict)] if isinstance(reply.get("games"), list) else []
        if reply.get("player_found") is False and not raw_games:
            checks.append({"tone": "warn", "text": f"Couldn't find {user.ign or user.name} in that file — "
                                                   "is your in-game name the same as your profile IGN?"})
        for note in (reply.get("notes") or [])[:5] if isinstance(reply.get("notes"), list) else []:
            if isinstance(note, str) and note.strip():
                checks.append({"tone": "info", "text": note.strip()[:200]})

    games = [g for g in (clean_game(r, heroes) for r in raw_games[:MAX_GAMES]) if g]
    skipped = len(raw_games[:MAX_GAMES]) - len(games)
    if len(raw_games) > MAX_GAMES:
        checks.append({"tone": "warn", "text": f"Only the first {MAX_GAMES} games were read from this file."})
    if skipped:
        checks.append({"tone": "warn", "text": f"{skipped} {'row' if skipped == 1 else 'rows'} had no hero or result and "
                                               f"{'was' if skipped == 1 else 'were'} skipped."})
    # A single game from a screenshot with no date is the game just played.
    if source == "screenshot" and len(games) == 1 and games[0]["played_on"] is None:
        games[0]["played_on"] = utcnow().date()
        checks.append({"tone": "info", "text": "No date on the screenshot — dated today."})
    unknown = sorted({g["hero"] for g in games if g["hero"] and g["hero"] not in heroes.values()})
    if unknown:
        checks.append({"tone": "warn", "text": f"Not in our hero list: {', '.join(unknown[:5])} — check the spelling."})
    if not games and not any(c["tone"] == "warn" for c in checks):
        checks.append({"tone": "warn", "text": "No games found in that file. Use a match-history screen, a post-match "
                                               "scoreboard, or a sheet with hero / result / K / D / A columns."})
    return {"file": name, "source": source, "read_directly": not used_ai, "games": games, "checks": checks}
