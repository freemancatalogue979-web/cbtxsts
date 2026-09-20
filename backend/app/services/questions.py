"""Question bank engine — one authoritative answer path for the whole arena.

Everything that reads, writes, imports, exports, copies, shuffles, searches or
grades a question goes through this module so ``Question.correct`` can never
drift:

* :func:`normalize_answer` converts an administrator's answer into the canonical
  stored form (``"A"`` … ``"D"``, or sorted keys such as ``"AC"``) and *refuses*
  to invent a value. Invalid input raises :class:`AnswerValidationError`.
* :func:`parse_question_blocks` reads pasted papers (``Answer:``, ``Correct:``,
  ``Key:``, case-insensitive) and returns both the parsed questions **and** a
  per-question validation report — nothing silently falls back to ``A``.
* :func:`apply_question_fields` writes every supported property and snapshots
  the previous state into ``question_versions``.
* :func:`display_order` implements option shuffling without ever touching the
  stored answer: it only reports where each canonical key is shown.
"""
from __future__ import annotations

import csv
import io
import json
import re
from typing import Any, Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    Answer,
    AuditLog,
    Question,
    QuestionFlag,
    QuestionVersion,
    Quiz,
    Student,
    utcnow,
)

LETTERS = ("A", "B", "C", "D")
ANSWER_RE = re.compile(r"^[A-D]{1,4}$")
DIFFICULTIES = ("easy", "medium", "hard")
STATUSES = ("draft", "approved", "rejected", "archived")
QUESTION_TYPES = (
    "mcq",
    "true_false",
    "multi_select",
    "fill_blank",
    "short_answer",
    "matching",
    "ordering",
    "image_choice",
    "audio",
    "scenario",
    "passage",
    "assertion_reason",
)
MULTI_ANSWER_TYPES = ("multi_select", "ordering", "matching")

# Fields an administrator may set on a question (PATCH semantics, every one of
# them persists — no field is silently dropped).
EDITABLE_FIELDS = (
    "text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct",
    "explanation",
    "points",
    "difficulty",
    "position",
    "question_type",
    "topic",
    "subtopic",
    "objective",
    "tags",
    "source",
    "reference",
    "author",
    "hint",
    "admin_notes",
    "media",
    "content",
    "status",
    "visible",
    "flag_reason",
    "order_locked",
    "flashcard_enabled",
    "duel_enabled",
    "practice_enabled",
    "time_limit_seconds",
    "quiz_id",
    "course_id",
)

SNAPSHOT_FIELDS = EDITABLE_FIELDS + ("source_id", "version")


class AnswerValidationError(ValueError):
    """Raised when an answer cannot be trusted — never silently repaired."""

    def __init__(self, message: str, *, index: int | None = None, field: str = "correct") -> None:
        super().__init__(message)
        self.message = message
        self.index = index
        self.field = field


# ---------------------------------------------------------------------------
# Canonical answer handling
# ---------------------------------------------------------------------------
def normalize_answer(raw: Any, *, allow_multi: bool = False, options: dict[str, str] | None = None) -> str:
    """Return the canonical stored answer for ``raw``.

    Accepts ``"c"``, ``"C"``, ``" c "`` and (for multi-answer types) ``"C,A"``.
    When ``options`` is supplied it also accepts the **actual answer text**
    (``"Savigny"``) and resolves it to the option's canonical key — the safe
    form for uploads, because it stays correct no matter how options are later
    shuffled for display. An ambiguous text (two identical options) or anything
    unrecognised is rejected with a message an administrator can act on. There
    is no default.
    """
    if raw is None:
        raise AnswerValidationError("No correct answer supplied — every question needs one.")
    text = str(raw).strip().upper()
    if not text:
        raise AnswerValidationError("No correct answer supplied — every question needs one.")
    if text in {"TRUE", "T"}:
        text = "A"
    elif text in {"FALSE", "F"}:
        text = "B"
    text = text.replace(" ", "")
    if "," in text:
        parts = [part for part in text.split(",") if part]
        if not allow_multi:
            raise AnswerValidationError(f"“{raw}” is not a single A/B/C/D answer.")
        if any(part not in LETTERS for part in parts):
            raise AnswerValidationError(f"“{raw}” contains an option that is not A, B, C or D.")
        if len(set(parts)) != len(parts):
            raise AnswerValidationError(f"“{raw}” repeats an option.")
        cleaned = "".join(sorted(set(parts)))
    else:
        if len(text) > 1 and allow_multi and all(char in LETTERS for char in text):
            cleaned = "".join(sorted(set(text)))
        else:
            if not ANSWER_RE.match(text):
                resolved = _resolve_answer_text(raw, options)
                if resolved is not None:
                    return resolved
                raise AnswerValidationError(
                    f"“{raw}” is not a valid answer — use A, B, C or D"
                    + (" (or several, e.g. A,C)" if allow_multi else "")
                    + ", or the exact text of the correct option."
                )
            cleaned = text
    if not allow_multi and len(cleaned) != 1:
        raise AnswerValidationError(f"“{raw}” is not a single A/B/C/D answer.")
    if options is not None:
        missing = [key for key in cleaned if not (options.get(key) or "").strip()]
        if missing:
            raise AnswerValidationError(
                f"The correct answer points at option {', '.join(missing)}, but that option is blank."
            )
    return cleaned


def _resolve_answer_text(raw: Any, options: dict[str, str] | None) -> str | None:
    """Match the full answer text against the option texts (case-insensitive).

    Returns the canonical key of the unique option whose text equals ``raw``.
    Returns ``None`` when there is no match (caller reports the usual error)
    and raises when the text matches more than one option — an ambiguous
    answer must never be silently pinned to the first hit.
    """
    if not options:
        return None
    needle = str(raw).strip().casefold()
    if not needle:
        return None
    matches = [key for key in LETTERS if (options.get(key) or "").strip().casefold() == needle]
    if len(matches) > 1:
        raise AnswerValidationError(
            f"“{raw}” matches more than one option ({', '.join(matches)}) — give the letter instead."
        )
    return matches[0] if matches else None


def answer_matches(stored: str, selected: str | None) -> bool:
    """Server-side grading primitive — compares canonical keys only."""
    if not selected:
        return False
    given = str(selected).strip().upper()
    key = (stored or "").strip().upper()
    if not key:
        return False
    if len(key) == 1:
        return given == key
    if "," in given:
        given = "".join(sorted({part for part in given.split(",") if part}))
    return given == key


def parse_answer_line(line: str) -> tuple[str, str] | None:
    """``"Correct: c"`` → ``("correct", "C")``. Returns None when not an answer line."""
    match = re.match(r"^(?:answer|answers|correct|correct answer|key|ans|answerkey)\s*[:\-–)\].=]?\s*(.+)$", line.strip(), re.I)
    if not match:
        return None
    return "answer", match.group(1).strip()


# ---------------------------------------------------------------------------
# Bulk paste import
# ---------------------------------------------------------------------------
def _clean_question_text(line: str) -> str:
    return re.sub(r"^(?:q(?:uestion)?\s*\d+\s*[.)\-:]|\d+\s*[.)\-:])\s*", "", line.strip(), flags=re.I).strip()


def parse_question_blocks(
    raw: str,
    *,
    default_points: int = 1,
    default_difficulty: str = "medium",
    default_type: str = "mcq",
) -> dict[str, Any]:
    """Parse a pasted paper into questions plus a validation report.

    Each block is separated by a blank line. Recognised option lines are
    ``A.``/``A)``/``A-``/``A:``; recognised answer lines are ``Answer:``,
    ``Correct:`` and ``Key:`` (case-insensitive). The answer itself may be a
    letter (``Answer: B``) **or the exact text of the correct option**
    (``Answer: Savigny``) — the text form resolves to the option's canonical
    key, so it stays correct however options are shuffled for display. A
    question whose answer line cannot be trusted is **rejected with a reason**
    — it is never defaulted to ``A``.
    """
    blocks = [block.strip() for block in re.split(r"\n\s*\n", raw or "") if block.strip()]
    parsed: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    for index, block in enumerate(blocks, start=1):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        options: dict[str, str] = {}
        text_parts: list[str] = []
        answer_raw: str | None = None
        explanation = ""
        points: int | None = None
        difficulty: str | None = None
        topic = ""
        tags: list[str] = []
        number: int | None = None

        first = lines[0] if lines else ""
        number_match = re.match(r"^(?:q(?:uestion)?\s*)?(\d+)\s*[.)\-:]", first, re.I)
        if number_match:
            number = int(number_match.group(1))

        for line in lines:
            option_match = re.match(r"^\(?([A-Da-d])\)?\s*[.)\-:]\s*(.+)$", line)
            answer_line = parse_answer_line(line)
            why_match = re.match(r"^(?:explanation|reason|why|note|solution)\s*[:\-–)\].]?\s*(.+)$", line, re.I)
            points_match = re.match(r"^(?:points?|marks?|score)\s*[:\-–)\].]?\s*(\d+)\s*$", line, re.I)
            difficulty_match = re.match(r"^(?:difficulty|level)\s*[:\-–)\].]?\s*(easy|medium|hard)\s*$", line, re.I)
            topic_match = re.match(r"^(?:topic|subject)\s*[:\-–)\].]?\s*(.+)$", line, re.I)
            tags_match = re.match(r"^tags?\s*[:\-–)\].]?\s*(.+)$", line, re.I)

            if answer_line:
                answer_raw = answer_line[1]
            elif why_match:
                explanation = why_match.group(1).strip()
            elif points_match:
                points = int(points_match.group(1))
            elif difficulty_match:
                difficulty = difficulty_match.group(1).lower()
            elif topic_match:
                topic = topic_match.group(1).strip()
            elif tags_match:
                tags = [tag.strip() for tag in re.split(r"[,;]", tags_match.group(1)) if tag.strip()]
            elif option_match and option_match.group(1).upper() not in options:
                options[option_match.group(1).upper()] = option_match.group(2).strip()
            elif not text_parts:
                text_parts.append(_clean_question_text(line))
            elif len(text_parts) < 6 and not options:
                text_parts.append(line)

        text = " ".join(part for part in text_parts if part).strip()
        problems: list[str] = []
        if not text:
            problems.append("missing question text")
        if not options.get("A") or not options.get("B"):
            problems.append("needs at least options A and B")

        correct: str | None = None
        if answer_raw is None:
            problems.append("no Answer:/Correct:/Key: line")
        else:
            try:
                correct = normalize_answer(answer_raw, options=options)
            except AnswerValidationError as error:
                problems.append(str(error.message))

        if problems or correct is None:
            errors.append(
                {
                    "index": index,
                    "number": number,
                    "text": text[:160] or "(empty block)",
                    "answer": answer_raw,
                    "reasons": problems,
                }
            )
            continue

        if len(text) < 3:
            warnings.append({"index": index, "note": "Question text is very short."})
        letters = [key for key in LETTERS if options.get(key)]
        if options.get("C") is None and len(letters) == 2:
            warnings.append({"index": index, "note": "True/false shaped question (two options)."})

        parsed.append(
            {
                "number": number or index,
                "text": text,
                "option_a": options.get("A", ""),
                "option_b": options.get("B", ""),
                "option_c": options.get("C", ""),
                "option_d": options.get("D", ""),
                "correct": correct,
                "explanation": explanation,
                "points": points or default_points,
                "difficulty": difficulty or default_difficulty,
                "question_type": default_type,
                "topic": topic,
                "tags": tags,
            }
        )

    return {
        "questions": parsed,
        "errors": errors,
        "warnings": warnings,
        "detected": len(blocks),
        "ok": len(parsed),
        "rejected": len(errors),
    }


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------
def question_snapshot(question: Question) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for field in SNAPSHOT_FIELDS:
        value = getattr(question, field, None)
        if isinstance(value, (list, dict)):
            value = json.loads(json.dumps(value))
        snapshot[field] = value
    return snapshot


def question_admin_public(question: Question, *, stats: dict[str, Any] | None = None) -> dict[str, Any]:
    """Full question payload for the staff console (answer key included)."""
    options = {key: value for key, value in question.options.items() if (value or "").strip()}
    return {
        "id": question.id,
        "quiz_id": question.quiz_id,
        "course_id": question.course_id,
        "source_id": question.source_id,
        "drawn": bool(question.source_id),
        "position": question.position,
        "text": question.text,
        "options": options,
        "option_a": question.option_a,
        "option_b": question.option_b,
        "option_c": question.option_c,
        "option_d": question.option_d,
        "correct": question.correct,
        "answers": question.answer_keys,
        "explanation": question.explanation,
        "points": question.points,
        "difficulty": question.difficulty,
        "question_type": question.question_type,
        "topic": question.topic,
        "subtopic": question.subtopic,
        "objective": question.objective,
        "tags": list(question.tags or []),
        "source": question.source,
        "reference": question.reference,
        "author": question.author,
        "hint": question.hint,
        "admin_notes": question.admin_notes,
        "media": question.media or {},
        "content": question.content or {},
        "status": question.status,
        "visible": question.visible,
        "flagged": bool(question.flag_reason),
        "flag_reason": question.flag_reason,
        "flagged_by": question.flagged_by,
        "flagged_at": question.flagged_at.isoformat() + "Z" if question.flagged_at else None,
        "order_locked": question.order_locked,
        "flashcard_enabled": question.flashcard_enabled,
        "duel_enabled": question.duel_enabled,
        "practice_enabled": question.practice_enabled,
        "time_limit_seconds": question.time_limit_seconds,
        "version": question.version,
        "usage_count": question.usage_count,
        "correct_count": question.correct_count,
        "wrong_count": question.wrong_count,
        "success_rate": round(question.correct_count / question.usage_count * 100, 1) if question.usage_count else 0.0,
        "average_ms": int(question.total_ms / question.usage_count) if question.usage_count else 0,
        "created_at": question.created_at.isoformat() + "Z" if question.created_at else None,
        "updated_at": question.updated_at.isoformat() + "Z" if question.updated_at else None,
        "created_by": question.created_by,
        "updated_by": question.updated_by,
        "stats": stats or {},
    }


def question_student_public(
    question: Question,
    *,
    reveal: bool = False,
    order: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Player-facing payload.

    ``order`` is the *display* order of the canonical option keys. When option
    shuffling is on, the player sees ``A``…``D`` in that order while the server
    keeps ``Question.correct`` untouched — the letter a player submits is mapped
    back through this order before any comparison happens.
    """
    order = order or [key for key in LETTERS if (question.options.get(key) or "").strip()]
    display: dict[str, str] = {}
    label_to_key: dict[str, str] = {}
    for position, key in enumerate(order):
        label = LETTERS[position]
        display[label] = question.options.get(key, "")
        label_to_key[label] = key
    if not order:
        display = {key: value for key, value in question.options.items() if (value or "").strip()}
        label_to_key = {key: key for key in display}

    media = question.media or {}
    declared = question.content.get("option_media") if isinstance(question.content, dict) else None
    payload: dict[str, Any] = {
        "id": question.id,
        "position": question.position,
        "text": question.text,
        "options": display,
        "display_order": order,
        "points": question.points,
        "difficulty": question.difficulty,
        "question_type": question.question_type,
        "topic": question.topic,
        "subtopic": question.subtopic,
        "hint": question.hint,
        "media": media,
        "content": question.content or {},
        "time_limit_seconds": question.time_limit_seconds,
        "tags": list(question.tags or []),
        "drawn": bool(question.source_id),
        "status": question.status,
    }
    if isinstance(declared, dict):
        payload["option_media"] = declared
    if reveal:
        # The displayed correct letter — computed from the shuffle order, never
        # from a cached letter. This is what keeps shuffling honest.
        payload["correct"] = question.correct
        payload["correct_label"] = next(
            (label for label, key in label_to_key.items() if key in question.answer_keys), None
        )
        payload["explanation"] = question.explanation
        payload["answer_text"] = [question.options.get(key, "") for key in question.answer_keys]
    if extra:
        payload.update(extra)
    return payload


def display_order(question: Question, *, shuffle: bool, seed: str = "") -> list[str]:
    """Canonical option keys in display order.

    Deterministic per (seed, question) so a refresh shows the same paper, while
    still being different between players and between questions.
    """
    keys = [key for key in LETTERS if (question.options.get(key) or "").strip()]
    if not shuffle or len(keys) < 2:
        return keys
    import random

    pool = list(keys)
    random.Random(f"{seed}:{question.id}").shuffle(pool)
    return pool


def label_to_key(question: Question, order: Iterable[str], label: str | None) -> str | None:
    """Translate a player's display letter into the canonical option key."""
    if not label:
        return None
    text = str(label).strip().upper()
    if not text:
        return None
    ordered = list(order)
    if text in ordered and text in LETTERS:
        index = LETTERS.index(text)
        if index < len(ordered):
            return ordered[index]
        return None
    if text in ordered:  # already canonical (older clients)
        return text
    return text if text in LETTERS else None


# ---------------------------------------------------------------------------
# Writing questions
# ---------------------------------------------------------------------------
def _coerce_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, type(default)) else default
        except json.JSONDecodeError:
            return [item.strip() for item in value.split(",") if item.strip()] if isinstance(default, list) else default
    return default


def clean_tags(value: Any) -> list[str]:
    tags = _coerce_json(value, [])
    cleaned: list[str] = []
    for tag in tags:
        text = str(tag).strip()[:40]
        if text and text.lower() not in {item.lower() for item in cleaned}:
            cleaned.append(text)
    return cleaned[:24]


def validate_payload(
    data: dict[str, Any],
    *,
    existing: Question | None = None,
    require_answer: bool = True,
) -> dict[str, Any]:
    """Validate + normalise an incoming question payload.

    Returns the cleaned mapping. Raises :class:`AnswerValidationError` (or a
    plain ``ValueError``) instead of quietly substituting values.
    """
    cleaned: dict[str, Any] = {}

    if "text" in data:
        text = str(data.get("text") or "").strip()
        if len(text) < 3:
            raise ValueError("Question text must be at least 3 characters.")
        cleaned["text"] = text

    for key in ("option_a", "option_b", "option_c", "option_d"):
        if key in data:
            cleaned[key] = str(data.get(key) or "").strip()[:4000]

    for key in ("explanation", "hint", "admin_notes"):
        if key in data:
            cleaned[key] = str(data.get(key) or "").strip()[:8000]

    for key in ("topic", "subtopic", "objective", "source", "reference", "author", "flag_reason"):
        if key in data:
            cleaned[key] = str(data.get(key) or "").strip()[:240]

    if "tags" in data:
        cleaned["tags"] = clean_tags(data.get("tags"))

    if "media" in data:
        cleaned["media"] = _coerce_json(data.get("media"), {})
    if "content" in data:
        cleaned["content"] = _coerce_json(data.get("content"), {})

    if "question_type" in data:
        question_type = str(data.get("question_type") or "mcq").strip().lower()
        if question_type not in QUESTION_TYPES:
            raise ValueError(f"Unknown question type “{question_type}”.")
        cleaned["question_type"] = question_type

    if "difficulty" in data:
        difficulty = str(data.get("difficulty") or "medium").strip().lower()
        if difficulty not in DIFFICULTIES:
            raise ValueError("Difficulty must be easy, medium or hard.")
        cleaned["difficulty"] = difficulty

    if "status" in data:
        status = str(data.get("status") or "approved").strip().lower()
        if status not in STATUSES:
            raise ValueError("Status must be draft, approved, rejected or archived.")
        cleaned["status"] = status

    if "points" in data:
        try:
            points = int(data.get("points") or 1)
        except (TypeError, ValueError) as error:
            raise ValueError("Points must be a whole number.") from error
        cleaned["points"] = max(1, min(999, points))

    if "time_limit_seconds" in data:
        try:
            seconds = int(data.get("time_limit_seconds") or 0)
        except (TypeError, ValueError) as error:
            raise ValueError("Time limit must be a whole number of seconds.") from error
        cleaned["time_limit_seconds"] = max(0, min(7200, seconds))

    if "position" in data and data["position"] is not None:
        cleaned["position"] = max(0, int(data["position"]))

    for key in ("visible", "order_locked", "flashcard_enabled", "duel_enabled", "practice_enabled"):
        if key in data:
            cleaned[key] = bool(data[key])

    if "quiz_id" in data and data["quiz_id"] is not None:
        cleaned["quiz_id"] = int(data["quiz_id"])
    if "course_id" in data:
        cleaned["course_id"] = int(data["course_id"]) if data["course_id"] not in (None, "") else None

    merged = dict(data)
    if existing is not None:
        for field in ("text", "option_a", "option_b", "option_c", "option_d", "question_type"):
            if field not in cleaned:
                merged[field] = getattr(existing, field)
    question_type = str(cleaned.get("question_type") or merged.get("question_type") or "mcq")
    options = {
        "A": cleaned.get("option_a", merged.get("option_a", "")),
        "B": cleaned.get("option_b", merged.get("option_b", "")),
        "C": cleaned.get("option_c", merged.get("option_c", "")),
        "D": cleaned.get("option_d", merged.get("option_d", "")),
    }

    allow_multi = question_type in MULTI_ANSWER_TYPES
    if "correct" in data or require_answer:
        raw_answer = data.get("correct", getattr(existing, "correct", None) if existing else None)
        if raw_answer in (None, ""):
            if require_answer:
                raise AnswerValidationError("Every question needs a correct answer (A–D).")
            # An explicit attempt to blank the answer is an error, never a no-op:
            # silently keeping the old key would hide the mistake from staff.
            raise AnswerValidationError(
                "The correct answer cannot be cleared or left blank — choose A, B, C or D."
            )
        else:
            cleaned["correct"] = normalize_answer(raw_answer, allow_multi=allow_multi, options=options)
    elif existing is not None:
        cleaned["correct"] = normalize_answer(existing.correct, allow_multi=allow_multi, options=options)

    if question_type == "true_false" and options["A"] and options["B"] and not options["C"]:
        # keep the stored answer valid for the two-option shape
        if cleaned.get("correct") not in {"A", "B"}:
            raise AnswerValidationError("True/false questions must store A (true) or B (false).")

    return cleaned


def validate_saved_question(question: Question) -> str:
    """Final guard before commit: the stored answer must be trustworthy.

    Raises :class:`AnswerValidationError` when a question would be persisted
    with an answer that does not exist among its options — the one failure mode
    that could ever make an exam unfair.
    """
    options = {key: value for key, value in question.options.items()}
    answer = normalize_answer(
        question.correct,
        allow_multi=question.question_type in MULTI_ANSWER_TYPES,
        options=options,
    )
    if question.question_type == "true_false" and answer not in {"A", "B"}:
        raise AnswerValidationError("True/false questions must store A (true) or B (false).")
    return answer


def audit(db: Session, *, actor: str, action: str, target_type: str, target_id: int, detail: dict | None = None) -> AuditLog:
    row = AuditLog(
        actor=actor or "staff",
        action=action,
        target_type=target_type,
        target_id=target_id or 0,
        detail=detail or {},
    )
    db.add(row)
    return row


def record_version(db: Session, question: Question, *, note: str = "", author: str = "") -> QuestionVersion:
    row = QuestionVersion(
        question_id=question.id,
        version=question.version,
        snapshot=question_snapshot(question),
        note=note[:240],
        author=author[:120],
    )
    db.add(row)
    return row


def apply_question_fields(
    db: Session,
    question: Question,
    data: dict[str, Any],
    *,
    author: str = "staff",
    note: str = "Edited",
    snapshot: bool = True,
) -> Question:
    """Apply validated ``data`` to ``question`` and snapshot the previous state."""
    cleaned = validate_payload(data, existing=question, require_answer=question.correct in (None, ""))
    if not cleaned:
        return question
    if snapshot:
        record_version(db, question, note=note, author=author)
    answer_changed = "correct" in cleaned and cleaned["correct"] != question.correct
    for field, value in cleaned.items():
        setattr(question, field, value)
    # Guard: a question can never be saved without a trustworthy answer.
    if not question.correct:
        raise AnswerValidationError("Every question needs a correct answer (A–D).")
    question.correct = normalize_answer(
        question.correct,
        allow_multi=question.question_type in MULTI_ANSWER_TYPES,
        options=question.options,
    )
    question.version = (question.version or 1) + 1
    question.updated_at = utcnow()
    question.updated_by = author[:120]
    if answer_changed:
        question.flagged_at = utcnow()
        question.flag_reason = question.flag_reason or ""
    db.flush()
    return question


def restore_version(db: Session, question: Question, version: int, *, author: str = "staff") -> Question:
    row = db.scalar(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == question.id, QuestionVersion.version == version)
        .order_by(QuestionVersion.id.desc())
    )
    if row is None:
        raise ValueError(f"Version {version} not found for this question.")
    data = {field: row.snapshot.get(field) for field in EDITABLE_FIELDS if field in row.snapshot}
    apply_question_fields(db, question, data, author=author, note=f"Restored v{version}", snapshot=True)
    return question


def duplicate_question(
    db: Session,
    question: Question,
    *,
    target_quiz_id: int | None = None,
    author: str = "staff",
    keep_source: bool = True,
) -> Question:
    """Copy a question (nothing shared that could drift)."""
    from ..models import Quiz

    quiz_id = target_quiz_id or question.quiz_id
    quiz = db.get(Quiz, quiz_id)
    course_id = quiz.course_id if quiz else question.course_id
    position = question.position
    if quiz_id == question.quiz_id:
        highest = db.scalar(select(func.max(Question.position)).where(Question.quiz_id == quiz_id))
        position = int(highest or 0) + 1
    clone = Question(
        quiz_id=quiz_id,
        course_id=course_id,
        source_id=question.id if keep_source else question.source_id,
        position=position,
        text=question.text,
        option_a=question.option_a,
        option_b=question.option_b,
        option_c=question.option_c,
        option_d=question.option_d,
        correct=question.correct,
        explanation=question.explanation,
        points=question.points,
        difficulty=question.difficulty,
        question_type=question.question_type,
        topic=question.topic,
        subtopic=question.subtopic,
        objective=question.objective,
        tags=clean_tags(question.tags or []),
        source=question.source,
        reference=question.reference,
        author=question.author or author,
        hint=question.hint,
        admin_notes=question.admin_notes,
        media=json.loads(json.dumps(question.media or {})),
        content=json.loads(json.dumps(question.content or {})),
        status=question.status,
        visible=question.visible,
        flashcard_enabled=question.flashcard_enabled,
        duel_enabled=question.duel_enabled,
        practice_enabled=question.practice_enabled,
        time_limit_seconds=question.time_limit_seconds,
        created_by=question.created_by or author,
        updated_by=author,
        version=1,
    )
    db.add(clone)
    db.flush()
    record_version(db, clone, note=f"Duplicated from #{question.id}", author=author)
    return clone


# ---------------------------------------------------------------------------
# Search / filter / sort / analytics
# ---------------------------------------------------------------------------
SORT_KEYS = {
    "position": (Question.position.asc(), Question.id.asc()),
    "newest": (Question.created_at.desc(), Question.id.desc()),
    "oldest": (Question.created_at.asc(), Question.id.asc()),
    "difficulty": (Question.difficulty.asc(), Question.position.asc()),
    "points": (Question.points.desc(), Question.id.asc()),
    "usage": (Question.usage_count.desc(), Question.id.asc()),
    "success": (Question.correct_count.desc(), Question.usage_count.desc()),
    "weakest": (Question.wrong_count.desc(), Question.usage_count.desc()),
    "text": (Question.text.asc(), Question.id.asc()),
    "version": (Question.version.desc(), Question.id.desc()),
}


def question_query(
    db: Session,
    *,
    q: str = "",
    course_id: int | None = None,
    quiz_id: int | None = None,
    topic: str = "",
    subtopic: str = "",
    difficulty: str = "",
    status: str = "",
    answer: str = "",
    tag: str = "",
    question_type: str = "",
    flagged: bool | None = None,
    drawn: bool | None = None,
    min_usage: int | None = None,
    max_success: float | None = None,
    sort: str = "position",
    limit: int = 50,
    offset: int = 0,
    include_archived: bool = True,
) -> dict[str, Any]:
    stmt = select(Question)
    if quiz_id:
        stmt = stmt.where(Question.quiz_id == quiz_id)
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Question.text).like(needle),
                func.lower(Question.explanation).like(needle),
                func.lower(Question.topic).like(needle),
                func.lower(Question.source).like(needle),
                func.lower(Question.reference).like(needle),
            )
        )
    if topic:
        stmt = stmt.where(func.lower(Question.topic) == topic.strip().lower())
    if subtopic:
        stmt = stmt.where(func.lower(Question.subtopic) == subtopic.strip().lower())
    if difficulty in DIFFICULTIES:
        stmt = stmt.where(Question.difficulty == difficulty)
    if status and status in STATUSES:
        stmt = stmt.where(Question.status == status)
    if answer:
        normalized = "".join(sorted(set(answer.strip().upper())))
        if normalized:
            stmt = stmt.where(Question.correct == normalized)
    if question_type:
        stmt = stmt.where(Question.question_type == question_type)
    if flagged is True:
        stmt = stmt.where(Question.flag_reason != "")
    elif flagged is False:
        stmt = stmt.where(Question.flag_reason == "")
    if drawn is True:
        stmt = stmt.where(Question.source_id.is_not(None))
    elif drawn is False:
        stmt = stmt.where(Question.source_id.is_(None))
    if not include_archived and status == "":
        stmt = stmt.where(Question.status != "archived")
    if min_usage is not None:
        stmt = stmt.where(Question.usage_count >= int(min_usage))
    if max_success is not None:
        stmt = stmt.where(Question.wrong_count > 0)
        stmt = stmt.where((Question.correct_count * 100.0) / func.max(Question.usage_count, 1) <= float(max_success))

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    order = SORT_KEYS.get(sort, SORT_KEYS["position"])
    rows = list(db.scalars(stmt.order_by(*order).limit(limit).offset(offset)).all())

    if tag:
        needle = tag.strip().lower()
        rows = [row for row in rows if needle in {str(item).lower() for item in (row.tags or [])}]
        total = len(rows)

    counts = db.execute(
        select(Question.status, func.count(Question.id)).group_by(Question.status)
    ).all()
    difficulty_counts = db.execute(
        select(Question.difficulty, func.count(Question.id)).group_by(Question.difficulty)
    ).all()
    topics = db.execute(
        select(Question.topic, func.count(Question.id))
        .where(Question.topic != "")
        .group_by(Question.topic)
        .order_by(func.count(Question.id).desc())
        .limit(40)
    ).all()
    tag_counter: dict[str, int] = {}
    for row in db.scalars(select(Question.tags)).all() or []:
        for item in row or []:
            tag_counter[str(item)] = tag_counter.get(str(item), 0) + 1

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "questions": rows,
        "facets": {
            "status": {str(key): int(value) for key, value in counts},
            "difficulty": {str(key): int(value) for key, value in difficulty_counts},
            "topics": [{"topic": key, "count": int(value)} for key, value in topics if key],
            "tags": [{"tag": key, "count": value} for key, value in sorted(tag_counter.items(), key=lambda item: -item[1])[:60]],
        },
    }


def question_analytics(db: Session, question_id: int) -> dict[str, Any]:
    question = db.get(Question, question_id)
    if question is None:
        raise ValueError("Question not found.")
    from sqlalchemy import case

    rows = db.execute(
        select(
            func.count(Answer.id),
            func.sum(case((Answer.is_correct.is_(True), 1), else_=0)),
            func.avg(Answer.seconds_spent),
        ).where(Answer.question_id == question_id)
    ).one()
    answered, correct, avg_seconds = int(rows[0] or 0), int(rows[1] or 0), float(rows[2] or 0)
    option_mix = db.execute(
        select(Answer.selected, func.count(Answer.id)).where(Answer.question_id == question_id).group_by(Answer.selected)
    ).all()
    recent_errors = db.execute(
        select(func.count(Answer.id)).where(Answer.question_id == question_id, Answer.is_correct.is_(False))
    ).scalar() or 0
    return {
        "question_id": question_id,
        "answered": answered,
        "correct": correct,
        "wrong": max(0, answered - correct),
        "accuracy": round(correct / answered * 100, 1) if answered else 0.0,
        "average_seconds": round(avg_seconds, 2),
        "errors": int(recent_errors),
        "option_mix": {str(key or "blank"): int(value) for key, value in option_mix},
        "needs_review": answered >= 5 and (correct / max(answered, 1)) < 0.35,
        "health": "weak" if answered >= 5 and (correct / max(answered, 1)) < 0.35 else "ok",
    }


def similar_questions(db: Session, question: Question, *, limit: int = 8) -> list[dict[str, Any]]:
    """Cheap duplicate/similar detection using normalised text tokens."""
    import difflib

    base = re.sub(r"\W+", " ", (question.text or "").lower()).strip()
    if not base:
        return []
    pool = db.scalars(
        select(Question)
        .where(Question.id != question.id)
        .where(Question.course_id == question.course_id if question.course_id else Question.id > 0)
        .limit(500)
    ).all()
    scored: list[tuple[float, Question]] = []
    for row in pool:
        other = re.sub(r"\W+", " ", (row.text or "").lower()).strip()
        if not other:
            continue
        ratio = difflib.SequenceMatcher(None, base, other).ratio()
        if ratio >= 0.65:
            scored.append((ratio, row))
    scored.sort(key=lambda item: -item[0])
    return [
        {
            "id": row.id,
            "text": row.text[:200],
            "similarity": round(ratio * 100, 1),
            "quiz_id": row.quiz_id,
            "correct": row.correct,
            "duplicate": ratio >= 0.92,
        }
        for ratio, row in scored[:limit]
    ]


def bank_health(db: Session, course_id: int | None = None) -> dict[str, Any]:
    stmt = select(Question)
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    questions = list(db.scalars(stmt).all())
    total = len(questions)
    empty_topics = [row for row in questions if not (row.topic or "").strip()]
    low_pool: list[dict[str, Any]] = []
    by_topic: dict[str, int] = {}
    for row in questions:
        key = (row.topic or "Untagged").strip() or "Untagged"
        by_topic[key] = by_topic.get(key, 0) + 1
    for topic, count in sorted(by_topic.items()):
        if count < 5:
            low_pool.append({"topic": topic, "count": count})
    broken = [row for row in questions if row.correct not in (row.answer_keys and "".join(row.answer_keys) or "") or not row.correct]
    no_explanation = sum(1 for row in questions if not (row.explanation or "").strip())
    weak = [row for row in questions if row.usage_count >= 5 and (row.correct_count / max(row.usage_count, 1)) < 0.35]
    return {
        "course_id": course_id,
        "total": total,
        "by_status": {status: sum(1 for row in questions if row.status == status) for status in STATUSES},
        "by_difficulty": {level: sum(1 for row in questions if row.difficulty == level) for level in DIFFICULTIES},
        "by_topic": [{"topic": key, "count": value} for key, value in sorted(by_topic.items(), key=lambda item: -item[1])],
        "warnings": {
            "untagged": len(empty_topics),
            "low_pool_topics": low_pool[:12],
            "broken": len(broken),
            "no_explanation": no_explanation,
            "weak": len(weak),
            "flagged": sum(1 for row in questions if row.flag_reason),
            "drafts": sum(1 for row in questions if row.status == "draft"),
        },
        "weakest": [
            {"id": row.id, "text": row.text[:140], "accuracy": round(row.correct_count / max(row.usage_count, 1) * 100, 1)}
            for row in sorted(weak, key=lambda row: row.correct_count / max(row.usage_count, 1))[:10]
        ],
        "most_missed": [
            {"id": row.id, "text": row.text[:140], "wrong": row.wrong_count}
            for row in sorted(questions, key=lambda row: -row.wrong_count)[:10]
            if row.wrong_count
        ],
        "most_mastered": [
            {"id": row.id, "text": row.text[:140], "correct": row.correct_count}
            for row in sorted(questions, key=lambda row: -row.correct_count)[:10]
            if row.correct_count
        ],
        "duplicates": duplicate_pairs(db, questions)[:12],
    }


def duplicate_pairs(db: Session, questions: list[Question], *, threshold: float = 0.9) -> list[dict[str, Any]]:
    import difflib

    pairs: list[dict[str, Any]] = []
    normalised = [(row, re.sub(r"\W+", " ", (row.text or "").lower()).strip()) for row in questions]
    for index, (row, text) in enumerate(normalised):
        if not text:
            continue
        for other, other_text in normalised[index + 1 :]:
            if not other_text:
                continue
            if abs(len(text) - len(other_text)) > max(len(text), len(other_text)) * 0.5:
                continue
            ratio = difflib.SequenceMatcher(None, text, other_text).ratio()
            if ratio >= threshold:
                pairs.append(
                    {
                        "a": {"id": row.id, "text": row.text[:160]},
                        "b": {"id": other.id, "text": other.text[:160]},
                        "similarity": round(ratio * 100, 1),
                    }
                )
    pairs.sort(key=lambda item: -item["similarity"])
    return pairs


def export_questions(questions: Iterable[Question], *, fmt: str = "json") -> tuple[str, str, str]:
    """Return ``(content, media_type, filename)`` for a question-bank export."""
    rows = [question_admin_public(row) for row in questions]
    if fmt == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "number",
                "text",
                "option_a",
                "option_b",
                "option_c",
                "option_d",
                "correct",
                "explanation",
                "points",
                "difficulty",
                "question_type",
                "topic",
                "subtopic",
                "tags",
                "source",
                "reference",
                "status",
            ]
        )
        for index, row in enumerate(rows, start=1):
            writer.writerow(
                [
                    index,
                    row["text"],
                    row["option_a"],
                    row["option_b"],
                    row["option_c"],
                    row["option_d"],
                    row["correct"],
                    row["explanation"],
                    row["points"],
                    row["difficulty"],
                    row["question_type"],
                    row["topic"],
                    row["subtopic"],
                    "; ".join(row["tags"]),
                    row["source"],
                    row["reference"],
                    row["status"],
                ]
            )
        return buffer.getvalue(), "text/csv", "question-bank.csv"

    payload = {
        "format": "quiz-arena.question-bank",
        "version": 1,
        "exported_at": utcnow().isoformat() + "Z",
        "count": len(rows),
        "questions": [
            {
                key: row[key]
                for key in (
                    "text",
                    "option_a",
                    "option_b",
                    "option_c",
                    "option_d",
                    "correct",
                    "explanation",
                    "points",
                    "difficulty",
                    "question_type",
                    "topic",
                    "subtopic",
                    "tags",
                    "source",
                    "reference",
                    "status",
                )
            }
            for row in rows
        ],
    }
    return json.dumps(payload, indent=2), "application/json", "question-bank.json"


def import_payload(data: Any, *, default_quiz_id: int, default_course_id: int | None) -> dict[str, Any]:
    """Validate an export-style payload (JSON list / object) for re-import."""
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    if isinstance(data, dict):
        raw_rows = data.get("questions") or []
    elif isinstance(data, list):
        raw_rows = data
    else:
        raise ValueError("Import payload must be a list of questions or an object with a questions array.")

    for index, row in enumerate(raw_rows, start=1):
        if not isinstance(row, dict):
            errors.append({"index": index, "text": str(row)[:120], "answer": None, "reasons": ["Not a question object"]})
            continue
        item = {
            "text": str(row.get("text") or "").strip(),
            "option_a": str(row.get("option_a") or "").strip(),
            "option_b": str(row.get("option_b") or "").strip(),
            "option_c": str(row.get("option_c") or "").strip(),
            "option_d": str(row.get("option_d") or "").strip(),
            "correct": row.get("correct"),
            "explanation": str(row.get("explanation") or ""),
            "points": int(row.get("points") or 1) if str(row.get("points") or "1").isdigit() else 1,
            "difficulty": str(row.get("difficulty") or "medium").lower(),
            "question_type": str(row.get("question_type") or "mcq").lower(),
            "topic": str(row.get("topic") or ""),
            "subtopic": str(row.get("subtopic") or ""),
            "tags": row.get("tags") or [],
            "source": str(row.get("source") or ""),
            "reference": str(row.get("reference") or ""),
            "status": str(row.get("status") or "approved").lower(),
        }
        try:
            cleaned = validate_payload(item, require_answer=True)
            cleaned["quiz_id"] = default_quiz_id
            cleaned["course_id"] = default_course_id
            rows.append(cleaned)
        except (AnswerValidationError, ValueError) as error:
            errors.append(
                {
                    "index": index,
                    "text": item["text"][:160] or "(empty)",
                    "answer": item["correct"],
                    "reasons": [getattr(error, "message", str(error))],
                }
            )
    return {"questions": rows, "errors": errors, "ok": len(rows), "rejected": len(errors)}


def register_question_attempt(
    db: Session,
    question: Question,
    *,
    correct: bool,
    elapsed_ms: int = 0,
) -> None:
    """Keep the live question counters in step with real answers."""
    question.usage_count = (question.usage_count or 0) + 1
    if correct:
        question.correct_count = (question.correct_count or 0) + 1
    else:
        question.wrong_count = (question.wrong_count or 0) + 1
    question.total_ms = (question.total_ms or 0) + max(0, int(elapsed_ms))


def mastery_scope_update(
    db: Session,
    student_id: int,
    *,
    scope_type: str,
    scope_key: str,
    correct: bool,
) -> None:
    """Update a mastery band (course/topic/subtopic/difficulty) for a player."""
    from ..models import PlayerMastery

    key = (scope_key or "").strip()[:120] or "General"
    row = db.scalar(
        select(PlayerMastery).where(
            PlayerMastery.student_id == student_id,
            PlayerMastery.scope_type == scope_type,
            PlayerMastery.scope_key == key,
        )
    )
    if row is None:
        row = PlayerMastery(student_id=student_id, scope_type=scope_type, scope_key=key)
        db.add(row)
    row.answered = (row.answered or 0) + 1
    row.correct = (row.correct or 0) + (1 if correct else 0)
    accuracy = row.correct / max(row.answered, 1)
    # Mastery rewards accuracy with a confidence curve over attempt volume.
    confidence = min(1.0, row.answered / 12)
    row.mastery = round(accuracy * 100 * confidence, 2)
    row.updated_at = utcnow()


def flag_question(
    db: Session,
    question: Question,
    *,
    reason: str,
    note: str = "",
    student_id: int | None = None,
    actor: str = "player",
) -> QuestionFlag:
    row = QuestionFlag(
        question_id=question.id,
        student_id=student_id,
        reason=(reason or "unclear")[:60],
        note=(note or "")[:400],
        status="open",
    )
    db.add(row)
    question.flag_reason = (reason or "unclear")[:240]
    question.flagged_by = actor[:120]
    question.flagged_at = utcnow()
    return row


def clear_flag(db: Session, question: Question, *, actor: str = "staff") -> Question:
    question.flag_reason = ""
    question.flagged_by = ""
    question.flagged_at = None
    audit(db, actor=actor, action="question.unflag", target_type="question", target_id=question.id)
    return question
