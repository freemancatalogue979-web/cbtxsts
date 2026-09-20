"""Database seeder.

Runs on startup and is fully idempotent: it only fills in what is missing. The
legacy JSON roster/question bank was converted once into
``app/seed_data/*.py``; from then on SQLite is the only source of truth.
"""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import func, select
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
from .seed_data.questions import QUESTIONS
from .seed_data.roster import ROSTER

JURISPRUDENCE_QUESTIONS = [
    {
        "text": "Who defined law as the command of an uncommanded sovereign backed by threats of sanction?",
        "option_a": "Hans Kelsen",
        "option_b": "John Austin",
        "option_c": "H.L.A. Hart",
        "option_d": "Thomas Aquinas",
        "correct": "B",
        "explanation": "John Austin established the Imperative/Command Theory of Law in Province of Jurisprudence Determined.",
        "difficulty": "easy",
        "topic": "Positivism",
    },
    {
        "text": "Which philosopher authored \"The Morality of Law\" and proposed the eight internal desiderata of law?",
        "option_a": "Ronald Dworkin",
        "option_b": "Lon L. Fuller",
        "option_c": "John Finnis",
        "option_d": "Jeremy Bentham",
        "correct": "B",
        "explanation": "Fuller introduced procedural natural law and the 8 principles of the inner morality of law.",
        "difficulty": "medium",
        "topic": "Natural Law",
    },
    {
        "text": "Hans Kelsen posited that every legal system derives its ultimate validity from what foundational norm?",
        "option_a": "The Volksgeist",
        "option_b": "The Grundnorm",
        "option_c": "Rule of Recognition",
        "option_d": "Lex Aeterna",
        "correct": "B",
        "explanation": "Kelsen's Pure Theory of Law centres on hierarchical validity derived from the Grundnorm.",
        "difficulty": "easy",
        "topic": "Positivism",
    },
    {
        "text": "The concept of the \"Rule of Recognition\" was introduced into analytical jurisprudence by:",
        "option_a": "H.L.A. Hart",
        "option_b": "Karl Olivecrona",
        "option_c": "Joseph Raz",
        "option_d": "Lord Denning",
        "correct": "A",
        "explanation": "Hart introduced the secondary rule of recognition in The Concept of Law.",
        "difficulty": "medium",
        "topic": "Positivism",
    },
    {
        "text": "The Historical School of Jurisprudence, championed by Savigny, posits that law is:",
        "option_a": "Imposed from above by sovereign command",
        "option_b": "A tool of capitalist exploitation",
        "option_c": "Found in the common consciousness of the people (Volksgeist)",
        "option_d": "Derived purely from divine revelation",
        "correct": "C",
        "explanation": "Savigny argued law develops like language from the internal spirit of a people.",
        "difficulty": "medium",
        "topic": "Historical School",
    },
    {
        "text": "Jeremy Bentham's utility principle judges law by its ability to:",
        "option_a": "Reflect divine command",
        "option_b": "Maximise pleasure and minimise pain",
        "option_c": "Preserve tradition",
        "option_d": "Enforce the Grundnorm",
        "correct": "B",
        "explanation": "Bentham's utilitarianism measures law by the greatest happiness of the greatest number.",
        "difficulty": "easy",
        "topic": "Utilitarianism",
    },
    {
        "text": "Which school of thought argues that law and morality are necessarily connected?",
        "option_a": "Legal positivism",
        "option_b": "Natural law",
        "option_c": "Legal realism",
        "option_d": "Marxist jurisprudence",
        "correct": "B",
        "explanation": "Natural law theory holds that an unjust law is not truly law.",
        "difficulty": "easy",
        "topic": "Natural Law",
    },
    {
        "text": "The realist school of jurisprudence is best associated with which idea?",
        "option_a": "Law is what the courts actually do",
        "option_b": "Law is a closed logical system",
        "option_c": "Law derives from morality alone",
        "option_d": "Law is the command of God",
        "correct": "A",
        "explanation": "American realists such as Holmes focused on judicial behaviour over abstract doctrine.",
        "difficulty": "medium",
        "topic": "Realism",
    },
]

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
        "message": "Constitutional Law Arena Exam is open now — 70 questions, 25 minutes, server-side timer. Climb the leaderboard and grab the ₦50,000 champion prize.",
        "kind": "exam",
        "target_course": "LAW 411",
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


def seed_courses(db: Session) -> dict[str, Course]:
    wanted = [
        ("LAW 411", "Nigerian Constitutional Law", "Supremacy of the Constitution, fundamental rights, federalism and the structure of the Nigerian state.", "violet"),
        ("LAW 421", "Jurisprudence & Legal Theory", "Schools of legal thought: natural law, positivism, realism, historical and Marxist theories.", "blue"),
        ("LAW 431", "Commercial Law & Sale of Goods", "Formation of commercial contracts, sale of goods, agency and negotiable instruments.", "red"),
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
            "key": "constitutional",
            "title": "Constitutional Law Arena Exam",
            "course": "LAW 411",
            "instructions": "70 objective questions • 25 minutes • the server owns the clock.\nAnswers autosave after every tap, so a refresh never costs you progress.\nPoints, XP and coins land the moment you submit.",
            "duration_minutes": 25,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
        },
        {
            "key": "speed",
            "title": "Constitutional Speed Round",
            "course": "LAW 411",
            "instructions": "15 questions in 6 minutes. Built for duels and rapid-fire practice.",
            "duration_minutes": 6,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
        },
        {
            "key": "jurisprudence",
            "title": "Jurisprudence Blitz",
            "course": "LAW 421",
            "instructions": "8 questions on the schools of legal thought. Perfect warm-up duel material.",
            "duration_minutes": 10,
            "status": "active",
            "scheduled_at": now - timedelta(minutes=5),
            "end_at": now + timedelta(days=14),
            "shuffle_questions": True,
            "allow_duel": True,
        },
        {
            "key": "commercial",
            "title": "Commercial Law Challenge",
            "course": "LAW 431",
            "instructions": "Opens next week. Bank XP on the other arenas until then.",
            "duration_minutes": 20,
            "status": "scheduled",
            "scheduled_at": now + timedelta(days=7),
            "end_at": now + timedelta(days=7, minutes=20),
            "shuffle_questions": True,
            "allow_duel": False,
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

    seed_questions(db, quizzes["constitutional"], QUESTIONS)
    speed_rows = [
        {
            "text": row["text"],
            "option_a": row["option_a"],
            "option_b": row["option_b"],
            "option_c": row.get("option_c", ""),
            "option_d": row.get("option_d", ""),
            "correct": row["correct"],
            "explanation": row.get("explanation", ""),
            "difficulty": row.get("difficulty", "medium"),
        }
        for row in random.Random(4110).sample(QUESTIONS, 15)
    ]
    seed_questions(db, quizzes["speed"], speed_rows)
    seed_questions(db, quizzes["jurisprudence"], JURISPRUDENCE_QUESTIONS)
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
            faculty=row.get("faculty", "Faculty of Law"),
            campus=row.get("campus", "UNEC (Enugu Campus)"),
            class_name=row.get("class_name", "030 Law Class"),
            level=row.get("level", "400 Level"),
            avatar_hue=_hue(row["name"]),
            week_key=game.week_key(),
            player_code=game.make_player_code(db),
        )
        db.add(student)
        db.flush()  # keep player-code collision checks honest
        created.append(student)
    db.flush()
    return created


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
    courses = seed_courses(db)
    quizzes = seed_quizzes(db, courses)
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
