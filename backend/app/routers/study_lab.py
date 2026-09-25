"""Study Lab endpoints — the dedicated learning workspace for players.

Dashboard overview, the per-topic learning path (Understand → Learn →
Practice → Review mistakes → Practice again → Mastery check), and the mistake
book. Question dealing, grading and mastery updates all happen here on the
server; the client only ever sees one question at a time and never the key.
"""
from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..models import (
    Question,
    StudyMistake,
    StudyPath,
    StudyRun,
    Student,
    utcnow,
)
from ..schemas import StudyAnswerIn, StudyPathActionIn, StudyRunIn
from ..serializers import question_public
from ..services.questions import answer_matches, display_order, label_to_key, mastery_scope_update

router = APIRouter(prefix="/study-lab", tags=["study-lab"])

from ..services import study_lab


def _question_public_safe(question: Question, *, reveal: bool = False) -> dict:
    payload = question_public(question, reveal=False)
    if reveal:
        payload["correct"] = question.correct
        payload["explanation"] = question.explanation or ""
    return payload


# ------------------------------------------------------------------ overview
@router.get("/overview")
def lab_overview(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    payload = study_lab.overview(db, student.id)
    active = db.scalar(
        select(StudyRun).where(StudyRun.student_id == student.id, StudyRun.status == "active").order_by(StudyRun.id.desc())
    )
    payload["active_run"] = (
        {
            "id": active.id,
            "topic": active.topic,
            "kind": active.kind,
            "position": active.position,
            "total": len(active.question_ids or []),
            "correct": active.correct,
            "score": active.score,
        }
        if active is not None
        else None
    )
    recent = db.scalars(
        select(StudyMistake)
        .where(StudyMistake.student_id == student.id)
        .order_by(StudyMistake.last_at.desc())
        .limit(5)
    ).all()
    mistakes = []
    for row in recent:
        question = db.get(Question, row.question_id)
        mistakes.append(
            {
                "id": row.id,
                "question_id": row.question_id,
                "question": (question.text if question else "")[:220],
                "topic": row.topic,
                "your_answer": row.selected,
                "correct_answer": row.correct_key,
                "why": (row.explanation or (question.explanation if question else "") or "")[:240],
                "hits": row.hits,
                "resolved": row.resolved,
                "source": row.source,
                "last_at": row.last_at.isoformat() + "Z" if row.last_at else None,
            }
        )
    payload["recent_mistakes"] = mistakes
    # One clear next step, whatever stage the player is at.
    if payload["active_run"]:
        payload["next_activity"] = {"kind": "resume", "label": "Resume your run", "topic": payload["active_run"]["topic"]}
    elif payload["recommended"]:
        payload["next_activity"] = {
            "kind": "path",
            "label": f"Work through {payload['recommended']}",
            "topic": payload["recommended"],
        }
    else:
        payload["next_activity"] = {"kind": "explore", "label": "Pick a topic and start a mastery run"}
    return payload


# ---------------------------------------------------------------- topic page
@router.get("/topic/{topic}")
def topic_page(
    topic: str,
    mistakes_limit: int = Query(10, ge=1, le=50),
    mistakes_offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    key = topic.strip()[:120]
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Which topic?")
    path = db.scalar(select(StudyPath).where(StudyPath.student_id == student.id, StudyPath.topic == key))
    stats = study_lab.topic_stats(db, student.id).get(key, {})
    materials = study_lab.topic_materials(db, key)
    pool = list(
        db.scalars(
            select(Question).where(
                func.lower(Question.topic) == key.lower(),
                Question.status == "approved",
                Question.visible.is_(True),
                Question.source_id.is_(None), Question.exam_only.is_(False),
            )
        ).all()
    )
    mistake_rows = db.scalars(
        select(StudyMistake)
        .where(StudyMistake.student_id == student.id, StudyMistake.topic == key)
        .order_by(StudyMistake.resolved, StudyMistake.hits.desc(), StudyMistake.last_at.desc())
        .limit(mistakes_limit)
        .offset(mistakes_offset)
    ).all()
    total_mistakes = int(
        db.scalar(
            select(func.count(StudyMistake.id)).where(StudyMistake.student_id == student.id, StudyMistake.topic == key)
        )
        or 0
    )
    mistakes = []
    for row in mistake_rows:
        question = db.get(Question, row.question_id)
        mistakes.append(
            {
                "id": row.id,
                "question_id": row.question_id,
                "question": question.text if question else "",
                "options": {
                    key_opt: getattr(question, f"option_{key_opt.lower()}", "") for key_opt in ("A", "B", "C", "D")
                } if question else {},
                "your_answer": row.selected,
                "correct_answer": row.correct_key,
                "why": row.explanation or (question.explanation if question else "") or "",
                "topic": row.topic,
                "difficulty": question.difficulty if question else "medium",
                "hits": row.hits,
                "resolved": row.resolved,
                "source": row.source,
                "last_at": row.last_at.isoformat() + "Z" if row.last_at else None,
            }
        )
    state = study_lab.state_of(key, stats, path)
    accuracy = float(stats.get("accuracy", 0.0))
    return {
        "topic": key,
        "stage": path.stage if path else "understand",
        "state": state,
        "state_label": study_lab.STATE_LABELS.get(state, state),
        "understood": bool(path.understood) if path else False,
        "sections_done": list(path.sections_done or []) if path else [],
        "review_seen": int(path.review_seen or 0) if path else 0,
        "practice": {
            "runs": int(path.practice_runs or 0) if path else 0,
            "answered": int(path.practice_answered or 0) if path else 0,
            "correct": int(path.practice_correct or 0) if path else 0,
        },
        "mastery": {
            "answered": int(stats.get("answered", 0)),
            "correct": int(stats.get("correct", 0)),
            "wrong": int(stats.get("wrong", 0)),
            "accuracy": round(accuracy * 100, 1),
            "check_passed": bool(path.check_passed) if path else False,
            "check_attempts": int(path.check_attempts or 0) if path else 0,
        },
        "understand": {
            "summary": [str(item) for item in (materials[0]["summary"] if materials else [])],
            "definitions": [material["title"] for material in materials[:3]],
            "common_mistakes": study_lab.common_mistakes(db, student.id, key),
            "materials": materials,
        },
        "mistakes": {"items": mistakes, "total": total_mistakes, "limit": mistakes_limit, "offset": mistakes_offset},
        "pool": len(pool),
        "weakness": study_lab.weakness({**stats, **{}}) if stats else 0.0,
    }


# ------------------------------------------------------------ path actions
@router.post("/topic/{topic}/action")
def topic_action(
    topic: str,
    payload: StudyPathActionIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    key = topic.strip()[:120]
    path = study_lab.path_for(db, student.id, key)
    if payload.action == "understood":
        path.understood = True
        study_lab.advance_stage(path, "learn")
    elif payload.action == "section_done":
        done = {int(x) for x in (path.sections_done or [])}
        if payload.section_id is not None:
            done ^= {int(payload.section_id)}
        path.sections_done = sorted(done)
        if done:
            study_lab.advance_stage(path, "learn")
    elif payload.action == "review_done":
        path.review_seen = int(path.review_seen or 0) + 1
        study_lab.advance_stage(path, "again")
    elif payload.action == "reset_stage":
        path.stage = "understand"
        path.understood = False
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown action: {payload.action}")
    db.commit()
    return {"stage": path.stage, "understood": path.understood, "sections_done": path.sections_done or []}


# ---------------------------------------------------------------- runs
def _pick_questions(db: Session, student: Student, key: str, kind: str, count: int) -> list[Question]:
    """Deal a run from the topic bank.

    Practice emphasises the player's shaky ground: repeated-mistake questions
    and the ones they have never seen come first, then the rest shuffled —
    random but never random about what matters. Mastery checks pull the
    harder half of the topic only, so passing one means something.
    """
    pool = list(
        db.scalars(
            select(Question).where(
                func.lower(Question.topic) == key.lower(),
                Question.status == "approved",
                Question.visible.is_(True),
                Question.source_id.is_(None), Question.exam_only.is_(False),
            )
        ).all()
    )
    if not pool:
        raise HTTPException(status.HTTP_409_CONFLICT, f"No approved questions are available for “{key}” yet.")
    rng = random.Random()
    if kind == "check":
        order = {"hard": 0, "medium": 1, "easy": 2}
        pool.sort(key=lambda q: (order.get(q.difficulty, 1), -int(q.wrong_count or 0)))
        picks = pool[: count]
        if len(picks) < 3:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This topic's bank is too small for a mastery check — keep practising instead.",
            )
        rng.shuffle(picks)
        return picks
    seen_ids = {
        int(row[0])
        for row in db.execute(
            select(StudyMistake.question_id).where(StudyMistake.student_id == student.id, StudyMistake.topic == key)
        ).all()
    }
    priority = [q for q in pool if q.id in seen_ids]
    rest = [q for q in pool if q.id not in seen_ids]
    rng.shuffle(rest)
    picks = (priority + rest)[: max(1, min(count, 25))]
    return picks


@router.post("/run/start")
def run_start(
    payload: StudyRunIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    key = payload.topic.strip()[:120]
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a topic to practise.")
    kind = payload.kind if payload.kind in ("practice", "check") else "practice"
    # One live run at a time — starting a new one abandons the old.
    stale = db.scalars(
        select(StudyRun).where(StudyRun.student_id == student.id, StudyRun.status == "active")
    ).all()
    for row in stale:
        row.status = "abandoned"
    count = payload.count or (5 if kind == "check" else 10)
    picks = _pick_questions(db, student, key, kind, count)
    run = StudyRun(student_id=student.id, topic=key, kind=kind, question_ids=[q.id for q in picks])
    db.add(run)
    path = study_lab.path_for(db, student.id, key)
    study_lab.advance_stage(path, "practice" if kind == "practice" else "check")
    db.commit()
    db.refresh(run)
    return _run_payload(db, run, student, started=True)


def _current_question(db: Session, run: StudyRun, student: Student) -> dict | None:
    ids = list(run.question_ids or [])
    if run.position >= len(ids):
        return None
    question = db.get(Question, ids[run.position])
    if question is None:
        return None
    order = display_order(question, shuffle=True, seed=f"study:{run.id}:{run.position}")
    return question_public(question, reveal=False, order=order)


def _run_payload(db: Session, run: StudyRun, student: Student, *, started: bool = False) -> dict:
    ids = list(run.question_ids or [])
    return {
        "run": {
            "id": run.id,
            "topic": run.topic,
            "kind": run.kind,
            "position": run.position,
            "total": len(ids),
            "score": run.score,
            "correct": run.correct,
            "status": run.status,
        },
        "question": _current_question(db, run, student) if run.status == "active" else None,
        "answers": run.answers or {},
        "started": started,
    }


@router.get("/run/active")
def run_active(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    run = db.scalar(
        select(StudyRun).where(StudyRun.student_id == student.id, StudyRun.status == "active").order_by(StudyRun.id.desc())
    )
    if run is None:
        return {"run": None}
    return _run_payload(db, run, student)


@router.post("/run/{run_id}/answer")
def run_answer(
    run_id: int,
    payload: StudyAnswerIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    run = db.get(StudyRun, run_id)
    if run is None or run.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    if run.status != "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This run is already finished.")
    ids = list(run.question_ids or [])
    if run.position >= len(ids) or ids[run.position] != payload.question_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That question is not on the clock right now.")
    question = db.get(Question, payload.question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question vanished mid-run.")
    order = display_order(question, shuffle=True, seed=f"study:{run.id}:{run.position}")
    # Translate the display letter into the canonical key (option-shuffle safe).
    canonical = label_to_key(question, order, payload.selected) or payload.selected
    correct = answer_matches(question.correct, canonical)

    answers = dict(run.answers or {})
    answers[str(question.id)] = {
        "selected": payload.selected,
        "canonical": canonical,
        "correct": bool(correct),
        "elapsed_ms": max(0, int(payload.elapsed_ms or 0)),
    }
    run.answers = answers
    run.position += 1
    run.correct = int(run.correct or 0) + (1 if correct else 0)
    run.score = int(run.score or 0) + (100 if correct else 0)
    db.flush()

    path = study_lab.path_for(db, student.id, run.topic)
    path.practice_answered = int(path.practice_answered or 0) + 1
    path.practice_correct = int(path.practice_correct or 0) + (1 if correct else 0)
    mastery_scope_update(db, student.id, scope_type="topic", scope_key=run.topic, correct=bool(correct))
    if correct:
        study_lab.resolve_mistake(db, student.id, question.id)
    else:
        study_lab.record_mistake(db, student.id, question, selected=canonical or payload.selected, source="practice")

    finished = run.position >= len(ids)
    result = {
        "correct": bool(correct),
        "correct_answer": question.correct,
        "explanation": question.explanation or "",
        "topic": question.topic or run.topic,
        "concept": f"{(question.topic or 'General').strip()} · {question.difficulty or 'medium'}",
        "your_answer": payload.selected,
        "progress": {"answered": run.position, "total": len(ids), "score": run.score, "correct": run.correct},
        "next": _current_question(db, run, student) if not finished else None,
    }

    rewards: list[dict] = []
    if finished:
        run.status = "finished"
        run.finished_at = utcnow()
        path.practice_runs = int(path.practice_runs or 0) + 1
        streak = study_lab.touch_practice_day(path)
        total = max(1, len(ids))
        ratio = run.correct / total
        if run.kind == "check":
            path.check_attempts = int(path.check_attempts or 0) + 1
            if ratio >= 0.8:
                path.check_passed = True
                study_lab.advance_stage(path, "mastered")
        if ratio >= 0.5:
            study_lab.advance_stage(path, "review")
        xp = (18 if run.kind == "check" else 8) * int(run.correct or 0) + (25 if ratio >= 0.8 else 0)
        coins = 4 * int(run.correct or 0) + (10 if run.kind == "check" and ratio >= 0.8 else 0)
        rewards = game.grant(
            db,
            student,
            xp=xp,
            coins=coins,
            kind="xp",
            title=("Mastery check passed" if run.kind == "check" and ratio >= 0.8 else f"{run.topic} run finished"),
            detail=f"{run.correct}/{total} correct" + (f" · {streak}-day practice streak" if streak > 1 else ""),
        )
    db.commit()
    result["finished"] = finished
    result["rewards"] = rewards
    if finished:
        result["run"] = _run_payload(db, run, student)["run"]
        result["run"]["mastery_passed"] = bool(run.kind == "check" and path.check_passed)
    return result


@router.post("/run/{run_id}/abandon")
def run_abandon(run_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    run = db.get(StudyRun, run_id)
    if run is None or run.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    if run.status == "active":
        run.status = "abandoned"
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------- mistake book
@router.get("/mistakes")
def mistake_book(
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    only_open: bool = True,
    topic: str = "",
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    conds = [StudyMistake.student_id == student.id]
    if only_open:
        conds.append(StudyMistake.resolved.is_(False))
    if topic.strip():
        conds.append(func.lower(StudyMistake.topic) == topic.strip().lower())
    rows = db.scalars(
        select(StudyMistake).where(*conds).order_by(StudyMistake.hits.desc(), StudyMistake.last_at.desc()).limit(limit).offset(offset)
    ).all()
    total = int(db.scalar(select(func.count(StudyMistake.id)).where(*conds)) or 0)
    items = []
    for row in rows:
        question = db.get(Question, row.question_id)
        items.append(
            {
                "id": row.id,
                "question_id": row.question_id,
                "question": question.text if question else "(question removed)",
                "options": {k: getattr(question, f"option_{k.lower()}", "") for k in ("A", "B", "C", "D")} if question else {},
                "your_answer": row.selected,
                "correct_answer": row.correct_key,
                "why": row.explanation or (question.explanation if question else "") or "No explanation was stored for this question.",
                "topic": row.topic,
                "hits": row.hits,
                "resolved": row.resolved,
                "source": row.source,
                "last_at": row.last_at.isoformat() + "Z" if row.last_at else None,
            }
        )
    return {"items": items, "total": total, "limit": limit, "offset": offset, "has_more": offset + limit < total}
