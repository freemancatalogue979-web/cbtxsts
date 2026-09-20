"""Duel endpoints: challenge friends, quick-match, join by code, answer live."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DUEL_QUESTION_COUNT, DUEL_STAKE_COINS
from ..db import get_db
from ..deps import require_student
from ..events import dispatch
from ..models import Config, Duel, Student
from ..schemas import DuelAnswerIn, DuelCreateIn
from ..serializers import duel_public
from ..services import duel as duel_service
from ..services.duel import DuelError, duel_room
from ..ws import hub

router = APIRouter(prefix="/duels", tags=["duels"])


def _duel_or_404(db: Session, duel_id: int) -> Duel:
    duel = db.get(Duel, duel_id)
    if duel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Duel not found.")
    return duel


def _duels_enabled(db: Session) -> None:
    config = db.get(Config, 1)
    if config and not config.duels_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Duels are paused by the arena administrator.")


def _mine(duel: Duel, student: Student) -> bool:
    return any(p.student_id == student.id for p in duel.participants)


def _playable(duel: Duel) -> bool:
    return duel.status in {"starting", "live"}


@router.get("")
def my_duels(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    active = duel_service.active_duels_for(db, student.id)
    history = db.scalars(
        select(Duel)
        .where(
            Duel.status.in_(["finished", "cancelled", "expired"]),
            Duel.participants.any(student_id=student.id),
        )
        .order_by(Duel.id.desc())
        .limit(20)
    ).all()
    online_ids = hub.online_student_ids
    return {
        "active": [duel_public(d, viewer_id=student.id, include_questions=_playable(d)) for d in active],
        "history": [duel_public(d, viewer_id=student.id, reveal=True) for d in history],
        # The open arena: public duels anyone can join. Private duels never
        # appear here — they are only reachable by code or direct invite.
        "open": [duel_public(d, viewer_id=student.id) for d in duel_service.public_duels(db)],
        "online": len(online_ids),
        "online_ids": online_ids,
        "stake_default": DUEL_STAKE_COINS,
        "question_count_default": DUEL_QUESTION_COUNT,
        "question_count_max": duel_service.DUEL_MAX_QUESTIONS,
    }


@router.post("")
async def create_duel(
    payload: DuelCreateIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _duels_enabled(db)
    try:
        opponent = duel_service.resolve_opponent(
            db, phone=payload.opponent_phone, student_id=payload.opponent_id, me=student
        )
        duel, events = duel_service.create_duel(
            db,
            student,
            opponent=opponent,
            quiz_id=payload.quiz_id,
            course_id=payload.course_id,
            topic=payload.topic,
            question_count=payload.question_count,
            stake_coins=payload.stake_coins,
            mode=payload.mode,
            best_of=payload.best_of,
            difficulty=payload.difficulty,
            sudden_death=payload.sudden_death,
        )
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id)


@router.post("/quick")
async def quick_match(
    payload: DuelCreateIn | None = None,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _duels_enabled(db)
    body = payload or DuelCreateIn()
    try:
        duel, events = duel_service.quick_match(
            db,
            student,
            hub.online_student_ids,
            question_count=body.question_count,
            stake_coins=body.stake_coins,
            quiz_id=body.quiz_id,
            course_id=body.course_id,
            mode=body.mode,
            best_of=body.best_of,
            difficulty=body.difficulty,
            sudden_death=body.sudden_death,
        )
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id, include_questions=_playable(duel))


@router.post("/open")
async def open_duel(
    payload: DuelCreateIn | None = None,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _duels_enabled(db)
    body = payload or DuelCreateIn()
    try:
        duel, events = duel_service.open_duel(
            db,
            student,
            topic=body.topic or "Open Arena",
            question_count=body.question_count,
            stake_coins=body.stake_coins,
            quiz_id=body.quiz_id,
            course_id=body.course_id,
        )
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id)


@router.get("/open")
def open_list(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> list[dict]:
    """Public duels that still have a free seat. Declared before ``/{duel_id}``
    so the literal path wins; private duels are never listed here."""
    return [duel_public(d, viewer_id=student.id) for d in duel_service.public_duels(db)]


@router.post("/join/{code}")
async def join_duel(
    code: str,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    _duels_enabled(db)
    try:
        duel, events = duel_service.join_by_code(db, student, code)
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id, include_questions=_playable(duel))


@router.post("/{duel_id}/accept")
async def accept(duel_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    duel = _duel_or_404(db, duel_id)
    try:
        events = duel_service.accept_duel(db, duel, student)
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id, include_questions=True)


@router.post("/{duel_id}/join")
async def join_by_id(
    duel_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    """Join a PUBLIC duel straight from the open-arena list (no code needed)."""
    _duels_enabled(db)
    duel = _duel_or_404(db, duel_id)
    try:
        duel, events = duel_service.join_open_duel(db, student, duel)
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id, include_questions=_playable(duel))


@router.post("/{duel_id}/decline")
async def decline(duel_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    duel = _duel_or_404(db, duel_id)
    try:
        events = duel_service.decline_duel(db, duel, student)
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return {"ok": True}


@router.post("/{duel_id}/cancel")
async def cancel(duel_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    duel = _duel_or_404(db, duel_id)
    try:
        events = duel_service.cancel_duel(db, duel, student)
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return {"ok": True}


@router.get("/{duel_id}")
def read_duel(duel_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    duel = _duel_or_404(db, duel_id)
    if not _mine(duel, student):
        # A PUBLIC duel still waiting for a rival may be inspected (and joined)
        # by anyone — e.g. from a chat invite bubble. Questions stay hidden for
        # outsiders; everything else is lobby information.
        if duel.status == "invited" and duel.visibility == "public":
            return duel_public(duel, viewer_id=student.id, include_questions=False)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This duel is not yours.")
    finished = duel.status == "finished"
    return duel_public(duel, viewer_id=student.id, include_questions=True, reveal=finished)


@router.post("/{duel_id}/answer")
async def answer(
    duel_id: int,
    payload: DuelAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    duel = _duel_or_404(db, duel_id)
    if not _mine(duel, student):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This duel is not yours.")
    try:
        events = duel_service.record_answer(
            db,
            duel,
            student,
            question_id=payload.question_id,
            selected=payload.selected,
            elapsed_ms=payload.elapsed_ms,
        )
        db.commit()
    except DuelError as error:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    await dispatch(events)
    return duel_public(duel, viewer_id=student.id, include_questions=_playable(duel), reveal=duel.status == "finished")
