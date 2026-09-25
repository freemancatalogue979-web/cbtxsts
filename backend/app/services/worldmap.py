"""World map — the player's learning journey rendered as a place.

The map is not decoration: every node is real curriculum data. A node is a topic
inside a course, carrying the questions that test it (counted from the bank), the
materials that teach it, the practice runs already recorded against it, and the
mastery band the exam/duel/practice engines maintain. The exam that closes a
world is its boss.

This module only *reads* state that other engines own — it never decides
correctness, mastery or rewards, so the map can never disagree with the rest of
the app. The one thing it does write is quest claims, and those are idempotent
per player per period and verified against the same counters they display.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..game import level_from_xp, title_for_level, xp_for_level  # noqa: F401 (xp_for_level optional)
from ..models import (
    Answer,
    Attempt,
    PracticeChallenge,
    Course,
    Duel,
    DuelParticipant,
    FlashcardReview,
    Material,
    MaterialProgress,
    PlayerMastery,
    PracticeRun,
    Question,
    Quiz,
    Student,
    StudySession,
    QuestClaim,
    utcnow,
)

# ---------------------------------------------------------------------------
# world themes
# ---------------------------------------------------------------------------
# A course becomes a place. The theme is matched from the course code/title so
# new courses pick up a sensible environment without any admin work, and the
# client only needs the key + palette.
# Cyber-Nature Biomes: where knowledge has become energy and technology has
# merged with a living digital ecosystem.
WORLD_THEMES: list[tuple[tuple[str, ...], dict]] = [
    (("law", "legal", "juris", "constitution"), {"key": "ancient_tech", "label": "Ancient-Tech Ruins", "emoji": "🏛️", "biome": "ancient_tech", "sky": "from-gold-500/25", "ground": "#1c1813"}),
    (("literature", "english", "lang", "lit"), {"key": "neural_ocean", "label": "Neural Ocean", "emoji": "🌊", "biome": "neural_ocean", "sky": "from-cyan-500/25", "ground": "#081d2c"}),
    (("econ", "account", "commerce", "finance", "bank"), {"key": "digital_desert", "label": "Digital Desert", "emoji": "🏜️", "biome": "digital_desert", "sky": "from-amber-500/25", "ground": "#291f0c"}),
    (("history", "civil", "ancient"), {"key": "neon_jungle", "label": "Neon Jungle", "emoji": "🌌", "biome": "neon_jungle", "sky": "from-violet-500/25", "ground": "#1e0f33"}),
    (("bio", "anat", "physio", "botan", "med"), {"key": "cyber_forest", "label": "Cyber Forest", "emoji": "🌿", "biome": "cyber_forest", "sky": "from-emerald-500/25", "ground": "#0c281e"}),
    (("geo", "earth", "environ"), {"key": "alien_grove", "label": "Alien Nature", "emoji": "🪐", "biome": "alien_grove", "sky": "from-teal-500/25", "ground": "#0a2420"}),
    (("chem", "physic", "math", "stat", "comput", "ict"), {"key": "frozen_network", "label": "Frozen Network", "emoji": "🧊", "biome": "frozen_network", "sky": "from-blue-500/25", "ground": "#0a1936"}),
]
DEFAULT_THEME = {"key": "techno_nexus", "label": "Techno-Nexus", "emoji": "🌱", "biome": "techno_nexus", "sky": "from-emerald-500/20", "ground": "#0d1f19"}


def theme_for(code: str, title: str) -> dict:
    haystack = f"{code} {title}".lower()
    for needles, theme in WORLD_THEMES:
        if any(needle in haystack for needle in needles):
            return theme
    return DEFAULT_THEME


# ---------------------------------------------------------------------------
# small time helpers (server clock only — never the client's)
# ---------------------------------------------------------------------------
def _day_start() -> datetime:
    now = utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _week_start() -> datetime:
    start = _day_start()
    return start - timedelta(days=start.weekday())


# ---------------------------------------------------------------------------
# counters — the shared truth for the HUD and for quest verification
# ---------------------------------------------------------------------------
def questions_answered(db: Session, student_id: int, since: datetime) -> int:
    """Questions answered across every surface since ``since``.

    Exam answers are row-per-question; practice runs and duels record their own
    totals. Summing the three keeps the "today" counter honest whichever mode the
    player used.
    """
    exam = int(
        db.scalar(
            select(func.count(Answer.id))
            .join(Attempt, Attempt.id == Answer.attempt_id)
            .where(Attempt.student_id == student_id, Answer.answered_at >= since)
        )
        or 0
    )
    # NOTE: PracticeRun.total is the number of questions *offered*, not answered —
    # a run that ends after losing its lives still records the full draw. Quests
    # must count real answers, so read them from the finished challenge payload
    # (which holds exactly one entry per graded answer).
    practice = 0
    for challenge in db.scalars(
        select(PracticeChallenge).where(
            PracticeChallenge.student_id == student_id, PracticeChallenge.finished_at >= since
        )
    ).all():
        practice += len((challenge.payload or {}).get("answers") or {})
    duels = int(
        db.scalar(
            select(func.coalesce(func.sum(DuelParticipant.answered_count), 0))
            .join(Duel, Duel.id == DuelParticipant.duel_id)
            .where(DuelParticipant.student_id == student_id, Duel.created_at >= since)
        )
        or 0
    )
    return exam + practice + duels


def flashcards_reviewed(db: Session, student_id: int, since: datetime) -> int:
    return int(
        db.scalar(
            select(func.count(FlashcardReview.id)).where(
                FlashcardReview.student_id == student_id, FlashcardReview.created_at >= since
            )
        )
        or 0
    )


def duels_won(db: Session, student_id: int, since: datetime) -> int:
    return int(
        db.scalar(
            select(func.count(Duel.id)).where(
                Duel.winner_id == student_id, Duel.created_at >= since, Duel.status == "finished"
            )
        )
        or 0
    )


def focus_seconds(db: Session, student_id: int, since: datetime) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(StudySession.seconds), 0)).where(
                StudySession.student_id == student_id, StudySession.started_at >= since
            )
        )
        or 0
    )


def materials_completed(db: Session, student_id: int, since: datetime) -> int:
    return int(
        db.scalar(
            select(func.count(MaterialProgress.id)).where(
                MaterialProgress.student_id == student_id,
                MaterialProgress.status == "completed",
                MaterialProgress.updated_at >= since,
            )
        )
        or 0
    )


def topics_mastered(db: Session, student_id: int, since: datetime | None = None) -> int:
    stmt = select(func.count(PlayerMastery.id)).where(
        PlayerMastery.student_id == student_id, PlayerMastery.scope_type == "topic", PlayerMastery.mastery >= 75
    )
    if since is not None:
        stmt = stmt.where(PlayerMastery.updated_at >= since)
    return int(db.scalar(stmt) or 0)


# ---------------------------------------------------------------------------
# quests
# ---------------------------------------------------------------------------
# Each quest is defined once, verified on the server, and paid once per period —
# claiming twice is impossible (unique row in quest_claims).
QUESTS: list[dict] = [
    {
        "key": "daily_questions",
        "kind": "daily",
        "label": "Answer 15 questions",
        "detail": "Any mode counts — exams, practice, duels.",
        "icon": "brain",
        "target": 15,
        "reward": {"xp": 80, "coins": 20},
    },
    {
        "key": "daily_read",
        "kind": "daily",
        "label": "Focus for 10 minutes",
        "detail": "Run a focus timer while you read or drill.",
        "icon": "timer",
        "target": 600,
        "reward": {"xp": 60, "coins": 15},
        "unit": "seconds",
    },
    {
        "key": "daily_flashcards",
        "kind": "daily",
        "label": "Review 15 flashcards",
        "detail": "Flip through any deck in the study lab.",
        "icon": "cards",
        "target": 15,
        "reward": {"xp": 50, "coins": 12},
    },
    {
        "key": "daily_duel",
        "kind": "daily",
        "label": "Win one duel",
        "detail": "Take a challenge in the arena.",
        "icon": "swords",
        "target": 1,
        "reward": {"xp": 90, "coins": 30},
    },
    {
        "key": "weekly_questions",
        "kind": "weekly",
        "label": "Answer 100 questions",
        "detail": "This week's grind.",
        "icon": "brain",
        "target": 100,
        "reward": {"xp": 250, "coins": 80},
    },
    {
        "key": "weekly_mastery",
        "kind": "weekly",
        "label": "Master 2 topics",
        "detail": "Push a topic past 75% mastery.",
        "icon": "star",
        "target": 2,
        "reward": {"xp": 300, "coins": 90},
    },
    {
        "key": "weekly_materials",
        "kind": "weekly",
        "label": "Finish a material",
        "detail": "Read a knowledge scroll to the end.",
        "icon": "book",
        "target": 1,
        "reward": {"xp": 200, "coins": 60},
    },
]


def _quest_progress(db: Session, student_id: int) -> dict[str, int]:
    day, week = _day_start(), _week_start()
    return {
        "daily_questions": questions_answered(db, student_id, day),
        "daily_read": focus_seconds(db, student_id, day),
        "daily_flashcards": flashcards_reviewed(db, student_id, day),
        "daily_duel": duels_won(db, student_id, day),
        "weekly_questions": questions_answered(db, student_id, week),
        "weekly_mastery": topics_mastered(db, student_id, week),
        "weekly_materials": materials_completed(db, student_id, week),
    }


def quest_state(db: Session, student_id: int) -> list[dict]:
    """Every quest with its server-verified progress and claim status."""
    progress = _quest_progress(db, student_id)
    claimed = {
        row.quest_key
        for row in db.scalars(
            select(QuestClaim).where(
                QuestClaim.student_id == student_id, QuestClaim.period_key.in_([_period_key("daily"), _period_key("weekly")])
            )
        ).all()
    }
    rows: list[dict] = []
    for quest in QUESTS:
        done = min(progress.get(quest["key"], 0), quest["target"])
        rows.append(
            {
                **quest,
                "progress": done,
                "complete": done >= quest["target"],
                "claimed": quest["key"] in claimed,
            }
        )
    return rows


def _period_key(kind: str) -> str:
    if kind == "weekly":
        start = _week_start()
        return f"w{start.year}-{start.month:02d}-{start.day:02d}"
    start = _day_start()
    return f"d{start.year}-{start.month:02d}-{start.day:02d}"


def claim_quest(db: Session, student: Student, key: str) -> tuple[list[dict], dict]:
    """Pay a finished quest once. Returns (reward_events, quest_payload)."""
    from ..game import grant

    quest = next((row for row in QUESTS if row["key"] == key), None)
    if quest is None:
        raise KeyError(key)
    state = next(row for row in quest_state(db, student.id) if row["key"] == key)
    if not state["complete"]:
        raise PermissionError("That quest is not finished yet.")
    if state["claimed"]:
        raise FileExistsError("Already claimed.")
    period = _period_key(quest["kind"])
    db.add(
        QuestClaim(
            student_id=student.id,
            quest_key=key,
            period_key=period,
            xp=int(quest["reward"]["xp"]),
            coins=int(quest["reward"]["coins"]),
        )
    )
    events = grant(
        db,
        student,
        xp=int(quest["reward"]["xp"]),
        coins=int(quest["reward"]["coins"]),
        kind="quest",
        title=f"Quest complete: {quest['label']}",
        detail=quest["detail"],
    )
    db.commit()
    return events, next(row for row in quest_state(db, student.id) if row["key"] == key)


# ---------------------------------------------------------------------------
# the map itself
# ---------------------------------------------------------------------------
MASTERED_AT = 75.0


def _node_state(answered: int, mastery: float, first_open: bool) -> str:
    if mastery >= MASTERED_AT and answered >= 3:
        return "mastered"
    if answered > 0:
        return "learning"
    return "available" if first_open else "locked"


def build_world_map(db: Session, student: Student) -> dict:
    """Assemble the whole adventure: worlds, their nodes, bosses, quests, totals."""
    courses = list(db.scalars(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).all())

    # mastery lookups (topic mastery keys are the raw Question.topic strings)
    topic_mastery = {
        row.scope_key: row
        for row in db.scalars(
            select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic")
        ).all()
    }
    course_mastery = {
        row.scope_key: row
        for row in db.scalars(
            select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "course")
        ).all()
    }

    quizzes = list(db.scalars(select(Quiz).where(Quiz.course_id.is_not(None)).order_by(Quiz.id)).all())
    attempts = list(
        db.scalars(
            select(Attempt).where(Attempt.student_id == student.id, Attempt.quiz_id.is_not(None)).order_by(Attempt.id)
        ).all()
    )

    materials = list(
        db.scalars(select(Material).where(Material.status == "published").order_by(Material.id)).all()
    )
    progress_rows = {
        row.material_id: row
        for row in db.scalars(select(MaterialProgress).where(MaterialProgress.student_id == student.id)).all()
    }

    practice_rows = list(db.scalars(select(PracticeRun).where(PracticeRun.student_id == student.id)).all())

    worlds: list[dict] = []
    total_nodes = total_mastered = total_materials = playable_bosses = 0

    for course in courses:
        question_rows = list(
            db.scalars(
                select(Question)
                .where(Question.course_id == course.id, Question.status == "approved", Question.visible.is_(True), Question.source_id.is_(None), Question.exam_only.is_(False))
                .order_by(Question.id)
            ).all()
        )
        # nodes are grouped in curriculum order (bank order), never shuffled: the
        # path a player walks must not move under them between visits.
        grouped: dict[str, dict] = {}
        for question in question_rows:
            topic = (question.topic or "").strip() or "General"
            bucket = grouped.setdefault(topic, {"topic": topic, "questions": 0, "first_id": question.id})
            bucket["questions"] += 1

        world_materials: dict[str, list[dict]] = {}
        for material in materials:
            if material.course_id != course.id:
                continue
            topic = (material.topic or "").strip() or "General"
            row = progress_rows.get(material.id)
            world_materials.setdefault(topic, []).append(
                {
                    "id": material.id,
                    "title": material.title,
                    "minutes": int(getattr(material, "estimated_minutes", 0) or 0),
                    "percent": int(row.percent) if row else 0,
                    "status": row.status if row else "not_started",
                }
            )

        nodes: list[dict] = []
        first_open_used = False
        for topic, bucket in grouped.items():
            mastery_row = topic_mastery.get(topic)
            answered = int(mastery_row.answered) if mastery_row else 0
            correct = int(mastery_row.correct) if mastery_row else 0
            mastery = round(float(mastery_row.mastery), 1) if mastery_row else 0.0
            state = _node_state(answered, mastery, not first_open_used)
            if state in {"available", "learning"}:
                first_open_used = True
            elif state == "mastered":
                first_open_used = True
            runs = [row for row in practice_rows if row.course_id == course.id and (row.topic or "") == topic]
            best = max((int(row.score) for row in runs), default=0)
            attempted = sum(int(row.total) for row in runs)
            right = sum(int(row.correct) for row in runs)
            nodes.append(
                {
                    "topic": topic,
                    "questions": bucket["questions"],
                    "answered": answered,
                    "correct": correct,
                    "mastery": mastery,
                    "state": state,
                    "materials": world_materials.get(topic, []),
                    "practice": {
                        "runs": len(runs),
                        "best": best,
                        "accuracy": round(right / max(attempted, 1) * 100, 1) if attempted else 0.0,
                    },
                }
            )

        if not nodes:
            continue

        world_quizzes = [quiz for quiz in quizzes if quiz.course_id == course.id]
        best_attempt = None
        for quiz in world_quizzes:
            for attempt in attempts:
                if attempt.quiz_id == quiz.id:
                    if best_attempt is None or (attempt.percentage or 0) > (best_attempt.percentage or 0):
                        best_attempt = attempt
        active_quiz = next((quiz for quiz in world_quizzes if quiz.status == "active"), None)
        boss_quiz = active_quiz or (world_quizzes[0] if world_quizzes else None)
        boss = None
        if boss_quiz is not None:
            boss = {
                "quiz_id": boss_quiz.id,
                "title": boss_quiz.title,
                "status": boss_quiz.status,
                "question_count": len([q for q in (boss_quiz.questions or []) if getattr(q, "visible", True)]),
                "scheduled_at": boss_quiz.scheduled_at.isoformat() if boss_quiz.scheduled_at else None,
                "best_percentage": round(float(best_attempt.percentage), 1) if best_attempt else None,
                "best_score": int(best_attempt.score) if best_attempt else None,
                "attempts": sum(1 for attempt in attempts if attempt.quiz_id == boss_quiz.id),
            }
            if boss_quiz.status == "active":
                playable_bosses += 1

        mastered_here = sum(1 for node in nodes if node["state"] == "mastered")
        answered_here = sum(node["answered"] for node in nodes)
        correct_here = sum(node["correct"] for node in nodes)
        mastery_row = course_mastery.get(course.code)
        world_mastery = round(float(mastery_row.mastery), 1) if mastery_row else 0.0
        materials_here = sum(len(node["materials"]) for node in nodes)

        total_nodes += len(nodes)
        total_mastered += mastered_here
        total_materials += materials_here

        worlds.append(
            {
                "course_id": course.id,
                "code": course.code,
                "title": course.title,
                "description": course.description or "",
                "accent": course.accent or "violet",
                "theme": theme_for(course.code, course.title),
                "mastery": world_mastery,
                "answered": answered_here,
                "correct": correct_here,
                "percent": round(mastered_here / len(nodes) * 100, 1) if nodes else 0.0,
                "materials": materials_here,
                "boss": boss,
                "nodes": nodes,
            }
        )

    level = level_from_xp(student.xp)
    reachable = sum(1 for world in worlds for node in world["nodes"] if node["state"] != "locked")
    quests = quest_state(db, student.id)
    return {
        "generated_at": utcnow().isoformat() + "Z",
        "player": {
            "level": level,
            "title": title_for_level(level),
            "xp": int(student.xp),
            "streak": int(student.streak or 0),
            "coins": int(student.coins),
        },
        "totals": {
            "worlds": len(worlds),
            "nodes": total_nodes,
            "mastered": total_mastered,
            "reachable": reachable,
            "materials": total_materials,
            "bosses": playable_bosses,
            "path_percent": round(total_mastered / total_nodes * 100, 1) if total_nodes else 0.0,
        },
        "quests": quests,
        "worlds": worlds,
    }
