"""Global challenges — international subject competitions with shareable results."""
from __future__ import annotations

import hashlib
import json
import random
import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..models import Course, Question, Quiz, Student, utcnow
from ..serializers import question_public, student_profile

router = APIRouter(prefix="/challenges", tags=["challenges"])

# Catalog: subject challenges anyone in the world can enter.
CATALOG = [
    {"id": "global-bio", "title": "Global Biology Challenge", "emoji": "🧬", "course_code": "BIO 101", "count": 10, "minutes": 12, "blurb": "Cells, genes and the living world — prove yourself worldwide."},
    {"id": "global-mth", "title": "Global Mathematics Challenge", "emoji": "📐", "course_code": "MTH 101", "count": 10, "minutes": 12, "blurb": "Algebra, geometry and numbers under the clock."},
    {"id": "global-csc", "title": "Global Computer Science Challenge", "emoji": "💻", "course_code": "CSC 101", "count": 10, "minutes": 12, "blurb": "Hardware, algorithms and networks."},
    {"id": "global-chm", "title": "Global Chemistry Challenge", "emoji": "⚗️", "course_code": "CHM 101", "count": 10, "minutes": 12, "blurb": "Atoms, bonds and reactions."},
    {"id": "global-phy", "title": "Global Physics Challenge", "emoji": "⚛️", "course_code": "PHY 101", "count": 10, "minutes": 12, "blurb": "Motion, energy and electricity."},
    {"id": "global-eng", "title": "Global English Challenge", "emoji": "📚", "course_code": "ENG 101", "count": 10, "minutes": 10, "blurb": "Grammar, comprehension and vocabulary."},
]

# In-memory + sqlite-backed results table created lazily via raw SQL if model missing.
# We store share results as JSON rows in a simple table via SQLAlchemy model added below.

from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, DateTime, Boolean, Float
from ..models import Base as ModelBase


class GlobalChallengeResult(ModelBase):
    __tablename__ = "global_challenge_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    share_code: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    student_id: Mapped[int] = mapped_column(Integer, index=True)
    challenge_id: Mapped[str] = mapped_column(String(40), index=True)
    day: Mapped[str] = mapped_column(String(16), index=True)  # ISO date
    correct: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    percentage: Mapped[float] = mapped_column(Float, default=0.0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    display_name: Mapped[str] = mapped_column(String(80), default="")
    country: Mapped[str] = mapped_column(String(8), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


def _catalog_item(cid: str) -> dict:
    for row in CATALOG:
        if row["id"] == cid:
            return row
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Challenge not found.")


def _pick_questions(db: Session, course_code: str, count: int, seed: str) -> list[Question]:
    course = db.scalar(select(Course).where(Course.code == course_code))
    if course is None:
        return []
    quizzes = db.scalars(select(Quiz).where(Quiz.course_id == course.id)).all()
    qids = []
    for qz in quizzes:
        for q in db.scalars(select(Question).where(Question.quiz_id == qz.id)).all():
            qids.append(q)
    if not qids:
        # any questions
        qids = list(db.scalars(select(Question).limit(500)).all())
    rng = random.Random(seed)
    rng.shuffle(qids)
    return qids[:count]


class SubmitIn(BaseModel):
    day: str
    duration_seconds: int = Field(default=0, ge=0, le=3600)
    items: list[dict] = Field(default_factory=list)  # {question_id, answer}


@router.get("/global")
def list_global(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    today = utcnow().date().isoformat()
    out = []
    for row in CATALOG:
        played = db.scalar(
            select(GlobalChallengeResult.id).where(
                GlobalChallengeResult.student_id == student.id,
                GlobalChallengeResult.challenge_id == row["id"],
                GlobalChallengeResult.day == today,
            )
        )
        players = db.scalar(
            select(func.count(GlobalChallengeResult.id)).where(
                GlobalChallengeResult.challenge_id == row["id"],
                GlobalChallengeResult.day == today,
            )
        ) or 0
        out.append({**row, "played_today": bool(played), "players_today": int(players)})
    season_key = utcnow().strftime("%Y-%m")
    return {
        "day": today,
        "season_key": season_key,
        "season_label": utcnow().strftime("%B %Y"),
        "challenges": out,
    }


@router.get("/global/{challenge_id}")
def get_challenge(challenge_id: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = _catalog_item(challenge_id)
    today = utcnow().date().isoformat()
    existing = db.scalar(
        select(GlobalChallengeResult).where(
            GlobalChallengeResult.student_id == student.id,
            GlobalChallengeResult.challenge_id == challenge_id,
            GlobalChallengeResult.day == today,
        )
    )
    if existing:
        return {
            "challenge": item,
            "day": today,
            "done": True,
            "result": {
                "correct": existing.correct,
                "total": existing.total,
                "percentage": existing.percentage,
                "share_code": existing.share_code,
                "duration_seconds": existing.duration_seconds,
            },
            "questions": [],
        }
    seed = f"{challenge_id}:{today}"
    rows = _pick_questions(db, item["course_code"], item["count"], seed)
    if len(rows) < 3:
        raise HTTPException(status.HTTP_409_CONFLICT, "Not enough questions in the bank for this challenge yet.")
    return {
        "challenge": item,
        "day": today,
        "done": False,
        "result": None,
        "questions": [question_public(q) for q in rows],
    }


@router.post("/global/{challenge_id}/submit")
async def submit_challenge(
    challenge_id: str,
    payload: SubmitIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    item = _catalog_item(challenge_id)
    today = utcnow().date().isoformat()
    if payload.day != today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That challenge day has ended.")
    existing = db.scalar(
        select(GlobalChallengeResult.id).where(
            GlobalChallengeResult.student_id == student.id,
            GlobalChallengeResult.challenge_id == challenge_id,
            GlobalChallengeResult.day == today,
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already played this challenge today.")

    seed = f"{challenge_id}:{today}"
    rows = _pick_questions(db, item["course_code"], item["count"], seed)
    key = {row.id: (row.correct or "").strip().upper() for row in rows}
    correct = 0
    for it in payload.items:
        qid = int(it.get("question_id") or 0)
        ans = str(it.get("answer") or "").strip().upper()
        if qid in key and ans == key[qid]:
            correct += 1
    total = len(rows) or 1
    pct = round(100.0 * correct / total, 1)
    share_code = secrets.token_urlsafe(9)[:12]
    result = GlobalChallengeResult(
        share_code=share_code,
        student_id=student.id,
        challenge_id=challenge_id,
        day=today,
        correct=correct,
        total=total,
        percentage=pct,
        duration_seconds=int(payload.duration_seconds or 0),
        display_name=(student.name or "Player")[:80],
        country=getattr(student, "country", "") or "",
    )
    db.add(result)
    xp = 40 + correct * 12 + (80 if correct == total else 0)
    coins = 20 + correct * 6 + (40 if correct == total else 0)
    rewards = game.grant(
        db, student, xp=xp, coins=coins, kind="xp",
        title=item["title"], detail=f"{correct}/{total} · {pct}%",
    )
    # how many scored lower today
    beaten = db.scalar(
        select(func.count(GlobalChallengeResult.id)).where(
            GlobalChallengeResult.challenge_id == challenge_id,
            GlobalChallengeResult.day == today,
            GlobalChallengeResult.percentage < pct,
            GlobalChallengeResult.student_id != student.id,
        )
    ) or 0
    players = db.scalar(
        select(func.count(GlobalChallengeResult.id)).where(
            GlobalChallengeResult.challenge_id == challenge_id,
            GlobalChallengeResult.day == today,
        )
    ) or 1
    db.commit()
    better_than = round(100.0 * beaten / max(players, 1), 1)
    return {
        "ok": True,
        "correct": correct,
        "total": total,
        "percentage": pct,
        "share_code": share_code,
        "rewards": rewards,
        "players_today": int(players),
        "better_than_percent": better_than,
        "challenge": item,
        "profile": student_profile(db, student),
        "share_text": (
            f"I scored {pct:g}% on the {item['title']} on Absolute Genesis "
            f"({correct}/{total}). Better than {better_than:g}% of players today. Can you beat me?"
        ),
    }


@router.get("/share/{share_code}")
def public_share(share_code: str, db: Session = Depends(get_db)) -> dict:
    """Public, no auth — powers the viral share card."""
    row = db.scalar(select(GlobalChallengeResult).where(GlobalChallengeResult.share_code == share_code))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Result not found.")
    item = next((c for c in CATALOG if c["id"] == row.challenge_id), None)
    beaten = db.scalar(
        select(func.count(GlobalChallengeResult.id)).where(
            GlobalChallengeResult.challenge_id == row.challenge_id,
            GlobalChallengeResult.day == row.day,
            GlobalChallengeResult.percentage < row.percentage,
        )
    ) or 0
    players = db.scalar(
        select(func.count(GlobalChallengeResult.id)).where(
            GlobalChallengeResult.challenge_id == row.challenge_id,
            GlobalChallengeResult.day == row.day,
        )
    ) or 1
    better_than = round(100.0 * beaten / max(players, 1), 1)
    return {
        "share_code": row.share_code,
        "challenge": item,
        "display_name": row.display_name,
        "country": row.country,
        "correct": row.correct,
        "total": row.total,
        "percentage": row.percentage,
        "day": row.day,
        "players_that_day": int(players),
        "better_than_percent": better_than,
        "share_text": (
            f"{row.display_name} scored {row.percentage:g}% on the "
            f"{(item or {}).get('title', 'Global Challenge')} — better than {better_than:g}% of players. "
            f"Can you beat them on Absolute Genesis?"
        ),
    }
