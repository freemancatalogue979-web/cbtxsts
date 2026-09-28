"""Tools for the staff AI assistant.

Staff tools read freely across courses (drafts included) but every *change*
is a proposal: ``propose_*`` tools only store an :class:`AIProposal`. A staff
member reviews it in the console and approves (optionally trimming/editing) —
only then does :mod:`proposals` write official content. There are no delete,
publish, grading or permission tools at all.
"""

from __future__ import annotations

import re
from collections import Counter

from sqlalchemy import func, or_, select

from ...models import AIProposal, Attempt, Course, CourseTopic, Material, MaterialSection, Question, Quiz, Student
from .. import ai_tutor as tutor
from .. import item_analysis
from ..questions import bank_health, duplicate_pairs
from .registry import STAFF_ROLES, ToolContext, ToolError, tool
from .student_tools import COURSE_ID, _course

STAFF = STAFF_ROLES
MAX_PROPOSED_QUESTIONS = 40
MAX_PROPOSED_TOPICS = 30
MAX_CLASSIFICATIONS = 120


def _bank(course_id: int):
    return select(Question).where(Question.course_id == course_id, Question.source_id.is_(None), Question.exam_only.is_(False))


# ------------------------------------------------------------------ reading
@tool(
    "get_course_overview",
    description="A course's materials (with ids and status), exams, curated topics and question-bank size by difficulty.",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID}, "required": ["course_id"]},
    roles=STAFF, label="Reading the course",
)
def get_course_overview(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    db = ctx.db
    materials = db.execute(select(Material).where(Material.course_id == course.id, Material.kind != "folder").order_by(Material.title)).scalars().all()
    sections = dict(db.execute(select(MaterialSection.material_id, func.count(MaterialSection.id)).group_by(MaterialSection.material_id)).all())
    exams = db.execute(select(Quiz).where(Quiz.course_id == course.id, Quiz.is_bank.is_(False)).order_by(Quiz.created_at.desc()).limit(20)).scalars().all()
    topics = db.execute(select(CourseTopic).where(CourseTopic.course_id == course.id).order_by(CourseTopic.position)).scalars().all()
    levels = dict(db.execute(select(Question.difficulty, func.count(Question.id)).where(Question.course_id == course.id, Question.source_id.is_(None), Question.exam_only.is_(False)).group_by(Question.difficulty)).all())
    return {
        "course": {"id": course.id, "code": course.code, "title": course.title, "active": course.is_active},
        "materials": [{"id": m.id, "title": m.title, "status": m.status, "topic": m.topic, "sections": sections.get(m.id, 0)} for m in materials],
        "exams": [{"id": q.id, "title": q.title, "status": q.status, "source": q.question_source, "draw_count": q.draw_count} for q in exams],
        "topics": [{"id": t.id, "name": t.name, "description": t.description[:120]} for t in topics],
        "bank": {"total": sum(levels.values()), "by_difficulty": levels},
    }


@tool(
    "read_material",
    description="Read the text of one material (all sections, or from a section onwards) so you can extract topics or write questions from it.",
    parameters={"type": "object", "properties": {"material_id": {"type": "integer", "minimum": 1}, "from_section": {"type": "integer", "minimum": 1}, "max_chars": {"type": "integer", "minimum": 1000, "maximum": 8000}}, "required": ["material_id"]},
    roles=STAFF, label="Reading the material",
)
def read_material(ctx: ToolContext, args: dict) -> dict:
    material = ctx.db.get(Material, args["material_id"])
    if material is None:
        raise ToolError("Material not found.")
    chunks = [c for c in tutor._material_chunks(ctx.db, material) if c["section"] >= args.get("from_section", 1)]
    limit, used, out = args.get("max_chars", 7000), 0, []
    for c in chunks:
        if used + len(c["text"]) > limit and out:
            break
        out.append({"section": c["section"], "title": c["title"], "text": c["text"]})
        used += len(c["text"])
    last = out[-1]["section"] if out else None
    more = any(c["section"] > (last or 0) for c in chunks)
    return {"material": {"id": material.id, "title": material.title, "course_id": material.course_id, "status": material.status}, "sections": out, "more_after_section": last if more else None, "summary": f"{len(out)} section parts of {material.title}"}


@tool(
    "analyze_question_bank",
    description="Health of a course's question bank: counts by topic/difficulty/status, questions without topic or explanation, thin topics, curated topics with no questions, topics used by questions but missing from the curated list, weakest questions and likely duplicates.",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID}, "required": ["course_id"]},
    roles=STAFF, label="Analysing the question bank",
)
def analyze_question_bank(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    health = bank_health(ctx.db, course.id)
    curated = {t.name.lower(): t.name for t in ctx.db.execute(select(CourseTopic).where(CourseTopic.course_id == course.id)).scalars()}
    used = {row["topic"].lower(): row["topic"] for row in health["by_topic"] if row["topic"] != "Untagged"}
    health["curated_without_questions"] = [curated[k] for k in curated if k not in used]
    health["question_topics_not_curated"] = [used[k] for k in used if k not in curated][:20]
    health.pop("most_mastered", None)
    return health


@tool(
    "find_duplicate_questions",
    description="Near-duplicate question pairs in a course bank (text similarity).",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID, "threshold": {"type": "number", "minimum": 0.7, "maximum": 0.99}}, "required": ["course_id"]},
    roles=STAFF, label="Looking for duplicates",
)
def find_duplicate_questions(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    rows = list(ctx.db.scalars(_bank(course.id).limit(800)).all())
    pairs = duplicate_pairs(ctx.db, rows, threshold=args.get("threshold", 0.85))
    return {"checked": len(rows), "pairs": pairs[:25], "summary": f"{len(pairs)} likely duplicate pairs among {len(rows)} questions"}


@tool(
    "search_questions",
    description="Staff search over a course bank with answers and metadata. missing='topic' or 'explanation' finds questions lacking them (useful before classifying).",
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID, "topic": {"type": "string", "maxLength": 120}, "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "query": {"type": "string", "maxLength": 200}, "missing": {"type": "string", "enum": ["topic", "explanation", "objective"]},
        "limit": {"type": "integer", "minimum": 1, "maximum": 40}, "offset": {"type": "integer", "minimum": 0, "maximum": 5000},
    }, "required": ["course_id"]},
    roles=STAFF, label="Searching questions",
)
def search_questions(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    stmt = _bank(course.id)
    if args.get("topic"):
        stmt = stmt.where(func.lower(Question.topic) == args["topic"].lower())
    if args.get("difficulty"):
        stmt = stmt.where(Question.difficulty == args["difficulty"])
    if args.get("query"):
        for word in args["query"].split()[:5]:
            stmt = stmt.where(Question.text.ilike(f"%{word}%"))
    missing = args.get("missing")
    if missing:
        column = {"topic": Question.topic, "explanation": Question.explanation, "objective": Question.objective}[missing]
        stmt = stmt.where(or_(column.is_(None), func.trim(column) == ""))
    total = ctx.db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = ctx.db.execute(stmt.order_by(Question.id).offset(args.get("offset", 0)).limit(args.get("limit", 20))).scalars().all()
    return {
        "total_matching": total,
        "questions": [{
            "id": q.id, "text": (q.text or "")[:260], "options": {k: (v or "")[:100] for k, v in zip("ABCD", (q.option_a, q.option_b, q.option_c, q.option_d)) if v},
            "correct": q.correct, "topic": q.topic, "subtopic": q.subtopic, "difficulty": q.difficulty, "objective": q.objective,
            "has_explanation": bool((q.explanation or "").strip()), "status": q.status,
        } for q in rows],
    }


@tool(
    "get_class_performance",
    description="How students performed in a course or one exam: attempts, average score, accuracy per topic, and flagged questions (possible wrong key, too hard, too easy, weak discrimination).",
    parameters={"type": "object", "properties": {"course_id": COURSE_ID, "exam_id": {"type": "integer", "minimum": 1}}},
    roles=STAFF, label="Analysing class performance",
)
def get_class_performance(ctx: ToolContext, args: dict) -> dict:
    if not args.get("course_id") and not args.get("exam_id"):
        raise ToolError("Give a course_id or an exam_id.")
    data = item_analysis.analyze(ctx.db, quiz_id=args.get("exam_id"), course_id=None if args.get("exam_id") else args.get("course_id"))
    stmt = select(func.count(Attempt.id), func.avg(Attempt.percentage)).where(Attempt.status != "in_progress")
    if args.get("exam_id"):
        stmt = stmt.where(Attempt.quiz_id == args["exam_id"])
    else:
        stmt = stmt.join(Quiz, Quiz.id == Attempt.quiz_id).where(Quiz.course_id == args["course_id"])
    count, avg = ctx.db.execute(stmt).one()
    topics: dict[str, list[float]] = {}
    for row in data["questions"]:
        entry = topics.setdefault(row["topic"] or "General", [0.0, 0])
        entry[0] += row["correct_rate"] * row["answered"]
        entry[1] += row["answered"]
    return {
        "attempts": count, "average_percentage": round(avg or 0, 1),
        "topics": sorted(({"topic": k, "accuracy": round(v[0] / v[1] * 100, 1) if v[1] else None, "answers": v[1]} for k, v in topics.items()), key=lambda r: r["accuracy"] if r["accuracy"] is not None else 101),
        "flagged_questions": [{k: r[k] for k in ("id", "text", "topic", "correct", "correct_rate", "picks", "flags")} for r in data["questions"] if r["flags"]][:15],
        "summary": data["summary"],
    }


@tool(
    "get_student_report",
    description="One student's learning report (accuracy by topic, weak/strong topics, recent scores). Find them by name, username or phone.",
    parameters={"type": "object", "properties": {"student": {"type": "string", "maxLength": 80}, "course_id": COURSE_ID}, "required": ["student"]},
    roles=STAFF, label="Reading the student's report",
)
def get_student_report(ctx: ToolContext, args: dict) -> dict:
    q = args["student"]
    matches = ctx.db.execute(select(Student).where(or_(Student.username.ilike(f"%{q}%"), Student.name.ilike(f"%{q}%"), Student.phone == q)).limit(5)).scalars().all()
    if not matches:
        raise ToolError("No student matched.")
    if len(matches) > 1 and not any(m.username.lower() == q.lower() for m in matches):
        return {"ambiguous": [{"username": m.username, "name": m.name} for m in matches], "note": "Several students matched — ask which one."}
    student = next((m for m in matches if m.username.lower() == q.lower()), matches[0])
    report = tutor.progress_summary(ctx.db, student, args.get("course_id"))
    report.pop("thresholds", None)
    return {"student": {"username": student.username, "name": student.name, "level": student.level}, **report}


# ---------------------------------------------------------------- proposals
def _proposal(ctx: ToolContext, kind: str, course: Course, title: str, summary: str, payload: dict) -> dict:
    row = AIProposal(kind=kind, course_id=course.id, title=title[:200], summary=summary[:600], payload=payload, created_by=ctx.admin.id if ctx.admin else None)
    ctx.db.add(row)
    ctx.db.flush()
    count = len(payload.get("items") or [])
    ctx.actions.append({"type": "proposal", "id": row.id, "kind": kind, "title": row.title, "course": course.code, "count": count})
    return {"proposal_id": row.id, "status": "pending", "items": count, "summary": f"Proposal #{row.id} saved for review ({count} items). Nothing changes until a staff member approves it in the review panel."}


@tool(
    "propose_topics",
    description="Propose curated topics for a course (e.g. extracted from its material). Stored for staff review — not saved as official topics until approved.",
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID,
        "rationale": {"type": "string", "maxLength": 500},
        "topics": {"type": "array", "maxItems": MAX_PROPOSED_TOPICS, "items": {"type": "object", "properties": {
            "name": {"type": "string", "maxLength": 120}, "description": {"type": "string", "maxLength": 400},
            "learning_objectives": {"type": "array", "items": {"type": "string", "maxLength": 200}, "maxItems": 8},
            "source_sections": {"type": "array", "items": {"type": "string", "maxLength": 120}, "maxItems": 8},
        }, "required": ["name"]}},
    }, "required": ["course_id", "topics"]},
    roles=STAFF, label="Drafting topics for review", writes=True,
)
def propose_topics(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    existing = {t.name.lower() for t in ctx.db.execute(select(CourseTopic).where(CourseTopic.course_id == course.id)).scalars()}
    seen, items = set(), []
    for t in args["topics"]:
        name = re.sub(r"\s+", " ", t["name"]).strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        items.append({**t, "name": name, "exists": name.lower() in existing})
    if not items:
        raise ToolError("No usable topics in the proposal.")
    return _proposal(ctx, "topics", course, f"{len(items)} topics for {course.code}", args.get("rationale", ""), {"items": items})


@tool(
    "propose_questions",
    description="Propose new multiple-choice questions for a course bank (A–D options, one correct letter, explanation, topic, difficulty). Stored for staff review — never added to the bank until approved.",
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID,
        "rationale": {"type": "string", "maxLength": 500},
        "questions": {"type": "array", "maxItems": MAX_PROPOSED_QUESTIONS, "items": {"type": "object", "properties": {
            "text": {"type": "string", "maxLength": 1200}, "option_a": {"type": "string", "maxLength": 400}, "option_b": {"type": "string", "maxLength": 400},
            "option_c": {"type": "string", "maxLength": 400}, "option_d": {"type": "string", "maxLength": 400},
            "correct": {"type": "string", "enum": ["A", "B", "C", "D"]}, "explanation": {"type": "string", "maxLength": 1200},
            "topic": {"type": "string", "maxLength": 120}, "subtopic": {"type": "string", "maxLength": 120},
            "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]}, "objective": {"type": "string", "maxLength": 240},
            "source": {"type": "string", "maxLength": 160},
        }, "required": ["text", "option_a", "option_b", "correct"]}},
    }, "required": ["course_id", "questions"]},
    roles=STAFF, label="Drafting questions for review", writes=True,
)
def propose_questions(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    existing = [re.sub(r"\W+", " ", t.lower()).strip() for t in ctx.db.execute(select(Question.text).where(Question.course_id == course.id)).scalars()]
    items, problems = [], []
    import difflib

    for index, q in enumerate(args["questions"]):
        options = {k: q.get(f"option_{k.lower()}", "") for k in "ABCD"}
        if not options.get(q["correct"]):
            problems.append(f"#{index + 1}: correct answer {q['correct']} has no option text")
            continue
        norm = re.sub(r"\W+", " ", q["text"].lower()).strip()
        dup = next((round(r * 100) for r in (difflib.SequenceMatcher(None, norm, e).ratio() for e in existing[:1500]) if r >= 0.9), None)
        items.append({**q, "difficulty": q.get("difficulty", "medium"), **({"possible_duplicate": dup} if dup else {})})
    if not items:
        raise ToolError("None of the questions were valid: " + "; ".join(problems[:5]))
    out = _proposal(ctx, "questions", course, f"{len(items)} questions for {course.code}", args.get("rationale", ""), {"items": items, "problems": problems})
    if problems:
        out["skipped"] = problems[:10]
    return out


@tool(
    "propose_classification",
    description="Propose topic / subtopic / difficulty / learning-objective changes for existing questions (use ids from search_questions). Stored for staff review.",
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID,
        "rationale": {"type": "string", "maxLength": 500},
        "changes": {"type": "array", "maxItems": MAX_CLASSIFICATIONS, "items": {"type": "object", "properties": {
            "question_id": {"type": "integer", "minimum": 1}, "topic": {"type": "string", "maxLength": 120}, "subtopic": {"type": "string", "maxLength": 120},
            "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]}, "objective": {"type": "string", "maxLength": 240},
        }, "required": ["question_id"]}},
    }, "required": ["course_id", "changes"]},
    roles=STAFF, label="Drafting classifications for review", writes=True,
)
def propose_classification(ctx: ToolContext, args: dict) -> dict:
    course = _course(ctx, args["course_id"])
    ids = [c["question_id"] for c in args["changes"]]
    questions = {q.id: q for q in ctx.db.execute(select(Question).where(Question.id.in_(ids), Question.course_id == course.id)).scalars()}
    items = []
    for change in args["changes"]:
        q = questions.get(change["question_id"])
        if q is None:
            continue
        before = {k: getattr(q, k) or "" for k in ("topic", "subtopic", "difficulty", "objective")}
        after = {k: v for k, v in change.items() if k != "question_id" and v and v != before.get(k)}
        if after:
            items.append({"question_id": q.id, "text": (q.text or "")[:160], "before": before, "after": after})
    if not items:
        raise ToolError("No changes to propose (unknown ids or nothing different).")
    counts = Counter(k for i in items for k in i["after"])
    return _proposal(ctx, "classification", course, f"Reclassify {len(items)} questions in {course.code}", args.get("rationale", "") or ", ".join(f"{v} {k}" for k, v in counts.items()), {"items": items})


# ------------------------------------------------------------------ bulk work
@tool(
    "start_ai_task",
    description=("Start a BACKGROUND task for bulk work that is too big for one reply: read whole course materials, build a topic list from them, "
                 "map EVERY existing bank question onto those topics, tag materials with topics, and/or generate 1-1000 new questions grounded in the "
                 "material. Runs with no size limit and produces proposals for staff review. Use this for any request over ~20 questions or 'all questions'."),
    parameters={"type": "object", "properties": {
        "course_id": COURSE_ID,
        "material_ids": {"type": "array", "items": {"type": "integer", "minimum": 1}, "maxItems": 50, "description": "Materials to read; omit for all course materials."},
        "build_topics": {"type": "boolean", "description": "Read the materials and propose a topic list (default true)."},
        "classify_questions": {"type": "boolean", "description": "Assign every existing bank question to a topic (default true)."},
        "map_materials": {"type": "boolean", "description": "Tag each material with its main topic (default true)."},
        "reclassify_difficulty": {"type": "boolean", "description": "Also re-rate question difficulty (default false)."},
        "only_untagged": {"type": "boolean", "description": "Only map questions that have no topic yet (default false)."},
        "generate_questions": {"type": "integer", "minimum": 0, "maximum": 1000, "description": "How many new questions to write (0 for none)."},
        "difficulty": {"type": "object", "properties": {"easy": {"type": "integer", "minimum": 0, "maximum": 100}, "medium": {"type": "integer", "minimum": 0, "maximum": 100}, "hard": {"type": "integer", "minimum": 0, "maximum": 100}}, "description": "Difficulty mix in percent."},
        "topics": {"type": "array", "items": {"type": "string", "maxLength": 120}, "maxItems": 40, "description": "Only these topics (for generation); omit to cover all."},
        "topic_count": {"type": "integer", "minimum": 0, "maximum": 40, "description": "Target number of topics to build (0 = automatic)."},
        "instructions": {"type": "string", "maxLength": 1500, "description": "Extra guidance from staff (style, level, focus)."},
    }, "required": ["course_id"]},
    roles=STAFF, label="Starting a background AI task", writes=True,
)
def start_ai_task(ctx: ToolContext, args: dict) -> dict:
    from . import tasks

    course = _course(ctx, args["course_id"])
    try:
        task = tasks.create(ctx.db, ctx.admin, course, args)
    except tasks.TaskError as error:
        raise ToolError(error.message) from error
    est = (task.params or {}).get("estimate") or {}
    ctx.actions.append({"type": "task", "id": task.id, "title": task.title, "course": course.code, "status": task.status,
                        "estimate": {k: est.get(k) for k in ("calls", "cost", "minutes", "materials", "bank_questions")}})
    return {"task_id": task.id, "status": "queued", "plan": task.title, "estimate": est,
            "summary": (f"Background task #{task.id} started ({task.title}). It reads {est.get('materials', 0)} material(s) and "
                        f"{est.get('bank_questions', 0)} bank question(s); about {est.get('minutes', 1)} min, est. ${est.get('cost', 0):.3f}. "
                        "Progress shows live in the Tasks tab; results arrive as proposals for review.")}


@tool(
    "get_ai_task",
    description="Progress and results of a background AI task (or the latest tasks for a course when task_id is omitted).",
    parameters={"type": "object", "properties": {"task_id": {"type": "integer", "minimum": 1}, "course_id": COURSE_ID}},
    roles=STAFF, label="Checking a background task",
)
def get_ai_task(ctx: ToolContext, args: dict) -> dict:
    from ...models import AITask
    from . import tasks

    def brief(t: AITask) -> dict:
        out = tasks.public(t)
        return {k: out[k] for k in ("id", "title", "status", "stage", "progress", "result", "error", "cost", "log")}

    if args.get("task_id"):
        t = ctx.db.get(AITask, args["task_id"])
        if t is None:
            raise ToolError("No such task.")
        return brief(t)
    stmt = select(AITask).order_by(AITask.id.desc()).limit(5)
    if args.get("course_id"):
        stmt = stmt.where(AITask.course_id == args["course_id"])
    return {"tasks": [brief(t) for t in ctx.db.execute(stmt).scalars()]}
