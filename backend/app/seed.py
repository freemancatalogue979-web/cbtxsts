"""Database seeder.

Runs on startup and is fully idempotent: it only fills in what is missing. The
legacy JSON roster/question bank was converted once into
``app/seed_data/*.py``; from then on SQLite is the only source of truth.
"""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import or_, func, select
from sqlalchemy.orm import Session

from . import game
from .config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_PASSWORD
from .models import (
    Activity,
    Admin,
    Badge,
    Config,
    Course,
    Friendship,
    Notification,
    Prize,
    Question,
    Quiz,
    Student,
    StudentBadge,
    utcnow,
)
from .security import hash_password
from .services.course_bank import ensure_bank_quiz, promote_legacy_exam_questions
from .seed_data.general import COURSES as GENERAL_COURSES
from .seed_data.general import questions_for
from .seed_data.roster import ROSTER

PRIZES = [
    {"title": "Season Champion Prize", "description": "Season winner takes the grand prize plus the Champion trophy.", "tier": "platinum", "kind": "rank", "min_rank": 1, "max_rank": 1, "icon": "crown", "sort_order": 1},
    {"title": "Runner-Up Prize", "description": "Second on the season leaderboard.", "tier": "gold", "kind": "rank", "min_rank": 2, "max_rank": 2, "icon": "medal", "sort_order": 2},
    {"title": "Third Place Prize", "description": "Third on the season leaderboard.", "tier": "gold", "kind": "rank", "min_rank": 3, "max_rank": 3, "icon": "award", "sort_order": 3},
    {"title": "Premium Data Bundle", "description": "For everyone who finishes inside the top 10.", "tier": "silver", "kind": "rank", "min_rank": 4, "max_rank": 10, "icon": "wifi", "sort_order": 4},
    {"title": "Hoodie & Merch Pack", "description": "Limited edition hoodie, cap and sticker pack for the top 25.", "tier": "silver", "kind": "rank", "min_rank": 11, "max_rank": 25, "icon": "shirt", "sort_order": 5},
    {"title": "Study Kit (Notebook + Pen Set)", "description": "Reward for the top 50 players of the season.", "tier": "bronze", "kind": "rank", "min_rank": 26, "max_rank": 50, "icon": "notebook-pen", "sort_order": 6},
    {"title": "Mobile Top-up Voucher", "description": "Redeem any time with your coins.", "tier": "bronze", "kind": "coins", "cost_coins": 450, "icon": "smartphone", "stock": 40, "sort_order": 7},
    {"title": "Pizza & Drinks Voucher", "description": "Share it with your duel rival. Redeem with coins.", "tier": "silver", "kind": "coins", "cost_coins": 900, "icon": "pizza", "stock": 15, "sort_order": 8},
    {"title": "Champion Desk Frame", "description": "Personalised desk frame for the player with the most duel wins.", "tier": "gold", "kind": "coins", "cost_coins": 1500, "icon": "frame", "stock": 5, "sort_order": 9},
]

NOTICES = [
    {
        "title": "The new season is LIVE",
        "message": "The English Language Mock Exam is open now — 20 questions, 25 minutes, server-side timer. Climb the leaderboard and go for the Season Champion prize.",
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
            prize_pool_note="Season prizes: champion trophy, data bundles, merch and vouchers.",
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


def seed_courses(db: Session) -> dict[str, Course]:
    """General-subject starter courses (English, Maths, sciences, computing)."""
    from .models import CourseTopic

    courses: dict[str, Course] = {}
    for row in GENERAL_COURSES:
        course = db.scalar(select(Course).where(Course.code == row["code"]))
        if course is None:
            course = Course(code=row["code"], title=row["title"], description=row["description"], accent=row["accent"], credit_units=3)
            db.add(course)
            db.flush()
            for position, name in enumerate(row["topics"], start=1):
                db.add(CourseTopic(course_id=course.id, name=name, position=position))
            db.flush()
        courses[row["code"]] = course
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
            "title": "English Language Mock Exam",
            "course": "ENG 101",
            "instructions": "20 questions drawn at random from the English bank • 25 minutes • the server owns the clock.\nAnswers autosave after every tap, so a refresh never costs you progress.\nPoints, XP and coins land the moment you submit.",
            "duration_minutes": 25,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 20,
        },
        {
            "key": "maths",
            "title": "Maths Speed Round",
            "course": "MTH 101",
            "instructions": "12 quick-fire maths questions in 10 minutes. Built for duels and rapid practice.",
            "duration_minutes": 10,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 12,
        },
        {
            "key": "biology",
            "title": "Biology Mock Exam",
            "course": "BIO 101",
            "instructions": "15 questions on cells, genetics, the body, ecology and plants • 15 minutes.",
            "duration_minutes": 15,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 15,
        },
        {
            "key": "chemistry",
            "title": "Chemistry Challenge",
            "course": "CHM 101",
            "instructions": "12 questions on atoms, bonding, reactions and acids • 12 minutes.",
            "duration_minutes": 12,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 12,
        },
        {
            "key": "computing",
            "title": "Computer Science Basics",
            "course": "CSC 101",
            "instructions": "12 questions on hardware, binary, algorithms and networks • 10 minutes.",
            "duration_minutes": 10,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
            "question_source": "course_random",
            "draw_count": 12,
        },
        {
            "key": "physics",
            "title": "Physics Weekly Test",
            "course": "PHY 101",
            "instructions": "Opens next week. Bank XP on the other exams until then.",
            "duration_minutes": 15,
            "status": "scheduled",
            "scheduled_at": now + timedelta(days=7),
            "end_at": now + timedelta(days=21),
            "shuffle_questions": True,
            "allow_duel": False,
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
    for code, course in courses.items():
        seed_questions(db, ensure_bank_quiz(db, course), questions_for(code))
    return quizzes


def seed_students(db: Session) -> list[Student]:
    existing = set(db.scalars(select(Student.phone)).all())
    created: list[Student] = []
    for index, row in enumerate(ROSTER):
        if row["phone"] in existing:
            continue
        student = Student(
            phone=row["phone"],
            name=row["name"],
            reg_no=row.get("reg_no"),
            faculty=row.get("faculty", "General Studies"),
            campus=row.get("campus", "Online Campus"),
            class_name=row.get("class_name", "General Class"),
            level=row.get("level", "Year 1"),
            avatar_hue=_hue(row["name"]),
            week_key=game.week_key(),
            player_code=game.make_player_code(db),
        )
        db.add(student)
        db.flush()  # keep player-code collision checks honest
        created.append(student)
    db.flush()
    return created


def seed_materials(db: Session, courses: dict[str, Course]) -> int:
    """Readable study notes for each starter course (only when the course has none)."""
    import json

    from .models import Material, MaterialSection
    from .seed_data.general import MATERIALS
    from .services.materials import sanitise_blocks

    made = 0
    for row in MATERIALS:
        course = courses.get(row["course"])
        if course is None:
            continue
        if db.scalar(select(Material.id).where(Material.course_id == course.id, Material.title == row["title"])):
            continue
        now = utcnow()
        material = Material(
            course_id=course.id, title=row["title"], kind="material", topic=row["topic"], description=row["description"],
            difficulty=row["difficulty"], estimated_minutes=row["minutes"], icon=row.get("icon", "book"), accent=course.accent,
            summary=json.dumps(row["summary"]), tags=json.dumps([row["topic"], course.code]), author="Genesis Academy",
            status="published", published_at=now, created_at=now, updated_at=now,
        )
        db.add(material)
        db.flush()
        per = max(2, round(row["minutes"] / max(1, len(row["sections"]))))
        for position, (title, blocks) in enumerate(row["sections"], start=1):
            db.add(MaterialSection(material_id=material.id, position=position, title=title, body=json.dumps(sanitise_blocks(blocks)), estimated_minutes=per))
        made += 1
    db.flush()
    return made


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



LEGACY_LAW_CODES = ("LAW 411", "LAW 421", "LAW 431")


def purge_legacy_law_courses(db: Session) -> int:
    """Delete Nigerian Law demo courses every boot so they cannot return after pull/seed.

    Removes courses, quizzes, questions, materials and related attempts for
    LAW 411 / 421 / 431. Idempotent.
    """
    from .models import Attempt, CourseTopic, Material

    removed = 0
    for code in LEGACY_LAW_CODES:
        course = db.scalar(select(Course).where(Course.code == code))
        if course is None:
            # also match by classic titles if code was renamed
            continue
        quizzes = list(db.scalars(select(Quiz).where(Quiz.course_id == course.id)).all())
        quiz_ids = [q.id for q in quizzes]
        # attempts on those quizzes
        if quiz_ids:
            for att in db.scalars(select(Attempt).where(Attempt.quiz_id.in_(quiz_ids))).all():
                db.delete(att)
        q_filter = [Question.course_id == course.id]
        if quiz_ids:
            q_filter.append(Question.quiz_id.in_(quiz_ids))
        for question in db.scalars(select(Question).where(or_(*q_filter))).all():
            db.delete(question)
        for material in db.scalars(select(Material).where(Material.course_id == course.id)).all():
            db.delete(material)
        for topic in db.scalars(select(CourseTopic).where(CourseTopic.course_id == course.id)).all():
            db.delete(topic)
        db.flush()
        for quiz in quizzes:
            db.delete(quiz)
        db.flush()
        db.delete(course)
        removed += 1
    # title-based catch-all (in case codes differ)
    for course in list(db.scalars(select(Course)).all()):
        title = (course.title or "").lower()
        code = (course.code or "").upper()
        if code.startswith("LAW ") or "constitutional law" in title or "jurisprudence" in title or "sale of goo" in title:
            if course.code in LEGACY_LAW_CODES:
                continue  # already handled
            if not code.startswith("LAW "):
                continue
            quizzes = list(db.scalars(select(Quiz).where(Quiz.course_id == course.id)).all())
            quiz_ids = [q.id for q in quizzes]
            if quiz_ids:
                for att in db.scalars(select(Attempt).where(Attempt.quiz_id.in_(quiz_ids))).all():
                    db.delete(att)
            for question in db.scalars(
                select(Question).where(
                    or_(Question.course_id == course.id, Question.quiz_id.in_(quiz_ids or [-1]))
                )
            ).all():
                db.delete(question)
            for material in db.scalars(select(Material).where(Material.course_id == course.id)).all():
                db.delete(material)
            for topic in db.scalars(select(CourseTopic).where(CourseTopic.course_id == course.id)).all():
                db.delete(topic)
            db.flush()
            for quiz in quizzes:
                db.delete(quiz)
            db.flush()
            db.delete(course)
            removed += 1
    if removed:
        db.flush()
    return removed


def seed_all(db: Session) -> dict[str, int]:
    """Idempotent bootstrap. Safe to call on every startup."""
    try:
        n = purge_legacy_law_courses(db)
        if n:
            db.commit()
    except Exception:
        db.rollback()
    config = seed_config(db)
    seed_admin(db)
    seed_badges(db)
    courses = seed_courses(db)
    quizzes = seed_quizzes(db, courses)
    seed_materials(db, courses)
    created: list[Student] = []  # no seeded class roster — only real registrations play
    seed_prizes(db)
    seed_notifications(db)
    db.commit()
    return {
        "students_created": len(created),
        "students_total": db.scalar(select(func.count(Student.id))) or 0,
        "courses": len(courses),
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
