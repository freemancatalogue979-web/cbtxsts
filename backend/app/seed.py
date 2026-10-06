"""Database seeder.

Runs on startup and is fully idempotent: it only fills in what is missing. The
platform ships with two courses — **ENG 101 Use of English** and **MTH 101
Elementary Mathematics** — whose question banks live in ``app/seed_data/*.py``;
from then on SQLite is the only source of truth.

The law catalogue this arena used to ship (LAW 411/421/431) is retired: on every
boot the seeder deletes those courses, their banks, their exams and everything
hanging off them, then makes sure English and Mathematics exist.
"""
from __future__ import annotations

import warnings
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy import exc as sqlalchemy_exc
from sqlalchemy.orm import Session

from . import game
from .config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_PASSWORD
from .models import (
    Admin,
    Badge,
    Config,
    Course,
    Notification,
    Prize,
    Question,
    Quiz,
    Student,
    utcnow,
)
from .security import hash_password
from .services.course_bank import ensure_bank_quiz, promote_legacy_exam_questions
from .seed_data.english_questions import ENGLISH_QUESTIONS
from .seed_data.maths_questions import MATHEMATICS_QUESTIONS

# Course codes that used to ship with the platform. They are retired: the
# seeder removes them (courses, banks, exams and everything hanging off them)
# from any database that still holds them.
RETIRED_COURSE_CODES = ("LAW 411", "LAW 421", "LAW 431")


PRIZES = [
    {"title": "₦50,000 Arena Champion Cash Prize", "description": "Season winner takes the grand cash prize plus the Arena Champion trophy.", "tier": "platinum", "kind": "rank", "min_rank": 1, "max_rank": 1, "icon": "crown", "sort_order": 1},
    {"title": "₦25,000 Runner-Up Prize", "description": "Second on the season leaderboard.", "tier": "gold", "kind": "rank", "min_rank": 2, "max_rank": 2, "icon": "medal", "sort_order": 2},
    {"title": "₦15,000 Third Place Prize", "description": "Third on the season leaderboard.", "tier": "gold", "kind": "rank", "min_rank": 3, "max_rank": 3, "icon": "award", "sort_order": 3},
    {"title": "10GB Premium Data Bundle", "description": "For everyone who finishes inside the top 10.", "tier": "silver", "kind": "rank", "min_rank": 4, "max_rank": 10, "icon": "wifi", "sort_order": 4},
    {"title": "Arena Hoodie & Merch Pack", "description": "Limited edition hoodie, cap and sticker pack for the top 25.", "tier": "silver", "kind": "rank", "min_rank": 11, "max_rank": 25, "icon": "shirt", "sort_order": 5},
    {"title": "Study Kit (Notebook + Pen Set)", "description": "Reward for the top 50 players of the season.", "tier": "bronze", "kind": "rank", "min_rank": 26, "max_rank": 50, "icon": "notebook-pen", "sort_order": 6},
    {"title": "₦2,000 Airtime Voucher", "description": "Redeem any time with your arena coins.", "tier": "bronze", "kind": "coins", "cost_coins": 450, "icon": "smartphone", "stock": 40, "sort_order": 7},
    {"title": "Pizza & Drinks Voucher", "description": "Share it with your duel rival. Redeem with coins.", "tier": "silver", "kind": "coins", "cost_coins": 900, "icon": "pizza", "stock": 15, "sort_order": 8},
    {"title": "Arena Champion Frame", "description": "Personalised desktop frame for the duel with the most wins.", "tier": "gold", "kind": "coins", "cost_coins": 1500, "icon": "frame", "stock": 5, "sort_order": 9},
]

NOTICES = [
    {
        "title": "Arena Season is LIVE",
        "message": "Use of English Arena Exam is open now — 40 questions drawn at random, 25 minutes, server-side timer. Climb the leaderboard and grab the ₦50,000 champion prize.",
        "kind": "exam",
        "target_course": "ENG 101",
        "is_pinned": True,
    },
    {
        "title": "Duel a friend in real time",
        "message": "Challenge any player by phone number, run a quick match, or drop a public arena code. Live scoring, speed bonuses and combo multipliers included.",
        "kind": "duel",
    },
    {
        "title": "Daily bonus + streaks",
        "message": "Sign in every day to collect coins and XP. Hit a 7-day streak to unlock the On Fire badge.",
        "kind": "prize",
    },
    {
        "title": "Prize vault open",
        "message": "Rank prizes are reserved for the top 50. Coin rewards can be redeemed instantly from the Prizes tab.",
        "kind": "prize",
    },
]


def _hue(name: str) -> int:
    hues = [348, 265, 226, 285, 210, 330, 250, 200]
    return hues[sum(ord(c) for c in name) % len(hues)]


def seed_config(db: Session) -> Config:
    config = db.get(Config, 1)
    if config is None:
        config = Config(
            id=1,
            grading_scale=game.DEFAULT_GRADING_SCALE,
            prize_pool_note="Season prize pool: ₦90,000 cash + data bundles, merch and vouchers.",
        )
        db.add(config)
        db.flush()
    return config


def seed_admin(db: Session) -> None:
    if db.scalar(select(Admin.id).where(Admin.email == DEFAULT_ADMIN_EMAIL)):
        return
    db.add(
        Admin(
            email=DEFAULT_ADMIN_EMAIL,
            name=DEFAULT_ADMIN_NAME,
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role="owner",
        )
    )
    db.flush()


def retire_legacy_courses(db: Session) -> int:
    """Delete the retired law catalogue from any database that still holds it.

    Idempotent and safe on a fresh database (there is nothing to delete). The
    delete is a plain ORM delete: SQLite runs with ``PRAGMA foreign_keys=ON``,
    so the database itself removes each course's quizzes, question banks,
    questions and attempts, and detaches anything that merely points at the
    course (duels, rooms, materials, events, AI artefacts...).

    Because the database cascades first, the ORM's own deletes can match zero
    rows; the resulting SAWarning is expected here, so it is suppressed for the
    flush instead of being logged on every boot.
    """
    legacy = list(db.scalars(select(Course).where(Course.code.in_(RETIRED_COURSE_CODES))).all())
    if not legacy:
        return 0
    for course in legacy:
        db.delete(course)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=r"DELETE statement on table .* expected to delete \d+ row\(s\); 0 were matched",
            category=sqlalchemy_exc.SAWarning,
        )
        db.flush()
    return len(legacy)


def seed_courses(db: Session) -> dict[str, Course]:
    wanted = [
        ("ENG 101", "Use of English", "Grammar and concord, lexis and structure, comprehension, phonology, registers, summary writing and letter/essay technique.", "violet"),
        ("MTH 101", "Elementary Mathematics", "Indices and logarithms, quadratic and simultaneous equations, sequences, sets, geometry, trigonometry, statistics and an introduction to calculus.", "blue"),
    ]
    courses: dict[str, Course] = {}
    for code, title, description, accent in wanted:
        course = db.scalar(select(Course).where(Course.code == code))
        if course is None:
            course = Course(code=code, title=title, description=description, accent=accent, credit_units=3)
            db.add(course)
            db.flush()
        courses[code] = course
    return courses


def seed_questions(db: Session, quiz: Quiz, rows: list[dict]) -> int:
    if db.scalar(select(func.count(Question.id)).where(Question.quiz_id == quiz.id)):
        return 0
    for position, row in enumerate(rows, start=1):
        db.add(
            Question(
                quiz_id=quiz.id,
                course_id=quiz.course_id,
                position=position,
                text=row["text"],
                option_a=row["option_a"],
                option_b=row["option_b"],
                option_c=row.get("option_c", ""),
                option_d=row.get("option_d", ""),
                correct=row["correct"],
                explanation=row.get("explanation", ""),
                difficulty=row.get("difficulty", "medium"),
                topic=row.get("topic", ""),
                points=1,
            )
        )
    db.flush()
    return len(rows)


def seed_quizzes(db: Session, courses: dict[str, Course]) -> dict[str, Quiz]:
    now = utcnow()
    specs = [
        {
            "key": "english",
            "title": "Use of English Arena Exam",
            "course": "ENG 101",
            "instructions": "40 objective questions drawn at random from the ENG 101 bank • 25 minutes • the server owns the clock.\nAnswers autosave after every tap, so a refresh never costs you progress.\nPoints, XP and coins land the moment you submit.",
            "duration_minutes": 25,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 40,
        },
        {
            "key": "english_speed",
            "title": "English Speed Round",
            "course": "ENG 101",
            "instructions": "15 questions in 6 minutes. Built for duels and rapid-fire practice.",
            "duration_minutes": 6,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 15,
        },
        {
            "key": "maths",
            "title": "Mathematics Arena Exam",
            "course": "MTH 101",
            "instructions": "40 objective questions drawn at random from the MTH 101 bank • 25 minutes • work them out, no calculator needed.\nAnswers autosave after every tap, so a refresh never costs you progress.",
            "duration_minutes": 25,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 40,
            "calculator": False,
        },
        {
            "key": "maths_speed",
            "title": "Mathematics Speed Round",
            "course": "MTH 101",
            "instructions": "15 questions in 8 minutes. Quick-fire arithmetic, algebra and geometry for duels.",
            "duration_minutes": 8,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 15,
        },
    ]

    quizzes: dict[str, Quiz] = {}
    for spec in specs:
        quiz = db.scalar(select(Quiz).where(Quiz.title == spec["title"]))
        if quiz is None:
            quiz = Quiz(course_id=courses[spec["course"]].id, **{k: v for k, v in spec.items() if k not in {"key", "course"}})
            db.add(quiz)
            db.flush()
        quizzes[spec["key"]] = quiz

    # Existing databases: questions that used to live inside exam papers move
    # into their course bank (the exam keeps serving its old fixed paper).
    promote_legacy_exam_questions(db)
    # Fresh databases: questions are seeded into the COURSE BANK; the exams
    # above draw from it at random, per player.
    seed_questions(db, ensure_bank_quiz(db, courses["ENG 101"]), ENGLISH_QUESTIONS)
    seed_questions(db, ensure_bank_quiz(db, courses["MTH 101"]), MATHEMATICS_QUESTIONS)
    return quizzes


def seed_badges(db: Session) -> None:
    game.ensure_badges(db)


def seed_prizes(db: Session) -> None:
    if db.scalar(select(Prize.id).limit(1)):
        return
    for row in PRIZES:
        db.add(Prize(**row))
    db.flush()


def seed_notifications(db: Session) -> None:
    if db.scalar(select(Notification.id).limit(1)):
        return
    for row in NOTICES:
        db.add(Notification(author="Arena Control", created_at=utcnow(), **row))
    db.flush()


def seed_all(db: Session) -> dict[str, int]:
    """Idempotent bootstrap. Safe to call on every startup."""
    config = seed_config(db)
    seed_admin(db)
    seed_badges(db)
    retired = retire_legacy_courses(db)  # the law catalogue no longer ships
    courses = seed_courses(db)
    quizzes = seed_quizzes(db, courses)
    seed_prizes(db)
    seed_notifications(db)
    db.commit()
    return {
        "students_total": db.scalar(select(func.count(Student.id))) or 0,
        "courses": len(courses),
        "courses_retired": retired,
        "quizzes": len(quizzes),
        "questions": db.scalar(select(func.count(Question.id))) or 0,
        "badges": db.scalar(select(func.count(Badge.id))) or 0,
        "prizes": db.scalar(select(func.count(Prize.id))) or 0,
        "config_id": config.id,
    }


if __name__ == "__main__":  # pragma: no cover - manual invocation
    from .db import SessionLocal, init_db

    init_db()
    with SessionLocal() as session:
        print(seed_all(session))
