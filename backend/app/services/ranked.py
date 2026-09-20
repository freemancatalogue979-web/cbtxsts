"""Ranked multiplayer: matchmade competitive matches with Elo ratings.

Matchmaking runs in the server ticker: players queue per course, and once at
least two are waiting (and the oldest has waited out the grace window) a match
is minted for up to 15 of them. The lobby counts down on the server clock,
then every participant answers the same questions on a shared window —
answers are graded server-side, standings broadcast live, and Elo ratings
move when the match finishes.

Scoring is accuracy-dominant by design: a correct answer is always worth far
more than the speed or streak bonuses stacked on top of it, so a slightly
slower correct click always beats a fast wrong one. The formula lives here
and only here — clients never compute or submit points.
"""
from __future__ import annotations

import random
from collections import deque
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..events import Event, to_room, to_student
from ..models import (
    Course,
    Question,
    RankedAnswer,
    RankedMatch,
    RankedParticipant,
    RankedQuestion,
    RankedQueue,
    Student,
    utcnow,
)
from ..serializers import question_public
from .duel import question_pool

# --------------------------------------------------------------------- tuning
MATCH_SIZE = 15          # hard cap per match
MIN_PLAYERS = 2          # a match may launch with just two players
LOBBY_SECONDS = 6        # lobby countdown
REVEAL_SECONDS = 4       # answer shown before the next question opens
QUESTION_COUNT = 10      # fallback when no tier rule applies
QUESTION_SECONDS = 20    # fallback when no tier rule applies
BASE_POINTS = 60         # correct answer floor — accuracy dominates
SPEED_BONUS = 30         # decays linearly over the question window
STREAK_BONUS = 10        # per consecutive correct above the first, capped
STREAK_CAP = 5
K_FACTOR = 32
SPEED_XP_DIVISOR = 6     # banked speed points / 6 become bonus XP at the finish

# Matchmaking patience ladder: the longer the oldest player has waited, the
# fewer players are needed to start — (seconds waited, players needed). Before
# the first rung a match only launches full (MATCH_SIZE); past the last rung
# it launches with whoever showed up.
QUEUE_LADDER: list[tuple[int, int]] = [
    (30, 12),
    (60, 10),
    (90, 6),
    (120, 4),
    (150, MIN_PLAYERS),
]

# Match shape by the tier of the queue's average rating: beginners get more
# time and fewer questions; the top of the ladder answers faster, longer sets.
TIER_RULES: dict[str, dict[str, int]] = {
    "bronze": {"questions": 6, "seconds": 30},
    "silver": {"questions": 7, "seconds": 26},
    "gold": {"questions": 8, "seconds": 22},
    "platinum": {"questions": 9, "seconds": 18},
    "diamond": {"questions": 10, "seconds": 15},
    "master": {"questions": 11, "seconds": 12},
    "grandmaster": {"questions": 12, "seconds": 10},
}

# Tier ladder (names/icons/colours configurable in one place).
TIERS: list[dict] = [
    {"key": "bronze", "name": "Bronze", "min": 0, "color": "#b0794a", "icon": "shield"},
    {"key": "silver", "name": "Silver", "min": 900, "color": "#a8b3c4", "icon": "shield"},
    {"key": "gold", "name": "Gold", "min": 1100, "color": "#e3b341", "icon": "medal"},
    {"key": "platinum", "name": "Platinum", "min": 1300, "color": "#7fd4c1", "icon": "medal"},
    {"key": "diamond", "name": "Diamond", "min": 1500, "color": "#7db8f0", "icon": "gem"},
    {"key": "master", "name": "Master", "min": 1700, "color": "#b98cf0", "icon": "crown"},
    {"key": "grandmaster", "name": "Grandmaster", "min": 1900, "color": "#f0729a", "icon": "crown"},
]

PLACE_XP = (30, 20, 10)
PLACE_COINS = (15, 10, 5)

# In-memory live state (rebuilt harmlessly on restart):
#   OPEN[match_id] = {question_id, index, deadline, reveal_until?}
#   LAST_STANDINGS[match_id] = {student_id: position} for activity lines
OPEN: dict[int, dict] = {}
ACTIVITY: dict[int, deque] = {}
LAST_STANDINGS: dict[int, dict] = {}


class RankedError(Exception):
    """Raised for user-facing ranked failures."""


# ---------------------------------------------------------------------- tiers
def tier_for(rating: int) -> dict:
    current = TIERS[0]
    for tier in TIERS:
        if rating >= tier["min"]:
            current = tier
    return current


def tiers_payload() -> list[dict]:
    return [
        {**tier, "max": (TIERS[i + 1]["min"] - 1) if i + 1 < len(TIERS) else None}
        for i, tier in enumerate(TIERS)
    ]


def players_needed(waited_seconds: float) -> int:
    """How many queued players start a match once the oldest has waited this long."""
    needed = MATCH_SIZE
    for wait, players in QUEUE_LADDER:
        if waited_seconds >= wait:
            needed = players
    return needed


def queue_ladder_payload() -> list[dict]:
    return [{"wait": wait, "players": players} for wait, players in QUEUE_LADDER]


def tier_rules_payload() -> dict[str, dict[str, int]]:
    return {key: dict(rules) for key, rules in TIER_RULES.items()}


def match_rules_for(ratings: list[int]) -> tuple[int, int]:
    """(question_count, per_question_seconds) from the queue's average rating."""
    if not ratings:
        return QUESTION_COUNT, QUESTION_SECONDS
    tier = tier_for(round(sum(ratings) / len(ratings)))
    rules = TIER_RULES.get(tier["key"])
    if rules is None:
        return QUESTION_COUNT, QUESTION_SECONDS
    return rules["questions"], rules["seconds"]


def _level(student: Student) -> int:
    return game.level_progress(student.xp)["level"]


def _iso(value) -> str:
    return value.isoformat() + "Z" if value else ""


def _course_title(db: Session, course_id: int | None) -> str:
    if not course_id:
        return "The whole arena"
    course = db.get(Course, course_id)
    return course.title if course else "The whole arena"


# ---------------------------------------------------------------------- queue
def join_queue(db: Session, student: Student, course_id: int | None) -> dict:
    active = active_match_for(db, student.id)
    if active is not None:
        return {"queued": False, "match_id": active.id, "state": match_state(db, active, student.id)}
    if course_id is None:
        raise RankedError("Pick a course before finding a match.")
    if db.get(Course, course_id) is None:
        raise RankedError("That course does not exist.")
    existing = db.scalar(
        select(RankedQueue).where(RankedQueue.student_id == student.id, RankedQueue.course_id == course_id)
    )
    if existing is None:
        db.add(RankedQueue(course_id=course_id, student_id=student.id, rating=student.ranked_rating))
        db.flush()
    return {
        "queued": True,
        "waiting": waiting_count(db, course_id),
        "joined_at": _iso(_queue_joined(db, student.id, course_id)),
    }


def leave_queue(db: Session, student: Student) -> bool:
    rows = list(db.scalars(select(RankedQueue).where(RankedQueue.student_id == student.id)).all())
    for row in rows:
        db.delete(row)
    db.flush()
    return bool(rows)


def waiting_count(db: Session, course_id: int | None) -> int:
    return db.scalar(select(func.count(RankedQueue.id)).where(RankedQueue.course_id == course_id)) or 0


def _queue_joined(db: Session, student_id: int, course_id: int | None):
    row = db.scalar(
        select(RankedQueue).where(RankedQueue.student_id == student_id, RankedQueue.course_id == course_id)
    )
    return row.joined_at if row else None


def active_match_for(db: Session, student_id: int) -> RankedMatch | None:
    return db.scalar(
        select(RankedMatch)
        .join(RankedParticipant, RankedParticipant.match_id == RankedMatch.id)
        .where(RankedParticipant.student_id == student_id, RankedMatch.status.in_(["lobby", "live"]))
        .order_by(RankedMatch.id.desc())
        .limit(1)
    )


# --------------------------------------------------------------- matchmaking
def poll_queue(db: Session) -> list[Event]:
    """Called by the server ticker: mint matches for ready course queues.

    The longer the oldest waiter has been queued, the fewer players are
    needed to start (see QUEUE_LADDER) — a full roster never waits, and a
    patient queue eventually launches with whoever showed up.
    """
    events: list[Event] = []
    rows = list(db.scalars(select(RankedQueue).order_by(RankedQueue.joined_at)).all())
    by_course: dict[int | None, list[RankedQueue]] = {}
    for row in rows:
        by_course.setdefault(row.course_id, []).append(row)
    for course_id, waiting in by_course.items():
        if len(waiting) < MIN_PLAYERS:
            continue
        oldest = min(row.joined_at for row in waiting)
        waited = (utcnow() - oldest).total_seconds()
        if len(waiting) < players_needed(waited):
            continue
        events += _launch_match(db, course_id, waiting[:MATCH_SIZE])
    return events


def _launch_match(db: Session, course_id: int | None, waiting: list[RankedQueue]) -> list[Event]:
    pool = question_pool(db, None, course_id=course_id)
    if not pool:
        return []  # nothing to quiz on; leave them waiting
    question_count, per_question_seconds = match_rules_for([row.rating for row in waiting])
    match = RankedMatch(
        course_id=course_id,
        status="lobby",
        question_count=question_count,
        per_question_seconds=per_question_seconds,
        lobby_at=utcnow() + timedelta(seconds=LOBBY_SECONDS),
    )
    db.add(match)
    db.flush()
    picks = random.sample(pool, min(question_count, len(pool)))
    for position, question in enumerate(picks):
        db.add(RankedQuestion(match_id=match.id, question_id=question.id, position=position))
    for row in waiting:
        student = db.get(Student, row.student_id)
        if student is None:
            continue
        db.add(RankedParticipant(match_id=match.id, student_id=student.id, rating_before=student.ranked_rating))
        db.delete(row)
    db.flush()
    ACTIVITY[match.id] = deque(maxlen=8)
    state = match_state(db, match, None)
    events = [to_room(f"ranked:{match.id}", "ranked_lobby", state)]
    for participant in participants(db, match):
        events.append(to_student(participant.student_id, "ranked_match", {"match_id": match.id}))
    return events


# ------------------------------------------------------------------ lifecycle
def participants(db: Session, match: RankedMatch) -> list[RankedParticipant]:
    return list(
        db.scalars(
            select(RankedParticipant)
            .where(RankedParticipant.match_id == match.id)
            .order_by(RankedParticipant.joined_at)
        ).all()
    )


def advance_matches(db: Session) -> list[Event]:
    """Server-paced engine: start lobbies whose countdown ended, close expired
    questions, open the next one after the reveal window, finish at the end."""
    events: list[Event] = []
    now = utcnow()
    for match in list(db.scalars(select(RankedMatch).where(RankedMatch.status == "lobby")).all()):
        if match.lobby_at is not None and now >= match.lobby_at:
            events += _start_match(db, match)
    for match in list(db.scalars(select(RankedMatch).where(RankedMatch.status == "live")).all()):
        info = OPEN.get(match.id)
        if info is None:
            continue
        if "reveal_until" in info:
            if now >= info["reveal_until"]:
                events += _open_next(db, match)
            continue
        if now >= info["deadline"]:
            events += _close_question(db, match)
    return events


def _start_match(db: Session, match: RankedMatch) -> list[Event]:
    match.status = "live"
    match.started_at = utcnow()
    db.flush()
    return _open_next(db, match)


def _open_next(db: Session, match: RankedMatch) -> list[Event]:
    questions = list(
        db.scalars(
            select(RankedQuestion).where(RankedQuestion.match_id == match.id).order_by(RankedQuestion.position)
        ).all()
    )
    nxt = match.round_index + 1
    if nxt >= len(questions):
        return _finish_match(db, match)
    match.round_index = nxt
    db.flush()
    question = db.get(Question, questions[nxt].question_id)
    deadline = utcnow() + timedelta(seconds=match.per_question_seconds)
    OPEN[match.id] = {"question_id": question.id, "index": nxt, "deadline": deadline}
    return [
        to_room(
            f"ranked:{match.id}",
            "ranked_question",
            {
                "index": nxt,
                "total": len(questions),
                "seconds": match.per_question_seconds,
                "deadline": _iso(deadline),
                "server_now": _iso(utcnow()),
                "question": question_public(question, reveal=False),
            },
        )
    ]


def _close_question(db: Session, match: RankedMatch) -> list[Event]:
    """Grade the open question, reveal the answer, publish standings."""
    info = OPEN.get(match.id)
    if info is None or "reveal_until" in info:
        return []
    info["reveal_until"] = utcnow() + timedelta(seconds=REVEAL_SECONDS)
    reveal = _reveal_payload(db, match, info)
    return [to_room(f"ranked:{match.id}", "ranked_reveal", reveal)] + _activity_events(db, match)


def _reveal_payload(db: Session, match: RankedMatch, info: dict) -> dict:
    question = db.get(Question, info["question_id"])
    answers = list(
        db.scalars(
            select(RankedAnswer).where(
                RankedAnswer.match_id == match.id, RankedAnswer.question_id == question.id
            )
        ).all()
    )
    correct_ids = sorted({row.student_id for row in answers if row.correct})
    return {
        "index": info["index"],
        "question_id": question.id,
        "correct": question.correct,
        "explanation": question.explanation or "",
        "correct_ids": correct_ids,
        "answered": len(answers),
        "standings": standings_payload(db, match),
        "server_now": _iso(utcnow()),
    }


def _activity_events(db: Session, match: RankedMatch) -> list[Event]:
    """Subtle live activity: position changes and milestones only — never a
    line per answer, which would spam the feed."""
    rows = standings_payload(db, match)
    ranked = {row["student_id"]: i + 1 for i, row in enumerate(rows)}
    previous = LAST_STANDINGS.get(match.id, {})
    feed = ACTIVITY.get(match.id)
    if feed is None:
        return []
    for student_id, position in ranked.items():
        row = next(r for r in rows if r["student_id"] == student_id)
        if previous and student_id in previous and previous[student_id] != position and position == 1:
            feed.append({"text": f"{row['name']} moved into 1st", "at": _iso(utcnow())})
    for row in rows:
        if row["answered"] == row["questions_total"] and row["questions_total"] > 0:
            if previous.get(row["student_id"]) is not None or row["answered"] > 1:
                feed.append({"text": f"{row['name']} completed question {row['answered']}", "at": _iso(utcnow())})
                break  # one milestone line per close, no spam
    LAST_STANDINGS[match.id] = ranked
    return [to_room(f"ranked:{match.id}", "ranked_activity", {"items": list(feed)})]


def _finish_match(db: Session, match: RankedMatch) -> list[Event]:
    OPEN.pop(match.id, None)
    ACTIVITY.pop(match.id, None)
    LAST_STANDINGS.pop(match.id, None)
    match.status = "finished"
    match.finished_at = utcnow()
    rows = participants(db, match)
    standings = sorted(rows, key=lambda p: (-p.score, -p.correct_count, p.joined_at))
    ratings: list[dict] = []
    n = len(standings)
    for place, participant in enumerate(standings, start=1):
        student = db.get(Student, participant.student_id)
        if student is None:
            continue
        participant.position = place
        participant.finished_at = utcnow()
        opponents = [p.rating_before for p in standings if p.student_id != participant.student_id]
        delta = 0
        if n >= 2 and opponents:
            average = sum(opponents) / len(opponents)
            expected = 1.0 / (1.0 + 10.0 ** ((average - participant.rating_before) / 400.0))
            actual = (n - place) / (n - 1)
            delta = max(-K_FACTOR, min(K_FACTOR, round(K_FACTOR * (actual - expected))))
        participant.rating_after = max(100, participant.rating_before + delta)
        student.ranked_rating = participant.rating_after
        student.ranked_played += 1
        if place == 1:
            student.ranked_won += 1
        bonus_xp = PLACE_XP[place - 1] if place - 1 < len(PLACE_XP) else 0
        bonus_coins = PLACE_COINS[place - 1] if place - 1 < len(PLACE_COINS) else 0
        # Speed bonus: the faster you locked correct answers, the more XP on top.
        speed_xp = round((participant.speed_points or 0) / SPEED_XP_DIVISOR)
        xp = 4 * participant.correct_count + bonus_xp + speed_xp
        coins = 2 * participant.correct_count + bonus_coins
        if xp or coins:
            detail = f"Place {place} of {n} · {participant.correct_count} correct"
            if speed_xp:
                detail += f" · +{speed_xp} speed bonus XP"
            game.grant(
                db,
                student,
                xp=xp,
                coins=coins,
                kind="xp",
                title=f"Ranked match #{match.id}",
                detail=detail,
            )
        ratings.append(
            {
                "student_id": participant.student_id,
                "name": student.name,
                "position": place,
                "before": participant.rating_before,
                "after": participant.rating_after,
                "delta": participant.rating_after - participant.rating_before,
                "xp": xp,
                "speed_xp": speed_xp,
            }
        )
    db.flush()
    payload = {
        "match_id": match.id,
        "standings": [participant_payload(db, match, p, None) for p in standings],
        "ratings": ratings,
        "server_now": _iso(utcnow()),
    }
    return [to_room(f"ranked:{match.id}", "ranked_finish", payload)]


# -------------------------------------------------------------------- answers
def submit_answer(
    db: Session, match: RankedMatch, student: Student, selected: str, elapsed_ms: int
) -> tuple[dict, bool]:
    """Grade one answer. Returns (result, everyone_answered)."""
    info = OPEN.get(match.id)
    if info is None or match.status != "live":
        raise RankedError("No question is open right now.")
    if "reveal_until" in info:
        raise RankedError("That question already closed.")
    if utcnow() > info["deadline"]:
        raise RankedError("Too slow — the clock on that question already ran out.")
    participant = db.scalar(
        select(RankedParticipant).where(
            RankedParticipant.match_id == match.id, RankedParticipant.student_id == student.id
        )
    )
    if participant is None:
        raise RankedError("You are not in this match.")
    question = db.get(Question, info["question_id"])
    existing = db.scalar(
        select(RankedAnswer).where(
            RankedAnswer.match_id == match.id,
            RankedAnswer.question_id == question.id,
            RankedAnswer.student_id == student.id,
        )
    )
    if existing:
        raise RankedError("You already locked an answer for this question.")
    correct = (selected or "").strip().upper() == (question.correct or "").strip().upper()
    points = 0
    speed = 0
    if correct:
        remaining = max(0.0, (info["deadline"] - utcnow()).total_seconds())
        window = max(1, match.per_question_seconds)
        speed = int(round(SPEED_BONUS * (remaining / window)))
        streak = min(participant.streak + 1, STREAK_CAP)
        points = BASE_POINTS + speed + STREAK_BONUS * (streak - 1)
        participant.score += points
        participant.correct_count += 1
        participant.streak = streak
        participant.best_streak = max(participant.best_streak, streak)
        # Bank the speed portion separately — it becomes bonus XP at the finish.
        participant.speed_points = (participant.speed_points or 0) + speed
    else:
        participant.wrong_count += 1
        participant.streak = 0
    participant.answered += 1
    db.add(
        RankedAnswer(
            match_id=match.id,
            question_id=question.id,
            student_id=student.id,
            selected=(selected or "").strip().upper(),
            correct=correct,
            elapsed_ms=elapsed_ms,
            points=points,
        )
    )
    db.flush()
    answered = (
        db.scalar(
            select(func.count(RankedAnswer.id)).where(
                RankedAnswer.match_id == match.id, RankedAnswer.question_id == question.id
            )
        )
        or 0
    )
    return {"correct": correct, "points": points}, answered >= len(participants(db, match))


def skip_question(db: Session, match: RankedMatch, student: Student) -> tuple[dict, bool]:
    """Pass on the open question: no points, no wrong mark, streak resets, and
    the room stops waiting on this player. Returns (result, everyone_answered)."""
    info = OPEN.get(match.id)
    if info is None or match.status != "live":
        raise RankedError("No question is open right now.")
    if "reveal_until" in info:
        raise RankedError("That question already closed.")
    if utcnow() > info["deadline"]:
        raise RankedError("Too slow — the clock on that question already ran out.")
    participant = db.scalar(
        select(RankedParticipant).where(
            RankedParticipant.match_id == match.id, RankedParticipant.student_id == student.id
        )
    )
    if participant is None:
        raise RankedError("You are not in this match.")
    question = db.get(Question, info["question_id"])
    existing = db.scalar(
        select(RankedAnswer).where(
            RankedAnswer.match_id == match.id,
            RankedAnswer.question_id == question.id,
            RankedAnswer.student_id == student.id,
        )
    )
    if existing:
        raise RankedError("You already locked an answer for this question.")
    participant.answered += 1
    participant.streak = 0
    db.add(
        RankedAnswer(
            match_id=match.id,
            question_id=question.id,
            student_id=student.id,
            selected="SKIP",
            correct=False,
            elapsed_ms=0,
            points=0,
        )
    )
    db.flush()
    answered = (
        db.scalar(
            select(func.count(RankedAnswer.id)).where(
                RankedAnswer.match_id == match.id, RankedAnswer.question_id == question.id
            )
        )
        or 0
    )
    return {"skipped": True, "points": 0}, answered >= len(participants(db, match))


def close_if_all_answered(db: Session, match: RankedMatch) -> dict | None:
    """When the last participant locks an answer the question closes early."""
    events = _close_question(db, match)
    if not events:
        return None
    return _reveal_payload(db, match, OPEN[match.id])


# --------------------------------------------------------------------- states
def participant_payload(
    db: Session, match: RankedMatch, participant: RankedParticipant, connected_ids: set[int] | None
) -> dict:
    student = db.get(Student, participant.student_id)
    if student is None:
        return {"student_id": participant.student_id, "name": "?", "score": participant.score}
    rating = (
        participant.rating_after
        if match.status == "finished" and participant.rating_after is not None
        else participant.rating_before
    )
    tier = tier_for(rating)
    connected = connected_ids is None or participant.student_id in connected_ids
    total = (
        db.scalar(select(func.count(RankedQuestion.id)).where(RankedQuestion.match_id == match.id)) or 0
    )
    return {
        "student_id": student.id,
        "name": student.name,
        "initials": student.name.split(" ")[0][:2].upper() if student.name else "?",
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "rating": rating,
        "tier": tier["key"],
        "tier_name": tier["name"],
        "level": _level(student),
        "score": participant.score,
        "correct": participant.correct_count,
        "wrong": participant.wrong_count,
        "answered": participant.answered,
        "streak": participant.streak,
        "best_streak": participant.best_streak,
        "questions_total": total,
        "position": participant.position,
        "connected": connected,
        "ready": True,  # matchmade players are committed the moment they queue
    }


def standings_payload(db: Session, match: RankedMatch, connected_ids: set[int] | None = None) -> list[dict]:
    rows = sorted(participants(db, match), key=lambda p: (-p.score, -p.correct_count, p.joined_at))
    payload = []
    for index, participant in enumerate(rows, start=1):
        row = participant_payload(db, match, participant, connected_ids)
        row["position"] = _position_of(match, participant, index)
        payload.append(row)
    return payload


def _position_of(match: RankedMatch, participant: RankedParticipant, running_place: int) -> int:
    """The final place is written at the finish; while a match runs, position
    is the live running order — never 0, never null."""
    if match.status == "finished" and participant.position:
        return participant.position
    return running_place


def positions_map(match: RankedMatch, parts: list[RankedParticipant]) -> dict[int, int]:
    ordered = sorted(parts, key=lambda p: (-p.score, -p.correct_count, p.joined_at))
    return {p.student_id: i for i, p in enumerate(ordered, start=1)}


def match_state(
    db: Session, match: RankedMatch, viewer_id: int | None, connected_ids: set[int] | None = None
) -> dict:
    total = db.scalar(select(func.count(RankedQuestion.id)).where(RankedQuestion.match_id == match.id)) or 0
    info = OPEN.get(match.id)
    question = None
    reveal = None
    me: dict | None = None
    if match.status == "live" and info is not None:
        if "reveal_until" in info:
            reveal = _reveal_payload(db, match, info)
        else:
            question_row = db.get(Question, info["question_id"])
            question = question_public(question_row, reveal=False)
        if viewer_id is not None:
            mine = db.scalar(
                select(RankedAnswer).where(
                    RankedAnswer.match_id == match.id,
                    RankedAnswer.question_id == info["question_id"],
                    RankedAnswer.student_id == viewer_id,
                )
            )
            me = (
                {"answered": True, "selected": mine.selected, "correct": mine.correct, "points": mine.points}
                if mine is not None
                else {"answered": False, "selected": None, "correct": None, "points": None}
            )
    parts = participants(db, match)
    pos_map = positions_map(match, parts)
    roster = []
    for participant in parts:
        row = participant_payload(db, match, participant, connected_ids)
        if not (match.status == "finished" and participant.position):
            row["position"] = pos_map.get(participant.student_id, 0)
        roster.append(row)
    return {
        "id": match.id,
        "status": match.status,
        "course_id": match.course_id,
        "course_title": _course_title(db, match.course_id),
        "question_count": match.question_count,
        "per_question_seconds": match.per_question_seconds,
        "round_index": match.round_index,
        "questions_total": total,
        "lobby_at": _iso(match.lobby_at),
        "server_now": _iso(utcnow()),
        "participants": roster,
        "question": question,
        "reveal": reveal,
        "me": me,
        "activity": list(ACTIVITY.get(match.id, [])),
    }


# -------------------------------------------------------------------- history
def history_payload(db: Session, student: Student, limit: int = 12) -> list[dict]:
    rows = list(
        db.scalars(
            select(RankedParticipant)
            .where(RankedParticipant.student_id == student.id, RankedParticipant.position.is_not(None))
            .order_by(RankedParticipant.id.desc())
            .limit(limit)
        ).all()
    )
    out = []
    for row in rows:
        match = db.get(RankedMatch, row.match_id)
        if match is None:
            continue
        out.append(
            {
                "match_id": match.id,
                "course_title": _course_title(db, match.course_id),
                "played_at": _iso(match.finished_at),
                "position": row.position,
                "players": len(participants(db, match)),
                "score": row.score,
                "correct": row.correct_count,
                "rating_before": row.rating_before,
                "rating_after": row.rating_after,
            }
        )
    return out


def _board_row(db: Session, student: Student, position: int) -> dict:
    tier = tier_for(student.ranked_rating)
    return {
        "position": position,
        "student_id": student.id,
        "name": student.name,
        "initials": student.name.split(" ")[0][:2].upper() if student.name else "?",
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "rating": student.ranked_rating,
        "tier": tier["key"],
        "tier_name": tier["name"],
        "level": _level(student),
        "played": student.ranked_played,
        "won": student.ranked_won,
    }


def leaderboard_payload(db: Session, student: Student, top: int = 20) -> dict:
    """Top of the ladder plus the viewer's own position and neighbours."""
    rows = list(
        db.scalars(
            select(Student)
            .where(Student.ranked_played > 0)
            .order_by(Student.ranked_rating.desc(), Student.ranked_played.desc())
            .limit(500)
        ).all()
    )
    board = [_board_row(db, s, i + 1) for i, s in enumerate(rows)]
    my_position = next((row["position"] for row in board if row["student_id"] == student.id), None)
    if my_position is None:
        count = (db.scalar(select(func.count(Student.id)).where(Student.ranked_played > 0)) or 0) + 1
        board.append(_board_row(db, student, count))
        my_position = count
    nearby_start = max(0, min(my_position - 3, max(0, len(board) - 5)))
    return {"top": board[:top], "mine": my_position, "nearby": board[nearby_start : nearby_start + 5]}


def review_payload(db: Session, match: RankedMatch, viewer_id: int) -> dict:
    """Post-match answer review: every question with the viewer's pick."""
    questions = list(
        db.scalars(
            select(RankedQuestion).where(RankedQuestion.match_id == match.id).order_by(RankedQuestion.position)
        ).all()
    )
    items = []
    for row in questions:
        question = db.get(Question, row.question_id)
        if question is None:
            continue
        mine = db.scalar(
            select(RankedAnswer).where(
                RankedAnswer.match_id == match.id,
                RankedAnswer.question_id == question.id,
                RankedAnswer.student_id == viewer_id,
            )
        )
        items.append(
            {
                "index": row.position,
                "question": question_public(question, reveal=True),
                "selected": mine.selected if mine else None,
                "correct": mine.correct if mine else False,
                "points": mine.points if mine else 0,
            }
        )
    return {"match_id": match.id, "items": items}
