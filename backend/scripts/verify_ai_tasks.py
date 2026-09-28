"""Background AI task checks (bulk course work at full capacity).

Runs in-process against a throwaway SQLite database with a scripted fake
provider (no network, no key needed):

    cd backend && PYTHONPATH=. .venv/bin/python scripts/verify_ai_tasks.py

Covers: estimate, reading every material (map → reduce topics), mapping EVERY
bank question onto the topics, tagging materials, generating 1000 questions
(deduped, validated, split into reviewable proposals), approve-all, cancel,
cost ceiling, empty balance, restart recovery, the chat agent starting a task,
task calls not eating the chat's daily limit, and staff-only access.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import uuid
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="agtask-"))
os.environ.update({
    "CBT_DATABASE_URL": f"sqlite:///{TMP / 'tasks.db'}",
    "DEEPSEEK_API_KEY": "sk-test-not-real", "AI_PROVIDER": "deepseek", "GEMINI_API_KEY": "",
    "AI_TASK_WORKERS": "4", "AI_RETRY_BASE": "0.01",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import socket  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from app.services import ai_providers as providers  # noqa: E402

PASSED = FAILED = 0


def check(name: str, ok: bool, detail=None) -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:300]}")


TOPICS = ["Negligence", "Nuisance", "Defamation", "Trespass"]
KEYWORDS = {"Negligence": "duty of care", "Nuisance": "interference with land", "Defamation": "reputation", "Trespass": "direct entry"}
MODE = {"slow": 0.0, "fail": ""}
COUNTER = {"q": 0, "calls": 0}
LOCK = threading.Lock()


def usage(i: int = 1500, o: int = 400) -> dict:
    return {"input": i, "output": o, "cached": 0}


def fake_complete(messages, **_kw):
    with LOCK:
        COUNTER["calls"] += 1
    if MODE["slow"]:
        time.sleep(MODE["slow"])
    if MODE["fail"]:
        raise providers.ProviderError("deepseek: balance empty (402)", 502, MODE["fail"])
    system, user = messages[0]["content"], messages[-1]["content"]
    if "analyse university course material" in system:
        found = [t for t, k in KEYWORDS.items() if k in user.split("PASSAGE:")[-1]]
        body = {"topics": [{"name": (f"{t} basics" if n % 2 else t), "description": f"About {t.lower()}.", "key_points": [KEYWORDS[t]]} for n, t in enumerate(found)]}
        return json.dumps(body), usage(), "stop", "deepseek-flash"
    if "design course syllabi" in system:
        body = {"topics": [{"name": t, "description": f"The tort of {t.lower()}.", "learning_objectives": [f"Explain {t.lower()}"], "merges": [t, f"{t} basics"]} for t in TOPICS]}
        return json.dumps(body), usage(3000, 900), "stop", "deepseek-flash"
    if "classify exam questions" in system:
        menu = re.findall(r"^(\d+)\. (\w+)", user, re.M)
        numbers = {name: int(n) for n, name in menu}
        out = []
        for qid, text in re.findall(r"^\[(\d+)\] (.*)$", user, re.M):
            hit = next((t for t, k in KEYWORDS.items() if k in text), None)
            out.append({"id": int(qid), "t": numbers.get(hit, 0) if hit else 0, "d": "hard"})
        return json.dumps({"a": out}), usage(5000, 800), "stop", "deepseek-flash"
    if "write rigorous" in system:
        n = int(re.search(r"Write exactly (\d+) NEW", user).group(1))
        topic = re.search(r"Topic: (\w+)", user).group(1)
        qs = []
        for _ in range(n):
            with LOCK:
                COUNTER["q"] += 1
                k = COUNTER["q"]
            qs.append({"text": f"In {topic.lower()} scenario {k}, which element of {KEYWORDS[topic]} case {k * 7919} applies first?", "option_a": f"Element {k}a", "option_b": f"Element {k}b",
                       "option_c": f"Element {k}c", "option_d": f"Element {k}d", "correct": "ABCD"[k % 4], "explanation": f"Per the material, {KEYWORDS[topic]}.",
                       "difficulty": ["easy", "medium", "hard"][k % 3], "subtopic": "Elements", "objective": f"Apply {topic.lower()}"})
        if n > 3:  # the model sometimes repeats itself or breaks an item
            qs.append(dict(qs[0]))
            qs.append({"text": "Broken?", "option_a": "x", "option_b": "", "correct": "B"})
        return json.dumps({"questions": qs}), usage(2500, 330 * n), "stop", "deepseek-flash"
    return "{}", usage(), "stop", "deepseek-flash"


SCRIPT: list = []


def fake_complete_tools(messages, tools, **_kw):
    step = SCRIPT.pop(0) if SCRIPT else {"text": "Done.", "tool_calls": [], "usage": usage(), "finish": "stop", "model": "deepseek-flash", "assistant": {"role": "assistant", "content": "Done."}}
    return step


def calls(name: str, args: dict) -> dict:
    cid = f"call_{uuid.uuid4().hex[:6]}"
    return {"text": "", "tool_calls": [{"id": cid, "name": name, "arguments": json.dumps(args)}], "usage": usage(), "finish": "tool_calls", "model": "deepseek-flash",
            "assistant": {"role": "assistant", "content": "", "tool_calls": [{"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}


def reply(text: str) -> dict:
    return {"text": text, "tool_calls": [], "usage": usage(), "finish": "stop", "model": "deepseek-flash", "assistant": {"role": "assistant", "content": text}}


impl = providers.PROVIDERS["deepseek"]
impl.complete = fake_complete  # type: ignore[method-assign]
impl.complete_tools = fake_complete_tools  # type: ignore[method-assign]


def main() -> None:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.1)
    base = f"http://127.0.0.1:{port}/api"

    def call(method, path, body=None, token=None):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                code, raw = r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            code, raw = e.code, e.read().decode()
        try:
            return code, json.loads(raw)
        except ValueError:
            return code, raw

    from app.db import SessionLocal
    from app.models import AIProposal, AIStaffUsage, AITask, Course, CourseTopic, Material, MaterialSection, Question
    from app.services.ai_core import tasks
    from app.services.course_bank import ensure_bank_quiz

    code, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    staff = admin["token"]
    code, player = call("POST", "/auth/register", {"username": "tk" + uuid.uuid4().hex[:6], "password": "secret123", "phone": "0803" + str(uuid.uuid4().int)[:7], "display_name": "T"})

    # course: 2 long materials (about 70k characters) + 90 untagged/mis-tagged bank questions
    with SessionLocal() as db:
        course = Course(code=f"TRT{uuid.uuid4().hex[:3].upper()}", title="Law of Torts")
        db.add(course)
        db.flush()
        mats = []
        for mi, pair in enumerate([TOPICS[:2], TOPICS[2:]]):
            m = Material(course_id=course.id, title=f"Torts reader {mi + 1}", kind="material", status="published")
            db.add(m)
            db.flush()
            mats.append(m.id)
            for si, topic in enumerate(pair * 3):
                blocks = [{"type": "paragraph", "text": f"{topic} paragraph {p}: the rule on {KEYWORDS[topic]} is explained with cases and examples. " * 3} for p in range(18)]
                db.add(MaterialSection(material_id=m.id, position=si + 1, title=f"{topic} part {si + 1}", body=json.dumps(blocks)))
        bank = ensure_bank_quiz(db, course)
        for i in range(90):
            topic = TOPICS[i % 4]
            db.add(Question(quiz_id=bank.id, course_id=course.id, position=i, text=f"Bank item {i}: what does {KEYWORDS[topic]} require in situation {i}?",
                            option_a="One", option_b="Two", option_c="Three", option_d="Four", correct="A", difficulty="medium", topic="" if i % 3 else "Misc"))
        db.add(Question(quiz_id=bank.id, course_id=course.id, position=99, text="Unrelated item about company law registration?", option_a="a", option_b="b", option_c="c", option_d="d", correct="A", topic=""))
        db.commit()
        cid, mat_ids = course.id, mats

    print("access + validation")
    code, _ = call("GET", "/admin/ai/tasks", token=player["token"])
    check("players cannot see AI tasks", code in (401, 403), code)
    code, body = call("POST", "/admin/ai/tasks", {"course_id": cid, "generate_questions": 1001}, staff)
    check("more than 1000 questions → 422", code == 422, body)
    code, body = call("POST", "/admin/ai/tasks", {"course_id": cid, "material_ids": [999999]}, staff)
    check("unknown material → 404", code == 404, body)
    code, body = call("POST", "/admin/ai/tasks", {"course_id": cid, "build_topics": False, "classify_questions": False, "map_materials": False}, staff)
    check("nothing to do → 422", code == 422, body)

    print("estimate")
    full = {"course_id": cid, "build_topics": True, "classify_questions": True, "map_materials": True, "reclassify_difficulty": True, "generate_questions": 1000, "difficulty": {"easy": 20, "medium": 50, "hard": 30}, "instructions": "Nigerian law school level"}
    code, est = call("POST", "/admin/ai/tasks/estimate", full, staff)
    e = est.get("estimate", {}) if isinstance(est, dict) else {}
    check("estimate counts materials, text and bank", code == 200 and e.get("materials") == 2 and e.get("characters", 0) > 50000 and e.get("bank_questions") == 91, est)
    check("estimate gives calls, cost and minutes", e.get("calls", 0) > 90 and e.get("cost", 0) > 0 and e.get("minutes", 0) >= 1, e)

    print("full course task: topics + map every question + tag materials + 1000 questions")
    started = time.monotonic()
    code, task = call("POST", "/admin/ai/tasks", {**full, "max_cost": 5}, staff)
    check("task accepted (202, queued)", code == 202 and task.get("status") in ("queued", "running"), task)
    tid = task["id"]
    tasks.wait_idle(180)
    code, t = call("GET", f"/admin/ai/tasks/{tid}", token=staff)
    check("task finished", t.get("status") == "done" and t["progress"].get("percent") == 100, {k: t.get(k) for k in ("status", "error", "progress")})
    print(f"       ({time.monotonic() - started:.1f}s, {t.get('calls')} calls, ${t.get('cost')})")
    r = t.get("result", {})
    check("read every material", r.get("read", {}).get("materials") == 2 and r["read"]["passages"] >= 6, r.get("read"))
    check("merged mentions into the 4 real topics", sorted(r.get("topics", {}).get("names", [])) == sorted(TOPICS), r.get("topics"))
    check("every bank question checked", r.get("classify", {}).get("questions") == 91, r.get("classify"))
    check("unrelated question left unmatched", r.get("classify", {}).get("unmatched") == 1, r.get("classify"))
    check("exactly 1000 questions written", r.get("generate", {}).get("made") == 1000, r.get("generate"))
    check("duplicates and malformed drafts discarded", r["generate"].get("duplicates", 0) > 0 and r["generate"].get("invalid", 0) > 0, r.get("generate"))
    check("log tells the story", any("Checked all 91" in x["text"] for x in t["log"]) and any("Wrote 1000 of 1000" in x["text"] for x in t["log"]), [x["text"] for x in t["log"]][-6:])
    props = t.get("proposals", [])
    kinds = [p["kind"] for p in props]
    check("proposals: topics, material tags, mapping, questions", {"topics", "material_topics", "classification", "questions"} <= set(kinds), kinds)
    check("question proposals stay reviewable (≤150 each)", all(p["count"] <= 150 for p in props if p["kind"] == "questions") and sum(p["count"] for p in props if p["kind"] == "questions") == 1000, [(p["kind"], p["count"]) for p in props])
    with SessionLocal() as db:
        rows = [db.get(AIProposal, p["id"]) for p in props]
        qs = [i for p in rows if p.kind == "questions" for i in p.payload["items"]]
        texts = [q["text"] for q in qs]
        check("no duplicate questions in the batch", len(set(texts)) == len(texts), len(texts) - len(set(texts)))
        check("every question valid (4 options, answer present)", all(q["correct"] in "ABCD" and all(q[f"option_{k}"] for k in "abcd") for q in qs))
        per_topic = {tp: sum(1 for q in qs if q["topic"] == tp) for tp in TOPICS}
        check("questions spread across all topics", all(v >= 150 for v in per_topic.values()), per_topic)
        diff = {d: sum(1 for q in qs if q["difficulty"] == d) for d in ("easy", "medium", "hard")}
        check("difficulty mix present", all(diff.values()), diff)
        cls = next(p for p in rows if p.kind == "classification")
        check("mapping covers every related question (90)", len(cls.payload["items"]) == 90, len(cls.payload["items"]))
        check("mapping also re-rates difficulty when asked", all(i["after"].get("difficulty") == "hard" for i in cls.payload["items"]))
        mt = next(p for p in rows if p.kind == "material_topics")
        check("each material tagged with its main topic", sorted(i["after"] for i in mt.payload["items"]) in (["Defamation", "Negligence"], ["Defamation", "Nuisance"], ["Negligence", "Trespass"], ["Nuisance", "Trespass"]), mt.payload["items"])
        check("proposals link back to the task", all(p.payload.get("task_id") == tid for p in rows))
        check("nothing saved before approval", db.query(Question).filter(Question.course_id == cid).count() == 91 and db.query(CourseTopic).filter(CourseTopic.course_id == cid).count() == 0)
        staff_rows = db.query(AIStaffUsage).filter(AIStaffUsage.request_id == f"task-{tid}").count()
        check("every AI call recorded in usage", staff_rows == t["calls"] and staff_rows > 90, (staff_rows, t["calls"]))
    code, status = call("GET", "/admin/ai/status", token=staff)
    check("task calls don't eat the chat's daily limit", status.get("used_today") == 0, status.get("used_today"))
    code, listing = call("GET", f"/admin/ai/tasks?course_id={cid}", token=staff)
    check("task list shows proposal states", code == 200 and listing["tasks"][0]["id"] == tid and all(p["status"] == "pending" for p in listing["tasks"][0]["proposals"]) and listing["limits"]["max_questions"] == 1000, listing.get("limits"))
    code, prop = call("GET", f"/admin/ai/proposals/{props[0]['id']}", token=staff)
    check("proposal exposes task_id", prop.get("task_id") == tid, prop.get("task_id"))

    print("approve all")
    t0 = time.monotonic()
    code, summary = call("POST", f"/admin/ai/tasks/{tid}/approve-all", {}, staff)
    check("approve-all applies everything", code == 200 and summary["topics"] == 4 and summary["questions"] == 1000 and summary["classified"] == 90 and summary["materials"] == 2, summary)
    print(f"       ({time.monotonic() - t0:.1f}s)")
    with SessionLocal() as db:
        check("bank now holds 1091 questions", db.query(Question).filter(Question.course_id == cid).count() == 1091)
        check("4 official topics created", db.query(CourseTopic).filter(CourseTopic.course_id == cid).count() == 4)
        tagged = db.query(Question).filter(Question.course_id == cid, Question.topic.in_(TOPICS)).count()
        check("every related question now has its topic", tagged == 1090, tagged)
        check("materials carry topics", all(db.get(Material, m).topic in TOPICS for m in mat_ids))
    code, again = call("POST", f"/admin/ai/tasks/{tid}/approve-all", {}, staff)
    check("approve-all twice → 409", code == 409, again)

    print("cancel")
    MODE["slow"] = 0.4
    code, task = call("POST", "/admin/ai/tasks", {"course_id": cid, "build_topics": False, "classify_questions": False, "map_materials": False, "generate_questions": 400}, staff)
    time.sleep(1.2)
    code, body = call("POST", f"/admin/ai/tasks/{task['id']}/cancel", {}, staff)
    check("cancel accepted", code == 200 and body.get("cancel_requested"), body)
    tasks.wait_idle(60)
    MODE["slow"] = 0
    code, t = call("GET", f"/admin/ai/tasks/{task['id']}", token=staff)
    check("task stops as cancelled and keeps partial work", t["status"] == "cancelled" and 0 < t["result"].get("generate", {}).get("made", 0) < 400 and t["proposals"], {k: t.get(k) for k in ("status", "error")} | {"made": t["result"].get("generate")})
    check("existing topics reused when not rebuilding", "Using 4 existing" in json.dumps(t["log"]), [x["text"] for x in t["log"]][:4])

    print("limits + failures")
    code, task = call("POST", "/admin/ai/tasks", {"course_id": cid, "build_topics": False, "classify_questions": False, "map_materials": False, "generate_questions": 300, "max_cost": 0.01}, staff)
    tasks.wait_idle(60)
    code, t = call("GET", f"/admin/ai/tasks/{task['id']}", token=staff)
    check("cost ceiling stops the task with a clear message", t["status"] == "stopped" and "ceiling" in t["error"] and t["cost"] >= 0.01, (t["status"], t["error"], t["cost"]))
    MODE["fail"] = "balance"
    code, task = call("POST", "/admin/ai/tasks", {"course_id": cid, "generate_questions": 50}, staff)
    tasks.wait_idle(60)
    MODE["fail"] = ""
    code, t = call("GET", f"/admin/ai/tasks/{task['id']}", token=staff)
    check("empty balance → failed with a friendly hint", t["status"] == "failed" and "balance is empty" in t["error"], (t["status"], t["error"]))
    os.environ["AI_TASKS_DISABLED"] = "1"
    code, task = call("POST", "/admin/ai/tasks", {"course_id": cid, "generate_questions": 10}, staff)
    with SessionLocal() as db:
        row = db.get(AITask, task["id"])
        row.status = "running"
        db.commit()
    tasks.recover()
    code, t = call("GET", f"/admin/ai/tasks/{task['id']}", token=staff)
    check("restart marks running tasks interrupted", t["status"] == "interrupted" and "restarted" in t["error"], (t["status"], t["error"]))
    code, task = call("POST", "/admin/ai/tasks", {"course_id": cid, "generate_questions": 10}, staff)
    code, body = call("POST", f"/admin/ai/tasks/{task['id']}/cancel", {}, staff)
    check("queued task cancels at once", body.get("status") == "cancelled", body)
    os.environ["AI_TASKS_DISABLED"] = "0"

    print("chat agent starts bulk work instead of refusing")
    SCRIPT[:] = [calls("start_ai_task", {"course_id": cid, "material_ids": [mat_ids[0]], "build_topics": False, "classify_questions": True, "map_materials": False, "generate_questions": 60}),
                 reply("Started task — it will map every question and write 60 questions. Progress is in the Tasks tab.")]
    code, out = call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "Read reader 1, assign all questions to topics and make 60 questions"}], "course_id": cid}, staff)
    card = next((a for a in out.get("actions", []) if a.get("type") == "task"), None) if isinstance(out, dict) else None
    check("agent returns a task card", code == 200 and card and card["estimate"]["bank_questions"] == 1091, out)
    tasks.wait_idle(120)
    code, t = call("GET", f"/admin/ai/tasks/{card['id']}", token=staff) if card else (0, {})
    check("agent-started task runs to completion", t.get("status") == "done" and t["result"]["generate"]["made"] == 60, (t.get("status"), t.get("error"), t.get("result", {}).get("generate")))
    check("only the chosen material was read", t.get("result", {}).get("read", {}).get("materials") == 1, t.get("result", {}).get("read"))
    from app.services.ai_core import ADMIN_SYSTEM
    check("staff rules forbid excuses on bulk work", "Never refuse a bulk job" in ADMIN_SYSTEM and "start_ai_task" in ADMIN_SYSTEM)

    server.should_exit = True
    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
