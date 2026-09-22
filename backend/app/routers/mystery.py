"""Mystery — learn by detective work.

Each case is a real investigation built on the arena's own content: a brief,
study clues drawn from the Materials system, and a server-dealt set of course
questions. Answering well unlocks the solution paragraphs one by one — the
reward is comprehension, and the XP/coins on top are just punctuation.
The dealt question set is stored, so refreshing never re-rolls a case.
"""
from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_admin, require_student
from ..models import (
    Admin,
    MysteryCase,
    MysteryClue,
    MysterySolve,
    Question,
    Student,
    utcnow,
)
from ..schemas import MysteryAnswerIn, MysteryBeginIn
from ..serializers import question_public
from ..services import study_lab
from ..services.questions import answer_matches, display_order, label_to_key, mastery_scope_update

router = APIRouter(prefix="/mystery", tags=["mystery"])
admin_router = APIRouter(prefix="/admin/mystery", tags=["mystery-admin"], dependencies=[Depends(require_admin)])


class MysteryError(Exception):
    pass


def _case_or_404(db: Session, case_id: int, *, published_only: bool) -> MysteryCase:
    case = db.get(MysteryCase, case_id)
    if case is None or (published_only and case.status != "published"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found.")
    return case


def _pool(db: Session, case: MysteryCase) -> list[Question]:
    stmt = select(Question).where(Question.status == "approved", Question.visible.is_(True))
    if case.course_id:
        stmt = stmt.where(Question.course_id == case.course_id)
    if case.topic.strip():
        stmt = stmt.where(func.lower(Question.topic) == case.topic.strip().lower())
    return list(db.scalars(stmt).all())


def case_public(db: Session, case: MysteryCase, viewer_id: int | None) -> dict:
    clues = db.scalars(
        select(MysteryClue).where(MysteryClue.case_id == case.id).order_by(MysteryClue.position)
    ).all()
    solve = None
    if viewer_id is not None:
        solve = db.scalar(
            select(MysterySolve).where(MysterySolve.case_id == case.id, MysterySolve.student_id == viewer_id)
        )
    pool_size = len(_pool(db, case))
    return {
        "id": case.id,
        "title": case.title,
        "blurb": case.blurb,
        "brief": case.brief if (solve is not None or case.status != "published") else "",
        "difficulty": case.difficulty,
        "topic": case.topic,
        "course_id": case.course_id,
        "cover": case.cover,
        "question_count": min(case.question_count, pool_size) if pool_size else case.question_count,
        "pass_count": case.pass_count,
        "reward_xp": case.reward_xp,
        "reward_coins": case.reward_coins,
        "status": case.status,
        "clues": [
            {
                "id": clue.id,
                "position": clue.position,
                "cost_coins": clue.cost_coins,
                "material_id": clue.material_id,
                "text": clue.text if (solve is not None and clue.id in (solve.opened_clues or [])) else "",
                "opened": bool(solve is not None and clue.id in (solve.opened_clues or [])),
            }
            for clue in clues
        ],
        "pool_ready": pool_size,
        "my": (
            {
                "status": solve.status,
                "position": solve.position,
                "total": len(solve.question_ids or []),
                "score": solve.score,
                "answers": solve.answers or {},
                "opened_clues": solve.opened_clues or [],
                "attempts": solve.attempts,
                "finished_at": solve.finished_at.isoformat() + "Z" if solve.finished_at else None,
            }
            if solve is not None
            else None
        ),
    }


# ---------------------------------------------------------------- listing
@router.get("")
def list_cases(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(MysteryCase).where(MysteryCase.status == "published").order_by(MysteryCase.order_index, MysteryCase.id)
    ).all()
    items = [case_public(db, case, student.id) for case in rows]
    solved = sum(1 for item in items if (item["my"] or {}).get("status") == "solved")
    return {"cases": items, "solved": solved, "total": len(items)}


@router.get("/{case_id}")
def read_case(case_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    case = _case_or_404(db, case_id, published_only=True)
    payload = case_public(db, case, student.id)
    solve = db.scalar(
        select(MysterySolve).where(MysterySolve.case_id == case.id, MysterySolve.student_id == student.id)
    )
    question = None
    if solve is not None and solve.status == "active":
        ids = list(solve.question_ids or [])
        if solve.position < len(ids):
            q = db.get(Question, ids[solve.position])
            if q is not None:
                order = display_order(q, shuffle=True, seed=f"mystery:{solve.id}:{q.id}")
                question = question_public(q, order=order)
    return {"case": payload, "question": question}


# ---------------------------------------------------------------- begin
@router.post("/{case_id}/begin")
def begin(
    case_id: int,
    payload: MysteryBeginIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    case = _case_or_404(db, case_id, published_only=True)
    solve = db.scalar(select(MysterySolve).where(MysterySolve.case_id == case.id, MysterySolve.student_id == student.id))
    if solve is not None and solve.status == "solved":
        # A solved case stays solved — no farming the reward by replaying it.
        return {"solve": _solve_public(db, solve), "resumed": True, "already_solved": True}
    if solve is not None and solve.status == "active" and not payload.reset:
        return {"solve": _solve_public(db, solve), "resumed": True}
    pool = _pool(db, case)
    if len(pool) < 3:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This case's question bank is too thin right now — an admin needs to add approved questions.",
        )
    count = max(3, min(case.question_count, len(pool)))
    picks = random.sample(pool, count)
    if solve is None:
        solve = MysterySolve(case_id=case.id, student_id=student.id)
        db.add(solve)
        db.flush()
    else:
        # Re-opening a closed case counts as a fresh attempt.
        solve.attempts = int(solve.attempts or 1) + 1
    solve.status = "active"
    solve.question_ids = [q.id for q in picks]
    solve.position = 0
    solve.answers = {}
    solve.score = 0
    solve.finished_at = None
    db.commit()
    db.refresh(solve)
    return {"solve": _solve_public(db, solve), "resumed": False}


def _solve_public(db: Session, solve: MysterySolve) -> dict:
    return {
        "id": solve.id,
        "case_id": solve.case_id,
        "status": solve.status,
        "position": solve.position,
        "total": len(solve.question_ids or []),
        "score": solve.score,
        "answers": solve.answers or {},
        "opened_clues": solve.opened_clues or [],
        "attempts": solve.attempts,
    }


# ---------------------------------------------------------------- clues
@router.post("/{case_id}/clue")
def open_clue(case_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    case = _case_or_404(db, case_id, published_only=True)
    solve = db.scalar(select(MysterySolve).where(MysterySolve.case_id == case.id, MysterySolve.student_id == student.id))
    if solve is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Open the case file first.")
    clues = db.scalars(
        select(MysteryClue).where(MysteryClue.case_id == case.id).order_by(MysteryClue.position)
    ).all()
    opened = [int(x) for x in (solve.opened_clues or [])]
    next_clue = next((c for c in clues if c.id not in opened), None)
    if next_clue is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every clue in this case is already on the board.")
    if next_clue.cost_coins and student.coins < next_clue.cost_coins:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That clue costs {next_clue.cost_coins} coins — you have {student.coins}. Answer questions correctly to earn more.",
        )
    if next_clue.cost_coins:
        student.coins -= next_clue.cost_coins
    solve.opened_clues = opened + [next_clue.id]
    db.commit()
    return {"clue": {"id": next_clue.id, "text": next_clue.text, "material_id": next_clue.material_id}, "coins": student.coins}


# ---------------------------------------------------------------- answers
@router.post("/{case_id}/answer")
async def answer(
    case_id: int,
    payload: MysteryAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    from ..ws import hub

    case = _case_or_404(db, case_id, published_only=True)
    solve = db.scalar(select(MysterySolve).where(MysterySolve.case_id == case.id, MysterySolve.student_id == student.id))
    if solve is None or solve.status != "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Open the case file first.")
    ids = list(solve.question_ids or [])
    if solve.position >= len(ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No question is on the board right now.")
    question = db.get(Question, ids[solve.position])
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That question is gone from the bank.")
    order = display_order(question, shuffle=True, seed=f"mystery:{solve.id}:{question.id}")
    canonical = label_to_key(question, order, payload.selected) or payload.selected
    correct = answer_matches(question.correct, canonical)

    answers = dict(solve.answers or {})
    answers[str(question.id)] = {"selected": payload.selected, "correct": bool(correct)}
    solve.answers = answers
    solve.position += 1
    solve.score = int(solve.score or 0) + (1 if correct else 0)
    mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic or case.topic or "Mystery", correct=bool(correct))
    if correct:
        study_lab.resolve_mistake(db, student.id, question.id)
    else:
        study_lab.record_mistake(db, student.id, question, selected=canonical, source="mystery")

    story = [str(x) for x in (case.story or [])]
    unlocked = min(solve.score, len(story))
    result = {
        "correct": bool(correct),
        "correct_answer": question.correct,
        "explanation": question.explanation or "",
        "topic": question.topic or case.topic,
        "progress": {"position": solve.position, "total": len(ids), "score": solve.score},
        "story_unlocked": story[max(0, unlocked - 1) : unlocked],
        "rewards": [],
        "solved": None,
    }

    finished = solve.position >= len(ids)
    if finished:
        if solve.score >= case.pass_count:
            solve.status = "solved"
            rewards = game.grant(
                db,
                student,
                xp=case.reward_xp,
                coins=case.reward_coins,
                kind="xp",
                title=f"Mystery solved — {case.title}",
                detail=f"{solve.score}/{len(ids)} deductions correct",
            )
            result["rewards"] = rewards
            await hub.send_to_student(student.id, "mystery_solved", {"case_id": case.id, "rewards": rewards})
        else:
            solve.status = "failed"
        solve.finished_at = utcnow()
    db.commit()
    result["solve"] = _solve_public(db, solve)
    result["solved"] = solve.status
    result["next"] = None
    if not finished:
        nxt = db.get(Question, ids[solve.position])
        if nxt is not None:
            result["next"] = question_public(nxt, order=display_order(nxt, shuffle=True, seed=f"mystery:{solve.id}:{nxt.id}"))
    result["story"] = story[: len(story)] if solve.status == "solved" else story[:unlocked]
    return result


# ---------------------------------------------------------------- admin CRUD
@admin_router.get("/cases")
def admin_list(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    total = int(db.scalar(select(func.count(MysteryCase.id))) or 0)
    rows = db.scalars(select(MysteryCase).order_by(MysteryCase.order_index, MysteryCase.id.desc()).limit(limit).offset(offset)).all()
    out = []
    for case in rows:
        clues = db.scalars(select(MysteryClue).where(MysteryClue.case_id == case.id).order_by(MysteryClue.position)).all()
        solves = int(db.scalar(select(func.count(MysterySolve.id)).where(MysterySolve.case_id == case.id)) or 0)
        opened = int(
            db.scalar(select(func.count(MysterySolve.id)).where(MysterySolve.case_id == case.id, MysterySolve.status == "solved"))
            or 0
        )
        out.append(
            {
                "id": case.id,
                "title": case.title,
                "status": case.status,
                "topic": case.topic,
                "course_id": case.course_id,
                "difficulty": case.difficulty,
                "question_count": case.question_count,
                "pass_count": case.pass_count,
                "reward_xp": case.reward_xp,
                "reward_coins": case.reward_coins,
                "blurb": case.blurb,
                "brief": case.brief,
                "story": case.story or [],
                "clues": [
                    {
                        "id": c.id,
                        "position": c.position,
                        "text": c.text,
                        "material_id": c.material_id,
                        "cost_coins": c.cost_coins,
                    }
                    for c in clues
                ],
                "solves": solves,
                "solved": opened,
                "pool": len(_pool(db, case)),
            }
        )
    return {"cases": out, "total": total, "limit": limit, "offset": offset}


@admin_router.post("/cases")
def admin_create(payload: dict, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    title = str(payload.get("title") or "").strip()
    if len(title) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cases need a real title (4+ characters).")
    case = MysteryCase(
        title=title[:160],
        blurb=str(payload.get("blurb") or "")[:600],
        brief=str(payload.get("brief") or "")[:4000],
        story=[str(x) for x in (payload.get("story") or []) if str(x).strip()][:8],
        course_id=payload.get("course_id") or None,
        topic=str(payload.get("topic") or "")[:120],
        difficulty=str(payload.get("difficulty") or "medium")[:12],
        question_count=max(3, min(int(payload.get("question_count") or 5), 20)),
        pass_count=max(1, int(payload.get("pass_count") or 0)) or None,
        reward_xp=max(0, min(int(payload.get("reward_xp") or 40), 5000)),
        reward_coins=max(0, min(int(payload.get("reward_coins") or 15), 2000)),
        status=payload.get("status") if payload.get("status") in ("draft", "published", "archived") else "draft",
        cover=str(payload.get("cover") or "magnifier")[:16],
        order_index=int(payload.get("order_index") or 0),
        created_by=getattr(admin, "email", ""),
    )
    if case.pass_count is None:
        case.pass_count = max(1, int(case.question_count * 0.6))
    db.add(case)
    db.flush()
    for position, clue in enumerate((payload.get("clues") or [])[:10], start=1):
        db.add(
            MysteryClue(
                case_id=case.id,
                position=position,
                text=str(clue.get("text") or "")[:2000],
                material_id=clue.get("material_id") or None,
                cost_coins=max(0, min(int(clue.get("cost_coins") or 0), 500)),
            )
        )
    db.commit()
    return {"case_id": case.id, "ok": True}


@admin_router.patch("/cases/{case_id}")
def admin_update(case_id: int, payload: dict, db: Session = Depends(get_db)) -> dict:
    case = _case_or_404(db, case_id, published_only=False)
    simple = {
        "title": 160,
        "blurb": 600,
        "brief": 4000,
        "topic": 120,
        "difficulty": 12,
        "status": 12,
        "cover": 16,
    }
    for field, cap in simple.items():
        if field in payload:
            setattr(case, field, str(payload[field])[:cap])
    for field in ("course_id", "question_count", "pass_count", "reward_xp", "reward_coins", "order_index"):
        if field in payload:
            setattr(case, field, payload[field] or None if field == "course_id" else int(payload[field]))
    if "story" in payload:
        case.story = [str(x) for x in (payload.get("story") or []) if str(x).strip()][:8]
    if "clues" in payload:
        for old in db.scalars(select(MysteryClue).where(MysteryClue.case_id == case.id)).all():
            db.delete(old)
        db.flush()
        for position, clue in enumerate((payload.get("clues") or [])[:10], start=1):
            db.add(
                MysteryClue(
                    case_id=case.id,
                    position=position,
                    text=str(clue.get("text") or "")[:2000],
                    material_id=clue.get("material_id") or None,
                    cost_coins=max(0, min(int(clue.get("cost_coins") or 0), 500)),
                )
            )
    db.commit()
    return {"ok": True, "case_id": case.id}


@admin_router.delete("/cases/{case_id}")
def admin_delete(case_id: int, db: Session = Depends(get_db)) -> dict:
    case = _case_or_404(db, case_id, published_only=False)
    for clue in db.scalars(select(MysteryClue).where(MysteryClue.case_id == case.id)).all():
        db.delete(clue)
    for solve in db.scalars(select(MysterySolve).where(MysterySolve.case_id == case.id)).all():
        db.delete(solve)
    db.delete(case)
    db.commit()
    return {"ok": True}
