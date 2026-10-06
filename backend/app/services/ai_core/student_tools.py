"""Tools the tutor may use on behalf of a signed-in student.

Everything is scoped to ``ctx.student``: a student's AI can read the public
course catalogue, published materials, question *stems* in the bank, and that
student's own progress and results — nothing belonging to anyone else, and no
answer keys for questions the student hasn't answered yet (so the bank that
feeds random exams can't be farmed through the chat).

The only write a student tool can do is create a personal mini exam.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select

from ...models import (
    AIFlashcard,
    AIFlashcardDeck,
    AILearningProfile,
    AIMiniExam,
    AIMiniExamItem,
    Answer,
    Attempt,
    Course,
    CourseTopic,
    FlashcardCard,
    Material,
    PracticeRun,
    Question,
    Quiz,
)
from .. import ai_tutor as tutor
from .. import mini_exam
from .registry import STAFF_ROLES, STUDENT, ToolContext, ToolError, tool

ANY = {STUDENT}
COURSE_ID = {"type": "integer", "description": "Course id (from list_my_courses).", "minimum": 1}


def _course(ctx: ToolContext, course_id: int | None) -> Course:
    cid = course_id or ctx.course_hint
    course = ctx.db.get(Course, cid) if cid else None
    if course is None or (not course.is_active and ctx.role not in STAFF_ROLES):
        raise ToolError("Course not found. Call list_my_courses to get valid ids.")
    return course


def _answered_ids(ctx: ToolContext) -> set[int]:
    sid = ctx.student.id
    ids = set(ctx.db.execute(select(Answer.question_id).join(Attempt, Attempt.id == Answer.attempt_id).where(Attempt.student_id == sid, Attempt.status != "in_progress", Answer.selected.is_not(None))).scalars())
    ids |= set(ctx.db.execute(select(AIMiniExamItem.question_id).join(AIMiniExam, AIMiniExam.id == AIMiniExamItem.exam_id).where(AIMiniExam.user_id == sid, AIMiniExam.status == "submitted")).scalars())
    return ids


def _bank_filter(stmt):
    return stmt.where(Question.status == "approved", Question.visible.is_(True), Question.exam_only.is_(False), Question.source_id.is_(None))


# ------------------------------------------------------------------ profile
@tool("get_my_profile", description="The student's name, study preferences (style, level, language, goals) and overall accuracy.", roles=ANY, label="Reading your profile")
def get_my_profile(ctx: ToolContext, args: dict) -> dict:
    s = ctx.student
    prof = ctx.db.get(AILearningProfile, s.id)
    summary = tutor.progress_summary(ctx.db, s)
    return {
        "name": s.name or s.username, "level": s.level,
        "preferences": {"style": prof.explanation_style, "level": prof.difficulty, "language": prof.language, "goals": prof.goals} if prof else None,
        "overall_accuracy": summary.get("accuracy"), "questions_answered": summary.get("attempted"),
    }


@tool("list_my_courses", description="Courses available on the platform with ids, codes, topic counts and practice-question counts. Call this first to resolve a course name like 'English' or 'MTH 101' to an id.", roles=ANY | STAFF_ROLES, label="Looking up courses")
def list_my_courses(ctx: ToolContext, args: dict) -> dict:
    db = ctx.db
    courses = db.execute(select(Course).where(Course.is_active.is_(True)).order_by(Course.code)).scalars().all()
    topics = dict(db.execute(select(CourseTopic.course_id, func.count(CourseTopic.id)).group_by(CourseTopic.course_id)).all())
    bank = dict(db.execute(_bank_filter(select(Question.course_id, func.count(Question.id))).where(Question.practice_enabled.is_(True)).group_by(Question.course_id)).all())
    return {"courses": [{"id": c.id, "code": c.code, "title": c.title, "topics": topics.get(c.id, 0), "practice_questions": bank.get(c.id, 0)} for c in courses]}


@tool(
    "get_course_topics",
    description="Topics of one course with how many practice questions each has and (for students) the student's accuracy per topic.",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID}, "required": ["course_id"]},
    roles=ANY | STAFF_ROLES, label="Checking course topics",
)
def get_course_topics(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args.get("course_id"))
    db = ctx.db
    curated = db.execute(select(CourseTopic).where(CourseTopic.course_id == course.id).order_by(CourseTopic.position, CourseTopic.name)).scalars().all()
    counts = dict(db.execute(_bank_filter(select(Question.topic, func.count(Question.id))).where(Question.course_id == course.id).group_by(Question.topic)).all())
    accuracy = {}
    if ctx.student:
        for row in tutor.refresh_topic_progress(db, ctx.student):
            if row.course_id == course.id:
                accuracy[row.topic.lower()] = {"accuracy": row.accuracy, "attempted": row.attempted}
    names = [t.name for t in curated] + sorted(n for n in counts if n and n.lower() not in {t.name.lower() for t in curated})
    desc = {t.name: t.description for t in curated}
    return {
        "course": {"id": course.id, "code": course.code, "title": course.title},
        "topics": [{"name": n, "description": desc.get(n, "")[:160], "questions": counts.get(n, 0), **({"mine": accuracy[n.lower()]} if n.lower() in accuracy else {})} for n in names][:60],
    }


# ---------------------------------------------------------------- materials
@tool(
    "search_course_material",
    description="Search the platform's official course materials and return the most relevant passages (with material and section). Use this before answering course-specific questions so answers are grounded in the real material.",
    parameters={"type": "object", "properties": {"query": {"type": "string", "maxLength": 300}, "course_id": COURSE_ID, "max_passages": {"type": "integer", "minimum": 1, "maximum": 6}}, "required": ["query"]},
    roles=ANY | STAFF_ROLES, label="Searching course materials",
)
def search_course_material(ctx: ToolContext, args: dict) -> dict:
    db = ctx.db
    cid = args.get("course_id") or ctx.course_hint
    stmt = select(Material).where(Material.kind != "folder")
    if ctx.role not in STAFF_ROLES:
        stmt = stmt.where(Material.status == "published")
    if cid:
        stmt = stmt.where(Material.course_id == cid)
    materials = db.execute(stmt.order_by(Material.updated_at.desc()).limit(40)).scalars().all()
    chunks = []
    ids = {}
    for m in materials:
        for c in tutor._material_chunks(db, m):
            c["material_id"] = m.id
            chunks.append(c)
        ids[m.id] = m.title
    picked = tutor.retrieve(chunks, args["query"], limit_chars=5000)[: args.get("max_passages", 4)]
    return {
        "passages": [{"material_id": c.get("material_id"), "material": c["source"].replace("Material: ", ""), "section": c["section"], "section_title": c["title"], "text": c["text"][:1400]} for c in picked],
        "summary": f"{len(picked)} passages from {len({c.get('material_id') for c in picked})} materials" if picked else "no matching material",
    }


# ------------------------------------------------------------ question bank
@tool(
    "search_question_bank",
    description="Find practice questions in a course's question bank by topic, difficulty or keywords. Returns ids, question stems, topic and difficulty (never answers). Use it to check what's available before building a mini exam.",
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID, "topic": {"type": "string", "maxLength": 120}, "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "query": {"type": "string", "maxLength": 200}, "limit": {"type": "integer", "minimum": 1, "maximum": 30},
    }, "required": ["course_id"]},
    roles=ANY, label="Searching the question bank",
)
def search_question_bank(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args.get("course_id"))
    stmt = _bank_filter(select(Question)).where(Question.course_id == course.id, Question.practice_enabled.is_(True))
    if args.get("topic"):
        stmt = stmt.where(func.lower(Question.topic) == args["topic"].lower())
    if args.get("difficulty"):
        stmt = stmt.where(Question.difficulty == args["difficulty"])
    if args.get("query"):
        for word in args["query"].split()[:5]:
            stmt = stmt.where(Question.text.ilike(f"%{word}%"))
    total = ctx.db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = ctx.db.execute(stmt.limit(args.get("limit", 12))).scalars().all()
    return {"total_matching": total, "questions": [{"id": q.id, "text": (q.text or "")[:200], "topic": q.topic or "General", "difficulty": q.difficulty} for q in rows]}


@tool(
    "get_question",
    description="One question with its options. The correct answer and explanation are included only if the student has already answered this question before and it isn't protected by a running exam.",
    parameters={"type": "object", "properties": {"question_id": {"type": "integer", "minimum": 1}}, "required": ["question_id"]},
    roles=ANY, label="Opening the question",
)
def get_question(ctx: ToolContext, args: dict) -> dict:
    q = ctx.db.get(Question, args["question_id"])
    if q is None or q.status != "approved" or not q.visible:
        raise ToolError("Question not found.")
    if tutor.question_protected(ctx.db, ctx.student, q, ctx.policy or None):
        return {"id": q.id, "protected": True, "note": "This question belongs to an exam the student can still sit. Help with the underlying concept only."}
    out = {"id": q.id, "text": q.text, "topic": q.topic, "difficulty": q.difficulty, "options": {k: v for k, v in zip("ABCD", (q.option_a, q.option_b, q.option_c, q.option_d)) if v}}
    if q.id in _answered_ids(ctx):
        out.update({"correct": q.correct, "explanation": q.explanation or ""})
    else:
        out["note"] = "The student hasn't answered this yet — don't reveal the answer; guide them instead."
    return out


# ------------------------------------------------------------------ progress
@tool(
    "get_my_progress",
    description="The student's real performance: accuracy per topic, weak and strong topics, repeated mistakes, flashcards due, recent scores and upcoming exams.",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID}},
    roles=ANY, label="Checking your progress",
)
def get_my_progress(ctx: ToolContext, args: dict) -> dict:
    data = tutor.progress_summary(ctx.db, ctx.student, args.get("course_id"))
    data.pop("thresholds", None)
    return data


@tool(
    "get_exam_history",
    description="The student's finished exams and mini exams (newest first) with scores. Use the returned kind + id with get_exam_result.",
    parameters={"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 20}}},
    roles=ANY, label="Looking at your exam history",
)
def get_exam_history(ctx: ToolContext, args: dict) -> dict:
    limit = args.get("limit", 8)
    db = ctx.db
    exams = db.execute(
        select(Attempt, Quiz.title).join(Quiz, Quiz.id == Attempt.quiz_id)
        .where(Attempt.student_id == ctx.student.id, Attempt.status != "in_progress").order_by(Attempt.submitted_at.desc()).limit(limit)
    ).all()
    minis = db.execute(select(AIMiniExam).where(AIMiniExam.user_id == ctx.student.id, AIMiniExam.status == "submitted").order_by(AIMiniExam.finished_at.desc()).limit(limit)).scalars().all()
    rows = [{"kind": "exam", "id": a.id, "title": t, "percentage": round(a.percentage or 0, 1), "score": a.score, "at": a.submitted_at.isoformat() if a.submitted_at else None} for a, t in exams]
    rows += [{"kind": "mini_exam", "id": m.id, "title": m.title, "percentage": m.percentage, "score": m.score, "total": m.total, "at": m.finished_at.isoformat() if m.finished_at else None} for m in minis]
    rows.sort(key=lambda r: r["at"] or "", reverse=True)
    return {"results": rows[:limit]}


@tool(
    "get_exam_result",
    description="Breakdown of one finished exam or mini exam: score, accuracy per topic and difficulty, weak/strong topics, and (mini exams) the wrong answers.",
    parameters={"type": "object", "properties": {"kind": {"type": "string", "enum": ["exam", "mini_exam"]}, "id": {"type": "integer", "minimum": 1}}, "required": ["kind", "id"]},
    roles=ANY, label="Reading the result",
)
def get_exam_result(ctx: ToolContext, args: dict) -> dict:
    db = ctx.db
    if args["kind"] == "mini_exam":
        exam = db.get(AIMiniExam, args["id"])
        if exam is None or exam.user_id != ctx.student.id:
            raise ToolError("Mini exam not found.")
        mini_exam.settle(db, exam)
        if exam.status not in {"submitted", "expired"}:
            return {"id": exam.id, "status": exam.status, "note": "Not finished yet."}
        analysis = {k: v for k, v in (exam.analysis or {}).items() if k != "ai"}
        return {"id": exam.id, "title": exam.title, **analysis}
    attempt = db.get(Attempt, args["id"])
    if attempt is None or attempt.student_id != ctx.student.id or attempt.status == "in_progress":
        raise ToolError("Result not found.")
    rows = db.execute(select(Answer.is_correct, Answer.selected, Question.topic, Question.difficulty).join(Question, Question.id == Answer.question_id).where(Answer.attempt_id == attempt.id)).all()
    topics: dict[str, list[int]] = {}
    for ok, selected, topic, _ in rows:
        entry = topics.setdefault(topic or "General", [0, 0])
        entry[1] += 1
        entry[0] += 1 if ok else 0
    quiz = db.get(Quiz, attempt.quiz_id)
    breakdown = sorted(({"topic": k, "correct": v[0], "total": v[1], "percentage": round(v[0] / v[1] * 100, 1)} for k, v in topics.items()), key=lambda r: r["percentage"])
    return {
        "id": attempt.id, "exam": quiz.title if quiz else "Exam", "percentage": round(attempt.percentage or 0, 1), "score": attempt.score, "grade": attempt.grade,
        "correct": attempt.correct_count, "wrong": attempt.wrong_count, "unanswered": attempt.unanswered_count, "topics": breakdown,
        "weak_topics": [r["topic"] for r in breakdown if r["percentage"] < 60][:4], "strong_topics": [r["topic"] for r in reversed(breakdown) if r["percentage"] >= 80][:4],
        "note": "Answer keys for official exams are not shared through the tutor.",
    }


@tool("get_recent_activity", description="What the student did recently: exams, mini exams, practice runs and flashcards due.", roles=ANY, label="Checking recent activity")
def get_recent_activity(ctx: ToolContext, args: dict) -> dict:
    db, sid = ctx.db, ctx.student.id
    since = mini_exam.utcnow() - timedelta(days=14)
    practice = db.execute(select(PracticeRun).where(PracticeRun.student_id == sid, PracticeRun.created_at >= since).order_by(PracticeRun.created_at.desc()).limit(6)).scalars().all()
    due_ai = db.execute(select(func.count(AIFlashcard.id)).join(AIFlashcardDeck, AIFlashcardDeck.id == AIFlashcard.deck_id).where(AIFlashcardDeck.user_id == sid, AIFlashcard.next_review_at <= mini_exam.utcnow())).scalar_one()
    due_cards = db.execute(select(func.count(FlashcardCard.id)).where(FlashcardCard.student_id == sid, FlashcardCard.due_on.is_not(None), FlashcardCard.due_on <= mini_exam.utcnow().date())).scalar_one()
    history = get_exam_history(ctx, {"limit": 5})["results"]
    return {
        "recent_results": history,
        "practice_runs": [{"topic": p.topic or "Mixed", "correct": p.correct, "total": p.total, "at": p.created_at.isoformat()} for p in practice],
        "flashcards_due": int(due_ai or 0) + int(due_cards or 0),
    }


# ---------------------------------------------------------------- mini exams
@tool(
    "create_mini_exam",
    description=(
        "Create a real, timed mini exam for the student from the course question bank. The backend picks and grades the questions; "
        "the app shows the student a Start button. ALWAYS use this when the student asks for a test, quiz, mock or exam — never write test questions in chat. "
        "focus='weak' prefers questions they got wrong before, 'new' prefers unseen ones."
    ),
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID,
        "topics": {"type": "array", "items": {"type": "string", "maxLength": 120}, "maxItems": 6, "description": "Exact topic names from get_course_topics; empty = whole course."},
        "difficulty": {"type": "string", "enum": ["mixed", "easy", "medium", "hard"]},
        "question_count": {"type": "integer", "minimum": 3, "maximum": 50},
        "duration_minutes": {"type": "integer", "minimum": 3, "maximum": 120, "description": "Optional; default about 1.2 minutes per question."},
        "focus": {"type": "string", "enum": ["mixed", "weak", "new"]},
        "title": {"type": "string", "maxLength": 120},
        "question_ids": {"type": "array", "items": {"type": "integer"}, "maxItems": 50, "description": "Optional hand-picked ids from search_question_bank."},
    }, "required": ["course_id", "question_count"]},
    roles=ANY, label="Building your mini exam", writes=True,
)
def create_mini_exam(ctx: ToolContext, args: dict) -> dict:
    if ctx.policy.get("active"):
        raise ToolError("The student has an exam running right now — mini exams are unavailable until they submit it.")
    course = _course(ctx, args.get("course_id"))
    try:
        exam = mini_exam.create(
            ctx.db, ctx.student, course_id=course.id, topics=args.get("topics") or None, difficulty=args.get("difficulty", "mixed"),
            count=args.get("question_count", 10), minutes=args.get("duration_minutes"), title=args.get("title", ""), focus=args.get("focus", "mixed"),
            question_ids=args.get("question_ids") or None, created_by="ai", conversation_id=ctx.conversation_id,
        )
    except mini_exam.MiniExamError as error:
        raise ToolError(error.message) from error
    card = {"type": "mini_exam", "id": exam.id, "title": exam.title, "question_count": exam.question_count, "duration_minutes": exam.duration_minutes, "difficulty": exam.difficulty, "topics": exam.topics, "course": course.code}
    ctx.actions.append(card)
    short = exam.question_count < args.get("question_count", 10)
    return {
        "created": True, **card,
        "summary": f"Mini exam #{exam.id} ready: {exam.question_count} questions, {exam.duration_minutes} min",
        "note": ("Only %d matching questions were available." % exam.question_count if short else "") + " The app shows a Start button under your reply — don't list the questions.",
    }
