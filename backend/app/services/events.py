"""Arena events: admin-created, no-cap competitive runs.

Events are multiplayer: the server deals every participant their OWN random
question set from the event's pool (fresh questions first, least-served as a
fallback — joining is never blocked), and each participant works through their
own set at their own pace (``untimed``/``fixed``) or on a per-question window
(``per_question``). The server owns all timing — a closed browser never
pauses a timed event — plus every score, the leaderboard and the rewards.
Players can join, leave and resume with progress intact until the event ends,
at which point the ticker finalizes positions, grants rewards and notifies
everyone who took part.
"""
from __future__ import annotations

import random
import time
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..events import Event, to_room, to_student
from ..models import (
    ArenaEvent,
    Badge,
    Course,
    EventAnswer,
    EventParticipant,
    EventQuestion,
    Notification,
    Question,
    Student,
    StudentBadge,
    utcnow,
)
from ..serializers import question_public
from .duel import question_pool
from .question_sets import create_multiplayer_question_sets
from .questions import normalize_answer

LEADERBOARD_TOP = 20
ACTIVITY_COOLDOWN = 6.0  # seconds between activity broadcasts per event
BASE_POINTS = 60
SPEED_BONUS = 30
STREAK_BONUS = 10
STREAK_CAP = 5

# In-memory per-event live state (rebuilt harmlessly on restart):
#   _last_activity[event_id] = last activity broadcast timestamp
#   _notified_*[event_id]    = approach/end reminders already sent
_last_activity: dict[int, float] = {}
_notified_approach: set[int] = set()
_notified_ending: set[int] = set()


class EventError(Exception):
    """Raised for user-facing event failures."""


def _iso(value) -> str:
    return value.isoformat() + "Z" if value else ""


def _level(student: Student) -> int:
    return game.level_progress(student.xp)["level"]


# ------------------------------------------------------------------- lifecycle
def poll_events(db: Session) -> list[Event]:
    """Ticker hook: reminders, starts, finishes."""
    events: list[Event] = []
    now = utcnow()
    scheduled = list(db.scalars(select(ArenaEvent).where(ArenaEvent.status == "scheduled")).all())
    for event in scheduled:
        until_start = (event.starts_at - now).total_seconds()
        if until_start <= 0:
            events += _start_event(db, event)
        elif until_start <= 600 and event.id not in _notified_approach:
            _notified_approach.add(event.id)
            _notify(db, f"{event.name} starts soon", "The event begins in less than 10 minutes.", kind="event")
            events.append(to_room("live", "event_reminder", {"event_id": event.id, "name": event.name, "starts_in": until_start}))
    for event in list(db.scalars(select(ArenaEvent).where(ArenaEvent.status == "live")).all()):
        until_end = (event.ends_at - now).total_seconds()
        if until_end <= 0:
            events += _finish_event(db, event)
        elif until_end <= 300 and event.id not in _notified_ending:
            _notified_ending.add(event.id)
            events.append(
                to_room(f"event:{event.id}", "event_ending", {"event_id": event.id, "ends_in": until_end})
            )
    return events


def _start_event(db: Session, event: ArenaEvent) -> list[Event]:
    # Fixed-duration events end at starts_at + duration, never later than ends_at.
    if event.time_mode == "fixed":
        event.ends_at = min(event.ends_at, event.starts_at + timedelta(minutes=event.duration_minutes))
    try:
        build_questions(db, event)
    except EventError:
        event.status = "cancelled"
        db.flush()
        _notify(db, f"{event.name} was cancelled", "No questions were available for this event.", kind="event")
        return [to_room("live", "event_cancelled", {"event_id": event.id, "name": event.name})]
    event.status = "live"
    db.flush()
    _notify(
        db,
        f"{event.name} is live",
        "The event has started — join from the Events tab.",
        kind="event",
    )
    return [to_room("live", "event_started", event_public(db, event, None))]


def _finish_event(db: Session, event: ArenaEvent) -> list[Event]:
    event.status = "finished"
    event.finalized_at = utcnow()
    rows = participants(db, event)
    standings = sorted(rows, key=lambda p: (-p.score, -p.correct_count, p.started_at))
    granted: list[dict] = []
    for place, participant in enumerate(standings, start=1):
        student = db.get(Student, participant.student_id)
        if student is None:
            continue
        participant.position = place
        participant.finished = True
        if participant.finished_at is None:
            participant.finished_at = utcnow()
        rewards = _grant_rewards(db, event, student, place)
        participant.rewards = rewards
        granted.append(rewards)
    db.flush()
    payload = {
        "event_id": event.id,
        "name": event.name,
        "leaderboard": leaderboard_payload(db, event, student_id=None),
        "participants": len(rows),
    }
    notes = [
        to_room("live", "event_finished", {"event_id": event.id, "name": event.name}),
        to_room(f"event:{event.id}", "event_end", payload),
    ]
    for participant in standings:
        student = db.get(Student, participant.student_id)
        if student is None:
            continue
        summary = ", ".join(
            part
            for part in [
                f"#{participant.position} of {len(standings)}",
                f"{participant.score} points",
                f"{participant.correct_count} correct",
            ]
            if part
        )
        _notify(db, f"Results: {event.name}", f"You finished {summary}. Check Events for your rewards.", kind="event")
        notes.append(to_student(student.id, "event_results", {"event_id": event.id, "position": participant.position, "rewards": participant.rewards}))
    return notes


def _grant_rewards(db: Session, event: ArenaEvent, student: Student, place: int) -> dict:
    """Admin-defined rewards, scaled by placement: the configured values are
    what the winner gets; lower places earn a proportion."""
    config = event.rewards or {}
    scale = {1: 1.0, 2: 0.6, 3: 0.4}.get(place, 0.25 if place <= 10 else 0.1)
    xp = int(config.get("xp", 0) * scale)
    coins = int(config.get("coins", 0) * scale)
    diamonds = int(config.get("diamonds", 0) * scale)
    granted: dict = {"xp": xp, "coins": coins, "diamonds": diamonds, "position": place}
    if xp or coins:
        game.grant(
            db,
            student,
            xp=xp,
            coins=coins,
            kind="prize",
            title=f"Event: {event.name}",
            detail=f"Place {place}",
        )
    if diamonds:
        game.award_diamonds(db, student, diamonds, reason=f"Event: {event.name} — place {place}")
    badge_key = config.get("badge_key", "")
    if badge_key and place == 1:
        badge = db.scalar(select(Badge).where(Badge.key == badge_key))
        if badge is not None:
            existing = db.scalar(
                select(StudentBadge).where(StudentBadge.student_id == student.id, StudentBadge.badge_id == badge.id)
            )
            if existing is None:
                db.add(StudentBadge(student_id=student.id, badge_id=badge.id))
                granted["badge"] = badge_key
    for key in ("title", "frame", "avatar"):
        if config.get(key) and place == 1:
            granted[key] = config[key]
    db.flush()
    return granted


def _notify(db: Session, title: str, message: str, *, kind: str = "event") -> None:
    db.add(Notification(title=title[:180], message=message, kind=kind))
    db.flush()


# --------------------------------------------------------------------- public
def event_public(db: Session, event: ArenaEvent, viewer_id: int | None) -> dict:
    course = db.get(Course, event.course_id) if event.course_id else None
    joined = False
    mine = None
    if viewer_id is not None:
        participant = participant_for(db, event.id, viewer_id)
        if participant is not None:
            joined = True
            mine = participant_payload(db, event, participant, None)
    participants_count = (
        db.scalar(select(func.count(EventParticipant.id)).where(EventParticipant.event_id == event.id)) or 0
    )
    rewards = event.rewards or {}
    prize_bits = []
    if rewards.get("xp"):
        prize_bits.append(f"{rewards['xp']} XP")
    if rewards.get("coins"):
        prize_bits.append(f"{rewards['coins']} coins")
    if rewards.get("diamonds"):
        prize_bits.append(f"{rewards['diamonds']} diamonds")
    if rewards.get("badge_key"):
        prize_bits.append("event badge")
    return {
        "id": event.id,
        "name": event.name,
        "description": event.description,
        "course_id": event.course_id,
        "course_title": course.title if course else "The whole arena",
        "topics": event.topics or [],
        "starts_at": _iso(event.starts_at),
        "ends_at": _iso(event.ends_at),
        "question_count": event.question_count,
        "time_mode": event.time_mode,
        "duration_minutes": event.duration_minutes,
        "per_question_seconds": event.per_question_seconds,
        "entry_xp": event.entry_xp,
        "visibility": event.visibility,
        "rewards": rewards,
        "prize_pool": " · ".join(prize_bits) if prize_bits else "Glory and leaderboard points",
        "banner": event.banner,
        "scoring_note": event.scoring_note,
        "allow_join_during": event.allow_join_during,
        "allow_leave": event.allow_leave,
        "leaderboard_visible": event.leaderboard_visible,
        "status": event.status,
        "participants": participants_count,
        "joined": joined,
        "me": mine,
        "server_now": _iso(utcnow()),
    }


def events_list(db: Session, student: Student) -> dict:
    now = utcnow()
    rows = list(
        db.scalars(
            select(ArenaEvent)
            .where(ArenaEvent.status.in_(["scheduled", "live"]))
            .order_by(ArenaEvent.starts_at)
            .limit(30)
        ).all()
    )
    past = list(
        db.scalars(
            select(ArenaEvent)
            .where(ArenaEvent.status.in_(["finished", "cancelled"]))
            .order_by(ArenaEvent.starts_at.desc())
            .limit(15)
        ).all()
    )
    return {
        "upcoming": [event_public(db, row, student.id) for row in rows if row.starts_at > now and row.status == "scheduled"],
        "live": [event_public(db, row, student.id) for row in rows if row.status == "live"],
        "past": [event_public(db, row, student.id) for row in past],
        "server_now": _iso(now),
    }


# ----------------------------------------------------------------- join/leave
def participant_for(db: Session, event_id: int, student_id: int) -> EventParticipant | None:
    return db.scalar(
        select(EventParticipant).where(
            EventParticipant.event_id == event_id, EventParticipant.student_id == student_id
        )
    )


def participants(db: Session, event: ArenaEvent) -> list[EventParticipant]:
    return list(
        db.scalars(
            select(EventParticipant)
            .where(EventParticipant.event_id == event.id)
            .order_by(EventParticipant.started_at)
        ).all()
    )


def join_event(db: Session, event: ArenaEvent, student: Student) -> EventParticipant:
    if event.status not in ("scheduled", "live"):
        raise EventError("This event is no longer open.")
    if event.status == "live" and not event.allow_join_during:
        raise EventError("Joining mid-event is disabled for this event.")
    # Joining a scheduled event pre-registers the player; the run itself only
    # opens when the server clock reaches starts_at.
    if event.entry_xp and student.xp < event.entry_xp:
        raise EventError(f"You need {event.entry_xp} XP to enter this event.")
    existing = participant_for(db, event.id, student.id)
    if existing is not None:
        return existing
    participant = EventParticipant(event_id=event.id, student_id=student.id)
    db.add(participant)
    db.flush()
    # Multiplayer rule: this participant's OWN set is dealt the moment they
    # join (a committed write), so resume, scoring and review all agree.
    _assign_participant_set(db, event, participant)
    return participant


def leave_event(db: Session, event: ArenaEvent, student: Student) -> bool:
    if not event.allow_leave:
        raise EventError("Leaving is disabled for this event.")
    participant = participant_for(db, event.id, student.id)
    if participant is None:
        return False
    if event.status == "scheduled":
        # Not started yet: leaving cancels the pre-registration outright.
        db.delete(participant)
        db.flush()
        return True
    # Once live, progress rows stay: the player may return and resume
    # exactly where they left off.
    participant.last_seen = utcnow()
    db.flush()
    return True


# -------------------------------------------------------------------- playing
def _event_questions(db: Session, event: ArenaEvent) -> list[EventQuestion]:
    return list(
        db.scalars(
            select(EventQuestion).where(EventQuestion.event_id == event.id).order_by(EventQuestion.position)
        ).all()
    )


def build_questions(db: Session, event: ArenaEvent) -> int:
    """Materialize the event's seed question order (idempotent).

    The seed rows are the event-level fallback; live participants are dealt
    their own sets in :func:`_participant_questions`.
    """
    if _event_questions(db, event):
        return len(_event_questions(db, event))
    pool = _event_pool(db, event)
    if not pool:
        raise EventError("No questions available for this event yet.")
    picks = random.sample(pool, min(event.question_count, len(pool)))
    for position, question in enumerate(picks):
        db.add(EventQuestion(event_id=event.id, question_id=question.id, position=position))
    db.flush()
    return len(picks)


def _event_pool(db: Session, event: ArenaEvent) -> list[Question]:
    pool = question_pool(db, None, course_id=event.course_id)
    topics = {t.lower() for t in (event.topics or [])}
    if topics:
        pool = [q for q in pool if (q.topic or "").lower() in topics] or pool
    return pool


def _assign_participant_set(db: Session, event: ArenaEvent, participant: EventParticipant) -> None:
    """Deal one participant their own set (fresh questions first).

    Joiners trickle in over the event's life, so overlap avoidance is best
    effort: usage counts (seed rows + every other participant's set) steer the
    picker, and a join is never blocked — a tiny bank degrades to reuse of the
    least-served questions, never to a refusal.
    """
    pool = _event_pool(db, event)
    if not pool:
        return  # the start-time seeder surfaces the real "no questions" error
    usage: dict[int, int] = {}
    for row in _event_questions(db, event):
        usage[row.question_id] = usage.get(row.question_id, 0) + 1
    for other in participants(db, event):
        if other.id == participant.id:
            continue
        for qid in other.question_ids or []:
            usage[int(qid)] = usage.get(int(qid), 0) + 1
    assigned = create_multiplayer_question_sets(
        pool, [participant.student_id], event.question_count, usage_counts=usage, strict=False
    )[participant.student_id]
    if assigned:
        participant.question_ids = [q.id for q in assigned]
        db.flush()


def _participant_questions(db: Session, event: ArenaEvent, participant: EventParticipant) -> list[Question]:
    """The participant's OWN question set, dealt once when they joined."""
    mine = list(participant.question_ids or [])
    if mine:
        rows = [db.get(Question, int(qid)) for qid in mine]
        rows = [q for q in rows if q is not None]
        if rows:
            return rows
    # Legacy participant (joined before per-player sets): the shared seed rows.
    out: list[Question] = []
    for row in _event_questions(db, event):
        question = db.get(Question, row.question_id)
        if question is not None:
            out.append(question)
    return out


def current_question(db: Session, event: ArenaEvent, participant: EventParticipant) -> dict:
    """Serve the participant's next unanswered question, resume-safe."""
    questions = _participant_questions(db, event, participant)
    if participant.current_index >= len(questions):
        return {"done": True, "answered": participant.answered, "total": len(questions)}
    question = questions[participant.current_index]
    if question is None:
        participant.current_index += 1
        db.flush()
        return current_question(db, event, participant)
    answered = db.scalar(
        select(func.count(EventAnswer.id)).where(
            EventAnswer.event_id == event.id, EventAnswer.student_id == participant.student_id
        )
    ) or 0
    mine = db.scalar(
        select(EventAnswer).where(
            EventAnswer.event_id == event.id,
            EventAnswer.question_id == question.id,
            EventAnswer.student_id == participant.student_id,
        )
    )
    return {
        "done": False,
        "index": participant.current_index,
        "total": len(questions),
        "question": question_public(question, reveal=False),
        "answered": answered,
        "me": {"answered": mine is not None, "selected": mine.selected if mine else None},
        "server_now": _iso(utcnow()),
    }


def submit_answer(
    db: Session, event: ArenaEvent, participant: EventParticipant, selected: str, elapsed_ms: int
) -> dict:
    if event.status != "live":
        raise EventError("This event is not running.")
    questions = _participant_questions(db, event, participant)
    if participant.current_index >= len(questions):
        raise EventError("You have finished the event.")
    question = questions[participant.current_index]
    existing = db.scalar(
        select(EventAnswer).where(
            EventAnswer.event_id == event.id,
            EventAnswer.question_id == question.id,
            EventAnswer.student_id == participant.student_id,
        )
    )
    if existing:
        raise EventError("You already answered this question.")
    correct = (selected or "").strip().upper() == (question.correct or "").strip().upper()
    points = 0
    if correct:
        window = max(1, event.per_question_seconds) if event.time_mode == "per_question" else 30
        speed = int(round(SPEED_BONUS * max(0.0, 1.0 - elapsed_ms / (window * 2000))))
        streak = min(participant.streak + 1, STREAK_CAP)
        points = BASE_POINTS + speed + STREAK_BONUS * (streak - 1)
        participant.score += points
        participant.correct_count += 1
        participant.streak = streak
        participant.best_streak = max(participant.best_streak, streak)
    else:
        participant.wrong_count += 1
        participant.streak = 0
    participant.answered += 1
    participant.current_index += 1
    participant.last_seen = utcnow()
    if participant.current_index >= len(questions):
        participant.finished = True
        participant.finished_at = utcnow()
    db.add(
        EventAnswer(
            event_id=event.id,
            question_id=question.id,
            student_id=participant.student_id,
            selected=(selected or "").strip().upper(),
            correct=correct,
            elapsed_ms=elapsed_ms,
            points=points,
        )
    )
    db.flush()
    return {
        "correct": correct,
        "points": points,
        "finished": participant.finished,
        "progress": current_question(db, event, participant),
    }


# ---------------------------------------------------------------- leaderboard
def participant_payload(db: Session, event: ArenaEvent, participant: EventParticipant, connected_ids: set[int] | None) -> dict:
    student = db.get(Student, participant.student_id)
    if student is None:
        return {"student_id": participant.student_id, "name": "?", "score": participant.score}
    # Each participant runs their own set: report THEIR total, not the seed's.
    total = len(participant.question_ids or []) or (
        db.scalar(select(func.count(EventQuestion.id)).where(EventQuestion.event_id == event.id)) or 0
    )
    return {
        "student_id": student.id,
        "name": student.name,
        "initials": student.name.split(" ")[0][:2].upper() if student.name else "?",
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
        "level": _level(student),
        "score": participant.score,
        "correct": participant.correct_count,
        "wrong": participant.wrong_count,
        "answered": participant.answered,
        "questions_total": total,
        "streak": participant.streak,
        "best_streak": participant.best_streak,
        "finished": participant.finished,
        "position": participant.position,
        "rewards": participant.rewards or {},
        "connected": connected_ids is None or participant.student_id in connected_ids,
    }


def leaderboard_payload(db: Session, event: ArenaEvent, student_id: int | None, connected_ids: set[int] | None = None) -> dict:
    """Server-side ranking. Large events only ship the top, the viewer's own
    row and a handful of neighbours — never the whole field."""
    rows = sorted(participants(db, event), key=lambda p: (-p.score, -p.correct_count, p.started_at))
    ranked = [participant_payload(db, event, p, connected_ids) for p in rows]
    for i, row in enumerate(ranked):
        row["position"] = i + 1
    top = ranked[:LEADERBOARD_TOP]
    mine = next((row for row in ranked if row["student_id"] == student_id), None) if student_id else None
    nearby = []
    if mine is not None:
        position = mine["position"]
        nearby = ranked[max(0, position - 3) : position + 2]
    active = sum(1 for p in rows if p.last_seen is not None and (utcnow() - p.last_seen).total_seconds() < 90)
    return {"top": top, "mine": mine, "nearby": nearby, "total": len(rows), "active": active}


def activity_payload(db: Session, event: ArenaEvent, limit: int = 8) -> list[dict]:
    """Lightweight live activity — milestones only, never per-answer spam."""
    now = time.time()
    last = _last_activity.get(event.id, 0.0)
    if now - last < ACTIVITY_COOLDOWN:
        return []
    _last_activity[event.id] = now
    rows = sorted(participants(db, event), key=lambda p: (-p.score, -p.correct_count, p.started_at))
    if not rows:
        return []
    items: list[dict] = []
    leader = rows[0]
    student = db.get(Student, leader.student_id)
    if student and leader.score > 0:
        items.append({"text": f"{student.name} reached {leader.score:,} points", "at": _iso(utcnow())})
    active = sum(1 for p in rows if p.last_seen is not None and (utcnow() - p.last_seen).total_seconds() < 90)
    if active:
        items.append({"text": f"{active} players currently active", "at": _iso(utcnow())})
    return items


# --------------------------------------------------------------------- review
def review_payload(db: Session, event: ArenaEvent, student_id: int) -> dict:
    """Post-event review of MY OWN set — other players' questions stay private."""
    participant = participant_for(db, event.id, student_id)
    if participant is not None and (participant.question_ids or []):
        questions = _participant_questions(db, event, participant)
    else:
        questions = [
            q
            for q in (db.get(Question, row.question_id) for row in _event_questions(db, event))
            if q is not None
        ]
    items = []
    for index, question in enumerate(questions):
        mine = db.scalar(
            select(EventAnswer).where(
                EventAnswer.event_id == event.id,
                EventAnswer.question_id == question.id,
                EventAnswer.student_id == student_id,
            )
        )
        items.append(
            {
                "index": index,
                "question": question_public(question, reveal=True),
                "selected": mine.selected if mine else None,
                "correct": mine.correct if mine else False,
                "points": mine.points if mine else 0,
            }
        )
    return {"event_id": event.id, "items": items}
