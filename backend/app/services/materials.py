"""Materials engine: sections, progress, study XP and the playtime bank.

Everything a player earns here is decided by the **server**:

* Study XP is written to ``study_xp_ledger`` with a unique reason key, so opening
  the same section a hundred times pays exactly once.
* Playtime is a per-day bank on ``playtime_balances``; the game may only consume
  what is there, and the credited time of a run is clamped by the server clock.
* Reading progress is idempotent: revisiting a section updates position, never
  the reward.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    Material,
    MaterialBookmark,
    MaterialConfusion,
    MaterialFeedback,
    MaterialHighlight,
    MaterialNote,
    MaterialPost,
    MaterialProgress,
    MaterialQuestion,
    MaterialSection,
    MaterialVersion,
    PlaytimeBalance,
    Question,
    Student,
    StudySession,
    StudyStreak,
    StudyXpLedger,
    utcnow,
)

# --------------------------------------------------------------------- tuning
STUDY_XP = {
    "start": 10,
    "section": 8,
    "completion": 25,
    "check": 20,
    "linked_quiz": 30,
    "flashcards": 15,
    "discussion": 5,
    "confusion_resolved": 15,
}
PLAYTIME_XP_THRESHOLDS = [100, 200, 350, 500]  # cumulative study XP → more time
PLAYTIME_PER_THRESHOLD = 10 * 60  # seconds granted per threshold
PLAYTIME_START_BONUS = 5 * 60  # a first taste of the game each day
PLAYTIME_DAILY_CAP = 45 * 60  # hard ceiling, however much they grind
PLAYTIME_COMPLETION_BONUS = 5 * 60  # finishing a material
PLAYTIME_MISSION_BONUS = 10 * 60  # the daily mission
SECTION_REWARD_MIN_SECONDS = 12  # time-on-section before it counts as read
COMPLETION_MIN_FRACTION = 0.6  # sections visited for "meaningful completion"
HIGHLIGHT_COLOURS = {"yellow", "blue", "green", "red"}


def today() -> date:
    return utcnow().date()


def _loads(raw: str | None, fallback: Any) -> Any:
    try:
        value = json.loads(raw or "")
    except (TypeError, ValueError):
        return fallback
    return value if value is not None else fallback


def _dumps(value: Any) -> str:
    return json.dumps(value, default=str)


# ------------------------------------------------------------------ material io
def tag_list(raw: str | None) -> list[str]:
    return [str(tag).strip() for tag in _loads(raw, []) if str(tag).strip()][:24]


def summary_points(raw: str | None) -> list[str]:
    return [str(point).strip() for point in _loads(raw, []) if str(point).strip()][:12]


def material_public(material: Material, *, sections: list[MaterialSection] | None = None, full: bool = False) -> dict:
    rows = sections if sections is not None else list(material.sections)
    base = {
        "id": material.id,
        "course_id": material.course_id,
        "quiz_id": material.quiz_id,
        "title": material.title,
        "kind": getattr(material, "kind", "material") or "material",
        "parent_id": getattr(material, "parent_id", None),
        "link_url": getattr(material, "link_url", "") or "",
        "topic": material.topic,
        "subtopic": material.subtopic,
        "description": material.description,
        "difficulty": material.difficulty,
        "estimated_minutes": material.estimated_minutes,
        "tags": tag_list(material.tags),
        "summary": summary_points(material.summary),
        "author": material.author,
        "status": material.status,
        "version": material.version,
        "icon": material.icon,
        "accent": material.accent,
        "allow_discussion": bool(material.allow_discussion),
        "section_count": len(rows),
        "views": material.views,
        "starts": material.starts,
        "completions": material.completions,
        "created_at": material.created_at.isoformat() if material.created_at else None,
        "updated_at": material.updated_at.isoformat() if material.updated_at else None,
        "published_at": material.published_at.isoformat() if material.published_at else None,
    }
    base["sections"] = [section_public(row, with_body=full) for row in rows]
    return base


BLOCK_TYPES = {
    "heading",
    "subheading",
    "paragraph",
    "list",
    "numbers",
    "table",
    "image",
    "note",
    "example",
    "definition",
    "keyterm",
    "tip",
    "summary",
    "reference",
    "quote",
    "video",
    "divider",
    "attachment",
}


def section_public(section: MaterialSection, *, with_body: bool = True) -> dict:
    data = {
        "id": section.id,
        "material_id": section.material_id,
        "position": section.position,
        "title": section.title,
        "estimated_minutes": section.estimated_minutes,
        "check_enabled": bool(section.check_enabled),
        "updated_at": section.updated_at.isoformat() if section.updated_at else None,
    }
    if with_body:
        data["blocks"] = sanitise_blocks(_loads(section.body, []))
    else:
        data["words"] = len(re.sub(r"<[^>]+>", " ", _blocks_text(_loads(section.body, []))).split())
    return data


def _blocks_text(blocks: list[Any]) -> str:
    parts: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        for key in ("text", "title", "caption", "url", "term", "meaning"):
            value = block.get(key)
            if isinstance(value, str):
                parts.append(value)
        for key in ("items", "rows", "bullets"):
            value = block.get(key)
            if isinstance(value, list):
                parts.extend(str(item) for item in value)
    return " ".join(parts)


_TAG_RE = re.compile(r"<[^>]+>")
_DANGEROUS = re.compile(r"(?i)<\s*(script|style|iframe|object|embed|link|meta)\b")


def clean_text(value: Any, limit: int = 8000) -> str:
    """Strip HTML rather than trust it — the reader renders plain text only."""
    text = _DANGEROUS.sub("", str(value or ""))
    text = _TAG_RE.sub(" ", text)
    text = re.sub(r"\s+\n", "\n", text)
    return text.strip()[:limit]


def sanitise_blocks(raw: Any) -> list[dict]:
    """Validate a section body into safe, typed blocks the reader understands."""
    if not isinstance(raw, list):
        return []
    blocks: list[dict] = []
    for entry in raw[:400]:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("type") or "paragraph").lower()
        if kind not in BLOCK_TYPES:
            kind = "paragraph"
        block: dict[str, Any] = {"type": kind}
        if kind in {"list", "numbers"}:
            items = entry.get("items") or []
            block["items"] = [clean_text(item, 400) for item in items if str(item).strip()][:40]
            # numbering as written in the notes: 1. / (a) / a) / i. / (iv) / A. / I. — and nesting
            if kind == "numbers" and entry.get("style") in {"lower-alpha", "upper-alpha", "lower-roman", "upper-roman"}:
                block["style"] = entry["style"]
            if kind == "numbers" and entry.get("wrap") in {"paren", "rparen"}:
                block["wrap"] = entry["wrap"]
            if kind == "numbers" and str(entry.get("start", "")).isdigit() and 1 < int(entry["start"]) <= 999:
                block["start"] = int(entry["start"])
            if str(entry.get("level", "")).isdigit() and 0 < int(entry["level"]) <= 2:
                block["level"] = int(entry["level"])
        elif kind == "table":
            rows = entry.get("rows") or []
            block["rows"] = [[clean_text(cell, 200) for cell in row][:8] for row in rows if isinstance(row, list)][:40]
            block["head"] = [clean_text(cell, 200) for cell in (entry.get("head") or [])][:8]
        elif kind == "keyterm":
            block["term"] = clean_text(entry.get("term"), 120)
            block["meaning"] = clean_text(entry.get("meaning"), 600)
        elif kind in {"image", "attachment"}:
            block["url"] = clean_text(entry.get("url"), 500)
            block["caption"] = clean_text(entry.get("caption"), 200)
        elif kind == "video":
            block["url"] = clean_text(entry.get("url"), 500)
            block["title"] = clean_text(entry.get("title"), 160)
        elif kind == "divider":
            pass
        else:
            block["text"] = clean_text(entry.get("text"), 6000)
            if entry.get("title") and kind in {"note", "example", "tip", "summary", "definition", "reference", "quote"}:
                block["title"] = clean_text(entry.get("title"), 160)
        blocks.append(block)
    return regroup_points(blocks)


# ------------------------------------------------------------------ points
# Notes pasted or saved as plain paragraphs often carry their own numbering:
#   "1 Name of the court: …" / "2 The appeal number." / "(a) it must be …" / "(iv) …"
# ``regroup_points`` turns runs of such paragraphs into real numbered lists (keeping
# the style, brackets and start number), so the reader shows points, not prose.
_POINT = re.compile(r"^\s*(\()?(\d{1,3}|[A-Za-z]|[ivxlcIVXLC]{2,6})([.)])?\s+(\S[\s\S]*)$")
_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}
_POINT_TEXT_TYPES = {"paragraph"}


def _roman(token: str) -> int:
    total, prev = 0, 0
    for ch in reversed(token.lower()):
        value = _ROMAN_VALUES.get(ch, 0)
        total = total - value if value < prev else total + value
        prev = max(prev, value)
    return total


def parse_point(text: str, prev: dict | None = None) -> dict | None:
    """The numbering at the start of a paragraph, or None if it is ordinary prose."""
    match = _POINT.match(text or "")
    if not match:
        return None
    opened, token, close, rest = match.groups()
    rest = rest.strip()
    if opened and close != ")":
        return None
    if not close and not opened:
        # bare number: "5 A boy" is a point; "2011 Evidence Act" / "5 boys came" are not
        if not (token.isdigit() and 1 <= int(token) <= 99 and re.match(r"[A-Z(\"“‘']", rest)):
            return None
    wrap = "paren" if opened else ("rparen" if close == ")" else "dot")
    if token.isdigit():
        return {"style": "decimal", "wrap": wrap, "value": int(token), "text": rest}
    if re.match(r"^[A-Z]\.\s", rest) or not (token.islower() or token.isupper()):
        return None  # initials "A. B. Okafor", or a word
    if wrap == "dot" and len(token) == 1 and token.isupper() and not re.search(r"[.:;?!]", rest):
        return None  # "A. Meaning of a Brief" — a lettered heading, left alone
    lower = token.islower()
    alpha, roman = f"{'lower' if lower else 'upper'}-alpha", f"{'lower' if lower else 'upper'}-roman"
    same = bool(prev and prev["wrap"] == wrap)
    if len(token) == 1:
        letter = ord(token.lower()) - 96
        if same and prev["style"] == alpha and letter == prev["value"] + 1:
            return {"style": alpha, "wrap": wrap, "value": letter, "text": rest}
        if token.lower() in _ROMAN_VALUES and ((same and prev["style"] == roman and _roman(token) == prev["value"] + 1) or token.lower() == "i"):
            return {"style": roman, "wrap": wrap, "value": _roman(token), "text": rest}
        return {"style": alpha, "wrap": wrap, "value": letter, "text": rest}
    if re.fullmatch(r"[ivxlc]+", token.lower()) and _roman(token) > 0:
        return {"style": roman, "wrap": wrap, "value": _roman(token), "text": rest}
    return None


def _split_point_lines(text: str) -> list[str]:
    """One paragraph holding "1 …\n2 …\n3 …" becomes one piece per point."""
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if len(lines) < 2:
        return [text]
    pieces: list[str] = []
    last: dict | None = None
    for line in lines:
        point = parse_point(line, last)
        # A point starts a new piece only after a finished sentence, a short title
        # ("Contents of a Brief"), or as the next number — never mid-sentence
        # ("…swear within / 14 Days of the order").
        follows = bool(last and point and point["style"] == last["style"] and point["wrap"] == last["wrap"] and point["value"] == last["value"] + 1)
        opens = bool(point) and bool(pieces) and (follows or re.search(r"[.:;?!)]$", pieces[-1]) or _short_title(pieces[-1]))
        if opens or not pieces:
            pieces.append(line)
            last = point if opens or (not pieces[:-1] and point) else last
        else:
            pieces[-1] = f"{pieces[-1]} {line}"  # a wrapped line belongs to the piece above
    return pieces


def _short_title(text: str) -> bool:
    words = re.findall(r"[A-Za-z][\w'’-]*", text)
    if words and words[-1].lower() in _TRAILING_WORDS:
        return False  # "…must swear within" is a sentence running on, not a title
    return 1 <= len(words) <= 8 and len(text) <= 70 and not re.search(r"[.,;:?!]$", text) and text[:1].isupper() and not parse_point(text)


_TRAILING_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "than", "that", "the",
    "to", "with", "within", "under", "be", "are", "was", "were", "which", "who", "not", "but", "if", "after", "before",
}


def regroup_points(blocks: list[dict]) -> list[dict]:
    expanded: list[dict] = []
    for block in blocks:
        if block["type"] in _POINT_TEXT_TYPES and "\n" in block.get("text", ""):
            pieces = _split_point_lines(block["text"])
            for index, piece in enumerate(pieces):
                # the title line in front of the points reads as a subheading
                title = len(pieces) > 1 and index == 0 and _short_title(piece) and parse_point(pieces[1])
                expanded.append({"type": "subheading", "text": piece} if title else {**block, "text": piece})
        else:
            expanded.append(block)

    out: list[dict] = []
    stack: list[tuple] = []  # nesting of point styles in the current run
    last: dict | None = None  # the last point seen in this run
    by_family: dict[tuple, dict] = {}
    for block in expanded:
        point = parse_point(block.get("text", ""), last) if block["type"] in _POINT_TEXT_TYPES else None
        if not point:
            out.append(block)
            if block["type"] == "numbers" and block.get("items"):
                key = (block.get("style", "decimal"), block.get("wrap", "dot"))
                stack[:] = [key]
                last = {"style": key[0], "wrap": key[1], "value": block.get("start", 1) + len(block["items"]) - 1}
                by_family = {key: last}
            else:
                stack.clear()
                last, by_family = None, {}
            continue
        key = (point["style"], point["wrap"])
        prev = by_family.get(key)
        tail = out[-1] if out else None
        if prev and tail and tail["type"] == "numbers" and (tail.get("style", "decimal"), tail.get("wrap", "dot")) == key and point["value"] == prev["value"] + 1:
            tail["items"].append(point["text"])  # the next point of the open list
        else:
            if key in stack:
                del stack[stack.index(key) + 1 :]
            else:
                stack.append(key)
            fresh: dict[str, Any] = {"type": "numbers", "items": [point["text"]]}
            if point["style"] != "decimal":
                fresh["style"] = point["style"]
            if point["wrap"] != "dot":
                fresh["wrap"] = point["wrap"]
            if point["value"] > 1:
                fresh["start"] = point["value"]
            level = min(len(stack) - 1, 2)
            if level:
                fresh["level"] = level
            out.append(fresh)
        last = point
        by_family[key] = point
    return out


def record_version(db: Session, material: Material, *, note: str, author: str) -> MaterialVersion:
    # Read sections fresh from the session: the relationship collection can be
    # stale right after an edit, and a stale snapshot would make "restore" lie.
    db.flush()
    fresh = list(
        db.scalars(select(MaterialSection).where(MaterialSection.material_id == material.id).order_by(MaterialSection.position)).all()
    )
    snapshot = material_public(material, sections=fresh, full=True)
    row = MaterialVersion(
        material_id=material.id,
        version=material.version,
        snapshot=_dumps(snapshot)[:4_000_000],
        note=note[:200],
        author=author[:120],
    )
    db.add(row)
    return row


# -------------------------------------------------------------------- progress
def get_progress(db: Session, material_id: int, student_id: int) -> MaterialProgress | None:
    return db.scalar(
        select(MaterialProgress).where(
            MaterialProgress.material_id == material_id, MaterialProgress.student_id == student_id
        )
    )


def ensure_progress(db: Session, material: Material, student_id: int) -> MaterialProgress:
    row = get_progress(db, material.id, student_id)
    if row is None:
        row = MaterialProgress(material_id=material.id, student_id=student_id, visited="[]")
        db.add(row)
        db.flush()
        material.starts = (material.starts or 0) + 1
    return row


def progress_public(row: MaterialProgress | None, total_sections: int) -> dict:
    if row is None:
        return {
            "status": "new",
            "percent": 0,
            "visited": [],
            "sections_done": 0,
            "total_sections": total_sections,
            "last_section_id": None,
            "last_section_position": 1,
            "seconds_spent": 0,
            "completed_at": None,
        }
    visited = [int(value) for value in _loads(row.visited, []) if str(value).isdigit()]
    return {
        "status": row.status,
        "percent": row.percent,
        "visited": visited,
        "sections_done": len(visited),
        "total_sections": total_sections,
        "last_section_id": row.last_section_id,
        "last_section_position": row.last_section_position,
        "seconds_spent": row.seconds_spent,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def award_study_xp(
    db: Session,
    student: Student,
    *,
    amount: int,
    reason: str,
    reason_key: str,
) -> dict:
    """Pay Study XP once per reason key, then feed the playtime bank."""
    key = reason_key[:120]
    existing = db.scalar(
        select(StudyXpLedger.id).where(StudyXpLedger.student_id == student.id, StudyXpLedger.reason_key == key)
    )
    if existing:
        return {"awarded": 0, "reason": reason, "duplicate": True}
    db.add(StudyXpLedger(student_id=student.id, amount=amount, reason=reason, reason_key=key, day=today()))
    # Study XP is XP the player can see, so it climbs the season ladder too.
    from ..game import award_xp

    award_xp(db, student, amount)
    bank = playtime_for(db, student.id)
    bank.study_xp = (bank.study_xp or 0) + amount
    bank.updated_at = utcnow()
    unlocked = apply_playtime_thresholds(db, student.id, bank)
    return {"awarded": amount, "reason": reason, "playtime_unlocked": unlocked, "study_xp_today": bank.study_xp}


def playtime_for(db: Session, student_id: int, day: date | None = None) -> PlaytimeBalance:
    target = day or today()
    row = db.scalar(
        select(PlaytimeBalance).where(PlaytimeBalance.student_id == student_id, PlaytimeBalance.day == target)
    )
    if row is None:
        row = PlaytimeBalance(
            student_id=student_id,
            day=target,
            earned_seconds=PLAYTIME_START_BONUS,
            used_seconds=0,
            study_xp=0,
            claimed_thresholds="[]",
            bonus_keys=_dumps(["daily_start"]),
        )
        db.add(row)
        db.flush()
    return row


def _bank_view(bank: PlaytimeBalance) -> dict:
    remaining = max(0, (bank.earned_seconds or 0) - (bank.used_seconds or 0))
    return {
        "day": bank.day.isoformat() if bank.day else None,
        "earned_seconds": bank.earned_seconds or 0,
        "used_seconds": bank.used_seconds or 0,
        "remaining_seconds": remaining,
        "study_xp_today": bank.study_xp or 0,
        "cap_seconds": PLAYTIME_DAILY_CAP,
        "thresholds": PLAYTIME_XP_THRESHOLDS,
        "seconds_per_threshold": PLAYTIME_PER_THRESHOLD,
    }


def apply_playtime_thresholds(db: Session, student_id: int, bank: PlaytimeBalance) -> list[int]:
    """Grant any cumulative Study-XP thresholds the player has now passed."""
    claimed = [int(value) for value in _loads(bank.claimed_thresholds, []) if str(value).isdigit()]
    granted: list[int] = []
    for threshold in PLAYTIME_XP_THRESHOLDS:
        if threshold in claimed or (bank.study_xp or 0) < threshold:
            continue
        claimed.append(threshold)
        granted.append(threshold)
    if granted:
        extra = PLAYTIME_PER_THRESHOLD * len(granted)
        bank.earned_seconds = min(
            PLAYTIME_DAILY_CAP,
            (bank.earned_seconds or 0) + extra,
        )
        bank.claimed_thresholds = _dumps(sorted(claimed))
        bank.updated_at = utcnow()
    return granted


def grant_bonus_playtime(db: Session, student_id: int, *, seconds: int, key: str) -> bool:
    """One-off bonus for the day (material completion, daily mission)."""
    bank = playtime_for(db, student_id)
    keys = [str(value) for value in _loads(bank.bonus_keys, [])]
    if key in keys:
        return False
    keys.append(key)
    bank.bonus_keys = _dumps(keys[-40:])
    bank.earned_seconds = min(PLAYTIME_DAILY_CAP, (bank.earned_seconds or 0) + seconds)
    bank.updated_at = utcnow()
    return True


# --------------------------------------------------------------------- streak
def touch_streak(db: Session, student_id: int, seconds: int) -> dict:
    row = db.scalar(select(StudyStreak).where(StudyStreak.student_id == student_id))
    if row is None:
        row = StudyStreak(student_id=student_id, current=0, best=0)
        db.add(row)
        db.flush()
    today_ = today()
    if row.day == today_:
        row.seconds_today = (row.seconds_today or 0) + seconds
    else:
        # Consecutive day → grow; a gap resets to 1 (no shaming, just maths).
        if row.day == today_ - timedelta(days=1) and (row.seconds_today or 0) >= 60:
            row.current = (row.current or 0) + 1
        elif row.day != today_:
            row.current = 1 if seconds > 0 else row.current
        row.best = max(row.best or 0, row.current or 0)
        row.day = today_
        row.seconds_today = max(0, seconds)
    row.updated_at = utcnow()
    return {"current": row.current, "best": row.best, "seconds_today": row.seconds_today}


def streak_public(db: Session, student_id: int) -> dict:
    row = db.scalar(select(StudyStreak).where(StudyStreak.student_id == student_id))
    if row is None:
        return {"current": 0, "best": 0, "seconds_today": 0, "day": None}
    # A streak that was not extended yesterday is shown as broken (not extended).
    stale = row.day is not None and row.day < today() - timedelta(days=1)
    return {
        "current": 0 if stale else (row.current or 0),
        "best": row.best or 0,
        "seconds_today": row.seconds_today if row.day == today() else 0,
        "day": row.day.isoformat() if row.day else None,
    }


# ---------------------------------------------------------------- self-test quiz
def material_questions(db: Session, material: Material, *, section_id: int | None = None) -> list[Question]:
    """Questions linked to the material, falling back to its topic/course."""
    stmt = select(Question).join(MaterialQuestion, MaterialQuestion.question_id == Question.id).where(
        MaterialQuestion.material_id == material.id
    )
    if section_id:
        stmt = stmt.where(MaterialQuestion.section_id == section_id)
    rows = list(db.scalars(stmt).all())
    if rows:
        return rows
    # Fall back to the topic (then the course) so a fresh material still has
    # something to test, and finally to the wider bank as revision.
    base = select(Question).where(Question.status == "approved", Question.source_id.is_(None), Question.exam_only.is_(False))
    if material.topic:
        rows = list(db.scalars(base.where(func.lower(Question.topic) == material.topic.lower()).limit(60)).all())
        if rows:
            return rows
    if material.course_id:
        rows = list(db.scalars(base.where(Question.course_id == material.course_id).limit(60)).all())
        if rows:
            return rows
    return list(db.scalars(base.limit(60)).all())
