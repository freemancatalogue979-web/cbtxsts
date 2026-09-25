"""Study-group community engine.

Everything group-scoped runs through here: membership and permission checks
(always server-side), the activity feed, per-member notifications, chat
serialisation and the group quiz lifecycle. Routers stay thin; the websocket
room name is ``study_group:{id}`` so only members holding a socket in that
room ever receive the group's live data.
"""
from __future__ import annotations

import json
import random
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..events import Event, to_room, to_student
from ..models import (
    Course,
    GroupMessage,
    InboxNote,
    Question,
    Student,
    StudyGroup,
    StudyGroupActivity,
    StudyGroupAnnouncement,
    StudyGroupMember,
    StudyGroupNotification,
    StudyGroupQuestion,
    StudyGroupQuestionReply,
    StudyGroupQuiz,
    StudyGroupQuizAnswer,
    StudyGroupQuizParticipant,
    StudyGroupQuizQuestion,
    utcnow,
)
from .questions import answer_matches, display_order, label_to_key, mastery_scope_update, register_question_attempt

MAX_QUIZ_QUESTIONS = 100
MAX_DUEL_QUESTIONS = 100
ROOM_PREFIX = "study_group:"

# ---------------------------------------------------------------------------
# Rooms, membership, permissions
# ---------------------------------------------------------------------------
def group_room(group_id: int) -> str:
    return f"{ROOM_PREFIX}{group_id}"


ROLE_RANK = {"member": 1, "moderator": 2, "owner": 3}


def role_rank(role: str) -> int:
    return ROLE_RANK.get(role or "member", 1)


# Permission matrix — the single source of truth. Every router call goes
# through ``can()`` so nothing privileged is ever decided in the browser.
_STAFF_ACTIONS = {
    "publish_announcements",
    "manage_announcements",
    "set_quiz",
    "manage_quizzes",
    "moderate_chat",
    "moderate_questions",
    "remove_members",
    "invite_members",
}
_OWNER_ACTIONS = {
    "edit_group",
    "assign_moderators",
    "manage_members",
    "view_analytics",
    "delete_group",
}
_MEMBER_ACTIONS = {
    "chat",
    "join_quizzes",
    "ask_questions",
    "answer_questions",
    "challenge_duels",
    "invite_members",
    "view_activity",
}


def can(role: str, action: str) -> bool:
    rank = role_rank(role)
    if action in _OWNER_ACTIONS:
        return rank >= 3
    if action in _STAFF_ACTIONS:
        return rank >= 2
    if action in _MEMBER_ACTIONS:
        return rank >= 1
    return False


def permissions_for(role: str) -> dict[str, bool]:
    actions = sorted(_OWNER_ACTIONS | _STAFF_ACTIONS | _MEMBER_ACTIONS)
    return {action: can(role, action) for action in actions}


class GroupError(Exception):
    """User-facing group failure (403/404/409 material)."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def membership(db: Session, group_id: int, student_id: int) -> StudyGroupMember | None:
    return db.scalar(
        select(StudyGroupMember).where(
            StudyGroupMember.group_id == group_id, StudyGroupMember.student_id == student_id
        )
    )


def require_group(db: Session, group_id: int) -> StudyGroup:
    group = db.get(StudyGroup, group_id)
    if group is None:
        raise GroupError("Group not found.", 404)
    return group


def require_member(db: Session, group_id: int, student: Student) -> StudyGroupMember:
    member = membership(db, group_id, student.id)
    if member is None:
        raise GroupError("Join the group first.", 403)
    return member


def require_permission(db: Session, group_id: int, student: Student, action: str) -> StudyGroupMember:
    member = require_member(db, group_id, student)
    if not can(member.role, action):
        raise GroupError("You do not have permission to do that in this group.", 403)
    return member


# ---------------------------------------------------------------------------
# Activity feed + notifications
# ---------------------------------------------------------------------------
def log_activity(
    db: Session,
    group: StudyGroup,
    *,
    kind: str,
    text: str,
    actor: Student | None = None,
    meta: dict | None = None,
    broadcast: bool = True,
) -> tuple[StudyGroupActivity, list[Event]]:
    """Append to the group activity feed and (optionally) fan it to the room."""
    row = StudyGroupActivity(
        group_id=group.id,
        actor_id=actor.id if actor else None,
        kind=kind,
        text=text[:280],
        meta=meta or {},
    )
    db.add(row)
    db.flush()
    events: list[Event] = []
    if broadcast:
        events.append(to_room(group_room(group.id), "group_activity", activity_public(row)))
    return row, events


def notify_members(
    db: Session,
    group: StudyGroup,
    student_ids: list[int],
    *,
    kind: str,
    title: str,
    message: str = "",
    meta: dict | None = None,
    inbox: bool = False,
) -> list[Event]:
    """Per-member group notifications (the group bell) + optional global inbox.

    ``inbox=True`` also writes an ``InboxNote`` so the arena-wide bell picks it
    up — reserved for things aimed at *you* (a reply, a challenge, your quiz
    result), never for whole-group broadcasts.
    """
    events: list[Event] = []
    payload_meta = {"group_id": group.id, "group_name": group.name, **(meta or {})}
    for student_id in student_ids:
        row = StudyGroupNotification(
            group_id=group.id,
            student_id=student_id,
            kind=kind,
            title=title[:180],
            message=message[:400],
            meta=payload_meta,
        )
        db.add(row)
        db.flush()
        payload = notification_public(row)
        events.append(to_student(student_id, "group_notification", payload))
        if inbox:
            note = InboxNote(
                student_id=student_id,
                kind="general",
                title=f"{group.name}: {title}"[:180],
                message=message[:400],
                meta=json.dumps(payload_meta, default=str)[:2000],
            )
            db.add(note)
            db.flush()
            from ..routers.social import _note_public

            events.append(to_student(student_id, "notify", _note_public(note)))
    return events


def broadcast_group(db: Session, group: StudyGroup, event: str, data: dict) -> Event:
    return to_room(group_room(group.id), event, {"group_id": group.id, **data})


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------
def _iso(value) -> str | None:
    from ..serializers import iso

    return iso(value)


def _student_chip(student: Student | None) -> dict[str, Any]:
    if student is None:
        return {"id": 0, "name": "Former member", "initials": "?", "avatar_hue": 265, "has_photo": False}
    from ..serializers import initials

    return {
        "id": student.id,
        "name": student.name,
        "initials": initials(student.name),
        "avatar_hue": student.avatar_hue,
        "has_photo": bool(student.photo),
    }


def member_public(member: StudyGroupMember, *, week_key: str = "") -> dict[str, Any]:
    student = member.student
    payload = {
        "student_id": member.student_id,
        "role": member.role,
        "joined_at": _iso(member.joined_at),
        "week_xp": member.week_xp if (not week_key or member.week_key == week_key) else 0,
        **_student_chip(student),
    }
    if student is not None:
        progress = game.level_progress(student.xp)
        payload["level"] = progress["level"]
        payload["title"] = progress["title"]
        payload["xp"] = student.xp
        payload["duels_won"] = student.duels_won
        payload["duels_played"] = student.duels_played
    return payload


def group_public(db: Session, group: StudyGroup, viewer: Student | None) -> dict[str, Any]:
    member_count = int(
        db.scalar(select(func.count(StudyGroupMember.id)).where(StudyGroupMember.group_id == group.id)) or 0
    )
    member = membership(db, group.id, viewer.id) if viewer else None
    owner = db.get(Student, group.owner_id)
    course = db.get(Course, group.course_id) if group.course_id else None
    return {
        "id": group.id,
        "code": group.code,
        "name": group.name,
        "description": group.description,
        "goal": group.goal,
        "owner_id": group.owner_id,
        "owner_name": owner.name if owner else "",
        "course_id": group.course_id,
        "course_title": course.title if course else "",
        "member_count": member_count,
        "is_member": member is not None,
        "is_owner": group.owner_id == (viewer.id if viewer else -1),
        "my_role": member.role if member else None,
        "permissions": permissions_for(member.role) if member else {},
        "created_at": _iso(group.created_at),
    }


def message_public(message: GroupMessage, *, viewer_id: int | None = None, reply: GroupMessage | None = None) -> dict[str, Any]:
    deleted = bool(message.deleted)
    try:
        reactions = json.loads(message.reactions or "{}")
    except ValueError:
        reactions = {}
    student = message.student
    role = ""
    # NOTE: the student chip is splatted FIRST — it carries a student ``id`` that
    # would otherwise clobber the message's own primary key. Every message field
    # is set after it so ``id`` is the message id (replies, edits, deletes and
    # reactions all address a message by this id).
    payload: dict[str, Any] = {
        **_student_chip(student),
        "id": message.id,
        "group_id": message.group_id,
        "student_id": message.student_id,
        "kind": message.kind,
        "body": "" if deleted else message.body,
        "deleted": deleted,
        "created_at": _iso(message.created_at),
        "edited_at": _iso(message.edited_at) if message.edited_at else None,
        "reactions": {emoji: len(ids) for emoji, ids in reactions.items() if isinstance(ids, list)},
        "my_reactions": [
            emoji for emoji, ids in reactions.items() if isinstance(ids, list) and viewer_id in ids
        ],
        "reply_to": None,
    }
    if reply is not None:
        reply_student = reply.student
        payload["reply_to"] = {
            "id": reply.id,
            "student_id": reply.student_id,
            "name": reply_student.name if reply_student else "Former member",
            "body": "" if reply.deleted else (reply.body or "")[:160],
            "deleted": bool(reply.deleted),
        }
    elif message.reply_to_id:
        payload["reply_to"] = {"id": message.reply_to_id, "student_id": 0, "name": "", "body": "", "deleted": False}
    return payload


def announcement_public(row: StudyGroupAnnouncement) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "image": row.image,
        "priority": row.priority,
        "pinned": bool(row.pinned),
        "scheduled_at": _iso(row.scheduled_at),
        "created_at": _iso(row.created_at),
        "author": _student_chip(row.author),
    }


def activity_public(row: StudyGroupActivity) -> dict[str, Any]:
    return {
        "id": row.id,
        "kind": row.kind,
        "text": row.text,
        "meta": row.meta or {},
        "created_at": _iso(row.created_at),
        "actor": _student_chip(row.actor) if row.actor_id else None,
    }


def notification_public(row: StudyGroupNotification) -> dict[str, Any]:
    return {
        "id": row.id,
        "group_id": row.group_id,
        "kind": row.kind,
        "title": row.title,
        "message": row.message,
        "meta": row.meta or {},
        "read": row.read_at is not None,
        "created_at": _iso(row.created_at),
    }


def quiz_public(
    db: Session,
    quiz: StudyGroupQuiz,
    *,
    viewer_id: int | None = None,
    participant: StudyGroupQuizParticipant | None = None,
) -> dict[str, Any]:
    _refresh_quiz_status(db, quiz)
    participants = int(
        db.scalar(
            select(func.count(func.distinct(StudyGroupQuizParticipant.student_id))).where(
                StudyGroupQuizParticipant.quiz_id == quiz.id
            )
        )
        or 0
    )
    submitted = int(
        db.scalar(
            select(func.count(StudyGroupQuizParticipant.id)).where(
                StudyGroupQuizParticipant.quiz_id == quiz.id, StudyGroupQuizParticipant.status == "submitted"
            )
        )
        or 0
    )
    creator = db.get(Student, quiz.created_by) if quiz.created_by else None
    payload: dict[str, Any] = {
        "id": quiz.id,
        "title": quiz.title,
        "description": quiz.description,
        "course_id": quiz.course_id,
        "course_title": quiz.course.title if quiz.course else "",
        "topic": quiz.topic,
        "question_count": quiz.question_count,
        "per_question_seconds": quiz.per_question_seconds,
        "duration_minutes": quiz.duration_minutes,
        "starts_at": _iso(quiz.starts_at),
        "ends_at": _iso(quiz.ends_at),
        "max_attempts": quiz.max_attempts,
        "randomize": bool(quiz.randomize),
        "visibility": quiz.visibility,
        "reward_xp": quiz.reward_xp,
        "reward_coins": quiz.reward_coins,
        "pass_score": quiz.pass_score,
        "status": quiz.status,
        "participants": participants,
        "submitted": submitted,
        "created_at": _iso(quiz.created_at),
        "created_by": _student_chip(creator),
        "my_participation": None,
    }
    if participant is not None:
        payload["my_participation"] = {
            "id": participant.id,
            "attempt_no": participant.attempt_no,
            "status": participant.status,
            "answered": participant.answered,
            "correct_count": participant.correct_count,
            "score": participant.score,
            "percentage": round(participant.percentage, 1),
            "passed": bool(participant.passed),
            "position": participant.position,
            "current_index": participant.current_index,
            "deadline_at": _iso(participant.deadline_at),
            "started_at": _iso(participant.started_at),
            "submitted_at": _iso(participant.submitted_at),
        }
    elif viewer_id is not None:
        latest = db.scalar(
            select(StudyGroupQuizParticipant)
            .where(
                StudyGroupQuizParticipant.quiz_id == quiz.id,
                StudyGroupQuizParticipant.student_id == viewer_id,
            )
            .order_by(StudyGroupQuizParticipant.attempt_no.desc())
        )
        if latest is not None:
            return quiz_public(db, quiz, viewer_id=viewer_id, participant=latest)
    return payload


def question_public(
    db: Session,
    row: StudyGroupQuestion,
    *,
    viewer_id: int | None = None,
    include_replies: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "attachment": row.attachment,
        "topic": row.topic,
        "course_id": row.course_id,
        "course_title": row.course.title if row.course else "",
        "status": row.status,
        "answers_count": row.answers_count,
        "best_answer_id": row.best_answer_id,
        "resolved": bool(row.resolved),
        "created_at": _iso(row.created_at),
        "asker": _student_chip(row.asker),
        "is_mine": bool(viewer_id and row.asker_id == viewer_id),
    }
    if include_replies:
        replies = db.scalars(
            select(StudyGroupQuestionReply)
            .where(StudyGroupQuestionReply.question_id == row.id)
            .order_by(StudyGroupQuestionReply.created_at.asc(), StudyGroupQuestionReply.id.asc())
            .limit(200)
        ).all()
        payload["replies"] = [reply_public(reply, viewer_id=viewer_id) for reply in replies]
    return payload


def reply_public(row: StudyGroupQuestionReply, *, viewer_id: int | None = None) -> dict[str, Any]:
    try:
        useful = [int(value) for value in json.loads(row.useful or "[]")]
    except ValueError:
        useful = []
    return {
        "id": row.id,
        "question_id": row.question_id,
        "parent_id": row.parent_id,
        "body": row.body,
        "is_best": bool(row.is_best),
        "useful_count": len(useful),
        "marked_useful": viewer_id in useful,
        "created_at": _iso(row.created_at),
        "author": _student_chip(row.student),
    }


# ---------------------------------------------------------------------------
# Presence — no polling: derived from the websocket hub
# ---------------------------------------------------------------------------
def presence_status(student_id: int, group_id: int) -> str:
    from ..ws import hub

    room = group_room(group_id)
    for client in hub.clients_for(student_id):
        if room in client.rooms:
            return "away" if getattr(client, "status", "online") == "away" else "online"
    if hub.is_online(student_id):
        return "away"
    return "offline"


def online_member_ids(group_id: int) -> set[int]:
    from ..ws import hub

    return hub.student_ids_in_room(group_room(group_id))


# ---------------------------------------------------------------------------
# Group quizzes — the server owns the question set, the clock and the score
# ---------------------------------------------------------------------------
def _refresh_quiz_status(db: Session, quiz: StudyGroupQuiz) -> None:
    """Lazily move scheduled → live → closed as the clock passes the window."""
    now = utcnow()
    changed = False
    if quiz.status == "scheduled" and (quiz.starts_at is None or quiz.starts_at <= now):
        if quiz.ends_at is None or quiz.ends_at > now:
            quiz.status = "live"
            changed = True
        else:
            quiz.status = "closed"
            changed = True
    elif quiz.status == "live" and quiz.ends_at is not None and quiz.ends_at <= now:
        quiz.status = "closed"
        changed = True
    if changed:
        db.add(quiz)


def question_pool(db: Session, *, course_id: int | None, topic: str) -> list[Question]:
    """Approved, visible bank questions for the group quiz scope."""
    stmt = select(Question).where(
        Question.status == "approved",
        Question.visible.is_(True),
        Question.source_id.is_(None), Question.exam_only.is_(False),
    )
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    if topic.strip():
        stmt = stmt.where(func.lower(Question.topic) == topic.strip().lower())
    pool = list(db.scalars(stmt).all())
    if not pool and topic.strip():
        # A topic with no matches must never dead-end a group quiz.
        stmt = select(Question).where(
            Question.status == "approved",
            Question.visible.is_(True),
            Question.source_id.is_(None), Question.exam_only.is_(False),
        )
        if course_id:
            stmt = stmt.where(Question.course_id == course_id)
        pool = list(db.scalars(stmt).all())
    return pool


def build_quiz(
    db: Session,
    group: StudyGroup,
    creator: Student,
    *,
    title: str,
    description: str = "",
    course_id: int | None = None,
    topic: str = "",
    question_count: int = 10,
    per_question_seconds: int = 30,
    duration_minutes: int = 0,
    starts_at=None,
    ends_at=None,
    max_attempts: int = 1,
    randomize: bool = True,
    reward_xp: int = 0,
    reward_coins: int = 0,
    pass_score: int = 50,
) -> tuple[StudyGroupQuiz, list[Event]]:
    count = max(1, min(int(question_count or 10), MAX_QUIZ_QUESTIONS))
    pool = question_pool(db, course_id=course_id, topic=topic)
    if not pool:
        raise GroupError("No questions available for that course/topic yet.", 409)
    picks = random.sample(pool, min(count, len(pool)))

    quiz = StudyGroupQuiz(
        group_id=group.id,
        created_by=creator.id,
        title=title.strip()[:200],
        description=description.strip()[:1000],
        course_id=course_id,
        topic=topic.strip()[:120],
        question_count=len(picks),
        per_question_seconds=max(5, min(int(per_question_seconds or 30), 300)),
        duration_minutes=max(0, min(int(duration_minutes or 0), 240)),
        starts_at=starts_at,
        ends_at=ends_at,
        max_attempts=max(0, min(int(max_attempts if max_attempts is not None else 1), 10)),
        randomize=bool(randomize),
        reward_xp=max(0, min(int(reward_xp or 0), 5000)),
        reward_coins=max(0, min(int(reward_coins or 0), 5000)),
        pass_score=max(0, min(int(pass_score if pass_score is not None else 50), 100)),
        status="scheduled",
    )
    db.add(quiz)
    db.flush()
    if randomize:
        random.shuffle(picks)
    for position, question in enumerate(picks, start=1):
        db.add(StudyGroupQuizQuestion(quiz_id=quiz.id, question_id=question.id, position=position))
    _refresh_quiz_status(db, quiz)
    db.flush()

    events = [
        broadcast_group(
            db,
            group,
            "group_quiz_update",
            {"quiz": quiz_public(db, quiz), "action": "created"},
        )
    ]
    member_ids = [
        row.student_id
        for row in db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)).all()
        if row.student_id != creator.id
    ]
    starts_line = "starting now" if quiz.status == "live" else f"starts {_iso(quiz.starts_at) or 'soon'}"
    events += notify_members(
        db,
        group,
        member_ids,
        kind="quiz",
        title=f"Quiz published: {quiz.title}",
        message=f"{creator.name.split(' ')[0]} set a {quiz.question_count}-question group quiz, {starts_line}.",
        meta={"quiz_id": quiz.id},
    )
    _, activity_events = log_activity(
        db,
        group,
        kind="quiz",
        text=f"{creator.name.split(' ')[0]} published the quiz “{quiz.title}” ({quiz.question_count} questions).",
        actor=creator,
        meta={"quiz_id": quiz.id},
    )
    events += activity_events
    return quiz, events


def join_quiz(
    db: Session,
    group: StudyGroup,
    quiz: StudyGroupQuiz,
    student: Student,
) -> tuple[StudyGroupQuizParticipant, list[Event]]:
    _refresh_quiz_status(db, quiz)
    if quiz.status != "live":
        raise GroupError(
            "This quiz is not open right now." if quiz.status == "scheduled" else "This quiz has already closed.",
            409,
        )
    attempts = db.scalars(
        select(StudyGroupQuizParticipant).where(
            StudyGroupQuizParticipant.quiz_id == quiz.id, StudyGroupQuizParticipant.student_id == student.id
        )
    ).all()
    open_attempt = next((row for row in attempts if row.status == "in_progress"), None)
    if open_attempt is not None:
        if open_attempt.deadline_at and open_attempt.deadline_at <= utcnow():
            return submit_quiz(db, group, quiz, open_attempt, student, auto=True)
        return open_attempt, []
    if quiz.max_attempts and len(attempts) >= quiz.max_attempts:
        raise GroupError("You have used all your attempts for this quiz.", 409)

    rows = db.scalars(
        select(StudyGroupQuizQuestion).where(StudyGroupQuizQuestion.quiz_id == quiz.id).order_by(StudyGroupQuizQuestion.position)
    ).all()

    # Multiplayer rule: every member gets their OWN server-dealt set from the
    # same pool — never the same questions as the rest of the group. Members
    # trickle in over hours, so overlap avoidance is best effort (fresh
    # questions first, least-served as fallback) and a join is never blocked.
    from .question_sets import create_multiplayer_question_sets

    usage: dict[int, int] = {}
    for row in rows:
        usage[row.question_id] = usage.get(row.question_id, 0) + 1
    sibling_attempts = db.scalars(
        select(StudyGroupQuizParticipant).where(StudyGroupQuizParticipant.quiz_id == quiz.id)
    ).all()
    for attempt in sibling_attempts:
        for qid in attempt.question_ids or []:
            usage[int(qid)] = usage.get(int(qid), 0) + 1
    pool = question_pool(db, course_id=quiz.course_id, topic=quiz.topic)
    assigned = (
        create_multiplayer_question_sets(
            pool, [student.id], quiz.question_count, usage_counts=usage, strict=False
        )[student.id]
        if pool
        else []
    )

    question_ids: list[int] | None = None
    if assigned:
        question_ids = [question.id for question in assigned]
        order = list(range(1, len(question_ids) + 1))
        option_orders = {}
        if quiz.randomize:
            for question in assigned:
                option_orders[str(question.id)] = display_order(
                    question, shuffle=True, seed=f"gq:{quiz.id}:{student.id}:{question.id}"
                )
    else:
        # Fallback (bank emptied after publishing): the legacy shared set.
        order = [row.position for row in rows]
        if quiz.randomize:
            random.shuffle(order)
        option_orders = {}
        if quiz.randomize:
            for row in rows:
                question = db.get(Question, row.question_id)
                if question is not None:
                    option_orders[str(row.question_id)] = display_order(
                        question, shuffle=True, seed=f"gq:{quiz.id}:{student.id}:{row.question_id}"
                    )

    now = utcnow()
    if quiz.duration_minutes:
        seconds = quiz.duration_minutes * 60
    elif quiz.per_question_seconds:
        seconds = quiz.per_question_seconds * max(1, len(order))
    else:
        seconds = 30 * max(1, len(order))
    participant = StudyGroupQuizParticipant(
        quiz_id=quiz.id,
        student_id=student.id,
        attempt_no=len(attempts) + 1,
        question_order=order,
        option_orders=option_orders,
        question_ids=question_ids,
        deadline_at=min(now + timedelta(seconds=seconds), quiz.ends_at) if quiz.ends_at else now + timedelta(seconds=seconds),
        started_at=now,
    )
    db.add(participant)
    db.flush()
    events = [
        broadcast_group(
            db,
            group,
            "group_quiz_update",
            {"quiz": quiz_public(db, quiz, viewer_id=student.id), "action": "joined", "student_id": student.id},
        )
    ]
    return participant, events


def _ordered_questions(db: Session, quiz: StudyGroupQuiz, participant: StudyGroupQuizParticipant) -> list[Question]:
    mine = list(participant.question_ids or [])
    if mine:
        # This attempt's own server-dealt set, in its own order.
        ordered: list[Question] = []
        for question_id in mine:
            question = db.get(Question, int(question_id))
            if question is not None:
                ordered.append(question)
        if ordered:
            return ordered
    rows = {
        row.position: row
        for row in db.scalars(
            select(StudyGroupQuizQuestion).where(StudyGroupQuizQuestion.quiz_id == quiz.id)
        ).all()
    }
    ordered: list[Question] = []
    for position in participant.question_order or []:
        row = rows.get(int(position))
        if row is None:
            continue
        question = db.get(Question, row.question_id)
        if question is not None:
            ordered.append(question)
    return ordered


def quiz_question_window(
    db: Session,
    quiz: StudyGroupQuiz,
    participant: StudyGroupQuizParticipant,
    index: int,
) -> dict[str, Any]:
    """Serve one question, server-side order and per-question clock included."""
    from ..serializers import question_public

    if participant.status != "in_progress":
        raise GroupError("This attempt is already finished.", 409)
    if participant.deadline_at and participant.deadline_at <= utcnow():
        raise GroupError("Time is up for this attempt.", 409)
    questions = _ordered_questions(db, quiz, participant)
    total = len(questions)
    index = max(0, min(int(index), total - 1)) if total else 0
    answered_ids = {row.question_id for row in participant.answers}
    per_question = quiz.per_question_seconds or 0
    payload: dict[str, Any] = {
        "index": index,
        "total": total,
        "per_question_seconds": per_question,
        "deadline_at": _iso(participant.deadline_at),
        "answered_count": participant.answered,
        "answered_ids": sorted(answered_ids),
        "question": None,
    }
    if total and 0 <= index < total:
        question = questions[index]
        order = (participant.option_orders or {}).get(str(question.id))
        payload["question"] = question_public(question, reveal=False, order=order)
        payload["already_answered"] = question.id in answered_ids
    return payload


def answer_quiz_question(
    db: Session,
    group: StudyGroup,
    quiz: StudyGroupQuiz,
    participant: StudyGroupQuizParticipant,
    student: Student,
    *,
    question_id: int,
    selected: str,
    elapsed_ms: int = 0,
) -> dict[str, Any]:
    """Grade one answer server-side and return honest feedback."""
    from ..serializers import question_public

    if participant.status != "in_progress":
        raise GroupError("This attempt is already finished.", 409)
    if participant.deadline_at and participant.deadline_at <= utcnow():
        raise GroupError("Time is up — submit to see your result.", 409)
    ordered = _ordered_questions(db, quiz, participant)
    questions = {row.id: row for row in ordered}
    question = questions.get(int(question_id))
    if question is None:
        raise GroupError("That question is not part of this quiz.", 404)
    existing = db.scalar(
        select(StudyGroupQuizAnswer).where(
            StudyGroupQuizAnswer.participant_id == participant.id,
            StudyGroupQuizAnswer.question_id == question.id,
        )
    )
    if existing is not None:
        raise GroupError("You already answered that question.", 409)

    order = (participant.option_orders or {}).get(str(question.id)) or question.option_keys
    canonical = label_to_key(question, order, selected) or ""
    correct = answer_matches(question.correct, canonical)
    elapsed_ms = max(0, min(int(elapsed_ms or 0), 600_000))
    points = int(question.points or 1) if correct else 0

    db.add(
        StudyGroupQuizAnswer(
            participant_id=participant.id,
            question_id=question.id,
            selected=canonical,
            correct=correct,
            elapsed_ms=elapsed_ms,
            points=points,
        )
    )
    participant.answered += 1
    if correct:
        participant.correct_count += 1
        participant.score += points
    else:
        participant.wrong_count += 1
    ordered_ids = [row.id for row in ordered]
    order_index = ordered_ids.index(question.id) if question.id in ordered_ids else participant.current_index
    participant.current_index = max(participant.current_index, order_index + 1)
    register_question_attempt(db, question, correct=correct, elapsed_ms=elapsed_ms)
    if question.topic:
        mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic, correct=correct)
    db.flush()
    return {
        "correct": correct,
        "points": points,
        "answer": question.correct if correct else None,
        "explanation": (question.explanation or "")[:600],
        "question": question_public(question, reveal=True, order=order),
        "score": participant.score,
        "answered": participant.answered,
        "total": len(questions),
    }


def submit_quiz(
    db: Session,
    group: StudyGroup,
    quiz: StudyGroupQuiz,
    participant: StudyGroupQuizParticipant,
    student: Student,
    *,
    auto: bool = False,
) -> tuple[StudyGroupQuizParticipant, dict[str, Any], list[Event]]:
    """Finalise an attempt: score, pass mark, leaderboard position, rewards."""
    if participant.status == "submitted":
        summary = _participant_summary(db, quiz, participant)
        return participant, summary, []
    total = len(participant.question_order or [])
    participant.status = "submitted"
    participant.submitted_at = utcnow()
    participant.percentage = round(participant.correct_count / total * 100, 2) if total else 0.0
    participant.passed = participant.percentage >= quiz.pass_score

    # Leaderboard position among submitted attempts (score, then accuracy, then time).
    better = int(
        db.scalar(
            select(func.count(StudyGroupQuizParticipant.id)).where(
                StudyGroupQuizParticipant.quiz_id == quiz.id,
                StudyGroupQuizParticipant.status == "submitted",
                StudyGroupQuizParticipant.id != participant.id,
                (StudyGroupQuizParticipant.score > participant.score)
                | (
                    (StudyGroupQuizParticipant.score == participant.score)
                    & (StudyGroupQuizParticipant.submitted_at < participant.submitted_at)
                ),
            )
        )
        or 0
    )
    participant.position = better + 1

    events_list: list[dict] = []
    xp = int(round(quiz.reward_xp * participant.percentage / 100))
    coins = quiz.reward_coins if participant.passed else 0
    if xp or coins:
        events_list = game.grant(
            db,
            student,
            xp=xp,
            coins=coins,
            kind="group_quiz",
            title=f"Group quiz: {quiz.title}",
            detail=f"{participant.correct_count}/{total} correct",
        )
    participant.xp_awarded = xp
    participant.coins_awarded = coins
    # The group ladder moves with quiz results too.
    member = membership(db, group.id, student.id)
    if member is not None and xp:
        week_key = game.week_key()
        if member.week_key != week_key:
            member.week_key = week_key
            member.week_xp = 0
        member.week_xp = (member.week_xp or 0) + xp
    db.flush()

    summary = _participant_summary(db, quiz, participant)
    summary["rewards"] = events_list
    summary["auto"] = auto

    events = [
        broadcast_group(
            db,
            group,
            "group_quiz_update",
            {"quiz": quiz_public(db, quiz, viewer_id=student.id), "action": "submitted", "student_id": student.id},
        ),
        to_student(student.id, "reward", {"rewards": events_list}),
    ]
    _, activity_events = log_activity(
        db,
        group,
        kind="quiz_result",
        text=(
            f"{student.name.split(' ')[0]} completed “{quiz.title}” — "
            f"{participant.correct_count}/{total} ({participant.percentage:.0f}%)."
        ),
        actor=student,
        meta={"quiz_id": quiz.id, "score": participant.score},
    )
    events += activity_events
    events += notify_members(
        db,
        group,
        [student.id],
        kind="result",
        title=f"Quiz result: {quiz.title}",
        message=f"You scored {participant.correct_count}/{total} ({participant.percentage:.0f}%) — "
        + ("passed ✅" if participant.passed else "below the pass mark."),
        meta={"quiz_id": quiz.id},
        inbox=True,
    )
    return participant, summary, events


def _participant_summary(db: Session, quiz: StudyGroupQuiz, participant: StudyGroupQuizParticipant) -> dict[str, Any]:
    total = len(participant.question_order or [])
    return {
        "participant_id": participant.id,
        "status": participant.status,
        "score": participant.score,
        "correct": participant.correct_count,
        "wrong": participant.wrong_count,
        "total": total,
        "percentage": round(participant.percentage, 1),
        "passed": bool(participant.passed),
        "pass_score": quiz.pass_score,
        "position": participant.position,
        "xp_awarded": participant.xp_awarded,
        "coins_awarded": participant.coins_awarded,
        "submitted_at": _iso(participant.submitted_at),
    }


def quiz_leaderboard(
    db: Session,
    quiz: StudyGroupQuiz,
    *,
    page: int = 1,
    size: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    total = int(
        db.scalar(
            select(func.count(StudyGroupQuizParticipant.id)).where(
                StudyGroupQuizParticipant.quiz_id == quiz.id,
                StudyGroupQuizParticipant.status == "submitted",
            )
        )
        or 0
    )
    rows = db.scalars(
        select(StudyGroupQuizParticipant)
        .where(
            StudyGroupQuizParticipant.quiz_id == quiz.id,
            StudyGroupQuizParticipant.status == "submitted",
        )
        .order_by(
            StudyGroupQuizParticipant.score.desc(),
            StudyGroupQuizParticipant.percentage.desc(),
            StudyGroupQuizParticipant.submitted_at.asc(),
        )
        .limit(size)
        .offset((max(1, page) - 1) * size)
    ).all()
    payload = []
    for offset, row in enumerate(rows):
        student = db.get(Student, row.student_id)
        payload.append(
            {
                "rank": (page - 1) * size + offset + 1,
                "student": _student_chip(student),
                "score": row.score,
                "correct": row.correct_count,
                "total": len(row.question_order or []),
                "percentage": round(row.percentage, 1),
                "passed": bool(row.passed),
                "submitted_at": _iso(row.submitted_at),
            }
        )
    return payload, total


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------
def member_ids(db: Session, group_id: int, *, exclude: int | None = None) -> list[int]:
    rows = db.scalars(select(StudyGroupMember.student_id).where(StudyGroupMember.group_id == group_id)).all()
    return [row for row in rows if row != exclude]


def paginate(query, db: Session, page: int, size: int) -> tuple[list[Any], int]:
    """Apply page/size to a select and return (rows, total)."""
    page = max(1, int(page or 1))
    size = max(1, min(int(size or 20), 100))
    total_query = select(func.count()).select_from(query.order_by(None).subquery())
    total = int(db.scalar(total_query) or 0)
    rows = list(db.scalars(query.limit(size).offset((page - 1) * size)).all())
    return rows, total


def page_meta(page: int, size: int, total: int) -> dict[str, Any]:
    page = max(1, int(page or 1))
    size = max(1, min(int(size or 20), 100))
    return {
        "page": page,
        "size": size,
        "total": total,
        "pages": max(1, (total + size - 1) // size),
    }


# ---------------------------------------------------------------------------
# Server clock — scheduled quizzes go live, scheduled announcements publish,
# attempts past their deadline finalise. Runs from the shared game ticker.
# ---------------------------------------------------------------------------
_notified_soon: set[int] = set()


def poll_groups(db: Session) -> list[Event]:
    from ..models import StudyGroupAnnouncement

    events: list[Event] = []
    now = utcnow()

    for quiz in list(db.scalars(select(StudyGroupQuiz).where(StudyGroupQuiz.status.in_(["scheduled", "live"]))).all()):
        group = db.get(StudyGroup, quiz.group_id)
        if group is None:
            continue
        before = quiz.status
        _refresh_quiz_status(db, quiz)
        if quiz.status != before:
            events.append(
                broadcast_group(db, group, "group_quiz_update", {"quiz": quiz_public(db, quiz), "action": quiz.status})
            )
            if quiz.status == "live":
                events += notify_members(
                    db,
                    group,
                    member_ids(db, group.id),
                    kind="quiz",
                    title=f"Quiz live now: {quiz.title}",
                    message=f"{quiz.question_count} questions — join from the group Quizzes page.",
                    meta={"quiz_id": quiz.id},
                    inbox=True,
                )
                _, activity_events = log_activity(
                    db, group, kind="quiz", text=f"The quiz “{quiz.title}” is now live.", meta={"quiz_id": quiz.id}
                )
                events += activity_events
        elif (
            quiz.status == "scheduled"
            and quiz.starts_at is not None
            and 0 < (quiz.starts_at - now).total_seconds() <= 600
            and quiz.id not in _notified_soon
        ):
            _notified_soon.add(quiz.id)
            events += notify_members(
                db,
                group,
                member_ids(db, group.id),
                kind="quiz",
                title=f"Quiz starting soon: {quiz.title}",
                message="Starts in less than 10 minutes.",
                meta={"quiz_id": quiz.id},
            )
            events.append(
                broadcast_group(db, group, "group_quiz_reminder", {"quiz_id": quiz.id, "title": quiz.title})
            )

    # Scheduled announcements flip to published on the server clock.
    for row in list(
        db.scalars(
            select(StudyGroupAnnouncement).where(
                StudyGroupAnnouncement.scheduled_at.is_not(None), StudyGroupAnnouncement.scheduled_at <= now
            )
        ).all()
    ):
        group = db.get(StudyGroup, row.group_id)
        if group is None:
            continue
        row.scheduled_at = None
        db.flush()
        events.append(broadcast_group(db, group, "group_announcement", {"announcement": announcement_public(row)}))
        events += notify_members(
            db,
            group,
            member_ids(db, group.id),
            kind="announcement",
            title=f"📢 {row.title}",
            message=row.body[:200],
            meta={"announcement_id": row.id},
        )

    # Attempts that ran past their deadline finalise with what they answered.
    expired = list(
        db.scalars(
            select(StudyGroupQuizParticipant).where(
                StudyGroupQuizParticipant.status == "in_progress",
                StudyGroupQuizParticipant.deadline_at.is_not(None),
                StudyGroupQuizParticipant.deadline_at <= now,
            )
        ).all()
    )
    for participant in expired:
        quiz = db.get(StudyGroupQuiz, participant.quiz_id)
        group = db.get(StudyGroup, quiz.group_id) if quiz else None
        student = db.get(Student, participant.student_id)
        if quiz is None or group is None or student is None:
            continue
        _, _, submit_events = submit_quiz(db, group, quiz, participant, student, auto=True)
        events += submit_events
    return events
