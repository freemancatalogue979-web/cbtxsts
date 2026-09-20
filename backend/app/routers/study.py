"""Study modes & social learning: flashcards, rush runs, the daily challenge,
ask-a-friend help requests, the lucky spin, weekly missions, the coin shop and
personal analytics. Everything is graded server-side from the real question bank."""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import (
    Activity,
    Answer,
    Attempt,
    ChatMessage,
    Course,
    DailyChallengeResult,
    Duel,
    DuelParticipant,
    HelpRequest,
    InboxNote,
    MissionClaim,
    Question,
    Quiz,
    RushRun,
    Student,
    utcnow,
)
from ..schemas import (
    DailySubmitIn,
    FlashLogIn,
    HelpAnswerIn,
    HelpAskIn,
    MatchGradeIn,
    RushGradeIn,
    ShopBuyIn,
)
from ..serializers import iso, question_public, student_profile

router = APIRouter(prefix="/study", tags=["study"])

RUSH_SIZE = 10
MATCH_PAIRS = 6
RUSH_WINDOW = {"blitz": 110, "sudden": 320}  # seconds of grace, server-enforced
DAILY_SIZE = 5

SPIN_TIERS: list[tuple[int, int]] = [
    (5, 26),
    (10, 22),
    (15, 18),
    (25, 13),
    (50, 10),
    (100, 7),
    (250, 4),
]

SHOP: list[dict] = [
    {"sku": "freeze", "name": "Streak Freeze", "cost": 300, "icon": "snowflake",
     "blurb": "Auto-saves your streak on one missed day."},
    {"sku": "boost", "name": "Double XP · 24h", "cost": 500, "icon": "zap",
     "blurb": "Every XP drop is doubled for 24 hours."},
    {"sku": "flair_gold", "name": "Gold Flair", "cost": 800, "icon": "crown",
     "blurb": "A gold ring around your avatar, everywhere."},
    {"sku": "flair_mint", "name": "Mint Flair", "cost": 800, "icon": "sparkles",
     "blurb": "A fresh mint ring around your avatar."},
    {"sku": "flair_flare", "name": "Flare Flair", "cost": 800, "icon": "flame",
     "blurb": "A hot red ring around your avatar."},
]

MISSIONS: list[dict] = [
    {"key": "answer25", "title": "Answer 25 questions", "detail": "Exams, rush runs and daily challenges all count.", "goal": 25, "xp": 60, "coins": 40},
    {"key": "exam1", "title": "Submit an exam", "detail": "Finish any exam this week.", "goal": 1, "xp": 80, "coins": 60},
    {"key": "duel2", "title": "Fight 2 duels", "detail": "Challenge a friend or join an open duel.", "goal": 2, "xp": 70, "coins": 50},
    {"key": "rush15", "title": "Score 15 in Rush", "detail": "Blitz and Sudden Death scores add up.", "goal": 15, "xp": 60, "coins": 45},
    {"key": "help1", "title": "Help a friend", "detail": "Answer an ask-a-friend request correctly.", "goal": 1, "xp": 50, "coins": 40},
    {"key": "chat5", "title": "Send 5 messages", "detail": "Chat keeps the squad sharp.", "goal": 5, "xp": 30, "coins": 25},
]


def _week_start() -> datetime:
    today = utcnow().date()
    return datetime.combine(today - timedelta(days=today.weekday()), datetime.min.time())


def _note(db: Session, student_id: int, kind: str, title: str, message: str, meta: dict | None = None) -> InboxNote:
    note = InboxNote(student_id=student_id, kind=kind, title=title, message=message, meta=json.dumps(meta or {}))
    db.add(note)
    return note


def _note_public(note: InboxNote) -> dict:
    return {
        "id": note.id,
        "kind": note.kind,
        "title": note.title,
        "message": note.message,
        "meta": json.loads(note.meta or "{}"),
        "read": note.read_at is not None,
        "created_at": iso(note.created_at),
    }


def _question_ids(db: Session, quiz_id: int | None = None) -> list[int]:
    query = select(Question.id)
    if quiz_id:
        query = query.where(Question.quiz_id == quiz_id)
    else:
        # Mixed pools draw from bank originals only — exam copies would duplicate text.
        query = query.join(Quiz, Quiz.id == Question.quiz_id).where(Question.source_id.is_(None))
    return list(db.scalars(query).all())


def _parse_issued(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "").replace("+00:00", ""))
    except ValueError as exc:  # pragma: no cover
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad issue timestamp.") from exc


# ---------------------------------------------------------------------------
# flashcards
# ---------------------------------------------------------------------------
@router.get("/flashcards")
def flashcards(
    quiz_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    ids = _question_ids(db, quiz_id)
    if not ids:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No questions in that deck yet.")
    picks = random.Random().sample(ids, min(30, len(ids)))
    rows = db.scalars(select(Question).where(Question.id.in_(picks))).all()
    by_id = {row.id: row for row in rows}
    ordered = [by_id[qid] for qid in picks if qid in by_id]
    quizzes = {q.id: q.title for q in db.scalars(select(Quiz)).all()}
    return {
        "cards": [
            {**question_public(row, reveal=True), "quiz_title": quizzes.get(row.quiz_id, "")}
            for row in ordered
        ]
    }


@router.post("/flashcards/log")
async def flashcard_log(
    payload: FlashLogIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    known = min(payload.known, payload.reviewed, 25)
    rewards = game.grant(
        db, student, xp=known, coins=0, kind="xp",
        title="Flashcard review", detail=f"{payload.reviewed} cards, {known} known cold",
    ) if payload.reviewed else []
    db.commit()
    return {"ok": True, "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# rush runs (blitz + sudden death)
# ---------------------------------------------------------------------------
@router.get("/rush")
def rush_set(
    mode: str = Query("blitz", pattern="^(blitz|sudden)$"),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    ids = _question_ids(db)
    if len(ids) < RUSH_SIZE:
        raise HTTPException(status.HTTP_409_CONFLICT, "The bank is too small for rush mode.")
    picks = random.Random().sample(ids, RUSH_SIZE)
    rows = db.scalars(select(Question).where(Question.id.in_(picks))).all()
    by_id = {row.id: row for row in rows}
    return {
        "mode": mode,
        "issued_at": iso(utcnow()),
        "seconds": 60 if mode == "blitz" else 0,
        "questions": [question_public(by_id[qid], reveal=mode == "sudden") for qid in picks if qid in by_id],
    }


@router.post("/rush")
async def rush_grade(
    payload: RushGradeIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    issued = _parse_issued(payload.issued_at)
    elapsed = (utcnow() - issued).total_seconds()
    if elapsed < 0 or elapsed > RUSH_WINDOW[payload.mode]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That run expired — start a fresh one.")

    ids = [item.question_id for item in payload.items][:RUSH_SIZE]
    rows = db.scalars(select(Question).where(Question.id.in_(ids))).all()
    key = {row.id: (row.correct or "").strip().lower() for row in rows}
    hits = [bool(key.get(item.question_id)) and item.answer.strip().lower() == key.get(item.question_id, "") for item in payload.items]

    if payload.mode == "sudden":
        score = 0
        for hit in hits:
            if not hit:
                break
            score += 1
        xp, coins = score * 6, score * 3
    else:
        score = sum(1 for hit in hits if hit)
        perfect = score == len(payload.items) and len(payload.items) >= RUSH_SIZE
        xp, coins = score * 5 + (25 if perfect else 0), score * 2 + (10 if perfect else 0)

    db.add(RushRun(
        student_id=student.id, mode=payload.mode, score=score,
        correct=score, total=len(payload.items), elapsed_ms=int(max(elapsed, 0) * 1000),
    ))
    rewards = game.grant(
        db, student, xp=xp, coins=coins, kind="xp",
        title="Blitz run" if payload.mode == "blitz" else "Sudden Death run",
        detail=f"Scored {score}/{len(payload.items)}",
    )
    best = db.scalar(
        select(func.max(RushRun.score)).where(RushRun.student_id == student.id, RushRun.mode == payload.mode)
    )
    db.commit()
    return {"ok": True, "score": score, "total": len(payload.items), "best": int(best or score),
            "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# daily challenge — everyone gets the same five questions today
# ---------------------------------------------------------------------------
def _daily_picks(db: Session, day: date) -> list[Question]:
    ids = _question_ids(db)
    if len(ids) < DAILY_SIZE:
        raise HTTPException(status.HTTP_409_CONFLICT, "The bank is too small for a daily challenge.")
    picks = random.Random(day.toordinal()).sample(ids, DAILY_SIZE)
    rows = db.scalars(select(Question).where(Question.id.in_(picks))).all()
    by_id = {row.id: row for row in rows}
    return [by_id[qid] for qid in picks if qid in by_id]


@router.get("/daily")
def daily_challenge(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    today = utcnow().date()
    done = db.scalar(
        select(DailyChallengeResult).where(DailyChallengeResult.student_id == student.id, DailyChallengeResult.day == today)
    )
    field_size = db.scalar(
        select(func.count(DailyChallengeResult.id)).where(DailyChallengeResult.day == today)
    )
    return {
        "day": today.isoformat(),
        "questions": [question_public(row) for row in _daily_picks(db, today)],
        "done": done is not None,
        "result": {"score": done.score, "correct": done.correct} if done else None,
        "players_today": int(field_size or 0),
    }


@router.post("/daily")
async def daily_submit(
    payload: DailySubmitIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    today = utcnow().date()
    if payload.day != today.isoformat():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That challenge is no longer today's.")
    if db.scalar(select(DailyChallengeResult.id).where(
        DailyChallengeResult.student_id == student.id, DailyChallengeResult.day == today
    )):
        raise HTTPException(status.HTTP_409_CONFLICT, "You already took today's challenge.")

    rows = _daily_picks(db, today)
    key = {row.id: (row.correct or "").strip().lower() for row in rows}
    correct = sum(1 for item in payload.items if key.get(item.question_id) and item.answer.strip().lower() == key[item.question_id])
    perfect = correct == len(rows)
    xp, coins = 30 + correct * 10 + (50 if perfect else 0), 15 + correct * 5 + (25 if perfect else 0)
    db.add(DailyChallengeResult(student_id=student.id, day=today, score=correct, correct=correct))
    rewards = game.grant(
        db, student, xp=xp, coins=coins, kind="xp",
        title="Daily challenge", detail=f"{correct}/{len(rows)}" + (" — perfect!" if perfect else ""),
    )
    db.commit()
    return {"ok": True, "correct": correct, "total": len(rows), "perfect": perfect,
            "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# ask a friend — help requests with tutor points
# ---------------------------------------------------------------------------
def _can_talk(db: Session, me: int, other: int) -> bool:
    from .chat import _can_talk as chat_can_talk

    return chat_can_talk(db, me, other)


def _help_public(db: Session, request: HelpRequest, *, for_helper: bool) -> dict:
    other = db.get(Student, request.helper_id if for_helper else request.asker_id)
    from ..serializers import student_public

    payload = {
        "id": request.id,
        "status": request.status,
        "prompt": request.prompt,
        "options": json.loads(request.options or "{}"),
        "created_at": iso(request.created_at),
        "answered_at": iso(request.answered_at) if request.answered_at else None,
        "other": student_public(other, mask=True) if other else None,
    }
    if request.status == "answered":
        payload["helper_answer"] = request.helper_answer
        payload["was_correct"] = request.was_correct
        payload["explanation"] = request.explanation
    return payload


@router.post("/help")
async def help_ask(
    payload: HelpAskIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    helper = db.get(Student, payload.to)
    if helper is None or helper.id == student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No player to ask.")
    if not _can_talk(db, student.id, helper.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only ask friends (or past duel rivals).")
    open_asks = db.scalar(
        select(func.count(HelpRequest.id)).where(HelpRequest.asker_id == student.id, HelpRequest.status == "pending")
    )
    if (open_asks or 0) >= 5:
        raise HTTPException(status.HTTP_409_CONFLICT, "Too many open asks — wait for replies first.")
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That question is gone.")

    request = HelpRequest(
        asker_id=student.id,
        helper_id=helper.id,
        question_id=question.id,
        prompt=question.text,
        options=json.dumps({k: v for k, v in question.options.items() if v}),
        correct=question.correct,
        explanation=question.explanation,
    )
    note = _note(
        db, helper.id, "help",
        f"{student.name.split(' ')[0]} needs your brain 🧠",
        "They asked you a question — answer it and earn tutor points.",
        {"help_id": None},
    )
    db.add(request)
    db.flush()
    note.meta = json.dumps({"help_id": request.id})
    db.commit()
    db.refresh(request)
    db.refresh(note)
    note_payload = _note_public(note)
    await dispatch([to_student(helper.id, "notify", note_payload)])
    return {"ok": True, "request": _help_public(db, request, for_helper=False), "note": note_payload}


@router.get("/help/inbox")
def help_inbox(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(HelpRequest)
        .where(HelpRequest.helper_id == student.id)
        .order_by(HelpRequest.status.asc(), HelpRequest.created_at.desc())
        .limit(30)
    ).all()
    return {"requests": [_help_public(db, row, for_helper=True) for row in rows]}


@router.get("/help/sent")
def help_sent(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(HelpRequest)
        .where(HelpRequest.asker_id == student.id)
        .order_by(HelpRequest.created_at.desc())
        .limit(30)
    ).all()
    return {"requests": [_help_public(db, row, for_helper=False) for row in rows]}


@router.post("/help/{request_id}/answer")
async def help_answer(
    request_id: int,
    payload: HelpAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    request = db.get(HelpRequest, request_id)
    if request is None or request.helper_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such help request.")
    if request.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "You already answered this one.")

    answer = payload.answer.strip().lower()
    was_correct = answer == (request.correct or "").strip().lower()
    request.status = "answered"
    request.helper_answer = answer
    request.was_correct = was_correct
    request.answered_at = utcnow()
    asker = db.get(Student, request.asker_id)

    rewards: list[dict] = []
    if was_correct:
        student.helper_points += 1
        rewards = game.grant(
            db, student, xp=15, coins=10, kind="reward",
            title="Tutor points", detail=f"Helped {asker.name.split(' ')[0] if asker else 'a friend'} land the right answer",
        )
    if asker:
        note = _note(
            db, asker.id, "answer",
            f"{student.name.split(' ')[0]} answered your question {'✅' if was_correct else '❌'}",
            (f"The answer was {request.correct.upper()}. {request.explanation}" if was_correct
             else f"They picked {answer.upper()} — open the thread and work it out together."),
            {"help_id": request.id, "correct": was_correct},
        )
    db.commit()
    if asker:
        db.refresh(note)
        await dispatch([to_student(asker.id, "notify", _note_public(note))])
    return {"ok": True, "was_correct": was_correct, "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# mind match — memory pairs mini-game dealt from the real question bank
# ---------------------------------------------------------------------------
@router.get("/match")
def match_set(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    ids = _question_ids(db)
    if len(ids) < MATCH_PAIRS:
        raise HTTPException(status.HTTP_409_CONFLICT, "The bank is too small for Mind Match.")
    picks = random.Random().sample(ids, MATCH_PAIRS)
    rows = db.scalars(select(Question).where(Question.id.in_(picks))).all()
    cards: list[dict] = []
    for row in rows:
        answer = (row.options or {}).get(row.correct) or (row.options or {}).get(row.correct.upper(), "")
        cards.append({"card": f"q{row.id}", "pair": row.id, "side": "prompt", "text": row.text})
        cards.append({"card": f"a{row.id}", "pair": row.id, "side": "answer", "text": answer})
    random.Random().shuffle(cards)
    return {"issued_at": iso(utcnow()), "pairs": MATCH_PAIRS, "cards": cards}


@router.post("/match")
async def match_grade(
    payload: MatchGradeIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    issued = _parse_issued(payload.issued_at)
    elapsed = (utcnow() - issued).total_seconds()
    if not -5 <= elapsed <= 600:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That match window closed — deal fresh cards.")
    matched = min(payload.matched, MATCH_PAIRS)
    if payload.moves < matched:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Impossible move count.")
    waste = max(0, payload.moves - matched)
    score = max(10, 100 - waste * 6 - int(elapsed // 10))
    perfect = matched == MATCH_PAIRS and waste <= 4
    xp = 10 + matched * 4 + (25 if perfect else 0)
    coins = matched * 3 + (10 if perfect else 0)
    db.add(RushRun(
        student_id=student.id, mode="match", score=score,
        correct=matched, total=MATCH_PAIRS, elapsed_ms=int(elapsed * 1000),
    ))
    rewards = game.grant(
        db, student, xp=xp, coins=coins, kind="xp",
        title="Mind Match", detail=f"{matched}/{MATCH_PAIRS} pairs in {payload.moves} flips" + (" — flawless!" if perfect else ""),
    )
    best = db.scalar(select(func.max(RushRun.score)).where(RushRun.student_id == student.id, RushRun.mode == "match"))
    db.commit()
    return {"ok": True, "score": score, "matched": matched, "pairs": MATCH_PAIRS, "perfect": perfect,
            "best": int(best or score), "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# lucky spin — one free spin a day
# ---------------------------------------------------------------------------
@router.post("/spin")
async def spin(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    today = utcnow().date()
    if student.last_spin_at == today:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already spun today — come back tomorrow.")
    tiers = [tier for tier, _weight in SPIN_TIERS]
    weights = [weight for _tier, weight in SPIN_TIERS]
    tier_index = random.Random().choices(range(len(tiers)), weights=weights, k=1)[0]
    coins = tiers[tier_index]
    student.last_spin_at = today
    rewards = game.grant(
        db, student, xp=0, coins=coins, kind="reward",
        title="Lucky spin", detail=f"Won {coins} coins",
    )
    db.commit()
    return {"ok": True, "tier": tier_index, "tiers": tiers, "coins": coins,
            "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# weekly missions
# ---------------------------------------------------------------------------
def _mission_progress(db: Session, student: Student, key: str, week_start: datetime) -> int:
    if key == "answer25":
        exam_answers = db.scalar(
            select(func.count(Answer.id)).where(Answer.attempt_id.in_(
                select(Attempt.id).where(Attempt.student_id == student.id)
            ), Answer.answered_at >= week_start)
        ) or 0
        rush_correct = db.scalar(
            select(func.coalesce(func.sum(RushRun.correct), 0)).where(
                RushRun.student_id == student.id, RushRun.created_at >= week_start
            )
        ) or 0
        daily_correct = db.scalar(
            select(func.coalesce(func.sum(DailyChallengeResult.correct), 0)).where(
                DailyChallengeResult.student_id == student.id, DailyChallengeResult.created_at >= week_start
            )
        ) or 0
        return int(exam_answers + rush_correct + daily_correct)
    if key == "exam1":
        return int(db.scalar(
            select(func.count(Attempt.id)).where(
                Attempt.student_id == student.id, Attempt.status == "submitted", Attempt.submitted_at >= week_start
            )
        ) or 0)
    if key == "duel2":
        return int(db.scalar(
            select(func.count(DuelParticipant.id))
            .join(Duel, Duel.id == DuelParticipant.duel_id)
            .where(DuelParticipant.student_id == student.id, Duel.created_at >= week_start)
        ) or 0)
    if key == "rush15":
        return int(db.scalar(
            select(func.coalesce(func.sum(RushRun.score), 0)).where(
                RushRun.student_id == student.id,
                RushRun.mode.in_(["blitz", "sudden"]),
                RushRun.created_at >= week_start,
            )
        ) or 0)
    if key == "help1":
        return int(db.scalar(
            select(func.count(HelpRequest.id)).where(
                HelpRequest.helper_id == student.id, HelpRequest.was_correct.is_(True),
                HelpRequest.answered_at >= week_start,
            )
        ) or 0)
    if key == "chat5":
        return int(db.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.sender_id == student.id, ChatMessage.created_at >= week_start
            )
        ) or 0)
    return 0


@router.get("/missions")
def missions(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    week_start = _week_start()
    claimed = set(db.scalars(
        select(MissionClaim.key).where(MissionClaim.student_id == student.id, MissionClaim.week_key == game.week_key())
    ).all())
    payload = []
    for mission in MISSIONS:
        progress = min(_mission_progress(db, student, mission["key"], week_start), mission["goal"])
        payload.append({**mission, "progress": progress, "claimed": mission["key"] in claimed})
    return {"week": game.week_key(), "missions": payload}


@router.post("/missions/{key}/claim")
async def mission_claim(key: str, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    mission = next((row for row in MISSIONS if row["key"] == key), None)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown mission.")
    week = game.week_key()
    if db.scalar(select(MissionClaim.id).where(
        MissionClaim.student_id == student.id, MissionClaim.key == key, MissionClaim.week_key == week
    )):
        raise HTTPException(status.HTTP_409_CONFLICT, "Already claimed this week.")
    progress = _mission_progress(db, student, key, _week_start())
    if progress < mission["goal"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Mission not done yet ({progress}/{mission['goal']}).")
    db.add(MissionClaim(student_id=student.id, key=key, week_key=week, xp=mission["xp"], coins=mission["coins"]))
    rewards = game.grant(
        db, student, xp=mission["xp"], coins=mission["coins"], kind="reward",
        title=f"Mission: {mission['title']}", detail="Weekly mission complete",
    )
    db.commit()
    return {"ok": True, "rewards": rewards, "profile": student_profile(db, student)}


# ---------------------------------------------------------------------------
# coin shop
# ---------------------------------------------------------------------------
@router.get("/shop")
def shop(student: Student = Depends(require_student)) -> dict:
    return {
        "items": SHOP,
        "coins": student.coins,
        "streak_freezes": student.streak_freezes,
        "flair": student.flair,
        "xp_boosted": bool(student.xp_boost_until and student.xp_boost_until > utcnow()),
    }


@router.post("/shop/buy")
def shop_buy(payload: ShopBuyIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    item = next((row for row in SHOP if row["sku"] == payload.sku), None)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown item.")
    if student.coins < item["cost"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not enough coins for that.")
    student.coins -= item["cost"]
    sku = payload.sku
    if sku == "freeze":
        student.streak_freezes += 1
        detail = "Streak freeze stored — it fires automatically on a missed day."
    elif sku == "boost":
        base = max(student.xp_boost_until or utcnow(), utcnow())
        student.xp_boost_until = base + timedelta(hours=24)
        detail = "Double XP is live for the next 24 hours."
    elif sku.startswith("flair_"):
        student.flair = sku.split("_", 1)[1]
        detail = "Flair equipped — flex it everywhere."
    else:  # pragma: no cover
        detail = ""
    db.add(Activity(student_id=student.id, kind="reward", title=f"Bought {item['name']}", detail=detail, amount=-item["cost"]))
    db.commit()
    return {"ok": True, "profile": student_profile(db, student), "detail": detail}


# ---------------------------------------------------------------------------
# analytics — your real study numbers
# ---------------------------------------------------------------------------
@router.get("/analytics")
def analytics(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    per_course = db.execute(
        select(Course.title, func.count(Answer.id), func.sum(case((Answer.is_correct.is_(True), 1), else_=0)))
        .select_from(Answer)
        .join(Attempt, Attempt.id == Answer.attempt_id)
        .join(Quiz, Quiz.id == Attempt.quiz_id)
        .join(Course, Course.id == Quiz.course_id)
        .where(Attempt.student_id == student.id)
        .group_by(Course.title)
    ).all()
    courses = [
        {"title": title, "answers": int(total or 0), "accuracy": round((correct or 0) / total * 100, 1) if total else 0.0}
        for title, total, correct in per_course
    ]
    weakest = min(courses, key=lambda row: row["accuracy"]) if courses else None

    rush_best = {
        mode: int(db.scalar(select(func.max(RushRun.score)).where(RushRun.student_id == student.id, RushRun.mode == mode)) or 0)
        for mode in ("blitz", "sudden", "match")
    }
    daily_best = int(db.scalar(select(func.max(DailyChallengeResult.correct)).where(DailyChallengeResult.student_id == student.id)) or 0)
    helped = int(db.scalar(select(func.count(HelpRequest.id)).where(
        HelpRequest.helper_id == student.id, HelpRequest.status == "answered"
    )) or 0)
    helped_correct = int(db.scalar(select(func.count(HelpRequest.id)).where(
        HelpRequest.helper_id == student.id, HelpRequest.was_correct.is_(True)
    )) or 0)
    asked = int(db.scalar(select(func.count(HelpRequest.id)).where(HelpRequest.asker_id == student.id)) or 0)
    study_seconds = float(db.scalar(
        select(func.coalesce(func.sum(Answer.seconds_spent), 0.0)).where(Answer.attempt_id.in_(
            select(Attempt.id).where(Attempt.student_id == student.id)
        ))
    ) or 0.0) + float(db.scalar(
        select(func.coalesce(func.sum(RushRun.elapsed_ms), 0)).where(RushRun.student_id == student.id)
    ) or 0.0) / 1000.0

    accuracy = (student.correct_answers / student.questions_answered * 100) if student.questions_answered else 0.0
    grade = game.calculate_grade(accuracy)
    return {
        "accuracy": round(accuracy, 1),
        "predicted_grade": grade,
        "questions_answered": student.questions_answered,
        "correct_answers": student.correct_answers,
        "study_minutes": int(study_seconds // 60),
        "courses": courses,
        "weakest": weakest,
        "rush_best": rush_best,
        "daily_best": daily_best,
        "help": {"asked": asked, "answered": helped, "correct": helped_correct, "points": student.helper_points},
        "best_percentage": student.best_percentage,
    }
