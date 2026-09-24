"""Player-facing catalogue: quizzes, courses, notices, prizes, badges and ranks."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_everyone
from ..models import (
    Activity,
    Attempt,
    Badge,
    Config,
    Course,
    Duel,
    Friendship,
    Notification,
    Prize,
    PrizeClaim,
    Quiz,
    Student,
    StudentBadge,
    utcnow,
)
from ..schemas import ClaimPrizeIn
from ..serializers import (
    badge_public,
    course_public,
    leaderboard_row,
    notification_public,
    prize_public,
    quiz_public,
)
from ..services.exam import quiz_leaderboard, top_leaderboard
from ..ws import hub

router = APIRouter(tags=["arena"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def config_payload(db: Session) -> dict:
    config = db.get(Config, 1)
    if not config:
        return {"online": hub.online_count()}
    return {
        "institution": config.institution,
        "campus": config.campus,
        "faculty": config.faculty,
        "season_name": config.season_name,
        "prize_pool_note": config.prize_pool_note,
        "grading_scale": config.grading_scale or game.DEFAULT_GRADING_SCALE,
        "duels_enabled": config.duels_enabled,
        "exams_enabled": config.exams_enabled,
        "online": hub.online_count(),
    }


def submission_count(db: Session, quiz_id: int) -> int:
    return int(
        db.scalar(select(func.count(Attempt.id)).where(Attempt.quiz_id == quiz_id, Attempt.status == "submitted"))
        or 0
    )


def friend_ids(db: Session, student_id: int) -> list[int]:
    outgoing = db.scalars(
        select(Friendship.friend_id).where(Friendship.student_id == student_id, Friendship.status == "accepted")
    ).all()
    incoming = db.scalars(
        select(Friendship.student_id).where(Friendship.friend_id == student_id, Friendship.status == "accepted")
    ).all()
    return sorted({*outgoing, *incoming, student_id})


def global_rank(db: Session, student: Student) -> int:
    better = db.scalar(
        select(func.count(Student.id)).where(Student.xp > student.xp, Student.is_banned.is_(False))
    )
    return int(better or 0) + 1


def prize_eligible(prize: Prize, rank: int, student: Student) -> bool:
    if not prize.is_active:
        return False
    if prize.kind == "rank":
        return prize.min_rank <= rank <= prize.max_rank
    return student.coins >= prize.cost_coins


# ---------------------------------------------------------------------------
# bootstrap + catalogue
# ---------------------------------------------------------------------------
@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db)) -> dict:
    """Everything the landing screen needs, in one round trip."""
    quizzes = db.scalars(
        select(Quiz).where(Quiz.status.in_(["active", "scheduled"])).order_by(Quiz.id.desc())
    ).all()
    notices = db.scalars(
        select(Notification).order_by(Notification.is_pinned.desc(), Notification.created_at.desc()).limit(6)
    ).all()
    return {
        "config": config_payload(db),
        "quizzes": [quiz_public(q, submission_count=submission_count(db, q.id)) for q in quizzes],
        "notifications": [notification_public(n) for n in notices],
        "leaderboard": top_leaderboard(db, limit=10),
        "online": hub.online_count(),
        "players": db.scalar(select(func.count(Student.id))) or 0,
        "duels_today": db.scalar(
            select(func.count(Duel.id)).where(Duel.created_at >= utcnow() - timedelta(hours=24))
        )
        or 0,
    }


@router.get("/courses")
def list_courses(db: Session = Depends(get_db)) -> list[dict]:
    from ..models import Question

    courses = db.scalars(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).all()
    counts = dict(db.execute(select(Quiz.course_id, func.count(Quiz.id)).where(Quiz.is_bank.is_(False)).group_by(Quiz.course_id)).all())
    # Duel-ready question bank per course (same filters the duel pool uses).
    question_counts = dict(
        db.execute(
            select(Question.course_id, func.count(Question.id))
            .where(
                Question.source_id.is_(None),
                Question.visible.is_(True),
                Question.status == "approved",
                Question.duel_enabled.is_(True),
            )
            .group_by(Question.course_id)
        ).all()
    )
    return [
        course_public(
            c,
            quiz_count=int(counts.get(c.id, 0)),
            question_count=int(question_counts.get(c.id, 0)),
        )
        for c in courses
    ]


@router.get("/quizzes")
def list_quizzes(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> list[dict]:
    # Course question banks are holding quizzes, not exams — never listed.
    quizzes = db.scalars(select(Quiz).where(Quiz.is_bank.is_(False)).order_by(Quiz.id.desc())).all()
    payload = []
    for quiz in quizzes:
        mine = db.scalar(select(Attempt).where(Attempt.quiz_id == quiz.id, Attempt.student_id == student.id))
        payload.append(quiz_public(quiz, submission_count=submission_count(db, quiz.id), my_attempt=mine))
    return payload


@router.get("/quizzes/{quiz_id}")
def read_quiz(quiz_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    quiz = db.get(Quiz, quiz_id)
    if quiz is None or bool(getattr(quiz, "is_bank", False)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    mine = db.scalar(select(Attempt).where(Attempt.quiz_id == quiz.id, Attempt.student_id == student.id))
    return quiz_public(quiz, submission_count=submission_count(db, quiz.id), my_attempt=mine)


@router.get("/quizzes/{quiz_id}/leaderboard")
def read_quiz_leaderboard(quiz_id: int, db: Session = Depends(get_db)) -> list[dict]:
    if db.get(Quiz, quiz_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quiz not found.")
    return quiz_leaderboard(db, quiz_id)


@router.get("/notifications")
def list_notifications(db: Session = Depends(get_db)) -> list[dict]:
    notices = db.scalars(
        select(Notification).order_by(Notification.is_pinned.desc(), Notification.created_at.desc()).limit(60)
    ).all()
    return [notification_public(n) for n in notices]


@router.get("/badges")
def list_badges(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> list[dict]:
    owned = set(db.scalars(select(StudentBadge.badge_id).where(StudentBadge.student_id == student.id)).all())
    return [badge_public(b, owned=b.id in owned) for b in db.scalars(select(Badge)).all()]


# ---------------------------------------------------------------------------
# leaderboards
# ---------------------------------------------------------------------------
@router.get("/leaderboard")
def leaderboard(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    scope: str = Query("global", pattern="^(global|weekly|friends|duels|helpers)$"),
    limit: int = Query(25, ge=5, le=100),
) -> dict:
    active = Student.is_banned.is_(False)
    # real data only: dormant roster accounts that never played stay off the boards
    played = or_(Student.xp > 0, Student.exams_taken > 0, Student.duels_played > 0)

    if scope == "weekly":
        rows = db.scalars(
            select(Student).where(active, played).order_by(Student.weekly_xp.desc(), Student.xp.desc()).limit(limit)
        ).all()
        payload = [leaderboard_row(s, i + 1, value_key="weekly_xp") for i, s in enumerate(rows)]
    elif scope == "duels":
        rows = db.scalars(
            select(Student)
            .where(active, Student.duels_played > 0)
            .order_by(Student.duels_won.desc(), Student.xp.desc())
            .limit(limit)
        ).all()
        payload = [leaderboard_row(s, i + 1, value_key="duels_won") for i, s in enumerate(rows)]
    elif scope == "helpers":
        rows = db.scalars(
            select(Student)
            .where(active, Student.helper_points > 0)
            .order_by(Student.helper_points.desc(), Student.xp.desc())
            .limit(limit)
        ).all()
        payload = [leaderboard_row(s, i + 1, value_key="helper_points") for i, s in enumerate(rows)]
    elif scope == "friends":
        rows = db.scalars(
            select(Student).where(Student.id.in_(friend_ids(db, student.id))).order_by(Student.xp.desc()).limit(limit)
        ).all()
        payload = [leaderboard_row(s, i + 1) for i, s in enumerate(rows)]
    else:
        rows = db.scalars(
            select(Student).where(active, played).order_by(Student.xp.desc(), Student.coins.desc()).limit(limit)
        ).all()
        payload = [leaderboard_row(s, i + 1) for i, s in enumerate(rows)]

    my_rank = next((row["rank"] for row in payload if row["id"] == student.id), None)
    if my_rank is None and scope != "friends":
        column = {
            "global": Student.xp,
            "weekly": Student.weekly_xp,
            "duels": Student.duels_won,
            "helpers": Student.helper_points,
        }[scope]
        extra = active if scope == "duels" else (active & played) if scope != "helpers" else (active)
        better = db.scalar(select(func.count(Student.id)).where(column > getattr(student, column.name), extra))
        my_rank = int(better or 0) + 1

    return {
        "scope": scope,
        "rows": payload,
        "me": leaderboard_row(student, my_rank or 0),
        "total_players": db.scalar(select(func.count(Student.id)).where(active)) or 0,
        "online": hub.online_count(),
    }


# ---------------------------------------------------------------------------
# prizes
# ---------------------------------------------------------------------------
@router.get("/prizes")
def list_prizes(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    config = db.get(Config, 1)
    prizes = db.scalars(select(Prize).where(Prize.is_active.is_(True)).order_by(Prize.sort_order, Prize.id)).all()
    claimed = set(db.scalars(select(PrizeClaim.prize_id).where(PrizeClaim.student_id == student.id)).all())
    rank = global_rank(db, student)
    return {
        "prizes": [
            prize_public(p, eligible=prize_eligible(p, rank, student), claimed=p.id in claimed) for p in prizes
        ],
        "my_rank": rank,
        "rank_label": game.rank_suffix(rank),
        "coins": student.coins,
        "prize_pool_note": config.prize_pool_note if config else "",
        "season": config.season_name if config else "",
    }


@router.post("/prizes/{prize_id}/claim")
async def claim_prize(
    prize_id: int,
    payload: ClaimPrizeIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    prize = db.get(Prize, prize_id)
    if prize is None or not prize.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prize not available.")
    if db.scalar(select(PrizeClaim.id).where(PrizeClaim.prize_id == prize.id, PrizeClaim.student_id == student.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already claimed this prize.")
    if prize.stock == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "This prize is fully claimed.")

    rank = global_rank(db, student)
    if not prize_eligible(prize, rank, student):
        reason = (
            f"Reserved for ranks {prize.min_rank}-{prize.max_rank} (you are #{rank})."
            if prize.kind == "rank"
            else f"Costs {prize.cost_coins} coins (you have {student.coins})."
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)

    if prize.kind == "coins" and prize.cost_coins:
        student.coins -= prize.cost_coins
    if prize.stock > 0:
        prize.stock -= 1

    db.add(PrizeClaim(prize_id=prize.id, student_id=student.id, status="pending", note=payload.note[:240]))
    db.add(
        Activity(
            student_id=student.id,
            kind="prize",
            title=f"Prize claimed — {prize.title}",
            detail="Awaiting staff approval",
            amount=0,
        )
    )
    db.commit()

    await dispatch([to_everyone("prize_claimed", {"prize": prize.title, "student": student.name})])
    return {
        "ok": True,
        "prize": prize_public(prize, eligible=True, claimed=True),
        "coins": student.coins,
    }
