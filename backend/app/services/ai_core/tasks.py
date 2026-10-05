"""Background AI tasks: bulk course work that cannot fit in one chat reply.

A task reads whole course materials (map → reduce, never the whole book in one
prompt), builds a topic list, maps EVERY bank question onto those topics and
generates up to 1000 new questions grounded in the material text. Work runs on
a background thread with its own DB session, a few model calls in parallel,
retries, a per-task cost ceiling and the monthly budget. The output is only
ever proposals — nothing touches the official course until staff approve.
"""

from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...db import SessionLocal
from ...models import Admin, AIProposal, AIStaffUsage, AITask, AIUsageEvent, Config, Course, CourseTopic, Material, Question
from .. import ai_providers as providers
from .. import ai_tutor as tutor

log = logging.getLogger("arena.ai.tasks")

MAX_QUESTIONS = 1000          # per task
GEN_BATCH = 12                # questions per model call
CLASSIFY_BATCH = 40           # existing questions per model call
PASSAGE_CHARS = 12000         # material text per "read" call
SOURCE_CHARS = 7000           # material text given to each generation call
PROPOSAL_MAX = 150            # items per saved proposal (keeps review usable)
MAX_TOPICS = 40
LOG_KEEP = 200
DEFAULT_MAX_COST = 1.0        # USD per task unless overridden (never unlimited)
HARD_MAX_COST = 10.0
STAGES = ("read", "topics", "materials", "classify", "generate", "dedupe", "write")
WRITE_BATCH = 22             # bank questions per material-writing call
WRITE_SOURCE_CHARS = 6000


class TaskError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class _Stop(Exception):
    """Raised inside a run to stop early (cancel, budget, fatal provider error)."""

    def __init__(self, message: str, status: str = "stopped"):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def workers() -> int:
    try:
        return max(1, min(8, int(os.getenv("AI_TASK_WORKERS", "6"))))
    except ValueError:
        return 6


def default_max_cost() -> float:
    try:
        return max(0.01, min(HARD_MAX_COST, float(os.getenv("AI_TASK_MAX_COST_USD", str(DEFAULT_MAX_COST)))))
    except ValueError:
        return DEFAULT_MAX_COST


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower())).strip()


def _words(text: str) -> set[str]:
    return {w for w in _norm(text).split() if len(w) > 2}


def _similar(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# ----------------------------------------------------------------- params
def clean_params(db: Session, course: Course, raw: dict) -> dict:
    """Validate and normalise what staff (or the chat agent) asked for."""
    raw = raw or {}
    mats = _materials(db, course, None)
    wanted = raw.get("material_ids")
    if wanted:
        ids = {int(i) for i in wanted if str(i).isdigit()}
        known = {m.id for m in mats}
        missing = ids - known
        if missing:
            raise TaskError(f"Material(s) {', '.join(map(str, sorted(missing)))} are not in {course.code}.", 404)
        material_ids = sorted(ids)
    else:
        material_ids = []  # all course materials
    count = int(raw.get("generate_questions") or 0)
    if count < 0 or count > MAX_QUESTIONS:
        raise TaskError(f"You can generate between 0 and {MAX_QUESTIONS} questions per task.", 422)
    mix = raw.get("difficulty") or {}
    try:
        mix = {k: max(0, int(mix.get(k, d))) for k, d in (("easy", 30), ("medium", 50), ("hard", 20))}
    except (TypeError, ValueError):
        mix = {"easy": 30, "medium": 50, "hard": 20}
    if sum(mix.values()) <= 0:
        mix = {"easy": 30, "medium": 50, "hard": 20}
    topics = [re.sub(r"\s+", " ", str(t)).strip()[:120] for t in raw.get("topics") or [] if str(t).strip()][:MAX_TOPICS]
    # A focused job (write materials / remove duplicates) does only that unless
    # the other steps were asked for explicitly.
    focused = bool(raw.get("write_materials") or raw.get("remove_duplicates")) and not count
    default_on = not focused
    params = {
        "material_ids": material_ids,
        "build_topics": bool(raw.get("build_topics", default_on)),
        "classify_questions": bool(raw.get("classify_questions", default_on)),
        "map_materials": bool(raw.get("map_materials", default_on)),
        "write_materials": bool(raw.get("write_materials", False)),
        "remove_duplicates": bool(raw.get("remove_duplicates", False)),
        "reclassify_difficulty": bool(raw.get("reclassify_difficulty", False)),
        "only_untagged": bool(raw.get("only_untagged", False)),
        "generate_questions": count,
        "difficulty": mix,
        "topics": topics,
        "topic_count": max(0, min(MAX_TOPICS, int(raw.get("topic_count") or 0))),
        "instructions": str(raw.get("instructions") or "").strip()[:1500],
        "max_cost": round(max(0.01, min(HARD_MAX_COST, float(raw.get("max_cost") or default_max_cost()))), 2),
    }
    if not (params["build_topics"] or params["classify_questions"] or params["map_materials"] or count or params["write_materials"] or params["remove_duplicates"]):
        raise TaskError("Pick at least one thing for the task to do.", 422)
    return params


def _materials(db: Session, course: Course, ids: list[int] | None) -> list[Material]:
    stmt = select(Material).where(Material.course_id == course.id, Material.kind == "material", Material.status != "archived")
    if ids:
        stmt = stmt.where(Material.id.in_(ids))
    return list(db.execute(stmt.order_by(Material.id)).scalars())


def _bank_questions(db: Session, course: Course) -> list[Question]:
    return list(db.execute(select(Question).where(Question.course_id == course.id, Question.source_id.is_(None)).order_by(Question.id)).scalars())


def _passages(db: Session, materials: list[Material]) -> list[dict]:
    """Group each material's ~1200-char chunks into ~12k-char passages."""
    out: list[dict] = []
    for material in materials:
        current: list[dict] = []
        size = 0
        for chunk in tutor._material_chunks(db, material):
            if size + len(chunk["text"]) > PASSAGE_CHARS and current:
                out.append(_passage(material, current))
                current, size = [], 0
            current.append(chunk)
            size += len(chunk["text"])
        if current:
            out.append(_passage(material, current))
    return out


def _passage(material: Material, chunks: list[dict]) -> dict:
    sections = []
    for c in chunks:
        label = f"§{c['section']} {c['title']}".strip()
        if label not in sections:
            sections.append(label)
    text = "\n\n".join(f"[§{c['section']} {c['title']}]\n{c['text']}" if c["part"] == 1 else c["text"] for c in chunks)
    return {"material_id": material.id, "material": material.title, "sections": sections[:12], "text": text, "chars": len(text), "topics": []}


# ----------------------------------------------------------------- estimate
def estimate(db: Session, course: Course, params: dict) -> dict:
    materials = _materials(db, course, params.get("material_ids") or None)
    chars = 0
    for m in materials:
        chars += sum(len(c["text"]) for c in tutor._material_chunks(db, m))
    passages = max(1, math.ceil(chars / PASSAGE_CHARS)) if chars else 0
    bank = db.execute(select(func.count(Question.id)).where(Question.course_id == course.id, Question.source_id.is_(None))).scalar_one()
    count = int(params.get("generate_questions") or 0)
    calls = tokens_in = tokens_out = 0
    need_topics = params.get("build_topics") or params.get("classify_questions") or params.get("map_materials") or count
    if need_topics and passages and params.get("build_topics"):
        calls += passages + 1
        tokens_in += chars // 4 + passages * 500 + 5000
        tokens_out += passages * 450 + 2500
    if params.get("classify_questions") and bank:
        n = math.ceil(bank / CLASSIFY_BATCH)
        calls += n
        tokens_in += bank * 130 + n * 900
        tokens_out += bank * 22
    if count:
        n = math.ceil(count * 1.15 / GEN_BATCH)
        calls += n
        tokens_in += n * (SOURCE_CHARS // 4 + 1100)
        tokens_out += int(count * 1.15 * 330)
    if params.get("write_materials") and bank:
        n = math.ceil(bank / WRITE_BATCH) + 1
        calls += n
        tokens_in += bank * 160 + n * (WRITE_SOURCE_CHARS // 4 + 900)
        tokens_out += n * 3800
    impl, model = tutor.ai_target(db)
    cost = providers.estimate_cost(impl.name, model, {"input": tokens_in, "output": tokens_out})
    minutes = max(1, math.ceil(calls / workers() * 25 / 60)) if calls else 0
    return {
        "materials": len(materials), "characters": chars, "passages": passages, "bank_questions": int(bank or 0),
        "calls": calls, "input_tokens": tokens_in, "output_tokens": tokens_out, "cost": round(cost, 4), "minutes": minutes,
        "max_cost": params.get("max_cost", default_max_cost()), "model": model, "provider": impl.name,
    }


# ----------------------------------------------------------------- public api
def public(task: AITask, *, full: bool = False) -> dict:
    out: dict[str, Any] = {
        "id": task.id, "course_id": task.course_id, "title": task.title, "status": task.status, "stage": task.stage,
        "progress": task.progress or {}, "result": task.result or {}, "error": task.error, "calls": task.calls,
        "input_tokens": task.input_tokens, "output_tokens": task.output_tokens, "cost": round(task.cost or 0, 4),
        "params": task.params or {}, "cancel_requested": bool(task.cancel_requested),
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
    }
    logs = task.log or []
    out["log"] = logs if full else logs[-6:]
    return out


def describe(params: dict, course: Course) -> str:
    parts = []
    if params.get("build_topics"):
        parts.append("topics")
    if params.get("classify_questions"):
        parts.append("map questions")
    if params.get("generate_questions"):
        parts.append(f"{params['generate_questions']} new questions")
    if params.get("write_materials"):
        parts.append("write study materials")
    if params.get("remove_duplicates"):
        parts.append("remove duplicates")
    if params.get("map_materials") and not parts:
        parts.append("tag materials")
    return f"{course.code}: " + (", ".join(parts) or "course task")


def create(db: Session, admin: Admin | None, course: Course, raw: dict) -> AITask:
    impl, _model = tutor.ai_target(db)
    if not impl.configured():
        raise TaskError("The AI key is not configured on the server yet.", 503)
    params = clean_params(db, course, raw)
    running = db.execute(select(func.count(AITask.id)).where(AITask.status.in_(("queued", "running")))).scalar_one()
    if running >= 5:
        raise TaskError("Five AI tasks are already queued or running — wait for one to finish.", 429)
    est = estimate(db, course, params)
    if est["materials"] == 0 and (params["build_topics"] or params["generate_questions"]):
        has_topics = db.execute(select(func.count(CourseTopic.id)).where(CourseTopic.course_id == course.id)).scalar_one()
        if params["build_topics"] or not (has_topics or params["topics"]):
            raise TaskError(f"{course.code} has no readable materials yet. Upload one (you can attach it in the chat) and try again.", 422)
    task = AITask(course_id=course.id, title=describe(params, course)[:200], params={**params, "estimate": est}, status="queued",
                  progress={"done": 0, "total": 0, "label": "Waiting to start", "percent": 0}, log=[], result={"proposals": []},
                  created_by=admin.id if admin else None)
    db.add(task)
    db.flush()
    _log_row(task, f"Queued · about {est['calls']} AI calls, est. ${est['cost']:.3f} (ceiling ${params['max_cost']:.2f}), ~{est['minutes']} min")
    return task


def cancel(db: Session, task: AITask) -> AITask:
    if task.status == "queued":
        task.status = "cancelled"
        task.finished_at = _now()
        _log_row(task, "Cancelled before it started.")
    elif task.status == "running":
        task.cancel_requested = True
        _log_row(task, "Cancel requested — stopping after the current step.")
    else:
        raise TaskError("This task is not running.", 409)
    db.flush()
    return task


def _log_row(task: AITask, text: str, level: str = "info") -> None:
    rows = list(task.log or [])
    rows.append({"at": _now().isoformat(), "level": level, "text": text[:400]})
    task.log = rows[-LOG_KEEP:]


# ----------------------------------------------------------------- runner
_lock = threading.Lock()
_thread: threading.Thread | None = None


def kick() -> None:
    """Start the background runner if it is idle (call after committing)."""
    global _thread
    if os.getenv("AI_TASKS_DISABLED") == "1":
        return
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_runner, name="ai-tasks", daemon=True)
        _thread.start()


def wait_idle(timeout: float = 60) -> bool:
    """Test helper: block until the runner has drained the queue."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        t = _thread
        if t is None or not t.is_alive():
            return True
        t.join(0.1)
    return False


def recover() -> int:
    """On start-up: tasks that were mid-run when the server stopped are marked
    interrupted (their saved proposals stay); queued ones start again."""
    with SessionLocal() as db:
        rows = list(db.execute(select(AITask).where(AITask.status == "running")).scalars())
        for task in rows:
            task.status = "interrupted"
            task.finished_at = _now()
            task.error = "The server restarted while this task was running. Proposals saved so far are kept — start it again for the rest."
            _log_row(task, "Interrupted by a server restart.", "warn")
        queued = db.execute(select(func.count(AITask.id)).where(AITask.status == "queued")).scalar_one()
        db.commit()
    if queued:
        kick()
    return len(rows)


def _runner() -> None:
    while True:
        with SessionLocal() as db:
            task = db.execute(select(AITask).where(AITask.status == "queued").order_by(AITask.id).limit(1)).scalar_one_or_none()
            if task is None:
                return
            task.status = "running"
            task.started_at = _now()
            db.commit()
            job = _Job(db, task)
            try:
                job.run()
            except _Stop as stop:
                job.finish(stop.status, stop.message)
            except Exception as error:  # noqa: BLE001 — a task must never kill the runner
                log.exception("AI task %s crashed", task.id)
                db.rollback()
                job.finish("failed", f"Something went wrong on the server: {type(error).__name__}. Proposals saved so far are kept.")


# ----------------------------------------------------------------- the job
class _Job:
    def __init__(self, db: Session, task: AITask):
        self.db = db
        self.task = task
        self.params = task.params or {}
        self.course = db.get(Course, task.course_id)
        self.impl, self.model = tutor.ai_target(db)
        self.result: dict = dict(task.result or {})
        self.result.setdefault("proposals", [])
        self.stage_totals: dict[str, int] = {}
        self.fatal = 0

    # --------------------------------------------------------- plumbing
    def log(self, text: str, level: str = "info") -> None:
        _log_row(self.task, text, level)
        self.save()

    def save(self) -> None:
        self.task.result = dict(self.result)
        self.db.commit()

    def progress(self, stage: str, done: int, total: int, label: str) -> None:
        stages = self.plan
        index = stages.index(stage) if stage in stages else 0
        share = (index + (done / total if total else 1)) / max(1, len(stages))
        self.task.stage = stage
        self.task.progress = {"stage": stage, "done": done, "total": total, "label": label, "percent": min(99, int(share * 100)), "stages": stages}
        self.save()

    def check(self) -> None:
        self.db.refresh(self.task, ["cancel_requested"])
        if self.task.cancel_requested:
            raise _Stop("Cancelled by staff. Proposals saved so far are kept.", "cancelled")
        if self.task.cost >= float(self.params.get("max_cost") or default_max_cost()):
            raise _Stop(f"Stopped at the task cost ceiling (${self.params.get('max_cost'):.2f}). Proposals saved so far are kept — raise the ceiling and run again for the rest.")
        cfg = self.db.get(Config, 1)
        budget = float(getattr(cfg, "ai_monthly_budget_usd", 0) or 0) if cfg else 0.0
        if budget > 0:
            month = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            a = self.db.execute(select(func.coalesce(func.sum(AIUsageEvent.estimated_cost), 0.0)).where(AIUsageEvent.created_at >= month)).scalar_one()
            b = self.db.execute(select(func.coalesce(func.sum(AIStaffUsage.estimated_cost), 0.0)).where(AIStaffUsage.created_at >= month)).scalar_one()
            if float(a or 0) + float(b or 0) >= budget:
                raise _Stop(f"Stopped: the monthly AI budget (${budget:.2f}) is used up. Proposals saved so far are kept.")

    def finish(self, status: str, message: str = "") -> None:
        try:
            self.db.rollback()
            self.task = self.db.get(AITask, self.task.id)
            self.task.status = status
            self.task.finished_at = _now()
            self.task.error = message[:400] if status != "done" else ""
            progress = dict(self.task.progress or {})
            progress["percent"] = 100 if status == "done" else progress.get("percent", 0)
            progress["label"] = "Finished" if status == "done" else message[:120]
            self.task.progress = progress
            self.task.result = dict(self.result)
            if message:
                _log_row(self.task, message, "info" if status == "done" else "warn")
            self.db.commit()
        except Exception:  # noqa: BLE001
            log.exception("could not finish task %s", self.task.id)

    def _call(self, messages: list[dict], max_tokens: int) -> tuple[dict | None, dict, str]:
        """HTTP only (safe on worker threads). Returns (json or None, usage, error)."""
        started = time.monotonic()
        try:
            text, usage, _finish, used = providers.with_retries(lambda: self.impl.complete(messages, model=self.model, max_tokens=max_tokens, temperature=0.3, json_mode=True), attempts=4, budget=90)
        except providers.ProviderError as error:
            return None, {"ms": int((time.monotonic() - started) * 1000), "code": error.code}, str(error)
        usage = dict(usage or {})
        usage["ms"] = int((time.monotonic() - started) * 1000)
        usage["model"] = used or self.model
        try:
            return tutor.parse_json(text), usage, ""
        except tutor.TutorError as error:
            return None, usage, f"unreadable reply ({error.technical})"

    def many(self, prompts: list[list[dict]], max_tokens: int, on_result: Callable[[int, dict | None, str], None]) -> None:
        """Run prompts a few at a time; account, check limits, report between waves."""
        size = workers()
        with ThreadPoolExecutor(max_workers=size) as pool:
            for start in range(0, len(prompts), size):
                self.check()
                wave = prompts[start : start + size]
                results = list(pool.map(lambda m: self._call(m, max_tokens), wave))
                for offset, (data, usage, error) in enumerate(results):
                    self.account(usage, error)
                    on_result(start + offset, data, error)
                self.save()

    def account(self, usage: dict, error: str) -> None:
        tokens_in, tokens_out, cached = int(usage.get("input") or 0), int(usage.get("output") or 0), int(usage.get("cached") or 0)
        cost = providers.estimate_cost(self.impl.name, usage.get("model") or self.model, usage) if not error or tokens_in else 0.0
        self.task.calls += 1
        self.task.input_tokens += tokens_in
        self.task.output_tokens += tokens_out
        self.task.cost = round((self.task.cost or 0) + cost, 6)
        self.db.add(AIStaffUsage(admin_id=self.task.created_by, request_id=f"task-{self.task.id}", kind="ADMIN_TASK", provider=self.impl.name,
                                 model=(usage.get("model") or self.model)[:60], input_tokens=tokens_in, output_tokens=tokens_out, cache_hit_tokens=cached,
                                 cache_miss_tokens=max(0, tokens_in - cached), estimated_cost=cost, latency_ms=int(usage.get("ms") or 0),
                                 status="error" if error else "ok", error=error[:300]))
        if error:
            code = usage.get("code", "")
            if code in ("bad_key", "balance", "not_configured"):
                hint = {"balance": "The AI account balance is empty — top it up and run the task again.",
                        "bad_key": "The AI key was rejected — check it in the server settings.",
                        "not_configured": "The AI key is not configured on the server."}[code]
                raise _Stop(hint + " Proposals saved so far are kept.", "failed")
            self.fatal += 1
            _log_row(self.task, f"One AI call failed ({error[:140]}) — continuing.", "warn")
            if self.fatal >= 12:
                raise _Stop("Too many AI calls failed in a row — the provider may be down. Proposals saved so far are kept.", "failed")
        else:
            self.fatal = 0

    def propose(self, kind: str, title: str, summary: str, items: list[dict]) -> list[int]:
        ids = []
        parts = [items[i : i + PROPOSAL_MAX] for i in range(0, len(items), PROPOSAL_MAX)] or []
        for index, part in enumerate(parts):
            suffix = f" (part {index + 1}/{len(parts)})" if len(parts) > 1 else ""
            row = AIProposal(kind=kind, course_id=self.course.id, title=(title + suffix)[:200], summary=summary[:600],
                             payload={"items": part, "task_id": self.task.id}, created_by=self.task.created_by)
            self.db.add(row)
            self.db.flush()
            ids.append(row.id)
            self.result["proposals"].append({"id": row.id, "kind": kind, "title": row.title, "count": len(part)})
        self.save()
        return ids

    # --------------------------------------------------------- pipeline
    def run(self) -> None:
        if self.course is None:
            raise _Stop("The course no longer exists.", "failed")
        p = self.params
        count = int(p.get("generate_questions") or 0)
        self.plan = [s for s, on in (("read", True), ("topics", True), ("materials", p.get("map_materials")),
                                     ("classify", p.get("classify_questions")), ("generate", count > 0),
                                     ("dedupe", p.get("remove_duplicates")), ("write", p.get("write_materials"))) if on]
        self.log(f"Started on {self.course.code} with {self.impl.name} · {self.model}")

        # 1. read
        self.progress("read", 0, 1, "Reading materials")
        materials = _materials(self.db, self.course, p.get("material_ids") or None)
        passages = _passages(self.db, materials)
        chars = sum(x["chars"] for x in passages)
        self.result["read"] = {"materials": len(materials), "passages": len(passages), "characters": chars}
        self.log(f"Read {len(materials)} material(s) · {len(passages)} passage(s) · {chars:,} characters" if materials else "No materials selected — working from the course topics.")
        self.progress("read", 1, 1, "Materials read")

        # 2. topics
        topics = self.build_topics(passages)
        needs_topics = p.get("map_materials") or p.get("classify_questions") or count or p.get("build_topics")
        if not topics and needs_topics:
            raise _Stop("No topics could be found — add material text or curated topics and try again.", "failed")

        # 3. materials → topic
        if p.get("map_materials") and passages:
            self.map_materials(materials, passages)

        # 4. classify every bank question
        if p.get("classify_questions"):
            self.classify(topics)

        # 5. generate
        if count:
            self.generate(topics, passages, count)

        # 6. duplicates across the whole bank
        if p.get("remove_duplicates"):
            self.dedupe()

        # 7. study materials that cover every bank question
        if p.get("write_materials"):
            self.write_materials(passages)

        made = sum(x["count"] for x in self.result["proposals"])
        self.finish("done", f"Done · {len(self.result['proposals'])} proposal(s) with {made} item(s) ready for review · ${self.task.cost:.4f}")

    # ---- topics
    def build_topics(self, passages: list[dict]) -> list[dict]:
        p = self.params
        existing = list(self.db.execute(select(CourseTopic).where(CourseTopic.course_id == self.course.id).order_by(CourseTopic.position)).scalars())
        chosen = p.get("topics") or []
        if chosen:  # staff named the topics — use them as-is
            topics = [{"name": n, "description": next((t.description for t in existing if t.name.lower() == n.lower()), "")} for n in chosen]
            self.log(f"Using the {len(topics)} topic(s) you named.")
        elif not p.get("build_topics") or not passages:
            topics = [{"name": t.name, "description": t.description or ""} for t in existing]
            if not topics:  # fall back to the topics already used on questions
                names = Counter(q.topic.strip() for q in _bank_questions(self.db, self.course) if (q.topic or "").strip())
                topics = [{"name": n, "description": ""} for n, _ in names.most_common(MAX_TOPICS)]
            self.log(f"Using {len(topics)} existing course topic(s).")
        else:
            topics = self.extract_topics(passages, existing)
        if passages:
            self.assign_passages(topics, passages)
        return topics

    def extract_topics(self, passages: list[dict], existing: list[CourseTopic]) -> list[dict]:
        total = len(passages)
        self.progress("topics", 0, total + 1, f"Finding topics in {total} passage(s)")
        instructions = self.params.get("instructions") or ""
        prompts = []
        for x in passages:
            prompts.append([
                {"role": "system", "content": "You analyse university course material for an exam-prep platform. Reply with JSON only."},
                {"role": "user", "content": (
                    f"Course: {self.course.code} — {self.course.title}\nMaterial: {x['material']}\nSections: {', '.join(x['sections'])}\n"
                    + (f"Staff instructions: {instructions}\n" if instructions else "")
                    + "\nList the distinct examinable topics taught in this passage (1-6). Use short syllabus-style names (2-6 words), "
                    "not chapter numbers. JSON: {\"topics\":[{\"name\":\"...\",\"description\":\"one sentence\",\"key_points\":[\"...\"]}]}\n\n"
                    f"PASSAGE:\n{x['text']}")},
            ])
        candidates: list[dict] = []

        def got(index: int, data: dict | None, error: str) -> None:
            found = []
            for t in (data or {}).get("topics") or []:
                if isinstance(t, dict) and str(t.get("name") or "").strip():
                    name = re.sub(r"\s+", " ", str(t["name"])).strip()[:120]
                    found.append(name)
                    candidates.append({"name": name, "description": str(t.get("description") or "")[:300], "passage": index,
                                       "key_points": [str(k)[:160] for k in (t.get("key_points") or [])[:5]]})
            passages[index]["candidates"] = found
            self.progress("topics", index + 1, total + 1, f"Read passage {index + 1} of {total}")

        self.many(prompts, 900, got)
        if not candidates:
            raise _Stop("The AI could not read topics from the material. Check the material has text, then try again.", "failed")
        self.log(f"Found {len(candidates)} topic mentions across {total} passage(s); merging into a syllabus…")

        # reduce: merge the candidate mentions into one clean syllabus
        counts = Counter(c["name"] for c in candidates)
        target = self.params.get("topic_count") or max(4, min(25, round(len(counts) / 3) or 4))
        lines = "\n".join(f"- {name} (×{n})" for name, n in counts.most_common(300))
        existing_names = ", ".join(t.name for t in existing) or "none"
        prompts = [[
            {"role": "system", "content": "You design course syllabi for an exam-prep platform. Reply with JSON only."},
            {"role": "user", "content": (
                f"Course: {self.course.code} — {self.course.title}\nExisting official topics (reuse these exact names where they fit): {existing_names}\n"
                + (f"Staff instructions: {instructions}\n" if instructions else "")
                + f"\nThese topic mentions were extracted from the course material (×n = how often). Merge duplicates and near-duplicates into about {target} "
                "clean, non-overlapping topics in teaching order. Every mention must be listed under exactly one topic's \"merges\". "
                "JSON: {\"topics\":[{\"name\":\"...\",\"description\":\"1-2 sentences\",\"learning_objectives\":[\"...\"],\"merges\":[\"mention\", ...]}]}\n\n"
                f"MENTIONS:\n{lines}")},
        ]]
        merged: list[dict] = []

        def reduced(_i: int, data: dict | None, error: str) -> None:
            for t in (data or {}).get("topics") or []:
                if isinstance(t, dict) and str(t.get("name") or "").strip():
                    merged.append({"name": re.sub(r"\s+", " ", str(t["name"])).strip()[:120], "description": str(t.get("description") or "")[:400],
                                   "learning_objectives": [str(o)[:200] for o in (t.get("learning_objectives") or [])[:6]],
                                   "merges": [str(m) for m in (t.get("merges") or [])]})

        self.many(prompts, 4000, reduced)
        if not merged:  # fall back: most frequent mentions
            self.log("Merge step failed — using the most frequent topic mentions instead.", "warn")
            seen = {}
            for c in candidates:
                seen.setdefault(c["name"].lower(), {"name": c["name"], "description": c["description"], "learning_objectives": c["key_points"][:4], "merges": []})
            merged = [seen[n.lower()] for n, _ in counts.most_common(target) if n.lower() in seen]
        # dedupe names, cap
        unique, names = [], set()
        for t in merged:
            if t["name"].lower() not in names:
                names.add(t["name"].lower())
                unique.append(t)
        merged = unique[:MAX_TOPICS]
        # candidate → final topic
        lookup = {}
        for t in merged:
            lookup[t["name"].lower()] = t["name"]
            for m in t.get("merges") or []:
                lookup[m.strip().lower()] = t["name"]
        for x in passages:
            x["topics"] = list(dict.fromkeys(lookup.get(c.lower()) or self._closest(c, merged) for c in x.get("candidates") or []))
        # proposal (only topics that are new)
        existing_lower = {t.name.lower() for t in existing}
        items = []
        for t in merged:
            sources = sorted({passages[c["passage"]]["material"] for c in candidates if (lookup.get(c["name"].lower()) or "") == t["name"]})
            items.append({"name": t["name"], "description": t["description"], "learning_objectives": t["learning_objectives"],
                          "source_sections": sources[:8], "exists": t["name"].lower() in existing_lower})
        new_items = [i for i in items if not i["exists"]]
        if new_items:
            self.propose("topics", f"{len(new_items)} topics from materials · {self.course.code}",
                         f"Built from {len(passages)} passage(s) of course material by AI task #{self.task.id}.", new_items)
        self.result["topics"] = {"total": len(merged), "new": len(new_items), "names": [t["name"] for t in merged]}
        self.log(f"Syllabus ready: {len(merged)} topic(s), {len(new_items)} new (proposed for approval).")
        self.progress("topics", total + 1, total + 1, "Topics ready")
        return [{"name": t["name"], "description": t["description"]} for t in merged]

    @staticmethod
    def _closest(name: str, topics: list[dict]) -> str:
        words = _words(name)
        best = max(topics, key=lambda t: _similar(words, _words(t["name"] + " " + t.get("description", ""))), default=None)
        return best["name"] if best else name

    def assign_passages(self, topics: list[dict], passages: list[dict]) -> None:
        """Passages without topics yet (existing-topic mode) → keyword match."""
        for x in passages:
            if x.get("topics"):
                continue
            words = _words(x["text"][:6000])
            scored = sorted(topics, key=lambda t: -len(_words(t["name"] + " " + t.get("description", "")) & words))
            x["topics"] = [t["name"] for t in scored[:3]]

    # ---- materials
    def map_materials(self, materials: list[Material], passages: list[dict]) -> None:
        self.progress("materials", 0, 1, "Matching materials to topics")
        items = []
        for m in materials:
            votes = Counter(t for x in passages if x["material_id"] == m.id for t in x.get("topics") or [])
            if not votes:
                continue
            best = votes.most_common(1)[0][0]
            if best != (m.topic or ""):
                items.append({"material_id": m.id, "title": m.title, "before": m.topic or "", "after": best[:120],
                              "covers": [t for t, _ in votes.most_common(6)]})
        if items:
            self.propose("material_topics", f"Tag {len(items)} material(s) with topics · {self.course.code}",
                         f"Main topic of each material, from AI task #{self.task.id}.", items)
        self.log(f"Materials: {len(items)} topic tag change(s) proposed." if items else "Materials already carry the right topic tags.")
        self.progress("materials", 1, 1, "Materials matched")

    # ---- classify
    def classify(self, topics: list[dict]) -> None:
        p = self.params
        questions = _bank_questions(self.db, self.course)
        if p.get("only_untagged"):
            questions = [q for q in questions if not (q.topic or "").strip()]
        total = len(questions)
        self.result["classify"] = {"questions": total, "changed": 0, "unmatched": 0}
        if not total:
            self.log("No bank questions to map.")
            self.progress("classify", 1, 1, "No questions to map")
            return
        batches = [questions[i : i + CLASSIFY_BATCH] for i in range(0, total, CLASSIFY_BATCH)]
        self.progress("classify", 0, total, f"Mapping {total} bank question(s) to {len(topics)} topic(s)")
        menu = "\n".join(f"{i + 1}. {t['name']}" + (f" — {t['description'][:140]}" if t.get("description") else "") for i, t in enumerate(topics))
        want_diff = p.get("reclassify_difficulty")
        prompts = []
        for batch in batches:
            rows = []
            for q in batch:
                opts = " | ".join(f"{k}) {str(getattr(q, f'option_{k.lower()}') or '')[:70]}" for k in "ABCD" if getattr(q, f"option_{k.lower()}", None))
                rows.append(f"[{q.id}] {(q.text or '')[:280]} :: {opts}")
            prompts.append([
                {"role": "system", "content": "You classify exam questions into a course syllabus. Reply with JSON only."},
                {"role": "user", "content": (
                    f"Course: {self.course.code} — {self.course.title}\nTOPICS:\n{menu}\n\n"
                    "For EVERY question below give the number of the topic it tests (0 only if it fits none)"
                    + (" and its difficulty (easy|medium|hard)" if want_diff else "")
                    + ". JSON: {\"a\":[{\"id\":123,\"t\":2" + (",\"d\":\"medium\"" if want_diff else "") + "}]}\n\nQUESTIONS:\n" + "\n".join(rows))},
            ])
        by_id = {q.id: q for q in questions}
        items: list[dict] = []
        done = {"n": 0, "unmatched": 0}

        def got(index: int, data: dict | None, error: str) -> None:
            answered = set()
            for a in (data or {}).get("a") or (data or {}).get("assignments") or []:
                if not isinstance(a, dict):
                    continue
                try:
                    qid, number = int(a.get("id")), int(a.get("t", a.get("topic", 0)) or 0)
                except (TypeError, ValueError):
                    continue
                q = by_id.get(qid)
                if q is None or qid in answered:
                    continue
                answered.add(qid)
                if not 1 <= number <= len(topics):
                    done["unmatched"] += 1
                    continue
                before = {k: getattr(q, k) or "" for k in ("topic", "subtopic", "difficulty", "objective")}
                after = {}
                if topics[number - 1]["name"] != before["topic"]:
                    after["topic"] = topics[number - 1]["name"]
                d = str(a.get("d") or "").lower()
                if want_diff and d in ("easy", "medium", "hard") and d != before["difficulty"]:
                    after["difficulty"] = d
                if after:
                    items.append({"question_id": q.id, "text": (q.text or "")[:160], "before": before, "after": after})
            done["n"] += len(batches[index])
            self.progress("classify", min(done["n"], total), total, f"Mapped {min(done['n'], total)} of {total} questions")

        self.many(prompts, 1800, got)
        items.sort(key=lambda i: (i["after"].get("topic", ""), i["question_id"]))
        if items:
            self.propose("classification", f"Map {len(items)} questions to topics · {self.course.code}",
                         f"Every bank question in {self.course.code} checked against {len(topics)} topic(s) by AI task #{self.task.id}.", items)
        self.result["classify"] = {"questions": total, "changed": len(items), "unmatched": done["unmatched"]}
        extra = f", {done['unmatched']} fit no topic (left unchanged)" if done["unmatched"] else ""
        self.log(f"Checked all {total} bank question(s): {len(items)} topic change(s) proposed{extra}.")

    # ---- generate
    def generate(self, topics: list[dict], passages: list[dict], count: int) -> None:
        p = self.params
        # allocate by how much material each topic has (at least 1 each)
        weight = Counter(t for x in passages for t in x.get("topics") or [])
        names = [t["name"] for t in topics]
        weights = [max(1, weight.get(n, 0)) for n in names]
        if count < len(names):  # fewer questions than topics → biggest topics first
            order = sorted(range(len(names)), key=lambda i: -weights[i])[:count]
            names, weights = [names[i] for i in order], [weights[i] for i in order]
        total_w = sum(weights)
        raw = [count * w / total_w for w in weights]
        alloc = [max(1, int(r)) for r in raw]
        for i in sorted(range(len(raw)), key=lambda i: -(raw[i] - int(raw[i]))):
            if sum(alloc) >= count:
                break
            alloc[i] += 1
        while sum(alloc) > count:
            alloc[alloc.index(max(alloc))] -= 1
        plan = {n: a for n, a in zip(names, alloc) if a > 0}
        desc = {t["name"]: t.get("description", "") for t in topics}
        # material text per topic
        sources: dict[str, list[dict]] = defaultdict(list)
        for x in passages:
            for t in x.get("topics") or []:
                sources[t].append(x)
        # dedupe against the bank
        bank_norm: set[str] = set()
        bank_words: dict[str, list[set[str]]] = defaultdict(list)
        for q in _bank_questions(self.db, self.course):
            bank_norm.add(_norm(q.text))
            bank_words[q.topic or ""].append(_words(q.text))
        mix = p.get("difficulty") or {"easy": 30, "medium": 50, "hard": 20}
        self.progress("generate", 0, count, f"Writing {count} questions across {len(plan)} topic(s)")
        self.log("Question plan: " + ", ".join(f"{n} {a}" for n, a in list(plan.items())[:12]) + (" …" if len(plan) > 12 else ""))

        made: dict[str, list[dict]] = defaultdict(list)
        stems: dict[str, list[set[str]]] = defaultdict(list)
        stats = {"invalid": 0, "duplicates": 0}
        rounds = {n: 0 for n in plan}

        def difficulties(n: int, seed: int) -> list[str]:
            total = sum(mix.values())
            out = []
            for k in ("easy", "medium", "hard"):
                out += [k] * round(n * mix[k] / total)
            while len(out) < n:
                out.append("medium")
            return out[:n]

        def prompt_for(topic: str, n: int, batch_no: int) -> list[dict]:
            pool = sources.get(topic) or passages
            text = ""
            if pool:  # rotate through the topic's passages so batches cover different parts
                x = pool[batch_no % len(pool)]
                body = x["text"]
                window = SOURCE_CHARS
                offset = ((batch_no // len(pool)) * window // 2) % max(1, len(body) - window) if len(body) > window else 0
                text = f"Material: {x['material']}\n" + body[offset : offset + window]
            diff = Counter(difficulties(n, batch_no))
            avoid = [q["text"][:90] for q in made[topic][-25:]]
            instructions = p.get("instructions") or ""
            return [
                {"role": "system", "content": "You write rigorous university exam multiple-choice questions for an exam-prep platform. Every question must be answerable from the provided material. Reply with JSON only."},
                {"role": "user", "content": (
                    f"Course: {self.course.code} — {self.course.title}\nTopic: {topic}" + (f" — {desc.get(topic, '')}" if desc.get(topic) else "") + "\n"
                    + (f"Staff instructions: {instructions}\n" if instructions else "")
                    + f"\nWrite exactly {n} NEW multiple-choice questions on this topic: " + ", ".join(f"{v} {k}" for k, v in diff.items() if v) + ". "
                    "Four options A-D, exactly one correct, plausible distractors, no 'all of the above', vary question styles (definition, application, "
                    "scenario, comparison, calculation where relevant). Explanation cites the idea from the material. "
                    + ("Do NOT repeat or paraphrase these existing questions: " + " || ".join(avoid) + ". " if avoid else "")
                    + "JSON: {\"questions\":[{\"text\":\"...\",\"option_a\":\"...\",\"option_b\":\"...\",\"option_c\":\"...\",\"option_d\":\"...\","
                    "\"correct\":\"A\",\"explanation\":\"...\",\"difficulty\":\"easy|medium|hard\",\"subtopic\":\"...\",\"objective\":\"...\"}]}\n\n"
                    + (f"MATERIAL:\n{text}" if text else "No material text is available — use standard university-level knowledge of this topic."))},
            ]

        def accept(topic: str, q: dict, source: str) -> bool:
            if not isinstance(q, dict):
                return False
            text = re.sub(r"\s+", " ", str(q.get("text") or "")).strip()
            options = {k: re.sub(r"\s+", " ", str(q.get(f"option_{k.lower()}") or "")).strip() for k in "ABCD"}
            correct = str(q.get("correct") or "").strip().upper()[:1]
            if len(text) < 12 or correct not in "ABCD" or not options.get(correct) or sum(1 for v in options.values() if v) < 4:
                stats["invalid"] += 1
                return False
            if len({v.lower() for v in options.values()}) < 4:
                stats["invalid"] += 1
                return False
            norm, words = _norm(text), _words(text)
            if norm in bank_norm or any(_similar(words, w) >= 0.9 for w in stems[topic]) or any(_similar(words, w) >= 0.9 for w in bank_words.get(topic, [])):
                stats["duplicates"] += 1
                return False
            diff = str(q.get("difficulty") or "medium").lower()
            item = {"text": text[:1200], **{f"option_{k.lower()}": options[k][:400] for k in "ABCD"}, "correct": correct,
                    "explanation": str(q.get("explanation") or "")[:1200], "topic": topic[:120], "subtopic": str(q.get("subtopic") or "")[:120],
                    "difficulty": diff if diff in ("easy", "medium", "hard") else "medium", "objective": str(q.get("objective") or "")[:240],
                    "source": source[:160]}
            made[topic].append(item)
            stems[topic].append(words)
            bank_norm.add(norm)
            return True

        def total_made() -> int:
            return sum(len(v) for v in made.values())

        saved: set[str] = set()

        def flush(topic: str) -> None:
            if topic in saved or not made[topic]:
                return
            saved.add(topic)
            self.propose("questions", f"{len(made[topic])} questions · {topic} · {self.course.code}",
                         f"Generated from course material by AI task #{self.task.id}.", made[topic])

        counter = 0
        while True:
            jobs: list[tuple[str, int, int]] = []
            for topic, want in plan.items():
                missing = want - len(made[topic])
                if missing <= 0 or rounds[topic] >= 3:
                    continue
                rounds[topic] += 1
                ask = missing if rounds[topic] == 1 else missing + 2
                while ask > 0:
                    n = min(GEN_BATCH, ask)
                    jobs.append((topic, n, counter))
                    counter += 1
                    ask -= n
            if not jobs:
                break
            prompts = [prompt_for(t, n, b) for t, n, b in jobs]

            def got(index: int, data: dict | None, error: str) -> None:
                topic = jobs[index][0]
                pool = sources.get(topic) or passages
                src = f"AI task #{self.task.id} · {pool[jobs[index][2] % len(pool)]['material']}" if pool else f"AI task #{self.task.id}"
                for q in (data or {}).get("questions") or []:
                    if len(made[topic]) >= plan[topic]:
                        break
                    accept(topic, q, src)
                self.progress("generate", min(total_made(), count), count, f"Wrote {min(total_made(), count)} of {count} questions")
                remaining = [j for j in jobs[index + 1 :] if j[0] == topic]
                if len(made[topic]) >= plan[topic] and not remaining:
                    flush(topic)

            try:
                self.many(prompts, min(8000, 520 * GEN_BATCH + 400), got)
            except _Stop:
                for topic in plan:
                    flush(topic)
                self.result["generate"] = {"asked": count, "made": total_made(), **stats}
                raise
        for topic in plan:
            flush(topic)
        n = total_made()
        self.result["generate"] = {"asked": count, "made": n, **stats}
        extra = f" ({stats['duplicates']} duplicates and {stats['invalid']} malformed drafts were discarded)" if stats["duplicates"] or stats["invalid"] else ""
        self.log(f"Wrote {n} of {count} question(s){extra}.", "info" if n >= count else "warn")


# ----------------------------------------------------------- cleanup & notes
def _dedupe(self: _Job) -> None:
    from .admin_tools import duplicate_groups

    self.progress("dedupe", 0, 1, "Scanning the bank for duplicates")
    rows = _bank_questions(self.db, self.course)
    groups = duplicate_groups(rows, threshold=0.9)
    by_id = {q.id: q for q in rows}
    items = [{"question_id": d, "text": (by_id[d].text or "")[:200], "topic": by_id[d].topic or "", "keep_id": g["keep"],
              "keep_text": (by_id[g["keep"]].text or "")[:200], "similarity": g["similarity"], "reason": f"duplicate of #{g['keep']} ({g['similarity']}% similar)"}
             for g in groups for d in g["drop"]]
    self.result["duplicates"] = {"checked": len(rows), "groups": len(groups), "extra_copies": len(items)}
    if items:
        self.propose("deletions", f"Remove {len(items)} duplicate questions from {self.course.code}",
                     f"{len(groups)} duplicate groups among {len(rows)} questions; the best copy of each group is kept.", items)
        self.log(f"Found {len(groups)} duplicate group(s) — {len(items)} extra cop(ies) proposed for removal.")
    else:
        self.log(f"No duplicates among {len(rows)} questions.")
    self.progress("dedupe", 1, 1, "Duplicates checked")


def _answer_text(q: Question) -> str:
    opts = {k: v for k, v in zip("ABCD", (q.option_a, q.option_b, q.option_c, q.option_d)) if v}
    letters = [c for c in str(q.correct or "").upper() if c in opts]
    return "; ".join(opts[c] for c in letters) or str(q.correct or "")


def _write_materials(self: _Job, passages: list[dict]) -> None:
    p = self.params
    rows = _bank_questions(self.db, self.course)
    wanted = {t.lower() for t in p.get("topics") or []}
    by_topic: dict[str, list[Question]] = defaultdict(list)
    for q in rows:
        name = (q.topic or "").strip() or "General"
        if wanted and name.lower() not in wanted:
            continue
        by_topic[name].append(q)
    if not by_topic:
        self.log("No bank questions to write materials from.", "warn")
        return
    sources: dict[str, list[dict]] = defaultdict(list)
    for x in passages:
        for t in x.get("topics") or []:
            sources[t.lower()].append(x)
    jobs: list[tuple[str, int, list[Question]]] = []
    for name, qs in sorted(by_topic.items(), key=lambda kv: -len(kv[1])):
        for part, start in enumerate(range(0, len(qs), WRITE_BATCH)):
            jobs.append((name, part, qs[start : start + WRITE_BATCH]))
    total = len(jobs)
    self.progress("write", 0, total, f"Writing study notes for {len(by_topic)} topic(s)")
    self.log(f"Writing materials for {len(by_topic)} topic(s) from {sum(len(v) for v in by_topic.values())} question(s) in {total} part(s).")
    instructions = p.get("instructions") or ""
    prompts = []
    for name, part, qs in jobs:
        pool = sources.get(name.lower()) or []
        source = ""
        if pool:
            x = pool[part % len(pool)]
            source = f"Material: {x['material']}\n" + x["text"][:WRITE_SOURCE_CHARS]
        lines = "\n".join(
            f"[{q.id}] {q.text}\n  Correct answer: {_answer_text(q)}" + (f"\n  Why: {q.explanation.strip()[:400]}" if (q.explanation or "").strip() else "")
            for q in qs)
        prompts.append([
            {"role": "system", "content": "You are an expert university lecturer writing clear, accurate study notes for an exam-prep platform. Reply with JSON only."},
            {"role": "user", "content": (
                f"Course: {self.course.code} — {self.course.title}\nTopic: {name}" + (f" (part {part + 1})" if part else "") + "\n"
                + (f"Staff instructions: {instructions}\n" if instructions else "")
                + "\nWrite study notes on this topic. A student who reads ONLY these notes must be able to answer every question below: "
                "teach each fact, rule, case, date, formula and definition they test, explain WHY, and add short examples. "
                "Organise by idea (not question by question), use plain English, never mention the questions, never write a quiz or an answer list. "
                "Block types: heading, subheading, paragraph, list (items), numbers (items), definition (term, meaning), keyterm (term, meaning), example (text), note (text), tip (text), summary (items).\n"
                "JSON: {\"title\":\"...\",\"summary\":[\"key takeaway\", ...],\"sections\":[{\"title\":\"...\",\"blocks\":[{\"type\":\"paragraph\",\"text\":\"...\"}]}],"
                "\"covers\":[question ids fully covered]}\n\n"
                f"QUESTIONS (with answers):\n{lines}\n\n" + (f"COURSE MATERIAL (use it, prefer its wording):\n{source}" if source else "No course material — rely on accurate standard knowledge of the subject."))},
        ])
    built: dict[str, dict] = {}
    done = [0]

    def got(index: int, data: dict | None, error: str) -> None:
        name, part, qs = jobs[index]
        done[0] += 1
        self.progress("write", done[0], total, f"Wrote part {done[0]} of {total}")
        if not data or not isinstance(data.get("sections"), list):
            return
        entry = built.setdefault(name, {"title": "", "topic": name, "summary": [], "sections": [], "covers": set(), "questions": set()})
        if part == 0 or not entry["title"]:
            entry["title"] = str(data.get("title") or f"{name}: study notes")[:200]
        entry["summary"] += [str(x)[:300] for x in data.get("summary") or [] if str(x).strip()]
        for sec in data["sections"]:
            if isinstance(sec, dict) and sec.get("blocks"):
                entry["sections"].append({"title": str(sec.get("title") or name)[:200], "blocks": sec["blocks"]})
        ids = {q.id for q in qs}
        entry["questions"] |= ids
        entry["covers"] |= {int(i) for i in data.get("covers") or [] if str(i).isdigit() and int(i) in ids}

    self.many(prompts, 6000, got)
    made = 0
    for name, entry in built.items():
        if not entry["sections"]:
            continue
        item = {"title": entry["title"], "topic": name, "description": f"Study notes covering {len(entry['questions'])} bank question(s) on {name}.",
                "summary": entry["summary"][:12], "sections": entry["sections"][:60], "covers_question_ids": sorted(entry["covers"]),
                "question_count": len(entry["questions"])}
        missing = len(entry["questions"]) - len(entry["covers"])
        self.propose("material", f"Material: {entry['title'][:150]}", f"{len(item['sections'])} sections · covers {len(entry['covers'])} of {len(entry['questions'])} questions"
                     + (f" ({missing} not confirmed)" if missing else ""), [item])
        made += 1
    self.result["materials_written"] = made
    self.log(f"Wrote {made} material(s) for review.")


_Job.dedupe = _dedupe
_Job.write_materials = _write_materials
