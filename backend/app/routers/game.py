"""Game Arena + study progression.

The game is the reward layer, never the point: playtime is unlocked by *study*,
the bank is tracked per day on the server, and the run that consumes it is
validated here so the client cannot mint time or score.
"""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin, require_student
from ..models import (
    Admin,
    Friendship,
    GameChallenge,
    GameProfile,
    GameSession,
    Material,
    PlaytimeBalance,
    Student,
    StudySession,
    utcnow,
)
from ..schemas import (
    GameChallengeIn,
    GameCosmeticsIn,
    GameSessionFinishIn,
    GameSessionStartIn,
    StudySessionFinishIn,
    StudySessionIn,
)
from ..game import award_xp
from ..services import materials as engine

router = APIRouter(prefix="/game", tags=["game"])
study_router = APIRouter(prefix="/study", tags=["study-sessions"])

CHARACTERS = [
    {"id": "bolt", "name": "Bolt", "blurb": "Balanced runner — fastest dash.", "unlock_xp": 0},
    {"id": "pixel", "name": "Pixel", "blurb": "Small hitbox, magnets pull harder.", "unlock_xp": 120},
    {"id": "goober", "name": "Goober", "blurb": "One extra shield charge per run.", "unlock_xp": 320},
    {"id": "nova", "name": "Nova", "blurb": "Slow-motion starts a second earlier.", "unlock_xp": 650},
]
TRAILS = [
    {"id": "none", "name": "None", "unlock_xp": 0},
    {"id": "spark", "name": "Spark", "unlock_xp": 80},
    {"id": "aurora", "name": "Aurora", "unlock_xp": 240},
    {"id": "comet", "name": "Comet", "unlock_xp": 500},
]
ACHIEVEMENTS = [
    {"key": "first_run", "name": "First Run", "blurb": "Finish your first arena run."},
    {"key": "survivor", "name": "Survivor", "blurb": "Survive 60 seconds in one run."},
    {"key": "speed_demon", "name": "Speed Demon", "blurb": "Reach wave 5."},
    {"key": "combo_master", "name": "Combo Master", "blurb": "Hit a 20x combo."},
    {"key": "untouchable", "name": "Untouchable", "blurb": "Finish a run with full lives."},
    {"key": "daily_champion", "name": "Daily Champion", "blurb": "Clear the daily challenge."},
    {"key": "score_10k", "name": "High Roller", "blurb": "Score 10,000 in one run."},
]
# Score is earned from survival time and pickups; the server re-derives a ceiling
# so an edited client payload cannot invent a score.
MAX_SCORE_PER_SECOND = 420
DAILY_CHALLENGE_TARGET_SECONDS = 90


def _profile(db: Session, student_id: int) -> GameProfile:
    row = db.scalar(select(GameProfile).where(GameProfile.student_id == student_id))
    if row is None:
        row = GameProfile(student_id=student_id)
        db.add(row)
        db.flush()
    return row


def _unlocked(db: Session, student: Student, profile: GameProfile) -> dict:
    study_total = int(student.xp or 0)
    characters = [row["id"] for row in CHARACTERS if study_total >= row["unlock_xp"]]
    trails = [row["id"] for row in TRAILS if study_total >= row["unlock_xp"]]
    return {"characters": characters, "trails": trails}


def _bank_payload(db: Session, student_id: int) -> dict:
    bank = engine.playtime_for(db, student_id)
    engine.apply_playtime_thresholds(db, student_id, bank)
    db.commit()
    return engine._bank_view(bank)


@router.get("")
def hub(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    """GAME HUB: bank, bests, daily challenge, achievements, challenges."""
    profile = _profile(db, student.id)
    bank = _bank_payload(db, student.id)
    today = engine.today()
    daily_rows = list(
        db.scalars(
            select(GameSession)
            .where(GameSession.day == today, GameSession.seconds > 0)
            .order_by(GameSession.score.desc())
            .limit(10)
        ).all()
    )
    names = {row.id: row.name for row in db.scalars(select(Student)).all()}
    friend_ids = [
        row.friend_id
        for row in db.scalars(
            select(Friendship).where(Friendship.student_id == student.id, Friendship.status == "accepted")
        ).all()
    ]
    friend_ids += [
        row.student_id
        for row in db.scalars(
            select(Friendship).where(Friendship.friend_id == student.id, Friendship.status == "accepted")
        ).all()
    ]
    friends = list(
        db.scalars(
            select(GameProfile)
            .where(GameProfile.student_id.in_(friend_ids or [0]))
            .order_by(GameProfile.best_score.desc())
            .limit(20)
        ).all()
    )
    challenges = list(
        db.scalars(
            select(GameChallenge)
            .where(
                ((GameChallenge.challenger_id == student.id) | (GameChallenge.opponent_id == student.id)),
                GameChallenge.status == "open",
            )
            .order_by(GameChallenge.created_at.desc())
            .limit(20)
        ).all()
    )
    streak = engine.streak_public(db, student.id)
    today_seconds = int(
        db.scalar(select(func.coalesce(func.sum(GameSession.credited_seconds), 0)).where(GameSession.day == today)) or 0
    )
    unlocked = _unlocked(db, student, profile)
    return {
        "playtime": bank,
        "locked": bank["remaining_seconds"] <= 0,
        "profile": {
            "best_score": profile.best_score,
            "best_survival_seconds": profile.best_survival_seconds,
            "best_combo": profile.best_combo,
            "runs": profile.runs,
            "total_seconds": profile.total_seconds,
            "character": profile.character,
            "trail": profile.trail,
            "achievements": [key for key in _json_list(profile.achievements) if isinstance(key, str)],
            **unlocked,
        },
        "characters": CHARACTERS,
        "trails": TRAILS,
        "achievements": [
            {**row, "earned": row["key"] in _json_list(profile.achievements)} for row in ACHIEVEMENTS
        ],
        "daily_challenge": {
            "title": f"Survive {DAILY_CHALLENGE_TARGET_SECONDS} seconds",
            "target_seconds": DAILY_CHALLENGE_TARGET_SECONDS,
            "done": any(row.seconds >= DAILY_CHALLENGE_TARGET_SECONDS for row in daily_rows if row.student_id == student.id),
            "board": [
                {"student_id": row.student_id, "name": names.get(row.student_id, "Player"), "score": row.score, "you": row.student_id == student.id}
                for row in daily_rows
            ],
        },
        "friends": [
            {"student_id": row.student_id, "name": names.get(row.student_id, "Player"), "best_score": row.best_score, "you": False}
            for row in friends
        ],
        "challenges": [
            {
                "id": row.id,
                "from": names.get(row.challenger_id, "Player"),
                "to": names.get(row.opponent_id, "Player"),
                "mode": row.mode,
                "target_score": row.target_score,
                "target_seconds": row.target_seconds,
                "status": row.status,
                "mine": row.challenger_id == student.id,
                "opponent_id": row.opponent_id,
            }
            for row in challenges
        ],
        "today_played_seconds": today_seconds,
        "streak": streak,
        "study": {
            "xp_today": bank["study_xp_today"],
            "next_threshold": next(
                (row for row in engine.PLAYTIME_XP_THRESHOLDS if row > bank["study_xp_today"]), None
            ),
        },
    }


def _json_list(raw: str | None) -> list:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


@router.post("/session")
def start_session(
    payload: GameSessionStartIn, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    bank = engine.playtime_for(db, student.id)
    remaining = max(0, (bank.earned_seconds or 0) - (bank.used_seconds or 0))
    if remaining < 30:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Arena time is finished for now — complete another study goal to unlock more.",
        )
    session = GameSession(student_id=student.id, mode=payload.mode, started_at=utcnow(), day=engine.today())
    db.add(session)
    db.commit()
    return {
        "session_id": session.id,
        "mode": session.mode,
        "remaining_seconds": remaining,
        "daily_challenge": {
            "title": f"Survive {DAILY_CHALLENGE_TARGET_SECONDS} seconds",
            "target_seconds": DAILY_CHALLENGE_TARGET_SECONDS,
        },
    }


@router.post("/session/{session_id}/heartbeat")
def heartbeat(
    session_id: int, seconds: int = Query(15, ge=1, le=120), db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    """Server-side playtime accounting while the run is live (auto-pause aware)."""
    session = db.get(GameSession, session_id)
    if session is None or session.student_id != student.id or session.ended_at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That run is no longer active.")
    bank = engine.playtime_for(db, student.id)
    remaining = max(0, (bank.earned_seconds or 0) - (bank.used_seconds or 0))
    charge = min(seconds, remaining)
    bank.used_seconds = (bank.used_seconds or 0) + charge
    bank.updated_at = utcnow()
    session.credited_seconds = (session.credited_seconds or 0) + charge
    db.commit()
    return {"remaining_seconds": max(0, remaining - charge), "out_of_time": remaining - charge <= 0}


@router.post("/session/{session_id}/finish")
def finish_session(
    session_id: int,
    payload: GameSessionFinishIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Close a run. Score/seconds are clamped to what the server can believe."""
    session = db.get(GameSession, session_id)
    if session is None or session.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    if session.ended_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "That run is already finished.")

    wall_seconds = max(0, int((utcnow() - (session.started_at or utcnow())).total_seconds()))
    charged = min(
        max(0, int(payload.seconds or 0)),
        wall_seconds + 5,  # allow a little clock skew, never invent minutes
        max(0, int(session.credited_seconds or 0)) + 20,
    )
    credible = min(int(payload.score or 0), (charged + 5) * MAX_SCORE_PER_SECOND)

    profile = _profile(db, student.id)
    session.score = credible
    session.seconds = charged
    session.client_seconds = max(0, int(payload.seconds or 0))
    session.combo = int(payload.combo or 0)
    session.collected = int(payload.collected or 0)
    session.wave = int(payload.wave or 0)
    session.ended_at = utcnow()

    # XP is a small, capped function of credible play — never the score itself.
    xp = min(120, max(0, charged // 6) + min(60, credible // 1500))
    session.xp = xp
    session.coins = min(60, credible // 3000)
    student.coins = (student.coins or 0) + session.coins

    profile.runs = (profile.runs or 0) + 1
    profile.total_seconds = (profile.total_seconds or 0) + charged
    profile.total_score = (profile.total_score or 0) + credible
    profile.best_score = max(profile.best_score or 0, credible)
    profile.best_survival_seconds = max(profile.best_survival_seconds or 0, charged)
    profile.best_combo = max(profile.best_combo or 0, session.combo or 0)
    profile.updated_at = utcnow()

    earned_achievements: list[dict] = []
    unlocked = _json_list(profile.achievements)
    checks = {
        "first_run": profile.runs >= 1,
        "survivor": charged >= 60,
        "speed_demon": (session.wave or 0) >= 5,
        "combo_master": (session.combo or 0) >= 20,
        "untouchable": bool(payload.collected) and charged >= 30 and (profile.best_combo or 0) >= 15,
        "score_10k": credible >= 10_000,
        "daily_champion": charged >= DAILY_CHALLENGE_TARGET_SECONDS,
    }
    for key, ok in checks.items():
        if ok and key not in unlocked:
            unlocked.append(key)
            meta = next((row for row in ACHIEVEMENTS if row["key"] == key), {"key": key, "name": key})
            earned_achievements.append(meta)
    profile.achievements = json.dumps(unlocked)

    # The run's XP lands here, with the season climb it caused travelling back
    # on the same list the achievements use.
    reward_events: list[dict] = list(earned_achievements)
    award_xp(db, student, xp, events=reward_events)

    # Resolve any open challenge from a friend against this run.
    resolved: list[dict] = []
    for challenge in db.scalars(
        select(GameChallenge).where(GameChallenge.opponent_id == student.id, GameChallenge.status == "open")
    ).all():
        beat = credible > challenge.target_score
        challenge.status = "beaten" if beat else "lost"
        challenge.result_session_id = session.id
        challenge.resolved_at = utcnow()
        resolved.append({"id": challenge.id, "beaten": beat, "target_score": challenge.target_score})

    bank = engine.playtime_for(db, student.id)
    engine.touch_streak(db, student.id, 0)  # game time never grows the study streak
    db.commit()

    return {
        "session": {
            "id": session.id,
            "score": session.score,
            "seconds": session.seconds,
            "combo": session.combo,
            "wave": session.wave,
            "collected": session.collected,
            "xp": session.xp,
            "coins": session.coins,
        },
        "best_score": profile.best_score,
        "best_survival_seconds": profile.best_survival_seconds,
        "achievements": earned_achievements,
        "rewards": reward_events,
        "challenges_resolved": resolved,
        "playtime": engine._bank_view(bank),
        "study": {"xp_today": bank.study_xp},
    }


@router.get("/leaderboard")
def leaderboard(
    scope: str = Query("daily", pattern="^(daily|weekly|friends|all_time|personal)$"),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    today = engine.today()
    names = {row.id: row.name for row in db.scalars(select(Student)).all()}
    if scope == "friends":
        ids = [
            row.friend_id
            for row in db.scalars(
                select(Friendship).where(Friendship.student_id == student.id, Friendship.status == "accepted")
            ).all()
        ] + [
            row.student_id
            for row in db.scalars(
                select(Friendship).where(Friendship.friend_id == student.id, Friendship.status == "accepted")
            ).all()
        ]
        rows = list(
            db.scalars(
                select(GameProfile).where(GameProfile.student_id.in_(ids + [student.id])).order_by(GameProfile.best_score.desc()).limit(30)
            ).all()
        )
        return {
            "scope": scope,
            "rows": [
                {"student_id": row.student_id, "name": names.get(row.student_id, "Player"), "score": row.best_score, "you": row.student_id == student.id}
                for row in rows
            ],
        }
    if scope in {"daily", "weekly"}:
        since = today if scope == "daily" else today - timedelta(days=7)
        best = (
            select(GameSession.student_id, func.max(GameSession.score).label("score"))
            .where(GameSession.day >= since)
            .group_by(GameSession.student_id)
            .subquery()
        )
        rows = db.execute(select(best.c.student_id, best.c.score).order_by(best.c.score.desc()).limit(30)).all()
        return {
            "scope": scope,
            "rows": [
                {"student_id": sid, "name": names.get(sid, "Player"), "score": int(score or 0), "you": sid == student.id}
                for sid, score in rows
            ],
        }
    if scope == "personal":
        rows = list(
            db.scalars(
                select(GameSession)
                .where(GameSession.student_id == student.id)
                .order_by(GameSession.score.desc())
                .limit(10)
            ).all()
        )
        return {
            "scope": scope,
            "rows": [
                {"id": row.id, "score": row.score, "seconds": row.seconds, "mode": row.mode, "day": row.day.isoformat() if row.day else None, "you": True}
                for row in rows
            ],
        }
    rows = list(db.scalars(select(GameProfile).order_by(GameProfile.best_score.desc()).limit(30)).all())
    return {
        "scope": scope,
        "rows": [
            {"student_id": row.student_id, "name": names.get(row.student_id, "Player"), "score": row.best_score, "you": row.student_id == student.id}
            for row in rows
        ],
    }


@router.post("/challenge")
async def challenge(
    payload: GameChallengeIn, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    opponent = db.get(Student, payload.opponent_id)
    if opponent is None or opponent.id == student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pick a friend to challenge.")
    profile = _profile(db, student.id)
    row = GameChallenge(
        challenger_id=student.id,
        opponent_id=opponent.id,
        mode=payload.mode,
        target_score=payload.target_score or profile.best_score or 1000,
        target_seconds=payload.target_seconds,
    )
    db.add(row)
    from ..models import ChatMessage

    db.add(
        ChatMessage(
            sender_id=student.id,
            recipient_id=opponent.id,
            kind="text",
            body=f"🎮 Can you beat my Arena score of {row.target_score:,}? Open Game Arena → Challenges.",
            meta=json.dumps({"game_challenge": row.id}),
        )
    )
    db.commit()
    return {"id": row.id, "target_score": row.target_score, "opponent": opponent.name}


@router.post("/cosmetics")
def cosmetics(
    payload: GameCosmeticsIn, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    profile = _profile(db, student.id)
    unlocked = _unlocked(db, student, profile)
    if payload.character:
        if payload.character not in unlocked["characters"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Keep studying to unlock that character.")
        profile.character = payload.character
    if payload.trail:
        if payload.trail not in unlocked["trails"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Keep studying to unlock that trail.")
        profile.trail = payload.trail
    profile.updated_at = utcnow()
    db.commit()
    return {"character": profile.character, "trail": profile.trail}


@router.get("/config")
def game_config(db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    """Admin view of the tunables (kept in one place so nothing is hardcoded twice)."""
    return {
        "xp_thresholds": engine.PLAYTIME_XP_THRESHOLDS,
        "seconds_per_threshold": engine.PLAYTIME_PER_THRESHOLD,
        "start_bonus_seconds": engine.PLAYTIME_START_BONUS,
        "daily_cap_seconds": engine.PLAYTIME_DAILY_CAP,
        "completion_bonus_seconds": engine.PLAYTIME_COMPLETION_BONUS,
        "mission_bonus_seconds": engine.PLAYTIME_MISSION_BONUS,
        "study_xp": engine.STUDY_XP,
        "characters": CHARACTERS,
        "trails": TRAILS,
        "achievements": ACHIEVEMENTS,
        "modes": ["survival", "score_attack", "time_trial", "daily"],
        "daily_challenge_seconds": DAILY_CHALLENGE_TARGET_SECONDS,
    }


# ===========================================================================
# Study sessions (focus timer)
# ===========================================================================
@study_router.post("/sessions")
def open_study_session(
    payload: StudySessionIn, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    row = StudySession(
        student_id=student.id,
        mode=payload.mode,
        planned_minutes=max(1, min(180, payload.planned_minutes)),
    )
    db.add(row)
    db.commit()
    return {"session_id": row.id, "mode": row.mode, "planned_minutes": row.planned_minutes}


@study_router.post("/sessions/finish")
def close_study_session(
    payload: StudySessionFinishIn, db: Session = Depends(get_db), student: Student = Depends(require_student)
) -> dict:
    row = db.get(StudySession, payload.session_id)
    if row is None or row.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study session not found.")
    if row.ended_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "That session is already closed.")
    wall = max(0, int((utcnow() - (row.started_at or utcnow())).total_seconds()))
    seconds = min(max(0, int(payload.seconds or 0)), wall + 10)
    row.seconds = seconds
    row.ended_at = utcnow()
    # 1 XP per focused minute, capped — idle time earns nothing.
    xp = min(60, seconds // 60) if seconds >= 120 else 0
    row.xp_awarded = xp
    reward = {"awarded": 0}
    if xp:
        reward = engine.award_study_xp(
            db,
            student,
            amount=xp,
            reason="session",
            reason_key=f"session:{row.id}",
        )
    streak = engine.touch_streak(db, student.id, seconds)
    bank = engine.playtime_for(db, student.id)
    db.commit()
    return {
        "session": {"id": row.id, "seconds": seconds, "xp": xp, "planned_minutes": row.planned_minutes},
        "reward": reward,
        "streak": streak,
        "playtime": engine._bank_view(bank),
        "break_suggested": seconds >= 45 * 60,
    }
