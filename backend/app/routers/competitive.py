"""Competitive layer: leaderboards, mastery, collection, tournaments, groups.

Everything reads the same scoring tables the rest of the arena writes to, so a
duel win, an exam or a flashcard session all feed one progression universe.
"""
from __future__ import annotations

import random
import string
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..services import season as season_ladder
from ..deps import require_admin, require_student
from ..events import dispatch, to_everyone, to_student
from ..models import (
    Answer,
    Attempt,
    Badge,
    Course,
    Duel,
    DuelParticipant,
    FlashcardCard,
    FlashcardDeck,
    FlashcardReview,
    GroupMessage,
    PlayerMastery,
    PracticeRun,
    Question,
    Quiz,
    SeasonStat,
    Student,
    StudentBadge,
    StudyGroup,
    StudyGroupMember,
    Tournament,
    TournamentEntry,
    TournamentMatch,
    utcnow,
)
from ..schemas import DuelSeriesIn, GroupMessageIn, StudyGroupIn, TournamentIn
from ..serializers import iso, leaderboard_row, question_public, student_public
from ..services.questions import display_order

router = APIRouter(prefix="/arena", tags=["arena"])

WEEK_SCOPES = ("weekly", "monthly", "season")


# ---------------------------------------------------------------------------
# Leaderboards
# ---------------------------------------------------------------------------
def _rank_of(db: Session, column, student: Student, extra=None) -> tuple[int, int]:
    """(rank, total) for a student on an arbitrary metric column."""
    clause = [Student.is_banned.is_(False)]
    if extra is not None:
        clause.append(extra)
    better = db.scalar(select(func.count(Student.id)).where(column > getattr(student, column.name), *clause))
    total = db.scalar(select(func.count(Student.id)).where(*clause))
    return int(better or 0) + 1, int(total or 0)


def _passed_players(db: Session, student: Student) -> int:
    """How many players this student overtook this week (XP minus weekly XP)."""
    start_of_week = student.xp - student.weekly_xp
    if start_of_week <= 0:
        return 0
    return int(
        db.scalar(
            select(func.count(Student.id)).where(
                Student.id != student.id,
                Student.is_banned.is_(False),
                Student.xp < student.xp,
                (Student.xp - Student.weekly_xp) > start_of_week,
            )
        )
        or 0
    )


@router.get("/leaderboards")
def leaderboards(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    scope: str = Query("global"),
    limit: int = Query(25, ge=5, le=100),
    course_id: int | None = Query(None),
    topic: str = Query(""),
) -> dict:
    """One endpoint, many boards — global, weekly, monthly, season and skill boards."""
    active = Student.is_banned.is_(False)
    month_start = utcnow() - timedelta(days=30)
    rows: list[Student] = []
    labels: dict[int, float] = {}

    if scope == "monthly":
        best = dict(
            db.execute(
                select(Attempt.student_id, func.max(Attempt.percentage))
                .where(Attempt.status == "submitted", Attempt.submitted_at >= month_start)
                .group_by(Attempt.student_id)
            ).all()
        )
        ranked = sorted(best.items(), key=lambda item: -float(item[1]))[:limit]
        rows = [db.get(Student, sid) for sid, _ in ranked if db.get(Student, sid) and not db.get(Student, sid).is_banned]
        labels = {sid: float(value) for sid, value in ranked}
    elif scope == "accuracy":
        rows = list(
            db.scalars(
                select(Student)
                .where(active, Student.questions_answered >= 10)
                .order_by(
                    (Student.correct_answers * 1.0 / func.max(Student.questions_answered, 1)).desc(), Student.xp.desc()
                )
                .limit(limit)
            ).all()
        )
    elif scope == "speed":
        averages = dict(
            db.execute(
                select(Answer.attempt_id, func.avg(Answer.seconds_spent)).group_by(Answer.attempt_id)
            ).all()
        )
        per_student: dict[int, list[float]] = {}
        attempts = db.scalars(select(Attempt).where(Attempt.status == "submitted")).all()
        for attempt in attempts:
            value = averages.get(attempt.id)
            if value:
                per_student.setdefault(attempt.student_id, []).append(float(value))
        scored = [
            (sid, sum(values) / len(values))
            for sid, values in per_student.items()
            if len(values) >= 1 and sum(values) / len(values) > 0
        ]
        scored.sort(key=lambda item: item[1])
        for sid, value in scored[:limit]:
            row = db.get(Student, sid)
            if row and not row.is_banned:
                rows.append(row)
                labels[sid] = round(value, 1)
    elif scope == "streak":
        rows = list(
            db.scalars(select(Student).where(active).order_by(Student.best_streak.desc(), Student.xp.desc()).limit(limit)).all()
        )
    elif scope == "flashcard":
        counts = dict(
            db.execute(
                select(FlashcardReview.student_id, func.count(FlashcardReview.id)).group_by(FlashcardReview.student_id)
            ).all()
        )
        ranked = sorted(counts.items(), key=lambda item: -int(item[1]))[:limit]
        rows = [db.get(Student, sid) for sid, _ in ranked if db.get(Student, sid)]
        labels = {sid: float(value) for sid, value in ranked}
    elif scope == "season":
        rows = list(
            db.scalars(
                select(Student)
                .join(SeasonStat, SeasonStat.student_id == Student.id)
                .where(active, SeasonStat.season_key == _season_key())
                .order_by(SeasonStat.xp.desc())
                .limit(limit)
            ).all()
        )
    elif scope in {"course", "topic"}:
        stmt = select(PlayerMastery, Student).join(Student, Student.id == PlayerMastery.student_id).where(
            active, PlayerMastery.scope_type == ("course" if scope == "course" else "topic")
        )
        if scope == "course" and course_id:
            course = db.get(Course, course_id)
            if course:
                stmt = stmt.where(PlayerMastery.scope_key == course.code)
        if scope == "topic" and topic:
            stmt = stmt.where(PlayerMastery.scope_key == topic)
        ranked = db.execute(stmt.order_by(PlayerMastery.mastery.desc()).limit(limit)).all()
        for mastery, row in ranked:
            rows.append(row)
            labels[row.id] = mastery.mastery
    elif scope == "class":
        rows = list(
            db.scalars(
                select(Student)
                .where(active, Student.class_name == student.class_name)
                .order_by(Student.xp.desc())
                .limit(limit)
            ).all()
        )
    elif scope == "campus":
        rows = list(
            db.scalars(
                select(Student)
                .where(active, Student.campus == student.campus)
                .order_by(Student.xp.desc())
                .limit(limit)
            ).all()
        )
    elif scope == "duel":
        rows = list(
            db.scalars(
                select(Student).where(active, Student.duels_played > 0).order_by(Student.duels_won.desc()).limit(limit)
            ).all()
        )
    elif scope == "friends":
        from .content import friend_ids

        rows = list(
            db.scalars(select(Student).where(Student.id.in_(friend_ids(db, student.id))).order_by(Student.xp.desc()).limit(limit)).all()
        )
    else:
        rows = list(db.scalars(select(Student).where(active).order_by(Student.xp.desc(), Student.coins.desc()).limit(limit)).all())

    payload = []
    for index, row in enumerate(rows, start=1):
        entry = leaderboard_row(row, index)
        if row.id in labels:
            entry["value"] = round(labels[row.id], 1)
        entry["is_you"] = row.id == student.id
        payload.append(entry)

    my_rank = next((row["rank"] for row in payload if row["is_you"]), None)
    if my_rank is None:
        if scope in {"global", "weekly", "duel"}:
            column = {"global": Student.xp, "weekly": Student.weekly_xp, "duel": Student.duels_won}[scope]
            my_rank, total = _rank_of(db, column, student, active if scope == "duel" else active)
        else:
            my_rank = 0
            total = int(db.scalar(select(func.count(Student.id)).where(active)) or 0)
    else:
        total = int(db.scalar(select(func.count(Student.id)).where(active)) or 0)

    return {
        "scope": scope,
        "rows": payload,
        "me": leaderboard_row(student, my_rank or 0),
        "my_rank": my_rank or 0,
        "total_players": total,
        "passed_players": _passed_players(db, student),
        "scopes": [
            {"key": "global", "label": "Global XP"},
            {"key": "weekly", "label": "This week"},
            {"key": "monthly", "label": "Best exam % (30d)"},
            {"key": "season", "label": "Season XP"},
            {"key": "accuracy", "label": "Accuracy"},
            {"key": "speed", "label": "Fastest average"},
            {"key": "streak", "label": "Best streak"},
            {"key": "duel", "label": "Duels won"},
            {"key": "flashcard", "label": "Cards reviewed"},
            {"key": "course", "label": "Course mastery"},
            {"key": "topic", "label": "Topic mastery"},
            {"key": "class", "label": "Class"},
            {"key": "campus", "label": "Campus"},
            {"key": "friends", "label": "Friends"},
        ],
    }


def _season_key() -> str:
    """A season is one calendar month (see services/season.py)."""
    return season_ladder.season_key()


@router.get("/season")
def season(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The live season: the ladder, where you sit on it, and the board.

    Season XP answers "what have I earned this month" — it starts again at zero
    when the month rolls over. Lifetime XP, coins, badges and mastery are a
    separate ledger and are never reset.
    """
    key = _season_key()
    ladder = season_ladder.summary(db, student)
    mine = db.scalar(select(SeasonStat).where(SeasonStat.student_id == student.id, SeasonStat.season_key == key))
    if mine is None:
        mine = SeasonStat(student_id=student.id, season_key=key, xp=0, coins=0)
        db.add(mine)
        db.commit()
    board = db.execute(
        select(SeasonStat, Student)
        .join(Student, Student.id == SeasonStat.student_id)
        .where(SeasonStat.season_key == key)
        .order_by(SeasonStat.xp.desc())
        .limit(20)
    ).all()
    rank = int(
        db.scalar(select(func.count(SeasonStat.id)).where(SeasonStat.season_key == key, SeasonStat.xp > mine.xp)) or 0
    ) + 1
    me = ladder["me"]
    return {
        "season_key": key,
        "label": ladder["season"]["label"],
        "days_left": ladder["season"]["days_left"],
        "my": {"xp": mine.xp, "coins": mine.coins, "rank": rank, "prestige": student.xp // 12500},
        "prestige_tier": me["rank"]["label"],
        # --- the badge ladder -------------------------------------------------
        "season": ladder["season"],
        "me_season": me,
        "ladder": ladder["ladder"],
        "levels": ladder["levels"],
        "history": ladder["history"],
        # ----------------------------------------------------------------------
        "leaderboard": [
            {**student_public(row, mask=True), "season_xp": stat.xp, "rank": index + 1}
            for index, (stat, row) in enumerate(board)
        ],
        "rewards": [
            {"rank": "Top 1", "xp": 2000, "coins": 1200, "badge": "season_king"},
            {"rank": "Top 3", "xp": 1200, "coins": 700, "badge": "season_podium"},
            {"rank": "Top 10", "xp": 600, "coins": 350, "badge": ""},
            {"rank": "Top 50", "xp": 250, "coins": 150, "badge": ""},
        ],
        "season_rewards_available": bool(mine.xp >= 1000),
    }


@router.post("/season/claim")
async def claim_season(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    key = _season_key()
    mine = db.scalar(select(SeasonStat).where(SeasonStat.student_id == student.id, SeasonStat.season_key == key))
    if mine is None or mine.xp < 1000:
        raise HTTPException(status.HTTP_409_CONFLICT, "Reach 1,000 season XP to claim the season reward.")
    rank = int(
        db.scalar(select(func.count(SeasonStat.id)).where(SeasonStat.season_key == key, SeasonStat.xp > mine.xp)) or 0
    ) + 1
    xp, coins = (2000, 1200) if rank == 1 else (1200, 700) if rank <= 3 else (600, 350) if rank <= 10 else (250, 150)
    if (mine.coins or 0) >= coins == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Season reward already claimed.")
    mine.coins += coins
    # Claiming a season reward must not push you up the same season's ladder.
    rewards = game.grant(
        db, student, xp=xp, coins=coins, kind="xp", title="Season reward", detail=f"Rank {rank} in {key}", season=False
    )
    db.commit()
    if rewards:
        await dispatch([to_student(student.id, "rewards", rewards)])
    return {"ok": True, "rank": rank, "xp": xp, "coins": coins, "rewards": rewards}


# ---------------------------------------------------------------------------
# Mastery & collection
# ---------------------------------------------------------------------------
@router.get("/mastery")
def mastery(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(PlayerMastery).where(PlayerMastery.student_id == student.id).order_by(PlayerMastery.mastery.desc())
    ).all()
    grouped: dict[str, list[dict]] = {"course": [], "topic": [], "subtopic": [], "difficulty": []}
    for row in rows:
        grouped.setdefault(row.scope_type, []).append(
            {
                "key": row.scope_key,
                "answered": row.answered,
                "correct": row.correct,
                "accuracy": round(row.correct / max(row.answered, 1) * 100, 1),
                "mastery": row.mastery,
            }
        )
    weak = [entry for entry in grouped["topic"] if entry["answered"] >= 3 and entry["mastery"] < 55][:8]
    strong = [entry for entry in grouped["topic"] if entry["mastery"] >= 75][:8]
    return {
        "course": grouped["course"],
        "topic": grouped["topic"],
        "subtopic": grouped["subtopic"],
        "difficulty": grouped["difficulty"],
        "weak_topics": weak,
        "strong_topics": strong,
        "heatmap": [
            {"topic": entry["key"], "mastery": entry["mastery"], "answered": entry["answered"]}
            for entry in grouped["topic"][:60]
        ],
        "overall": round(
            sum(entry["mastery"] for entry in grouped["topic"]) / max(len(grouped["topic"]), 1), 1
        ),
    }


ACHIEVEMENT_CATEGORIES = {
    "exam": "Exam achievements",
    "duel": "Duel achievements",
    "flashcard": "Flashcard achievements",
    "streak": "Study streaks",
    "social": "Social achievements",
    "mastery": "Mastery",
    "hidden": "Secret achievements",
}


@router.get("/world-map")
def world_map(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """The adventure map: courses as worlds, topics as locations, exams as bosses.

    Everything on the map is read from the engines that already own it (exam
    results, practice runs, material progress, mastery bands), so the map can
    never show a different picture from the rest of the arena.
    """
    from ..services import worldmap

    return worldmap.build_world_map(db, student)


@router.post("/quests/{quest_key}/claim")
def claim_quest(quest_key: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Collect a finished quest. Progress is re-verified here — never trusted from the client."""
    from ..services import worldmap

    try:
        events, quest = worldmap.claim_quest(db, student, quest_key)
    except KeyError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown quest.") from error
    except PermissionError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    except FileExistsError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    return {"quest": quest, "rewards": events, "profile": student_public(student)}


@router.get("/collection")
def collection(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Badge showcase: earned, in-progress and hidden achievements."""
    badges = db.scalars(select(Badge)).all()
    owned = {
        row.badge_id: row.awarded_at
        for row in db.scalars(select(StudentBadge).where(StudentBadge.student_id == student.id)).all()
    }
    flashcard_reviews = int(
        db.scalar(select(func.count(FlashcardReview.id)).where(FlashcardReview.student_id == student.id)) or 0
    )
    practice_runs = int(
        db.scalar(select(func.count(PracticeRun.id)).where(PracticeRun.student_id == student.id)) or 0
    )
    topic_mastery = db.scalars(
        select(PlayerMastery).where(PlayerMastery.student_id == student.id, PlayerMastery.scope_type == "topic")
    ).all()
    perfect_scores = int(
        db.scalar(select(func.count(Attempt.id)).where(Attempt.student_id == student.id, Attempt.percentage >= 100)) or 0
    )
    items = []
    for badge in badges:
        earned = badge.id in owned
        progress = None
        if badge.key == "card_shark":
            progress = {"value": min(flashcard_reviews, 500), "goal": 500}
        elif badge.key == "sharpshooter":
            progress = {"value": min(student.best_run, 10), "goal": 10}
        elif badge.key == "centurion":
            progress = {"value": min(student.correct_answers, 100), "goal": 100}
        elif badge.key == "flawless":
            progress = {"value": min(int(student.best_percentage), 95), "goal": 95}
        elif badge.key == "streak_7":
            progress = {"value": min(student.best_streak, 7), "goal": 7}
        elif badge.key == "level_10":
            progress = {"value": game.level_from_xp(student.xp), "goal": 10}
        items.append(
            {
                "key": badge.key,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "tier": badge.tier,
                "xp_reward": badge.xp_reward,
                "coin_reward": badge.coin_reward,
                "earned": earned,
                "awarded_at": iso(owned.get(badge.id)) if earned else None,
                "category": (
                    "duel"
                    if "duel" in badge.key
                    else "flashcard"
                    if badge.key in {"card_shark", "daily_goal"}
                    else "streak"
                    if "streak" in badge.key
                    else "social"
                    if badge.key == "socialite"
                    else "exam"
                ),
                "progress": progress,
                "hidden": badge.key.startswith("secret_") and not earned,
                "secret": badge.key.startswith("secret_"),
            }
        )
    items.append(
        {
            "key": "perfect_run",
            "name": "Perfect Run",
            "description": "Finish a practice run without a single mistake",
            "icon": "sparkles",
            "tier": "platinum",
            "earned": perfect_scores > 0,
            "awarded_at": None,
            "category": "mastery",
            "progress": {"value": perfect_scores, "goal": 1},
            "hidden": False,
            "secret": False,
        }
    )
    items.append(
        {
            "key": "gauntlet",
            "name": "Gauntlet",
            "description": "Complete 10 practice runs",
            "icon": "swords",
            "tier": "gold",
            "earned": practice_runs >= 10,
            "awarded_at": None,
            "category": "mastery",
            "progress": {"value": min(practice_runs, 10), "goal": 10},
            "hidden": False,
            "secret": False,
        }
    )
    items.append(
        {
            "key": "polymath",
            "name": "Polymath",
            "description": "Push 5 topics past 75% mastery",
            "icon": "brain",
            "tier": "platinum",
            "earned": sum(1 for row in topic_mastery if row.mastery >= 75) >= 5,
            "awarded_at": None,
            "category": "mastery",
            "progress": {"value": sum(1 for row in topic_mastery if row.mastery >= 75), "goal": 5},
            "hidden": False,
            "secret": False,
        }
    )
    earned_count = sum(1 for item in items if item["earned"])
    return {
        "items": items,
        "categories": [{"key": key, "label": label} for key, label in ACHIEVEMENT_CATEGORIES.items()],
        "earned": earned_count,
        "total": len(items),
        "showcase": [item for item in items if item["earned"]][:6],
        "completion": round(earned_count / max(len(items), 1) * 100, 1),
    }


# ---------------------------------------------------------------------------
# Tournaments
# ---------------------------------------------------------------------------
def _bracket_pairings(entries: list[TournamentEntry]) -> list[list[TournamentEntry]]:
    pairs = []
    for index in range(0, len(entries), 2):
        pairs.append(entries[index : index + 2])
    return pairs


@router.get("/tournaments")
def list_tournaments(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    cycles = _ensure_cycles(db)
    rows = db.scalars(select(Tournament).order_by(Tournament.created_at.desc()).limit(40)).all()
    mine = {
        row.tournament_id
        for row in db.scalars(select(TournamentEntry).where(TournamentEntry.student_id == student.id)).all()
    }
    payload = []
    for row in rows:
        count = int(db.scalar(select(func.count(TournamentEntry.id)).where(TournamentEntry.tournament_id == row.id)) or 0)
        payload.append(
            {
                "id": row.id,
                "name": row.name,
                "scope": row.scope,
                "kind": row.kind,
                "status": row.status,
                "size": row.size,
                "entries": count,
                "course_id": row.course_id,
                "scope_value": row.scope_value,
                "prize_xp": row.prize_xp,
                "prize_coins": row.prize_coins,
                "badge_key": row.badge_key,
                "cycle_key": row.cycle_key,
                "starts_at": iso(row.starts_at),
                "ends_at": iso(row.ends_at),
                "joined": row.id in mine,
            }
        )
    return {"tournaments": payload, "created_cycles": cycles}


def _ensure_cycles(db: Session) -> list[str]:
    """Keep a weekly, monthly, campus and course tournament open for everyone."""
    created: list[str] = []
    today = utcnow().date()
    iso = today.isocalendar()
    cycles = {
        "weekly": f"{iso[0]}-W{iso[1]:02d}",
        "monthly": f"{today.year}-{today.month:02d}",
        "campus": f"{today.year}-{today.month:02d}",
        "class": f"{today.year}-{today.month:02d}",
    }
    labels = {
        "weekly": "Weekly Arena Cup",
        "monthly": "Monthly Championship",
        "campus": "Campus Clash",
        "class": "Class Tournament",
    }
    for scope, key in cycles.items():
        existing = db.scalar(select(Tournament.id).where(Tournament.scope == scope, Tournament.cycle_key == key))
        if existing:
            continue
        row = Tournament(
            name=f"{labels[scope]} · {key}",
            scope=scope,
            kind="ladder" if scope in {"weekly", "monthly"} else "bracket",
            status="open",
            size=16,
            cycle_key=key,
            prize_xp=800 if scope == "monthly" else 400,
            prize_coins=500 if scope == "monthly" else 250,
            badge_key=f"tournament_{scope}",
            starts_at=utcnow(),
            ends_at=utcnow() + timedelta(days=7 if scope == "weekly" else 30),
        )
        db.add(row)
        created.append(f"{scope}:{key}")
    if created:
        db.commit()
    return created


@router.post("/tournaments")
def create_tournament(
    payload: TournamentIn,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> dict:
    row = Tournament(
        name=payload.name.strip(),
        scope=payload.scope,
        kind=payload.kind,
        course_id=payload.course_id,
        scope_value=payload.scope_value,
        size=payload.size,
        prize_xp=payload.prize_xp,
        prize_coins=payload.prize_coins,
        cycle_key=f"{utcnow().date().isoformat()}",
        starts_at=utcnow(),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id, "name": row.name}


@router.post("/tournaments/{tournament_id}/join")
def join_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tournament not found.")
    if tournament.status == "finished":
        raise HTTPException(status.HTTP_409_CONFLICT, "That tournament is already over.")
    existing = db.scalar(
        select(TournamentEntry).where(
            TournamentEntry.tournament_id == tournament.id, TournamentEntry.student_id == student.id
        )
    )
    if existing:
        return {"ok": True, "already": True, "entry_id": existing.id}
    count = int(db.scalar(select(func.count(TournamentEntry.id)).where(TournamentEntry.tournament_id == tournament.id)) or 0)
    if count >= tournament.size:
        raise HTTPException(status.HTTP_409_CONFLICT, "This tournament is full — join the next cycle.")
    entry = TournamentEntry(tournament_id=tournament.id, student_id=student.id, seed=count + 1)
    db.add(entry)
    db.commit()
    return {"ok": True, "entry_id": entry.id, "seed": entry.seed}


@router.get("/tournaments/{tournament_id}")
def tournament_detail(tournament_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tournament not found.")
    entries = db.scalars(
        select(TournamentEntry).where(TournamentEntry.tournament_id == tournament.id).order_by(TournamentEntry.seed)
    ).all()
    matches = db.scalars(
        select(TournamentMatch).where(TournamentMatch.tournament_id == tournament.id).order_by(TournamentMatch.round_no, TournamentMatch.slot)
    ).all()
    names = {row.id: row.student.name if row.student else f"Player {row.student_id}" for row in entries}
    return {
        "tournament": {
            "id": tournament.id,
            "name": tournament.name,
            "scope": tournament.scope,
            "kind": tournament.kind,
            "status": tournament.status,
            "size": tournament.size,
            "prize_xp": tournament.prize_xp,
            "prize_coins": tournament.prize_coins,
            "cycle_key": tournament.cycle_key,
        },
        "standings": [
            {
                "entry_id": row.id,
                "student_id": row.student_id,
                "name": names.get(row.id, ""),
                "seed": row.seed,
                "score": row.score,
                "wins": row.wins,
                "losses": row.losses,
                "round_reached": row.round_reached,
                "eliminated": row.eliminated,
                "is_you": row.student_id == student.id,
            }
            for row in entries
        ],
        "matches": [
            {
                "id": row.id,
                "round": row.round_no,
                "slot": row.slot,
                "a": {"id": row.student_a, "name": names.get(row.student_a, "") if row.student_a else "TBD"},
                "b": {"id": row.student_b, "name": names.get(row.student_b, "") if row.student_b else "TBD"},
                "winner_id": row.winner_id,
                "duel_id": row.duel_id,
                "score_a": row.score_a,
                "score_b": row.score_b,
                "status": row.status,
            }
            for row in matches
        ],
    }


@router.post("/tournaments/{tournament_id}/advance")
async def advance_tournament(
    tournament_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> dict:
    """Seed or advance a bracket, settling matches from finished duels."""
    tournament = db.get(Tournament, tournament_id)
    if tournament is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tournament not found.")
    entries = list(
        db.scalars(select(TournamentEntry).where(TournamentEntry.tournament_id == tournament.id).order_by(TournamentEntry.seed)).all()
    )
    if tournament.kind == "ladder" or not entries:
        for index, entry in enumerate(entries, start=1):
            entry.score = int(entry.score or 0) + random.Random(f"{tournament.id}:{entry.id}").randint(10, 60)
            _ = index
        db.commit()
        return {"ok": True, "mode": "ladder"}

    existing_rounds = {row.round_no for row in db.scalars(select(TournamentMatch).where(TournamentMatch.tournament_id == tournament.id)).all()}
    if not existing_rounds:
        pairs = _bracket_pairings(entries)
        for slot, pair in enumerate(pairs, start=1):
            if len(pair) < 2:
                continue
            match = TournamentMatch(
                tournament_id=tournament.id,
                round_no=1,
                slot=slot,
                student_a=pair[0].student_id,
                student_b=pair[1].student_id,
                status="pending",
            )
            db.add(match)
        tournament.status = "live"
        db.commit()
        return {"ok": True, "mode": "seeded", "matches": len(pairs)}

    round_no = max(existing_rounds)
    matches = db.scalars(
        select(TournamentMatch).where(TournamentMatch.tournament_id == tournament.id, TournamentMatch.round_no == round_no)
    ).all()
    events = []
    for match in matches:
        if match.status == "done":
            continue
        duel = db.get(Duel, match.duel_id) if match.duel_id else None
        if duel and duel.status == "finished":
            match.winner_id = duel.winner_id
        else:
            # No live duel: the higher-XP player advances (staff can override).
            a = db.get(Student, match.student_a) if match.student_a else None
            b = db.get(Student, match.student_b) if match.student_b else None
            match.winner_id = (a.id if (a and (not b or a.xp >= b.xp)) else (b.id if b else None))
        match.status = "done"
        if match.winner_id:
            winner = db.scalar(
                select(TournamentEntry).where(
                    TournamentEntry.tournament_id == tournament.id, TournamentEntry.student_id == match.winner_id
                )
            )
            loser_id = match.student_b if match.winner_id == match.student_a else match.student_a
            loser = db.scalar(
                select(TournamentEntry).where(
                    TournamentEntry.tournament_id == tournament.id, TournamentEntry.student_id == loser_id
                )
            ) if loser_id else None
            if winner:
                winner.wins += 1
                winner.round_reached = max(winner.round_reached, round_no)
            if loser:
                loser.losses += 1
                loser.eliminated = True

    winners = [
        match.winner_id
        for match in matches
        if match.winner_id
    ]
    if len(winners) <= 1:
        tournament.status = "finished"
        champion = winners[0] if winners else None
        if champion:
            student = db.get(Student, champion)
            entry = db.scalar(
                select(TournamentEntry).where(TournamentEntry.tournament_id == tournament.id, TournamentEntry.student_id == champion)
            )
            if entry:
                entry.round_reached = round_no + 1
            if student:
                rewards = game.grant(
                    db,
                    student,
                    xp=tournament.prize_xp,
                    coins=tournament.prize_coins,
                    kind="xp",
                    title=f"Tournament champion — {tournament.name}",
                    detail="You took the bracket.",
                )
                events.append(to_student(student.id, "rewards", rewards))
                events.append(to_everyone("tournament_champion", {"name": student.name, "tournament": tournament.name}))
    else:
        next_round = round_no + 1
        for slot, index in enumerate(range(0, len(winners), 2), start=1):
            pair = winners[index : index + 2]
            if len(pair) < 2:
                break
            db.add(
                TournamentMatch(
                    tournament_id=tournament.id,
                    round_no=next_round,
                    slot=slot,
                    student_a=pair[0],
                    student_b=pair[1],
                    status="pending",
                )
            )
    db.commit()
    if events:
        await dispatch(events)
    return {"ok": True, "mode": "advanced", "round": round_no, "winners": winners}


@router.get("/tournaments/history/me")
def my_tournaments(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    entries = db.scalars(
        select(TournamentEntry).where(TournamentEntry.student_id == student.id).order_by(TournamentEntry.id.desc()).limit(30)
    ).all()
    payload = []
    for entry in entries:
        tournament = db.get(Tournament, entry.tournament_id)
        payload.append(
            {
                "tournament": {
                    "id": entry.tournament_id,
                    "name": tournament.name if tournament else "",
                    "scope": tournament.scope if tournament else "",
                    "status": tournament.status if tournament else "",
                },
                "wins": entry.wins,
                "losses": entry.losses,
                "score": entry.score,
                "round_reached": entry.round_reached,
                "champion": bool(tournament and tournament.status == "finished" and not entry.eliminated and entry.wins > 0),
            }
        )
    return {"history": payload}


# ---------------------------------------------------------------------------
# Study groups
# ---------------------------------------------------------------------------
def _make_group_code(db: Session) -> str:
    alphabet = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"
    for _ in range(20):
        code = "".join(random.choice(alphabet) for _ in range(6))
        if not db.scalar(select(StudyGroup.id).where(StudyGroup.code == code)):
            return code
    return "GROUP1"


def _group_public(db: Session, group: StudyGroup, student: Student) -> dict:
    members = db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)).all()
    is_member = any(row.student_id == student.id for row in members)
    return {
        "id": group.id,
        "code": group.code,
        "name": group.name,
        "description": group.description,
        "owner_id": group.owner_id,
        "course_id": group.course_id,
        "goal": group.goal,
        "members": len(members),
        "is_member": is_member,
        "is_owner": group.owner_id == student.id,
        "created_at": iso(group.created_at),
    }


@router.get("/groups")
def my_groups(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    memberships = db.scalars(select(StudyGroupMember).where(StudyGroupMember.student_id == student.id)).all()
    groups = [db.get(StudyGroup, row.group_id) for row in memberships]
    discover = db.scalars(select(StudyGroup).order_by(StudyGroup.id.desc()).limit(20)).all()
    return {
        "mine": [_group_public(db, group, student) for group in groups if group],
        "discover": [
            _group_public(db, group, student)
            for group in discover
            if group.id not in {row.group_id for row in memberships}
        ][:10],
    }


@router.post("/groups")
def create_group(
    payload: StudyGroupIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    group = StudyGroup(
        code=_make_group_code(db),
        name=payload.name.strip(),
        description=payload.description[:300],
        owner_id=student.id,
        course_id=payload.course_id,
        goal=payload.goal[:200],
    )
    db.add(group)
    db.flush()
    db.add(StudyGroupMember(group_id=group.id, student_id=student.id, role="owner"))
    db.commit()
    return _group_public(db, group, student)


@router.post("/groups/join/{code}")
def join_group(code: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    group = db.scalar(select(StudyGroup).where(StudyGroup.code == code.strip().upper()))
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No study group with that code.")
    existing = db.scalar(
        select(StudyGroupMember).where(StudyGroupMember.group_id == group.id, StudyGroupMember.student_id == student.id)
    )
    if existing is None:
        db.add(StudyGroupMember(group_id=group.id, student_id=student.id))
        db.commit()
    return _group_public(db, group, student)


@router.get("/groups/{group_id}")
def group_detail(group_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    group = db.get(StudyGroup, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    members = db.scalars(select(StudyGroupMember).where(StudyGroupMember.group_id == group.id)).all()
    week_key = game.week_key()
    board = []
    for member in members:
        student_row = db.get(Student, member.student_id)
        if student_row is None:
            continue
        board.append(
            {
                **student_public(student_row, mask=True),
                "week_xp": member.week_xp if member.week_key == week_key else 0,
                "role": member.role,
            }
        )
    board.sort(key=lambda row: -row["week_xp"])
    return {
        "group": _group_public(db, group, student),
        "leaderboard": [{**row, "rank": index + 1} for index, row in enumerate(board)],
        "messages": _group_messages(db, group.id),
    }


def _group_messages(db: Session, group_id: int, limit: int = 60) -> list[dict]:
    rows = db.scalars(
        select(GroupMessage).where(GroupMessage.group_id == group_id).order_by(GroupMessage.id.desc()).limit(limit)
    ).all()
    return [
        {
            "id": row.id,
            "student_id": row.student_id,
            "name": row.student.name if row.student else "Player",
            "photo": bool(row.student.photo) if row.student else False,
            "avatar_hue": row.student.avatar_hue if row.student else 265,
            "body": row.body,
            "kind": row.kind,
            "meta": row.meta,
            "created_at": iso(row.created_at),
        }
        for row in reversed(rows)
    ]


@router.get("/groups/{group_id}/messages")
def group_messages(group_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return {"messages": _group_messages(db, group_id)}


@router.post("/groups/{group_id}/messages")
async def post_group_message(
    group_id: int,
    payload: GroupMessageIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    member = db.scalar(
        select(StudyGroupMember).where(StudyGroupMember.group_id == group_id, StudyGroupMember.student_id == student.id)
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the group first.")
    row = GroupMessage(group_id=group_id, student_id=student.id, body=payload.body[:600])
    db.add(row)
    db.commit()
    await dispatch([to_everyone("group_message", {"group_id": group_id, "message": _group_messages(db, group_id, 1)[0]})])
    return {"ok": True, "message": _group_messages(db, group_id, 1)[0]}


@router.post("/groups/{group_id}/group-quiz")
def group_quiz(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    size: int = Query(10, ge=3, le=30),
) -> dict:
    """Start a shared group quiz — everyone answers the same server-held set."""
    group = db.get(StudyGroup, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    from .practice import _adaptive_order, _pool, _srs_question_payload

    pool = _pool(db, course_id=group.course_id)
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, "No questions available for this group yet.")
    picks = _adaptive_order(db, pool, student, size, want_weak=False)
    orders = {row.id: display_order(row, shuffle=True, seed=f"group:{group.id}:{row.id}") for row in picks}
    row = GroupMessage(
        group_id=group.id,
        student_id=student.id,
        kind="live_question",
        body=f"{student.name.split(' ')[0]} started a group quiz — {len(picks)} questions",
        meta="{}",
    )
    db.add(row)
    db.commit()
    return {
        "questions": [_srs_question_payload(item, orders[item.id]) for item in picks],
        "seconds": 25,
        "started_by": student.name,
    }


@router.post("/groups/{group_id}/challenge")
async def group_challenge(
    group_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Challenge every member: push a group duel invitation into the room chat."""
    member = db.scalar(
        select(StudyGroupMember).where(StudyGroupMember.group_id == group_id, StudyGroupMember.student_id == student.id)
    )
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the group first.")
    row = GroupMessage(
        group_id=group_id,
        student_id=student.id,
        kind="system",
        body=f"{student.name.split(' ')[0]} challenged the group to a duel night",
    )
    db.add(row)
    db.commit()
    await dispatch([to_everyone("group_challenge", {"group_id": group_id, "from": student.name})])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Duel extras: rematch, series, stats, rivals
# ---------------------------------------------------------------------------
def _series_tally(db: Session, duel: Duel, student: Student) -> dict:
    if not duel.series_id:
        return {"series_id": "", "games": [], "score": {"you": 0, "them": 0}, "best_of": duel.best_of or 1}
    games = db.scalars(select(Duel).where(Duel.series_id == duel.series_id).order_by(Duel.game_index)).all()
    you = them = 0
    for game in games:
        if game.status != "finished":
            continue
        if game.winner_id == student.id:
            you += 1
        elif game.winner_id:
            them += 1
    return {
        "series_id": duel.series_id,
        "best_of": duel.best_of or 1,
        "score": {"you": you, "them": them},
        "games": [
            {
                "id": game.id,
                "game_index": game.game_index,
                "status": game.status,
                "winner_id": game.winner_id,
                "code": game.code,
            }
            for game in games
        ],
        "decided": you > (duel.best_of or 1) // 2 or them > (duel.best_of or 1) // 2,
    }


@router.get("/duels/{duel_id}/series")
def duel_series(duel_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    duel = db.get(Duel, duel_id)
    if duel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Duel not found.")
    return _series_tally(db, duel, student)


@router.post("/duels/{duel_id}/rematch")
async def duel_rematch(
    duel_id: int,
    payload: DuelSeriesIn | None = None,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Instant rematch (best-of series aware) against the same opponent."""
    from ..services import duel as duel_service
    from ..serializers import duel_public

    duel = db.get(Duel, duel_id)
    if duel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Duel not found.")
    opponent_participant = next((p for p in duel.participants if p.student_id != student.id), None)
    if opponent_participant is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This duel has no opponent to rematch.")
    opponent = db.get(Student, opponent_participant.student_id)
    if opponent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Opponent not found.")
    body = payload or DuelSeriesIn()
    series_id = duel.series_id or f"S{duel.id}-{random.randint(1000, 9999)}"
    try:
        new_duel, events = duel_service.create_duel(
            db,
            student,
            opponent=opponent,
            quiz_id=duel.quiz_id,
            course_id=duel.course_id,
            topic=duel.topic,
            question_count=body.question_count or duel.question_count,
            stake_coins=body.stake_coins if body.stake_coins is not None else duel.stake_coins,
            mode=duel.mode or "casual",
            best_of=body.best_of or duel.best_of or 1,
            series_id=series_id,
            game_index=(duel.game_index or 1) + 1,
            rematch_of=duel.id,
            difficulty=body.difficulty or duel.difficulty,
            sudden_death=bool(body.sudden_death or duel.sudden_death),
        )
        db.commit()
    except duel_service.DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(new_duel, viewer_id=student.id, include_questions=False)


@router.get("/duels/stats/me")
def duel_stats(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    finished = db.scalars(
        select(Duel).where(Duel.status == "finished", Duel.participants.any(student_id=student.id)).order_by(Duel.id.desc())
    ).all()
    wins = sum(1 for duel in finished if duel.winner_id == student.id)
    losses = sum(1 for duel in finished if duel.winner_id and duel.winner_id != student.id)
    draws = len(finished) - wins - losses
    streak = 0
    for duel in finished:
        if duel.winner_id == student.id:
            streak += 1
        else:
            break
    ranked = [duel for duel in finished if (duel.mode or "casual") == "ranked"]
    rating = 1000 + wins * 18 - losses * 14
    return {
        "played": len(finished),
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "win_rate": round(wins / len(finished) * 100, 1) if finished else 0.0,
        "current_streak": streak,
        "best_streak": student.best_run,
        "rating": max(400, rating),
        "ranked_played": len(ranked),
        "rivals": _rivals(db, student),
        "history": [
            {
                "id": duel.id,
                "code": duel.code,
                "topic": duel.topic,
                "mode": duel.mode or "casual",
                "best_of": duel.best_of or 1,
                "winner_id": duel.winner_id,
                "won": duel.winner_id == student.id,
                "finished_at": iso(duel.finished_at),
                "opponent": [
                    {"id": p.student_id, "name": p.student.name if p.student else ""}
                    for p in duel.participants
                    if p.student_id != student.id
                ],
            }
            for duel in finished[:20]
        ],
    }


def _rivals(db: Session, student: Student) -> list[dict]:
    """Players you have duelled most — your rivals, with a revenge prompt."""
    rows = db.execute(
        select(DuelParticipant.student_id, func.count(DuelParticipant.id))
        .join(Duel, Duel.id == DuelParticipant.duel_id)
        .where(Duel.participants.any(student_id=student.id), DuelParticipant.student_id != student.id)
        .group_by(DuelParticipant.student_id)
        .order_by(func.count(DuelParticipant.id).desc())
        .limit(5)
    ).all()
    rivals = []
    for rival_id, count in rows:
        rival = db.get(Student, rival_id)
        if rival is None:
            continue
        head_to_head = db.scalars(
            select(Duel).where(
                Duel.status == "finished",
                Duel.participants.any(student_id=student.id),
                Duel.participants.any(student_id=rival_id),
            )
        ).all()
        wins = sum(1 for duel in head_to_head if duel.winner_id == student.id)
        losses = sum(1 for duel in head_to_head if duel.winner_id == rival_id)
        rivals.append(
            {
                **student_public(rival, mask=True),
                "duels": int(count),
                "wins": wins,
                "losses": losses,
                "vengeance": losses > wins,
            }
        )
    return rivals


# ---------------------------------------------------------------------------
# Sharing & friend challenges
# ---------------------------------------------------------------------------
@router.get("/share/{kind}")
def build_share(kind: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """Generate shareable text for scores, achievements, streaks and ranks."""
    if kind == "score":
        best = db.scalar(
            select(Attempt).where(Attempt.student_id == student.id, Attempt.status == "submitted").order_by(Attempt.percentage.desc())
        )
        text = (
            f"I scored {best.percentage:.0f}% ({best.grade}) on {best.quiz.title} in Quiz Arena!"
            if best
            else "I'm training for my next exam on Quiz Arena."
        )
    elif kind == "streak":
        text = f"{student.streak}-day study streak on Quiz Arena 🔥"
    elif kind == "rank":
        rank = int(db.scalar(select(func.count(Student.id)).where(Student.xp > student.xp, Student.is_banned.is_(False))) or 0) + 1
        text = f"I'm rank #{rank} on the Quiz Arena leaderboard."
    elif kind == "achievement":
        badge = db.execute(
            select(Badge, StudentBadge)
            .join(StudentBadge, StudentBadge.badge_id == Badge.id)
            .where(StudentBadge.student_id == student.id)
            .order_by(StudentBadge.id.desc())
            .limit(1)
        ).first()
        text = f"I unlocked “{badge[0].name}” on Quiz Arena 🏆" if badge else "Chasing achievements on Quiz Arena."
    elif kind == "perfect":
        text = f"{int(student.best_percentage)}% perfect-score chasing on Quiz Arena."
    else:
        text = "Come duel me on Quiz Arena."
    return {"kind": kind, "text": text, "url": "/", "player_code": student.player_code}


@router.post("/challenge/{student_id}")
async def challenge_friend(
    student_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Send a friend-challenge invitation (lands in chat + notifications)."""
    from ..models import ChatMessage, InboxNote

    target = db.get(Student, student_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    if target.id == student.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot challenge yourself.")
    message = ChatMessage(
        sender_id=student.id,
        recipient_id=target.id,
        kind="duel",
        body=f"{student.name} challenged you to a duel!",
        meta='{"challenge": true}',
    )
    db.add(message)
    db.add(
        InboxNote(
            student_id=target.id,
            kind="duel",
            title=f"{student.name} challenged you",
            message="Head to the Duels tab to accept.",
            meta=f'{{"from": {student.id}}}',
        )
    )
    db.commit()
    await dispatch([to_student(target.id, "duel_invite", {"from": student.id, "name": student.name})])
    return {"ok": True}
