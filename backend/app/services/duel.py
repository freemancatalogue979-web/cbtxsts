"""Live head-to-head duel engine (REST writes + websocket fan-out).

Answers are recorded through REST so nothing is lost if a socket blips; the
websocket is used purely to push live score updates, invites and results.
"""
from __future__ import annotations

import random
import string
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import game
from ..config import (
    DUEL_BASE_POINTS,
    DUEL_QUESTION_COUNT,
    DUEL_SPEED_BONUS_MAX,
    DUEL_STAKE_COINS,
    DUEL_TIME_LIMIT_SECONDS,
)
from ..events import Event, to_everyone, to_room, to_student
from ..models import Duel, DuelAnswer, DuelParticipant, DuelQuestion, Question, Quiz, Student, utcnow
from .questions import answer_matches, mastery_scope_update, register_question_attempt

INVITE_TTL_SECONDS = 600  # 10 minutes to accept before an invite expires
COMBO_STEP = 4
COMBO_CAP = 24
SPEED_WINDOW_SECONDS = 20


class DuelError(Exception):
    """Raised for user-facing duel failures."""


def duel_room(duel_id: int) -> str:
    return f"duel:{duel_id}"


def _make_code(db: Session) -> str:
    alphabet = string.ascii_uppercase.replace("O", "") + "23456789"
    for _ in range(20):
        code = "".join(random.choice(alphabet) for _ in range(6))
        if not db.scalar(select(Duel.id).where(Duel.code == code)):
            return code
    return f"D{random.randint(10000, 99999)}"


def question_pool(
    db: Session,
    quiz_id: int | None,
    course_id: int | None = None,
    *,
    topic: str = "",
    difficulty: str = "",
) -> list[Question]:
    query = (
        select(Question)
        .join(Quiz, Quiz.id == Question.quiz_id)
        .where(Quiz.allow_duel.is_(True), Quiz.status != "draft")
        # Staff can take a question out of competitive play without deleting it.
        .where(Question.duel_enabled.is_(True), Question.visible.is_(True), Question.status == "approved")
    )
    if quiz_id:
        query = query.where(Question.quiz_id == quiz_id)
    else:
        # Course duel: that course's bank only. Random duel: the whole bank.
        # Drawn exam copies (source_id set) stay out of the global pools.
        query = query.where(Question.source_id.is_(None))
        if course_id:
            query = query.where(Question.course_id == course_id)
    if topic:
        query = query.where(func.lower(Question.topic) == topic.lower())
    if difficulty:
        query = query.where(Question.difficulty == difficulty.lower())
    return list(db.scalars(query).all())


def build_duel_questions(
    db: Session,
    duel: Duel,
    quiz_id: int | None,
    count: int,
    course_id: int | None = None,
    *,
    topic: str = "",
    difficulty: str = "",
) -> list[Question]:
    pool = question_pool(db, quiz_id, course_id=course_id, topic=topic, difficulty=difficulty)
    if not pool and topic:
        # A topic that matches nothing must never dead-end a challenge (older
        # clients sent free-text topics): widen the pool but keep the duel's
        # recorded topic for display.
        pool = question_pool(db, quiz_id, course_id=course_id, topic="", difficulty=difficulty)
    if not pool:
        raise DuelError("No duel-ready questions are available yet. Ask an admin to activate a quiz.")
    picks = random.sample(pool, min(count, len(pool)))
    for position, question in enumerate(picks, start=1):
        db.add(DuelQuestion(duel=duel, question_id=question.id, position=position))
    duel.question_count = len(picks)
    db.flush()
    return picks


def resolve_opponent(db: Session, *, phone: str | None, student_id: int | None, me: Student) -> Student:
    target: Student | None = db.get(Student, student_id) if student_id else None
    if target is None and phone:
        target = db.scalar(select(Student).where(Student.phone == phone))
    if target is None:
        raise DuelError("No arena player found with those details.")
    if target.id == me.id:
        raise DuelError("You cannot duel yourself.")
    if target.is_banned:
        raise DuelError("That player is not available for duels.")
    return target


def _participant_for(duel: Duel, student_id: int) -> DuelParticipant | None:
    return next((p for p in duel.participants if p.student_id == student_id), None)


def create_duel(
    db: Session,
    challenger: Student,
    *,
    opponent: Student,
    quiz_id: int | None = None,
    course_id: int | None = None,
    topic: str = "General Arena",
    question_count: int = DUEL_QUESTION_COUNT,
    stake_coins: int = DUEL_STAKE_COINS,
    mode: str = "casual",
    best_of: int = 1,
    series_id: str = "",
    game_index: int = 1,
    rematch_of: int | None = None,
    difficulty: str = "",
    sudden_death: bool = False,
) -> tuple[Duel, list[Event]]:
    stake = max(0, min(stake_coins, challenger.coins))
    duel = Duel(
        code=_make_code(db),
        topic=topic or "General Arena",
        quiz_id=quiz_id,
        course_id=course_id if quiz_id is None else None,
        status="invited",
        stake_coins=stake,
        question_count=question_count,
        time_limit_seconds=DUEL_TIME_LIMIT_SECONDS,
        expires_at=utcnow() + timedelta(seconds=INVITE_TTL_SECONDS),
        mode=mode if mode in {"casual", "ranked", "friendly", "tournament"} else "casual",
        best_of=best_of if best_of in {1, 3, 5} else 1,
        series_id=series_id or f"S{challenger.id}{utcnow().strftime('%H%M%S')}",
        game_index=max(1, int(game_index)),
        rematch_of=rematch_of,
        difficulty=difficulty or "",
        sudden_death=bool(sudden_death),
        topic_filter=topic or "",
    )
    db.add(duel)
    db.flush()
    db.add(DuelParticipant(duel=duel, student_id=challenger.id, seat="challenger"))
    db.add(DuelParticipant(duel=duel, student_id=opponent.id, seat="opponent"))
    build_duel_questions(
        db, duel, duel.quiz_id, question_count, course_id=duel.course_id, topic=topic, difficulty=difficulty
    )

    from ..serializers import duel_public

    invite = duel_public(duel, viewer_id=opponent.id)
    invite["challenger_name"] = challenger.name
    return duel, [
        to_student(opponent.id, "duel_invite", invite),
        to_student(challenger.id, "duel_created", duel_public(duel, viewer_id=challenger.id)),
    ]


def start_duel(db: Session, duel: Duel) -> list[Event]:
    if duel.status == "finished":
        raise DuelError("This duel is already over.")
    if duel.status == "live":
        return []
    if len(duel.participants) < 2:
        raise DuelError("Waiting for a second player.")

    # Never block a match over coins: stake is clamped to what both players hold.
    effective_stake = min([duel.stake_coins] + [p.student.coins for p in duel.participants])
    duel.stake_coins = max(0, effective_stake)

    now = utcnow()
    for participant in duel.participants:
        participant.student.coins -= duel.stake_coins
    duel.status = "live"
    duel.started_at = now
    duel.expires_at = now + timedelta(seconds=duel.time_limit_seconds)
    db.flush()

    from ..serializers import duel_public, iso

    room = duel_room(duel.id)
    events: list[Event] = []
    for participant in duel.participants:
        payload = duel_public(duel, viewer_id=participant.student_id, include_questions=True)
        payload["deadline"] = iso(duel.expires_at)
        events.append(to_student(participant.student_id, "duel_start", payload))
    events.append(to_room(room, "duel_live", {"duel_id": duel.id, "status": "live", "stake": duel.stake_coins}))
    return events


def accept_duel(db: Session, duel: Duel, student: Student) -> list[Event]:
    if _participant_for(duel, student.id) is None:
        raise DuelError("You are not part of this duel.")
    if duel.status != "invited":
        raise DuelError("This duel is no longer open.")
    return start_duel(db, duel)


def decline_duel(db: Session, duel: Duel, student: Student) -> list[Event]:
    if _participant_for(duel, student.id) is None:
        raise DuelError("You are not part of this duel.")
    if duel.status != "invited":
        raise DuelError("This duel has already started.")
    duel.status = "cancelled"
    db.flush()
    return _notify_both(db, duel, "duel_cancelled", {"reason": "declined", "by": student.id})


def cancel_duel(db: Session, duel: Duel, student: Student) -> list[Event]:
    if _participant_for(duel, student.id) is None:
        raise DuelError("You are not part of this duel.")
    if duel.status == "finished":
        raise DuelError("This duel already finished.")
    was_live = duel.status == "live"
    duel.status = "cancelled"
    if was_live:  # stakes were taken at start, give them back
        for participant in duel.participants:
            participant.student.coins += duel.stake_coins
    db.flush()
    return _notify_both(db, duel, "duel_cancelled", {"reason": "cancelled", "by": student.id})


def _notify_both(db: Session, duel: Duel, event: str, data: dict) -> list[Event]:
    from ..serializers import duel_public

    base = duel_public(duel)
    base.update(data)
    events = [to_room(duel_room(duel.id), event, dict(base))]
    events += [to_student(p.student_id, event, dict(base)) for p in duel.participants]
    return events


def score_for(correct: bool, elapsed_ms: int, run_before: int) -> int:
    """Base points + speed bonus + combo bonus. Wrong answers score nothing."""
    if not correct:
        return 0
    seconds = max(0.0, elapsed_ms / 1000)
    speed = int(round(DUEL_SPEED_BONUS_MAX * max(0.0, 1 - seconds / SPEED_WINDOW_SECONDS)))
    combo = min(COMBO_CAP, max(0, run_before) * COMBO_STEP)
    return DUEL_BASE_POINTS + speed + combo


def record_answer(
    db: Session,
    duel: Duel,
    student: Student,
    *,
    question_id: int,
    selected: str,
    elapsed_ms: int = 0,
) -> list[Event]:
    participant = _participant_for(duel, student.id)
    if participant is None:
        raise DuelError("You are not part of this duel.")
    if duel.status != "live":
        raise DuelError("This duel is not live.")
    if duel.expires_at and duel.expires_at < utcnow():
        return finalize_duel(db, duel, reason="time_up")

    slot = next((row for row in duel.questions if row.question_id == question_id), None)
    if slot is None:
        raise DuelError("That question is not part of this duel.")
    if db.scalar(
        select(DuelAnswer.id).where(
            DuelAnswer.duel_id == duel.id,
            DuelAnswer.student_id == student.id,
            DuelAnswer.question_id == question_id,
        )
    ):
        raise DuelError("You have already answered that question.")

    question: Question = slot.question
    is_correct = answer_matches(question.correct, selected)
    run_before = participant.current_run
    participant.current_run = run_before + 1 if is_correct else 0
    participant.best_run = max(participant.best_run, participant.current_run)
    student.best_run = max(student.best_run, participant.best_run)

    points = score_for(is_correct, elapsed_ms, run_before)
    db.add(
        DuelAnswer(
            duel_id=duel.id,
            student_id=student.id,
            question_id=question_id,
            selected=selected.upper(),
            is_correct=is_correct,
            points=points,
            elapsed_ms=max(0, int(elapsed_ms)),
        )
    )
    participant.score += points
    participant.answered_count += 1
    participant.correct_count += 1 if is_correct else 0
    register_question_attempt(db, question, correct=is_correct, elapsed_ms=int(elapsed_ms or 0))
    mastery_scope_update(db, participant.student_id, scope_type="difficulty", scope_key=question.difficulty, correct=is_correct)
    if question.topic:
        mastery_scope_update(db, participant.student_id, scope_type="topic", scope_key=question.topic, correct=is_correct)
    db.flush()

    events = [
        to_room(
            duel_room(duel.id),
            "duel_progress",
            {
                "duel_id": duel.id,
                "student_id": student.id,
                "question_order": slot.position,
                "correct": is_correct,
                "points": points,
                "score": participant.score,
                "answered": participant.answered_count,
                "total": duel.question_count,
                "run": participant.current_run,
                "elapsed_ms": max(0, int(elapsed_ms)),
            },
        )
    ]

    if participant.answered_count >= duel.question_count and participant.finished_at is None:
        participant.finished_at = utcnow()
        db.flush()

    if all(p.answered_count >= duel.question_count for p in duel.participants):
        events.extend(finalize_duel(db, duel))
    return events


def finalize_duel(db: Session, duel: Duel, *, reason: str = "completed") -> list[Event]:
    if duel.status == "finished":
        return []

    participants = sorted(
        duel.participants,
        key=lambda p: (-p.score, p.finished_at or utcnow(), p.student_id),
    )
    top = participants[0]
    runner_up = participants[1] if len(participants) > 1 else None
    draw = bool(runner_up and runner_up.score == top.score)

    duel.status = "finished"
    duel.finished_at = utcnow()
    duel.winner_id = None if draw else top.student_id
    stake = duel.stake_coins

    rewards_by_player: dict[int, list[dict]] = {}
    for participant in duel.participants:
        player = participant.student
        player.duels_played += 1
        is_winner = not draw and participant.student_id == duel.winner_id
        rival = runner_up.student.name if (runner_up and runner_up.student) else "a rival"
        if is_winner:
            player.duels_won += 1
            xp, coins = 120 + participant.correct_count * 6, stake * 2 + 25
            title = f"Duel won vs {rival}"
        elif draw:
            xp, coins = 70 + participant.correct_count * 4, stake
            title = "Duel drawn"
        else:
            player.duels_lost += 1
            xp, coins = 45 + participant.correct_count * 4, 0
            title = f"Duel lost vs {top.student.name if top.student else rival}"
        rewards_by_player[player.id] = game.grant(
            db,
            player,
            xp=xp,
            coins=coins,
            kind="duel",
            title=title,
            detail=f"{participant.correct_count}/{duel.question_count} correct • {participant.score} points",
        )

    from ..serializers import duel_public
    from .exam import top_leaderboard

    payload = duel_public(duel, reveal=True, include_questions=True)
    payload.update({"reason": reason, "draw": draw, "winner_id": duel.winner_id})
    room = duel_room(duel.id)
    events: list[Event] = [to_room(room, "duel_finished", dict(payload))]
    for participant in duel.participants:
        personal = dict(payload)
        personal["rewards"] = rewards_by_player.get(participant.student_id, [])
        events.append(to_student(participant.student_id, "duel_result", personal))
    events.append(to_everyone("leaderboard", {"scope": "global", "rows": top_leaderboard(db, limit=10)}))
    return events


def expire_duels(db: Session) -> list[Event]:
    """Finish live duels whose clock ran out; cancel stale invites."""
    now = utcnow()
    events: list[Event] = []

    live = db.scalars(
        select(Duel).where(Duel.status == "live", Duel.expires_at.is_not(None), Duel.expires_at < now)
    ).all()
    for duel in live:
        for participant in duel.participants:
            if participant.answered_count < duel.question_count:
                participant.forfeited = participant.answered_count == 0
                participant.finished_at = now
        db.flush()
        events.extend(finalize_duel(db, duel, reason="time_up"))

    stale = db.scalars(
        select(Duel).where(Duel.status == "invited", Duel.expires_at.is_not(None), Duel.expires_at < now)
    ).all()
    for duel in stale:
        duel.status = "expired"
        events.extend(_notify_both(db, duel, "duel_expired", {"duel_id": duel.id}))

    if live or stale:
        db.commit()
    return events


def quick_match(
    db: Session,
    student: Student,
    online_ids: list[int],
    *,
    question_count: int = DUEL_QUESTION_COUNT,
    stake_coins: int = 0,
    quiz_id: int | None = None,
    course_id: int | None = None,
    mode: str = "casual",
    best_of: int = 1,
    difficulty: str = "",
    sudden_death: bool = False,
) -> tuple[Duel, list[Event]]:
    """Accept a pending invite, else match with any idle online player."""
    pending = db.scalars(
        select(Duel)
        .join(DuelParticipant, DuelParticipant.duel_id == Duel.id)
        .where(Duel.status == "invited", DuelParticipant.student_id == student.id)
        .order_by(Duel.created_at.desc())
    ).all()
    if pending:
        return pending[0], accept_duel(db, pending[0], student)

    busy = set(
        db.scalars(
            select(DuelParticipant.student_id)
            .join(Duel, Duel.id == DuelParticipant.duel_id)
            .where(Duel.status.in_(["invited", "live"]))
        ).all()
    )
    candidates = [sid for sid in online_ids if sid != student.id and sid not in busy]
    if not candidates:
        raise DuelError("No idle opponents are online right now — challenge a friend by phone number instead.")

    opponent = db.get(Student, random.choice(candidates))
    if opponent is None:
        raise DuelError("Matchmaking failed. Try again.")

    duel, events = create_duel(
        db,
        student,
        opponent=opponent,
        quiz_id=quiz_id,
        course_id=course_id,
        topic="Quick Match",
        question_count=question_count,
        stake_coins=stake_coins,
        mode=mode,
        best_of=best_of,
        difficulty=difficulty,
        sudden_death=sudden_death,
    )
    events.extend(start_duel(db, duel))
    return duel, events


def join_by_code(db: Session, student: Student, code: str) -> tuple[Duel, list[Event]]:
    duel = db.scalar(select(Duel).where(Duel.code == (code or "").strip().upper()))
    if duel is None:
        raise DuelError("No duel found with that code.")
    if _participant_for(duel, student.id):
        return duel, (accept_duel(db, duel, student) if duel.status == "invited" else [])
    if duel.status != "invited":
        raise DuelError("That duel is already underway.")
    db.add(DuelParticipant(duel=duel, student_id=student.id, seat="opponent"))
    db.flush()
    return duel, start_duel(db, duel)


def open_duel(
    db: Session,
    student: Student,
    *,
    topic: str = "Open Arena",
    question_count: int = DUEL_QUESTION_COUNT,
    stake_coins: int = 0,
    quiz_id: int | None = None,
    course_id: int | None = None,
    mode: str = "casual",
    best_of: int = 1,
    difficulty: str = "",
) -> tuple[Duel, list[Event]]:
    """Public challenge anyone can join with the code."""
    stake = max(0, min(stake_coins, student.coins))
    duel = Duel(
        code=_make_code(db),
        topic=topic,
        quiz_id=quiz_id,
        course_id=course_id if quiz_id is None else None,
        status="invited",
        stake_coins=stake,
        question_count=question_count,
        time_limit_seconds=DUEL_TIME_LIMIT_SECONDS,
        expires_at=utcnow() + timedelta(seconds=INVITE_TTL_SECONDS),
        mode=mode if mode in {"casual", "ranked", "friendly", "tournament"} else "casual",
        best_of=best_of if best_of in {1, 3, 5} else 1,
        difficulty=difficulty or "",
        series_id=f"O{student.id}{utcnow().strftime('%H%M%S')}",
    )
    db.add(duel)
    db.flush()
    db.add(DuelParticipant(duel=duel, student_id=student.id, seat="challenger"))
    build_duel_questions(
        db, duel, duel.quiz_id, question_count, course_id=duel.course_id, topic=topic, difficulty=difficulty
    )

    from ..serializers import duel_public

    return duel, [to_everyone("duel_open", duel_public(duel, viewer_id=student.id))]


def active_duels_for(db: Session, student_id: int) -> list[Duel]:
    return list(
        db.scalars(
            select(Duel)
            .join(DuelParticipant, DuelParticipant.duel_id == Duel.id)
            .where(
                DuelParticipant.student_id == student_id,
                or_(Duel.status == "invited", Duel.status == "live"),
            )
            .order_by(Duel.created_at.desc())
        ).all()
    )
