"""Mini exams — personal, timed practice exams built from the course bank.

The AI (or the student) only *asks* for one: course, topics, difficulty, size.
Everything that matters for fairness lives here on the server:

* which questions are eligible (approved, visible, practice-enabled bank
  questions — never exam-only questions, never anything in a running exam),
* the timer (``deadline_at``; late answers are refused, overdue exams are
  closed automatically the next time anyone looks at them),
* grading (``Question.correct`` is the only source of truth),
* the result and its analysis (topic / difficulty / time breakdowns).

Correct answers and explanations are only sent once the exam is finished.
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AIMiniExam, AIMiniExamItem, Answer, Attempt, Config, Course, Question, Student

MIN_QUESTIONS = 3
MAX_QUESTIONS = 50
MAX_OPEN = 5  # ready + in-progress mini exams a student may hold at once
DAILY_CREATE_LIMIT = 20
GRACE_SECONDS = 5
LETTERS = ("A", "B", "C", "D")
WEAK_BELOW = 60.0
STRONG_FROM = 80.0


class MiniExamError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------ pool
def _options(q: Question) -> list[tuple[str, str]]:
    return [(letter, text) for letter, text in zip(LETTERS, (q.option_a, q.option_b, q.option_c, q.option_d)) if (text or "").strip()]


def _gradable(q: Question) -> bool:
    """Single-answer questions with at least two options and a valid key."""
    return len(_options(q)) >= 2 and (q.correct or "") in {letter for letter, _ in _options(q)}


def protected_ids(db: Session, student: Student) -> set[int]:
    """Questions in the student's running real exams stay out of mini exams."""
    now = utcnow()
    running = db.execute(select(Attempt).where(Attempt.student_id == student.id, Attempt.status == "in_progress", Attempt.deadline_at > now)).scalars().all()
    ids: set[int] = set()
    for attempt in running:
        ids.update(int(q) for q in (attempt.question_ids or []) if str(q).isdigit())
        ids.update(db.execute(select(Question.id).where(Question.quiz_id == attempt.quiz_id)).scalars())
    return ids


def eligible(db: Session, student: Student, *, course_id: int | None, topics: list[str] | None = None, difficulty: str = "") -> list[Question]:
    stmt = select(Question).where(
        Question.status == "approved",
        Question.visible.is_(True),
        Question.practice_enabled.is_(True),
        Question.exam_only.is_(False),
        Question.source_id.is_(None),
    )
    if course_id:
        stmt = stmt.where(Question.course_id == course_id)
    wanted = [t.strip().lower() for t in (topics or []) if t and t.strip()]
    if wanted:
        stmt = stmt.where(func.lower(Question.topic).in_(wanted))
    if difficulty in {"easy", "medium", "hard"}:
        stmt = stmt.where(Question.difficulty == difficulty)
    blocked = protected_ids(db, student)
    return [q for q in db.scalars(stmt.limit(3000)).all() if q.id not in blocked and _gradable(q)]


def _history(db: Session, student: Student) -> dict[int, dict]:
    """question_id -> {"seen": n, "wrong": n} from exams and earlier mini exams."""
    out: dict[int, dict] = defaultdict(lambda: {"seen": 0, "wrong": 0})
    rows = db.execute(
        select(Answer.question_id, Answer.is_correct).join(Attempt, Attempt.id == Answer.attempt_id)
        .where(Attempt.student_id == student.id, Answer.selected.is_not(None))
    ).all()
    rows += db.execute(
        select(AIMiniExamItem.question_id, AIMiniExamItem.is_correct).join(AIMiniExam, AIMiniExam.id == AIMiniExamItem.exam_id)
        .where(AIMiniExam.user_id == student.id, AIMiniExamItem.selected.is_not(None))
    ).all()
    for qid, ok in rows:
        out[qid]["seen"] += 1
        out[qid]["wrong"] += 0 if ok else 1
    return out


def choose(db: Session, student: Student, pool: list[Question], count: int, *, focus: str = "mixed", rng: random.Random | None = None) -> list[Question]:
    """Adaptive pick: missed-before first (focus=weak), unseen first (focus=new),
    otherwise a blend — then spread across topics round-robin."""
    rng = rng or random.Random()
    hist = _history(db, student)

    def rank(q: Question) -> tuple:
        h = hist.get(q.id, {"seen": 0, "wrong": 0})
        if focus == "weak":
            return (-h["wrong"], h["seen"] == 0, rng.random())
        if focus == "new":
            return (h["seen"] > 0, -h["wrong"], rng.random())
        return (h["seen"] > 0 and h["wrong"] == 0, rng.random())

    by_topic: dict[str, list[Question]] = defaultdict(list)
    for q in sorted(pool, key=rank):
        by_topic[(q.topic or "General").strip() or "General"].append(q)
    topics = list(by_topic)
    rng.shuffle(topics)
    picked: list[Question] = []
    while len(picked) < count and any(by_topic.values()):
        for topic in topics:
            if by_topic[topic] and len(picked) < count:
                picked.append(by_topic[topic].pop(0))
    rng.shuffle(picked)
    return picked


# ---------------------------------------------------------------- create
def default_minutes(count: int) -> int:
    return max(5, min(120, round(count * 1.2)))


def create(
    db: Session,
    student: Student,
    *,
    course_id: int | None,
    topics: list[str] | None = None,
    difficulty: str = "mixed",
    count: int = 10,
    minutes: int | None = None,
    title: str = "",
    focus: str = "mixed",
    question_ids: list[int] | None = None,
    created_by: str = "ai",
    conversation_id: int | None = None,
) -> AIMiniExam:
    course = db.get(Course, course_id) if course_id else None
    if course_id and (course is None or not course.is_active):
        raise MiniExamError("That course isn't available.", 404)
    count = max(MIN_QUESTIONS, min(MAX_QUESTIONS, int(count or 10)))
    difficulty = difficulty if difficulty in {"easy", "medium", "hard"} else "mixed"
    open_now = db.execute(select(func.count(AIMiniExam.id)).where(AIMiniExam.user_id == student.id, AIMiniExam.status.in_(["ready", "in_progress"]))).scalar_one()
    if open_now >= MAX_OPEN:
        raise MiniExamError(f"You already have {open_now} unfinished mini exams. Finish or delete one first.", 429)
    since = utcnow() - timedelta(days=1)
    today = db.execute(select(func.count(AIMiniExam.id)).where(AIMiniExam.user_id == student.id, AIMiniExam.created_at >= since)).scalar_one()
    cfg = db.get(Config, 1)
    daily = int(getattr(cfg, "ai_mini_exam_daily_limit", DAILY_CREATE_LIMIT) if cfg is not None else DAILY_CREATE_LIMIT)
    if today >= daily:
        raise MiniExamError("You've reached today's mini-exam limit. Try again tomorrow.", 429)

    pool = eligible(db, student, course_id=course_id, topics=topics, difficulty="" if difficulty == "mixed" else difficulty)
    if question_ids:
        allowed = {q.id: q for q in pool}
        chosen = [allowed[i] for i in dict.fromkeys(int(i) for i in question_ids if str(i).isdigit()) if i in allowed][:count]
        if len(chosen) < count:  # top up from the same pool
            rest = [q for q in pool if q.id not in {c.id for c in chosen}]
            chosen += choose(db, student, rest, count - len(chosen), focus=focus)
    else:
        chosen = choose(db, student, pool, count, focus=focus)
    if len(chosen) < MIN_QUESTIONS:
        scope = f"{course.code} " if course else ""
        extra = f" on {', '.join(topics)}" if topics else ""
        raise MiniExamError(f"There aren't enough {scope}practice questions{extra} yet (found {len(chosen)}). Try a wider topic or mixed difficulty.", 409)

    topic_names = sorted({(q.topic or "General") for q in chosen})
    label = title.strip()[:160] if title and title.strip() else f"{course.code + ' ' if course else ''}{(topics[0] if topics and len(topics) == 1 else 'Mixed topics')} — mini exam"
    exam = AIMiniExam(
        user_id=student.id, course_id=course.id if course else None, conversation_id=conversation_id, created_by=created_by if created_by in {"ai", "student"} else "ai",
        title=label, topics=topic_names[:12], difficulty=difficulty, question_count=len(chosen),
        duration_minutes=max(3, min(180, int(minutes or default_minutes(len(chosen))))), status="ready",
    )
    db.add(exam)
    db.flush()
    for position, q in enumerate(chosen):
        db.add(AIMiniExamItem(exam_id=exam.id, question_id=q.id, position=position, marks=max(1, int(q.points or 1))))
    db.flush()
    db.refresh(exam)
    return exam


# ----------------------------------------------------------- life cycle
def owned(db: Session, student: Student, exam_id: int) -> AIMiniExam:
    exam = db.get(AIMiniExam, exam_id)
    if exam is None or exam.user_id != student.id:
        raise MiniExamError("Mini exam not found.", 404)
    settle(db, exam)
    return exam


def settle(db: Session, exam: AIMiniExam) -> None:
    """Close an overdue exam (the timer lives on the server, not the phone)."""
    if exam.status == "in_progress" and exam.deadline_at and utcnow() > exam.deadline_at + timedelta(seconds=GRACE_SECONDS):
        finish(db, exam, reason="timer")


def start(db: Session, student: Student, exam: AIMiniExam) -> AIMiniExam:
    if exam.status == "in_progress":
        return exam
    if exam.status != "ready":
        raise MiniExamError("This mini exam is already finished.", 409)
    if protected_ids(db, student):
        raise MiniExamError("Finish your running exam first — mini exams wait until you submit it.", 423)
    now = utcnow()
    exam.status = "in_progress"
    exam.started_at = now
    exam.deadline_at = now + timedelta(minutes=exam.duration_minutes)
    db.flush()
    return exam


def answer(db: Session, exam: AIMiniExam, question_id: int, selected: str | None, seconds: float = 0.0) -> AIMiniExamItem:
    if exam.status != "in_progress":
        raise MiniExamError("This mini exam isn't running.", 409)
    item = next((i for i in exam.items if i.question_id == question_id), None)
    if item is None:
        raise MiniExamError("That question isn't in this exam.", 404)
    choice = (selected or "").strip().upper()[:1] or None
    if choice and choice not in LETTERS:
        raise MiniExamError("Pick A, B, C or D.", 422)
    item.selected = choice
    # the app reports the total time spent on this question so far
    item.seconds_spent = round(max(item.seconds_spent or 0.0, min(max(float(seconds or 0), 0.0), 3600.0)), 1)
    item.answered_at = utcnow()
    db.flush()
    return item


def finish(db: Session, exam: AIMiniExam, *, reason: str = "early") -> AIMiniExam:
    if exam.status in {"submitted", "expired"}:
        return exam
    questions = {q.id: q for q in db.scalars(select(Question).where(Question.id.in_([i.question_id for i in exam.items]))).all()}
    score = total = 0
    for item in exam.items:
        q = questions.get(item.question_id)
        item.is_correct = bool(q and item.selected and item.selected == (q.correct or ""))
        total += item.marks
        score += item.marks if item.is_correct else 0
    exam.score, exam.total = score, total
    exam.percentage = round(score / total * 100, 1) if total else 0.0
    exam.finished_at = utcnow()
    exam.status = "submitted" if exam.started_at else "expired"
    exam.analysis = {**analyse(db, exam, questions), "submission": reason}
    db.flush()
    return exam


# -------------------------------------------------------------- analysis
def analyse(db: Session, exam: AIMiniExam, questions: dict[int, Question] | None = None) -> dict:
    """Deterministic breakdown — the AI explains it, but never invents it."""
    questions = questions or {q.id: q for q in db.scalars(select(Question).where(Question.id.in_([i.question_id for i in exam.items]))).all()}
    topic: dict[str, dict] = defaultdict(lambda: {"correct": 0, "total": 0, "wrong": 0, "skipped": 0})
    level: dict[str, dict] = defaultdict(lambda: {"correct": 0, "total": 0})
    mistakes, times = [], []
    skipped = 0
    for item in exam.items:
        q = questions.get(item.question_id)
        if q is None:
            continue
        name = (q.topic or "General").strip() or "General"
        topic[name]["total"] += 1
        level[q.difficulty or "medium"]["total"] += 1
        if item.selected is None:
            skipped += 1
            topic[name]["skipped"] += 1
        elif item.is_correct:
            topic[name]["correct"] += 1
            level[q.difficulty or "medium"]["correct"] += 1
        else:
            topic[name]["wrong"] += 1
        if item.seconds_spent:
            times.append(item.seconds_spent)
        if not item.is_correct:
            opts = dict(_options(q))
            mistakes.append({
                "question_id": q.id, "topic": name, "subtopic": q.subtopic or "", "difficulty": q.difficulty,
                "question": (q.text or "")[:220], "chosen": item.selected, "chosen_text": opts.get(item.selected or "", "")[:120],
                "correct": q.correct, "correct_text": opts.get(q.correct or "", "")[:120], "objective": q.objective or "",
            })
    pct = lambda d: round(d["correct"] / d["total"] * 100, 1) if d["total"] else 0.0  # noqa: E731
    topics = sorted(({"topic": k, **v, "percentage": pct(v)} for k, v in topic.items()), key=lambda r: r["percentage"])
    weak = [t["topic"] for t in topics if t["total"] >= 1 and t["percentage"] < WEAK_BELOW][:4]
    strong = [t["topic"] for t in reversed(topics) if t["total"] >= 2 and t["percentage"] >= STRONG_FROM][:4]
    previous = db.execute(
        select(AIMiniExam.percentage).where(AIMiniExam.user_id == exam.user_id, AIMiniExam.id != exam.id, AIMiniExam.status == "submitted", AIMiniExam.course_id == exam.course_id)
        .order_by(AIMiniExam.finished_at.desc()).limit(1)
    ).scalar_one_or_none()
    actions = []
    for name in weak[:2]:
        actions.append({"type": "review", "topic": name, "label": f"Review {name}"})
        actions.append({"type": "mini_exam", "topic": name, "label": f"Take 10 targeted questions on {name}"})
    if weak:
        actions.append({"type": "flashcards", "topic": weak[0], "label": f"Make flashcards for {weak[0]}"})
    if not weak and exam.percentage >= STRONG_FROM:
        actions.append({"type": "mini_exam", "topic": "", "label": "Try a harder mini exam"})
    return {
        "score": exam.score, "total": exam.total, "percentage": exam.percentage,
        "correct": sum(1 for i in exam.items if i.is_correct), "wrong": sum(1 for i in exam.items if i.selected and not i.is_correct), "skipped": skipped,
        "questions": len(exam.items),
        "topics": topics, "difficulty": [{"level": k, **v, "percentage": pct(v)} for k, v in sorted(level.items())],
        "weak_topics": weak, "strong_topics": strong,
        "avg_seconds": round(sum(times) / len(times), 1) if times else None,
        "time_used_seconds": int((exam.finished_at - exam.started_at).total_seconds()) if exam.finished_at and exam.started_at else None,
        "previous_percentage": previous, "change": round(exam.percentage - previous, 1) if previous is not None else None,
        "mistakes": mistakes[:25],
        "recommended_actions": actions,
    }


NARRATIVE_PROMPT = """You are the Absolute Genesis AI tutor writing feedback on a finished mini exam.
Use ONLY the analysis JSON provided. Never invent scores, topics or questions.
Reply as JSON: {"headline": "one short encouraging sentence with the score",
"summary": "2-4 sentences: what went well, the main weakness, and why",
"mistake_patterns": ["short pattern seen across the wrong answers", ...],
"recommended_actions": ["specific next step", ...]}
Keep it warm, specific and brief. Max 3 mistake patterns and 4 actions."""


def narrative_messages(exam: AIMiniExam, course_label: str) -> list[dict]:
    data = {k: v for k, v in (exam.analysis or {}).items() if k not in {"ai"}}
    data["title"] = exam.title
    data["course"] = course_label
    return [{"role": "system", "content": NARRATIVE_PROMPT}, {"role": "user", "content": json.dumps(data)[:12000]}]


# --------------------------------------------------------------- payload
def payload(db: Session, exam: AIMiniExam, *, questions: bool = True) -> dict:
    finished = exam.status in {"submitted", "expired"}
    course = db.get(Course, exam.course_id) if exam.course_id else None
    out: dict[str, Any] = {
        "id": exam.id, "title": exam.title, "status": exam.status, "created_by": exam.created_by,
        "course": {"id": course.id, "code": course.code, "title": course.title} if course else None,
        "topics": exam.topics or [], "difficulty": exam.difficulty, "question_count": exam.question_count,
        "duration_minutes": exam.duration_minutes,
        "started_at": exam.started_at.isoformat() if exam.started_at else None,
        "deadline_at": exam.deadline_at.isoformat() if exam.deadline_at else None,
        "finished_at": exam.finished_at.isoformat() if exam.finished_at else None,
        "seconds_left": max(0, int((exam.deadline_at - utcnow()).total_seconds())) if exam.status == "in_progress" and exam.deadline_at else None,
        "answered": sum(1 for i in exam.items if i.selected),
        "created_at": exam.created_at.isoformat() if exam.created_at else None,
    }
    if finished:
        out.update({"score": exam.score, "total": exam.total, "percentage": exam.percentage, "analysis": exam.analysis or {}})
    if questions and exam.status != "ready":
        qs = {q.id: q for q in db.scalars(select(Question).where(Question.id.in_([i.question_id for i in exam.items]))).all()}
        rows = []
        for item in exam.items:
            q = qs.get(item.question_id)
            if q is None:
                continue
            row: dict[str, Any] = {
                "question_id": q.id, "position": item.position, "text": q.text, "image_url": (q.media or {}).get("image_url") or (q.media or {}).get("image") or None,
                "options": [{"key": k, "text": t} for k, t in _options(q)], "topic": q.topic or "", "difficulty": q.difficulty,
                "marks": item.marks, "selected": item.selected,
            }
            if finished:
                row.update({"correct": q.correct, "is_correct": item.is_correct, "explanation": q.explanation or ""})
            rows.append(row)
        out["questions"] = rows
    return out


def list_for(db: Session, student: Student, limit: int = 30) -> list[dict]:
    exams = db.execute(select(AIMiniExam).where(AIMiniExam.user_id == student.id).order_by(AIMiniExam.created_at.desc()).limit(limit)).scalars().all()
    for exam in exams:
        settle(db, exam)
    return [payload(db, e, questions=False) for e in exams]
