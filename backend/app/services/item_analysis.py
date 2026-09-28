"""Question (item) analysis for staff — which questions work, and which need fixing.

For every question answered in submitted attempts of an exam (or of every exam
in a course, which is what matters for random course-bank papers) we report:

* **correct rate** — share of students who saw it and got it right;
* **option picks** — how many chose each option (canonical keys, so shuffling
  does not scramble the counts), plus how many left it blank;
* **discrimination** — correct rate in the top 27% of papers minus the bottom
  27%. Good questions are answered correctly more often by strong students.
  Near zero means the question does not separate them; negative usually means
  the answer key is wrong or the wording misleads the best students.

Flags are hints for a human, never automatic changes:

* ``check_key``  — a wrong option is picked more than the key by the top group,
  or discrimination is clearly negative → the key may be wrong;
* ``too_easy`` / ``too_hard`` — correct rate ≥ 90% / ≤ 20%;
* ``weak`` — barely separates strong from weak students;
* ``unused_option`` — an option nobody picks (a distractor doing no work).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Answer, Attempt, Question, Quiz

MIN_FOR_FLAGS = 5  # fewer answers than this → report numbers, raise no flags
LETTERS = ("A", "B", "C", "D")


def _attempts(db: Session, *, quiz_id: int | None, course_id: int | None) -> list[Attempt]:
    query = select(Attempt).where(Attempt.status == "submitted")
    if quiz_id is not None:
        query = query.where(Attempt.quiz_id == quiz_id)
    elif course_id is not None:
        query = query.join(Quiz, Quiz.id == Attempt.quiz_id).where(Quiz.course_id == course_id, Quiz.is_bank.is_(False))
    else:  # pragma: no cover - guarded by the router
        return []
    return list(db.scalars(query).all())


def analyze(db: Session, *, quiz_id: int | None = None, course_id: int | None = None) -> dict[str, Any]:
    attempts = _attempts(db, quiz_id=quiz_id, course_id=course_id)
    if not attempts:
        return {"attempts": 0, "questions": [], "summary": {"flagged": 0, "check_key": 0, "questions": 0}}

    # Which questions each attempt was shown (dealt list, or the whole legacy quiz).
    legacy_cache: dict[int, list[int]] = {}
    seen_by: dict[int, list[int]] = {}
    for attempt in attempts:
        dealt = [int(qid) for qid in (attempt.question_ids or [])]
        if not dealt:
            if attempt.quiz_id not in legacy_cache:
                legacy_cache[attempt.quiz_id] = list(
                    db.scalars(select(Question.id).where(Question.quiz_id == attempt.quiz_id)).all()
                )
            dealt = legacy_cache[attempt.quiz_id]
        seen_by[attempt.id] = dealt

    # Top / bottom 27% of papers by percentage (at least one paper each when n ≥ 2).
    ranked = sorted(attempts, key=lambda a: (a.percentage or 0.0), reverse=True)
    cut = max(1, round(len(ranked) * 0.27)) if len(ranked) >= 2 else 0
    top_ids = {a.id for a in ranked[:cut]}
    bottom_ids = {a.id for a in ranked[-cut:]} if cut else set()

    attempt_ids = [a.id for a in attempts]
    answers: dict[tuple[int, int], Answer] = {}
    for chunk_start in range(0, len(attempt_ids), 500):
        chunk = attempt_ids[chunk_start : chunk_start + 500]
        for row in db.scalars(select(Answer).where(Answer.attempt_id.in_(chunk))).all():
            answers[(row.attempt_id, row.question_id)] = row

    stats: dict[int, dict[str, Any]] = defaultdict(
        lambda: {"seen": 0, "correct": 0, "blank": 0, "picks": defaultdict(int),
                 "top_seen": 0, "top_correct": 0, "bottom_seen": 0, "bottom_correct": 0,
                 "top_picks": defaultdict(int), "seconds": 0.0, "timed": 0}
    )
    for attempt in attempts:
        for qid in seen_by[attempt.id]:
            item = stats[qid]
            item["seen"] += 1
            row = answers.get((attempt.id, qid))
            picked = (row.selected or "").upper() if row else ""
            correct = bool(row.is_correct) if row and picked else False
            if picked:
                item["picks"][picked] += 1
                if row.seconds_spent:
                    item["seconds"] += float(row.seconds_spent)
                    item["timed"] += 1
            else:
                item["blank"] += 1
            if correct:
                item["correct"] += 1
            if attempt.id in top_ids:
                item["top_seen"] += 1
                item["top_correct"] += int(correct)
                if picked:
                    item["top_picks"][picked] += 1
            if attempt.id in bottom_ids:
                item["bottom_seen"] += 1
                item["bottom_correct"] += int(correct)

    questions = {q.id: q for q in db.scalars(select(Question).where(Question.id.in_(list(stats)))).all()}
    rows: list[dict[str, Any]] = []
    for qid, item in stats.items():
        question = questions.get(qid)
        if question is None:
            continue
        seen = item["seen"]
        rate = item["correct"] / seen if seen else 0.0
        p_top = item["top_correct"] / item["top_seen"] if item["top_seen"] else None
        p_bottom = item["bottom_correct"] / item["bottom_seen"] if item["bottom_seen"] else None
        discrimination = round(p_top - p_bottom, 2) if p_top is not None and p_bottom is not None else None
        options = {k: v for k, v in question.options.items() if (v or "").strip()} if question.question_type == "mcq" or question.options else {}
        key = (question.correct or "").upper()[:1]
        picks = {k: int(item["picks"].get(k, 0)) for k in LETTERS if k in options}

        flags: list[str] = []
        answered = seen - item["blank"]
        if seen >= MIN_FOR_FLAGS:
            top_picks = item["top_picks"]
            top_key = top_picks.get(key, 0)
            strong_distractor = [k for k in picks if k != key and top_picks.get(k, 0) > top_key and top_picks.get(k, 0) >= 2]
            if strong_distractor or (discrimination is not None and discrimination <= -0.2):
                flags.append("check_key")
            if rate >= 0.9:
                flags.append("too_easy")
            elif rate <= 0.2:
                flags.append("too_hard")
            if discrimination is not None and -0.2 < discrimination < 0.1 and "check_key" not in flags and rate < 0.9:
                flags.append("weak")
            if answered >= 10 and options and any(picks.get(k, 0) == 0 for k in options if k != key):
                flags.append("unused_option")

        rows.append(
            {
                "id": qid,
                "text": question.text[:280],
                "topic": question.topic or "",
                "difficulty": question.difficulty,
                "correct": key,
                "options": {k: (v or "")[:160] for k, v in options.items()},
                "seen": seen,
                "answered": answered,
                "blank": item["blank"],
                "correct_rate": round(rate, 3),
                "picks": picks,
                "discrimination": discrimination,
                "avg_seconds": round(item["seconds"] / item["timed"], 1) if item["timed"] else None,
                "flags": flags,
            }
        )

    severity = {"check_key": 0, "too_hard": 1, "weak": 2, "too_easy": 3, "unused_option": 4}
    rows.sort(key=lambda r: (min([severity.get(f, 9) for f in r["flags"]] or [9]), r["correct_rate"], -r["seen"]))
    return {
        "attempts": len(attempts),
        "questions": rows,
        "summary": {
            "questions": len(rows),
            "flagged": sum(1 for r in rows if r["flags"]),
            "check_key": sum(1 for r in rows if "check_key" in r["flags"]),
        },
    }
