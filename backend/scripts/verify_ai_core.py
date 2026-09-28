"""AI core checks: tools, the tutor agent, mini exams, staff proposals.

Runs in-process against a throwaway SQLite database with a scripted fake
provider (no network, no key needed):

    cd backend && PYTHONPATH=. .venv/bin/python scripts/verify_ai_core.py

Covers: permission-checked tools (students can't reach staff tools, tool
arguments are schema-validated), the tutor chat agent (tool events → answer →
mini-exam card), mini exams as real backend records (start / answer / timer /
finish / analysis / answers hidden until the end / owner-only), topic mastery
updates, AI feedback, the staff assistant (proposals only — nothing saved until
approved), approve with edits, reject, audit log and usage tracking.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="agcore-"))
os.environ.update({
    "CBT_DATABASE_URL": f"sqlite:///{TMP / 'core.db'}",
    "DEEPSEEK_API_KEY": "sk-test-not-real", "AI_PROVIDER": "deepseek", "GEMINI_API_KEY": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import socket  # noqa: E402
import threading  # noqa: E402
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


# ------------------------------------------------------------ fake provider
SCRIPT: list = []   # queue of responses; each is a dict or a callable(messages, tools) -> dict
SEEN: list = []     # (messages, tool names) per call


def reply(text: str) -> dict:
    return {"text": text, "tool_calls": [], "usage": {"input": 900, "output": 60, "cached": 700}, "finish": "stop", "model": "deepseek-flash", "assistant": {"role": "assistant", "content": text}}


def calls(*items: tuple[str, dict]) -> dict:
    tc = [{"id": f"call_{uuid.uuid4().hex[:6]}", "name": n, "arguments": json.dumps(a)} for n, a in items]
    return {"text": "", "tool_calls": tc, "usage": {"input": 800, "output": 40, "cached": 600}, "finish": "tool_calls", "model": "deepseek-flash",
            "assistant": {"role": "assistant", "content": "", "tool_calls": [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in tc]}}


def fake_complete_tools(messages, tools, **_kw):
    SEEN.append((json.loads(json.dumps(messages, default=str)), [t["function"]["name"] if "function" in t else t.get("name") for t in tools]))
    step = SCRIPT.pop(0) if SCRIPT else reply("Done.")
    return step(messages, tools) if callable(step) else step


def fake_complete(messages, **_kw):
    body = json.dumps({"headline": "Solid start", "summary": "You handled definitions well.", "mistake_patterns": ["Mixing up duty and breach"], "recommended_actions": ["Revise breach of duty"]})
    return body, {"input": 400, "output": 80, "cached": 0}, "deepseek-flash", "stop"


impl = providers.PROVIDERS["deepseek"]
impl.complete_tools = fake_complete_tools  # type: ignore[method-assign]
impl.complete = fake_complete  # type: ignore[method-assign]


def tool_results(messages: list) -> dict:
    return {m.get("name"): json.loads(m["content"]) for m in messages if m.get("role") == "tool"}


def sse(text: str) -> list[tuple[str, dict]]:
    out, event = [], None
    for line in text.splitlines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            out.append((event, json.loads(line[6:])))
    return out


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
    try:
        def call(method, path, body=None, token=None):
            req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    code, raw = r.status, r.read().decode()
            except urllib.error.HTTPError as e:
                code, raw = e.code, e.read().decode()
            try:
                return code, json.loads(raw)
            except ValueError:
                return code, raw

        def student():
            name = "core" + uuid.uuid4().hex[:6]
            code, body = call("POST", "/auth/register", {"username": name, "password": "secret123", "phone": "0803" + str(uuid.uuid4().int)[:7], "display_name": "Core Tester"})
            assert code in (200, 201), body
            return body["token"]

        code, admin = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
        staff = admin["token"]
        me, other = student(), student()

        # a course with a 24-question bank across three topics
        from app.db import SessionLocal
        from app.models import AIMiniExam, AIProposal, AIStaffUsage, AIToolCall, Course, CourseTopic, Question, StudentTopicProgress
        from app.services.course_bank import ensure_bank_quiz

        with SessionLocal() as db:
            course = Course(code=f"LAW{uuid.uuid4().hex[:3].upper()}", title="Law of Torts")
            db.add(course)
            db.flush()
            bank = ensure_bank_quiz(db, course)
            for i in range(24):
                topic = ["Negligence", "Nuisance", "Defamation"][i % 3]
                db.add(Question(quiz_id=bank.id, course_id=course.id, position=i, text=f"{topic} question {i}: which is right?", option_a="Right", option_b="Wrong", option_c="Also wrong", option_d="Nope",
                                correct="A", explanation=f"Because {topic.lower()} rule {i}.", difficulty=["easy", "medium", "hard"][i % 3], topic=topic))
            db.commit()
            course_id, course_code = course.id, course.code

        print("tool permissions + validation")
        from app.services.ai_core import registry
        student_tools, staff_tools = set(registry.names_for(registry.STUDENT)), set(registry.names_for(registry.STAFF))
        check("students get learning tools", {"search_question_bank", "get_my_progress", "create_mini_exam", "search_course_material"} <= student_tools, student_tools)
        check("students never get staff/writing tools", not (student_tools & {"propose_questions", "propose_topics", "propose_classification", "get_student_report", "get_class_performance", "analyze_question_bank"}), student_tools & staff_tools)
        check("no destructive tools exist at all", not any(n.startswith(("delete_", "drop_", "grant_", "change_score", "set_score")) for n in student_tools | staff_tools))

        code, conv = call("POST", "/tutor/conversations", {"title": "Torts"}, me)
        cid = conv["id"] if isinstance(conv, dict) and "id" in conv else conv.get("conversation", {}).get("id")

        # the model tries a staff tool, sends bad args, then does it properly
        SCRIPT[:] = [
            calls(("propose_questions", {"course_id": course_id, "questions": []}), ("get_course_topics", {"course_id": "abc"})),
            lambda m, t: (tool_results(m), reply("Tried."))[1],
        ]
        code, text = call("POST", f"/tutor/conversations/{cid}/messages", {"content": "Explain negligence", "context": {"course_id": course_id}}, me)
        ev = sse(text if isinstance(text, str) else json.dumps(text))
        tools = [d for e, d in ev if e == "tool" and d.get("status") != "running"]
        check("staff tool from a student → denied", any(t["name"] == "propose_questions" and t["status"] == "denied" for t in tools), tools)
        check("bad tool arguments → invalid (schema-checked)", any(t["name"] == "get_course_topics" and t["status"] == "invalid" for t in tools), tools)
        check("offered tool list is the student list", set(SEEN[0][1]) == student_tools, SEEN[0][1])
        check("agent rules sit after platform rules (stable prefix first)", "PLATFORM RULES" in SEEN[0][0][0]["content"] and SEEN[0][0][0]["content"].find("PLATFORM RULES") < SEEN[0][0][0]["content"].find("TOOLS"), SEEN[0][0][0]["content"][:200])
        with SessionLocal() as db:
            audit = db.query(AIToolCall).filter(AIToolCall.tool == "propose_questions").all()
            check("every tool call is audited", audit and audit[0].status == "denied" and audit[0].actor_role == "student", [(a.tool, a.status) for a in audit])

        print("tutor agent → real mini exam")
        SEEN.clear()
        SCRIPT[:] = [
            calls(("get_course_topics", {"course_id": course_id})),
            calls(("create_mini_exam", {"course_id": course_id, "topics": ["Negligence", "Nuisance"], "question_count": 6, "duration_minutes": 8, "difficulty": "mixed", "title": "Torts warm-up"})),
            reply("Your **Torts warm-up** is ready — press Start when you are."),
        ]
        code, text = call("POST", f"/tutor/conversations/{cid}/messages", {"content": "Give me a 6-question test on negligence and nuisance", "context": {"course_id": course_id}}, me)
        ev = sse(text)
        kinds = [e for e, _ in ev]
        check("stream: meta → tool → delta → actions → done", kinds[0] == "meta" and "tool" in kinds and "delta" in kinds and kinds[-2:] == ["actions", "done"], kinds)
        answer = "".join(d["text"] for e, d in ev if e == "delta")
        check("final answer streamed", "Torts warm-up" in answer, answer)
        actions = next(d["actions"] for e, d in ev if e == "actions")
        card = actions[0]
        check("mini-exam card action", card["type"] == "mini_exam" and card["question_count"] == 6 and card["duration_minutes"] == 8 and card["course"] == course_code, card)
        topics_seen = tool_results(SEEN[1][0]).get("get_course_topics")
        check("tool results reach the model (minimal data)", topics_seen and "Negligence" in json.dumps(topics_seen) and "correct" not in json.dumps(topics_seen), topics_seen)
        code, full = call("GET", f"/tutor/conversations/{cid}", token=me)
        last = full["messages"][-1]
        check("saved answer keeps tools + card", last["role"] == "assistant" and last["meta"].get("actions", [{}])[0].get("id") == card["id"] and last["meta"].get("tools"), last.get("meta"))

        eid = card["id"]
        print("mini exam lifecycle")
        code, ex = call("GET", f"/ai/mini-exams/{eid}", token=me)
        check("exam is a backend record, status ready", code == 200 and ex["status"] == "ready" and ex["question_count"] == 6, ex)
        check("questions stay hidden until START", "questions" not in ex, list(ex))
        check("someone else can't open it", call("GET", f"/ai/mini-exams/{eid}", token=other)[0] == 404)
        with SessionLocal() as db:
            first_qid = db.get(AIMiniExam, eid).items[0].question_id
        check("can't answer before starting", call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": first_qid, "selected": "A"}, me)[0] in (409, 423))
        check("someone else can't start it", call("POST", f"/ai/mini-exams/{eid}/start", token=other)[0] == 404)
        code, ex = call("POST", f"/ai/mini-exams/{eid}/start", token=me)
        check("start → in progress with a backend deadline", code == 200 and ex["status"] == "in_progress" and 0 < ex["seconds_left"] <= 8 * 60, ex.get("seconds_left"))
        check("answers never sent before the finish", len(ex["questions"]) == 6 and all("correct" not in q and "explanation" not in q for q in ex["questions"]), ex["questions"][0])
        check("only the chosen topics", all(q.get("topic") in {"Negligence", "Nuisance"} for q in ex["questions"]), [q.get("topic") for q in ex["questions"]])
        qs = ex["questions"]
        with SessionLocal() as db:
            truth = {q.id: q.correct for q in db.query(Question).filter(Question.id.in_([q["question_id"] for q in qs]))}
        picks = {}
        skip = next(q["question_id"] for q in reversed(qs) if q["topic"] == "Nuisance")
        for q in qs:
            # right on Negligence, wrong on Nuisance (so weak/strong topics show up)
            letter = truth[q["question_id"]] if q["topic"] == "Negligence" else next(x for x in "ABCD" if x != truth[q["question_id"]])
            if q["question_id"] == skip:
                continue  # leave one unanswered
            picks[q["question_id"]] = letter
            code, res = call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": q["question_id"], "selected": letter, "seconds": 12}, me)
        check("answers are recorded", code == 200 and res["answered"] == len(qs) - 1, res)
        check("change of answer allowed while running", call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": qs[0]["question_id"], "selected": picks[qs[0]["question_id"]], "seconds": 3}, me)[0] == 200)
        check("a question from outside the exam is refused", call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": 999999, "selected": "A"}, me)[0] in (404, 422))
        check("bad option refused", call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": qs[0]["question_id"], "selected": "Z"}, me)[0] == 422)
        code, done = call("POST", f"/ai/mini-exams/{eid}/finish", token=me)
        expected = sum(1 for qid, letter in picks.items() if truth[qid] == letter)
        check("finish scores on the server", code == 200 and done["status"] == "submitted" and done["score"] == expected, (done.get("score"), expected))
        an = done.get("analysis") or {}
        check("analysis: percentage, weak + strong topics, actions", "percentage" in an and "Nuisance" in json.dumps(an.get("weak_topics")) and "Negligence" in json.dumps(an.get("strong_topics")) and an.get("recommended_actions"), an)
        check("answers + explanations revealed after finish", all("correct" in q and "explanation" in q for q in done["questions"]), done["questions"][0])
        check("no answering after finish", call("POST", f"/ai/mini-exams/{eid}/answer", {"question_id": qs[1]["question_id"], "selected": "A"}, me)[0] == 409)
        with SessionLocal() as db:
            from app.security import decode_token
            sid = int(decode_token(me).subject)
            prog = {p.topic: p for p in db.query(StudentTopicProgress).filter(StudentTopicProgress.user_id == sid)}
        check("topic mastery updated from the mini exam", "Negligence" in prog and "Nuisance" in prog, list(prog))
        code, fb = call("POST", f"/ai/mini-exams/{eid}/feedback", token=me)
        check("AI feedback written + stored", code == 200 and fb["feedback"]["headline"] == "Solid start" and not fb["cached"], fb)
        check("feedback cached (no second AI call)", call("POST", f"/ai/mini-exams/{eid}/feedback", token=me)[1].get("cached") is True)
        code, lst = call("GET", "/ai/mini-exams", token=me)
        check("listed in my mini exams", code == 200 and any(x["id"] == eid for x in lst["mini_exams"]), lst)
        check("not in someone else's list", not any(x["id"] == eid for x in call("GET", "/ai/mini-exams", token=other)[1]["mini_exams"]))

        print("self-serve mini exam + timer")
        code, ex2 = call("POST", "/ai/mini-exams", {"course_id": course_id, "question_count": 4, "duration_minutes": 5, "difficulty": "easy"}, me)
        check("student can build one without the AI", code == 201 and ex2["question_count"] == 4 and ex2["created_by"] == "student", ex2)
        check("too many questions clamped / refused sensibly", call("POST", "/ai/mini-exams", {"course_id": course_id, "question_count": 500}, me)[0] in (201, 409, 422))
        ex2 = call("POST", f"/ai/mini-exams/{ex2['id']}/start", token=me)[1]
        with SessionLocal() as db:
            row = db.get(AIMiniExam, ex2["id"])
            from datetime import timedelta
            row.deadline_at = row.deadline_at - timedelta(minutes=10)
            db.commit()
        code, late = call("POST", f"/ai/mini-exams/{ex2['id']}/answer", {"question_id": ex2["questions"][0]["question_id"], "selected": "A"}, me)
        check("answer after the deadline refused", code in (409, 410), (code, late))
        code, auto = call("GET", f"/ai/mini-exams/{ex2['id']}", token=me)
        check("timer ran out → auto-submitted by the server", auto["status"] in ("expired", "submitted"), auto["status"])

        print("staff assistant → proposals")
        check("students can't use the staff assistant", call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "hi"}]}, me)[0] in (401, 403))
        SEEN.clear()
        SCRIPT[:] = [
            calls(("analyze_question_bank", {"course_id": course_id})),
            calls(("propose_questions", {"course_id": course_id, "rationale": "Defamation is thin.", "questions": [
                {"text": "Which defence applies to a true statement?", "option_a": "Justification", "option_b": "Consent", "option_c": "Necessity", "option_d": "Volenti", "correct": "A", "explanation": "Truth is a complete defence.", "topic": "Defamation", "difficulty": "medium"},
                {"text": "Libel is defamation in what form?", "option_a": "Permanent", "option_b": "Spoken", "option_c": "Implied", "option_d": "None", "correct": "A", "explanation": "Libel is permanent form.", "topic": "Defamation", "difficulty": "easy"},
                {"text": "Negligence question 0: which is right?", "option_a": "Right", "option_b": "Wrong", "correct": "A", "topic": "Negligence"},
            ]}), ("propose_topics", {"course_id": course_id, "topics": [{"name": "Vicarious Liability", "description": "Employer liability.", "learning_objectives": ["Explain the close connection test"]}]})),
            reply("I've drafted 2 new Defamation questions and one topic for your review."),
        ]
        with SessionLocal() as db:
            before_q = db.query(Question).filter(Question.course_id == course_id).count()
        code, out = call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "Find gaps in the bank and draft questions"}], "course_id": course_id}, staff)
        check("assistant replies with tools + proposal actions", code == 200 and out["reply"] and len(out["tools"]) == 3 and sum(1 for a in out["actions"] if a["type"] == "proposal") == 2, out)
        check("staff tool list offered", "propose_questions" in SEEN[0][1] and "get_student_report" in SEEN[0][1], SEEN[0][1])
        check("course context in the staff system prompt", course_code in SEEN[0][0][0]["content"])
        with SessionLocal() as db:
            check("nothing saved before approval", db.query(Question).filter(Question.course_id == course_id).count() == before_q)
            check("usage logged for staff (tokens + cache)", db.query(AIStaffUsage).filter(AIStaffUsage.request_id == out["request_id"]).one().cache_hit_tokens > 0)
        code, plist = call("GET", "/admin/ai/proposals", token=staff)
        qprop = next(p for p in plist["proposals"] if p["kind"] == "questions")
        tprop = next(p for p in plist["proposals"] if p["kind"] == "topics")
        code, detail = call("GET", f"/admin/ai/proposals/{qprop['id']}", token=staff)
        items = detail["payload"]["items"]
        check("proposal preview holds the drafted questions", len(items) == 3 and items[0]["text"].startswith("Which defence"), items)
        check("near-duplicate of a bank question flagged", items[2].get("possible_duplicate") and not items[0].get("possible_duplicate"), items[2])
        check("students can't see proposals", call("GET", "/admin/ai/proposals", token=me)[0] in (401, 403))
        edited = [dict(items[0], explanation="Truth (justification) is a complete defence to defamation.")]
        code, res = call("POST", f"/admin/ai/proposals/{qprop['id']}/approve", {"selected": [0], "items": edited}, staff)
        check("approve with edits → saved", code == 200 and res["status"] == "approved", res)
        with SessionLocal() as db:
            saved = db.query(Question).filter(Question.course_id == course_id, Question.text == items[0]["text"]).all()
            check("only the selected, edited question joined the bank", len(saved) == 1 and saved[0].explanation.startswith("Truth (justification)") and db.query(Question).filter(Question.course_id == course_id).count() == before_q + 1, [(q.text, q.explanation) for q in saved])
        check("can't approve twice", call("POST", f"/admin/ai/proposals/{qprop['id']}/approve", {}, staff)[0] == 409)
        code, res = call("POST", f"/admin/ai/proposals/{tprop['id']}/reject", {"reason": "Not in this syllabus"}, staff)
        with SessionLocal() as db:
            check("rejected topic not created", code == 200 and res["status"] == "rejected" and not db.query(CourseTopic).filter(CourseTopic.course_id == course_id, CourseTopic.name == "Vicarious Liability").count(), res)
            check("proposals stored separately with status", {p.status for p in db.query(AIProposal)} >= {"approved", "rejected"})

        print("staff assistant: leaked tool markup, final round, streaming, thinking, stop")
        dsml = ('Checking the course first.\n\n&lt;｜｜DSML｜｜ calls&gt;\n&lt;｜｜DSML｜｜ invoke name="get_course_overview"&gt;\n'
                f'&lt;｜｜DSML｜｜ parameter name="course_id" string="false"&gt;{course_id}&lt;/｜｜DSML｜｜ parameter&gt;\n'
                '&lt;/｜｜DSML｜｜ invoke&gt;\n&lt;/｜｜DSML｜｜ calls&gt;')
        SEEN.clear()
        SCRIPT[:] = [reply(dsml), reply("**Done** — rights &amp; duties reviewed.")]
        code, out = call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "overview please"}], "course_id": course_id}, staff)
        check("DSML tool markup in text is run as a real tool call", code == 200 and [t["name"] for t in out["tools"]] == ["get_course_overview"] and out["tools"][0]["status"] == "ok", out)
        check("reply never shows DSML markup or HTML entities", code == 200 and "DSML" not in out["reply"] and "&amp;" not in out["reply"] and "rights & duties" in out["reply"], out.get("reply"))
        check("recovered call replayed to the model as a proper tool turn", any(m.get("role") == "tool" for m in SEEN[-1][0]) and any(m.get("tool_calls") for m in SEEN[-1][0] if m.get("role") == "assistant"), SEEN[-1][0][-3:])

        SEEN.clear()
        rounds = 6  # ai_agent_max_steps default 5 → 6 tool rounds, then a no-tools final round
        SCRIPT[:] = [calls(("get_course_overview", {"course_id": course_id})) for _ in range(rounds)] + [reply("Wrapping up.\n" + dsml.split("\n\n", 1)[1])]
        code, out = call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "do everything"}], "course_id": course_id}, staff)
        last_msgs, last_tools = SEEN[-1]
        check("final round offers no tools and tells the model to wrap up", last_tools == [] and "TOOL BUDGET USED UP" in str(last_msgs[-1].get("content")), (last_tools, last_msgs[-1]))
        check("tool the model still wrote in the final round runs and is summarised", code == 200 and len(out["tools"]) == rounds + 1 and "DSML" not in out["reply"] and out["reply"].startswith("Wrapping up.") and "Here's what I did" in out["reply"], out)

        def stream(body, token, on_event=None):
            req = urllib.request.Request(base + "/admin/ai/agent/stream", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}", "Accept": "text/event-stream"})
            events, block = [], []
            with urllib.request.urlopen(req, timeout=60) as r:
                for raw in r:
                    line = raw.decode().rstrip("\n")
                    if line:
                        block.append(line)
                        continue
                    ev = next((b[6:].strip() for b in block if b.startswith("event:")), "message")
                    data = json.loads("".join(b[5:].strip() for b in block if b.startswith("data:")) or "{}")
                    block = []
                    events.append((ev, data))
                    if on_event:
                        on_event(ev, data)
            return events

        KW: list = []
        orig = impl.complete_tools

        def spy(messages, tools, **kw):
            KW.append(kw)
            return orig(messages, tools, **kw)

        impl.complete_tools = spy  # type: ignore[method-assign]
        think_step = calls(("get_course_overview", {"course_id": course_id}))
        think_step["reasoning"] = "The staff member wants an overview; read the course first."
        think_step["text"] = "Let me look at the course."
        SCRIPT[:] = [think_step, reply("## Overview\n- **Topics:** fine")]
        history = [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "earlier answer", "reasoning": "earlier thoughts"}, {"role": "user", "content": "overview, think it through"}]
        evs = stream({"messages": history, "course_id": course_id, "thinking": True}, staff)
        kinds = [e for e, _ in evs]
        check("stream: meta → status → thinking → note → tool → delta → done", kinds[0] == "meta" and "status" in kinds and "thinking" in kinds and "note" in kinds and "tool" in kinds and "delta" in kinds and kinds[-1] == "done"
              and kinds.index("thinking") < kinds.index("tool") < kinds.index("delta"), kinds)
        check("stream: reply text arrives as deltas", "".join(d["text"] for e, d in evs if e == "delta").startswith("## Overview"), evs)
        check("thinking mode requested from the provider", KW and all(k.get("reasoning") for k in KW), KW)
        check("earlier reasoning replayed with the history", any(m.get("reasoning_content") == "earlier thoughts" for m in SEEN[-1][0] if m.get("role") == "assistant"), [m for m in SEEN[-1][0] if m.get("role") == "assistant"])
        KW.clear()
        SCRIPT[:] = [reply("Quick answer.")]
        stream({"messages": [{"role": "user", "content": "hi"}], "course_id": course_id}, staff)
        check("thinking off unless asked", KW and not any(k.get("reasoning") for k in KW), KW)

        def slow(messages, tools):
            time.sleep(1.2)
            return calls(("get_course_overview", {"course_id": course_id}))

        SCRIPT[:] = [slow, slow, slow, reply("should not get here")]
        before_tools = len(SEEN)

        def on_event(ev, data):
            if ev == "meta":
                threading.Timer(0.3, lambda: call("POST", f"/admin/ai/agent/{data['request_id']}/stop", {}, staff)).start()

        started_at = time.monotonic()
        evs = stream({"messages": [{"role": "user", "content": "long job"}], "course_id": course_id}, staff, on_event)
        kinds = [e for e, _ in evs]
        check("stop mid-run → cancelled event, no final reply", kinds[-1] == "cancelled" and "delta" not in kinds and "done" not in kinds, kinds)
        check("stop halts before further model rounds", len(SEEN) - before_tools <= 1 and time.monotonic() - started_at < 4, (len(SEEN) - before_tools, time.monotonic() - started_at))
        SCRIPT.clear()
        impl.complete_tools = orig  # type: ignore[method-assign]
        with SessionLocal() as db:
            check("stopped request logged as cancelled", db.query(AIStaffUsage).filter(AIStaffUsage.status == "cancelled").count() >= 1)
        check("students can't use the streaming assistant", call("POST", "/admin/ai/agent/stream", {"messages": [{"role": "user", "content": "hi"}]}, me)[0] in (401, 403))

        print("audit + usage + settings")
        code, log = call("GET", "/admin/ai/tool-calls", token=staff)
        check("tool audit log for staff", code == 200 and any(x["tool"] == "create_mini_exam" for x in log["calls"]), code)
        code, use = call("GET", "/admin/ai/usage", token=staff)
        feats = {f["feature"]: f for f in use.get("features", [])}
        check("usage by feature incl. cache hits + staff", code == 200 and "STAFF_ASSISTANT" in feats and feats["STAFF_ASSISTANT"]["cache_hit"] > 0 and use["total_cost"] > 0, use)
        code, st = call("GET", "/admin/ai/status", token=staff)
        check("status endpoint", code == 200 and st["configured"] and st["pending_proposals"] == 0, st)
        call("PUT", "/admin/tutor/settings", {"ai_staff_daily_limit": 1}, staff)
        check("staff daily limit enforced", call("POST", "/admin/ai/agent", {"messages": [{"role": "user", "content": "again"}]}, staff)[0] == 429)
        check("limits are bounded (0..10000)", call("PUT", "/admin/tutor/settings", {"ai_staff_daily_limit": 10**9}, staff)[0] == 422)
        call("PUT", "/admin/tutor/settings", {"ai_agent_enabled": False}, staff)
        SEEN.clear()
        code, text = call("POST", f"/tutor/conversations/{cid}/messages", {"content": "Give me a 10 question test on torts"}, me)
        check("agent off → 'make a test' falls back to the practice generator", code == 200 and isinstance(text, dict) and text.get("route") == "generate" and text.get("kind") == "practice", text)
    finally:
        server.should_exit = True

    print(f"\n{PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
