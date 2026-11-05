#!/usr/bin/env python3
"""Build a lived-in demo world for presentations.

    cd backend && .venv/bin/python scripts/demo_world.py [--url http://127.0.0.1:3000]

(or simply ``./start-arena.sh demo`` / ``start-arena.bat demo`` while the app runs)

What it does
  1. Keeps English and Mathematics active while retaining legacy course history.
  2. Makes sure English and Mathematics have starter questions, exams and materials.
  3. Creates students — mostly United States and United Kingdom — and gives them
     real history through the normal API: exams taken, practice runs, friends,
     study groups with chat / announcements / Q&A / group quizzes, private chats,
     teachers with students, materials, quizzes, reviews and replies.
  4. Polishes profiles (schools, bios, streaks, ratings) and spreads activity
     over the last few weeks so feeds and leaderboards look natural.

It keeps historical course, quiz and attempt records intact, and only changes
catalogue visibility plus the demo usernames below. Safe to re-run:
existing demo accounts are reused and social steps are skipped once done.

Every demo account uses the password  demo1234 .
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from sqlalchemy import or_, select  # noqa: E402

from app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.course_catalog import ACTIVE_COURSE_CODES  # noqa: E402
from app.models import (  # noqa: E402
    Activity,
    Attempt,
    Config,
    Course,
    Material,
    Notification,
    Prize,
    Question,
    Quiz,
    Student,
    StudyGroup,
)

PASSWORD = "demo1234"
MARKER_GROUP = "London Maths Circle"
rng = random.Random(2026)

# username, display name, phone, school/campus, country, level, bio, status, skill 0..1
STUDENTS = [
    ("emma", "Emma Wilson", "+447700900101", "King's College London", "UK", "Year 2", "Maths and reading nerd from London. Coffee, flashcards and a 6am study club.", "Revising for mocks ☕", 0.86),
    ("oliver", "Oliver Bennett", "+447700900102", "University of Manchester", "UK", "Year 1", "Maths first, football second. Ask me about tricky word problems.", "Speed round anyone?", 0.78),
    ("amelia", "Amelia Hughes", "+447700900103", "University of Leeds", "UK", "Year 2", "Future doctor. English and maths flashcards are my love language.", "", 0.82),
    ("harry", "Harry Clarke", "+447700900104", "University of Birmingham", "UK", "Year 1", "Chess, puzzles and a good mystery novel.", "In the library 📚", 0.64),
    ("isla", "Isla Murray", "+447700900105", "University of Edinburgh", "UK", "Year 3", "Scottish, sarcastic, and strangely good at algebra.", "", 0.74),
    ("george", "George Patel", "+447700900106", "University of Leicester", "UK", "Year 2", "Maths student. I explain probability at parties.", "Building a study bot", 0.8),
    ("charlotte", "Charlotte Evans", "+447700900107", "Cardiff University", "UK", "Year 1", "English literature + a bit of everything.", "", 0.69),
    ("jack", "Jack Robinson", "+447700900108", "University of Bristol", "UK", "Year 2", "Engineering student. Maths duels at 9pm.", "", 0.71),
    ("priya", "Priya Sharma", "+447700900109", "University College London", "UK", "Year 3", "Essay structure is just maths for ideas.", "Mock exam Friday!", 0.88),
    ("freya", "Freya Morgan", "+447700900110", "University of Oxford", "UK", "Year 1", "Languages and linguistics. Grammar police (friendly).", "", 0.84),
    ("liam", "Liam Johnson", "+12025550101", "University of Texas at Austin", "US", "Sophomore", "Pre-med from Austin. Reading and maths all day.", "Grinding practice sets", 0.79),
    ("olivia", "Olivia Martinez", "+12025550102", "UCLA", "US", "Junior", "LA born. Writing, debate and way too much iced coffee.", "", 0.75),
    ("noah", "Noah Williams", "+12025550103", "University of Chicago", "US", "Freshman", "Math major. Probability puzzles welcome.", "", 0.83),
    ("ava", "Ava Thompson", "+12025550104", "New York University", "US", "Sophomore", "SAT/AP tutor on weekends. Running the Prep Squad.", "Group quiz tonight 8pm", 0.87),
    ("ethan", "Ethan Brooks", "+12025550105", "University of Washington", "US", "Junior", "Seattle. Maths puzzles and rainy-day reading.", "", 0.72),
    ("mia", "Mia Rodriguez", "+12025550106", "University of Miami", "US", "Freshman", "Poetry and beach walks 🐠", "", 0.66),
    ("lucas", "Lucas Kim", "+12025550107", "UC Berkeley", "US", "Senior", "Building a study group. Running the Friday quiz.", "Shipping side projects", 0.9),
    ("harper", "Harper Davis", "+12025550108", "Boston University", "US", "Sophomore", "English night owl. Ask me about essay structure.", "", 0.77),
    ("jayden", "Jayden Carter", "+12025550109", "Georgia Tech", "US", "Junior", "Atlanta. Engineering + basketball.", "", 0.68),
    ("chloe", "Chloe Anderson", "+12025550110", "University of Colorado Boulder", "US", "Freshman", "Hiking, reading, and vocabulary quizzes.", "", 0.7),
    ("mason", "Mason Lee", "+12025550111", "Rice University", "US", "Sophomore", "Houston. Algebra problem-solver.", "", 0.73),
    ("zoe", "Zoe Mitchell", "+12025550112", "University of Pennsylvania", "US", "Junior", "Economics + statistics. Spreadsheets are art.", "", 0.81),
    ("sarah", "Sarah Chen", "+14165550113", "University of Toronto", "CA", "Year 2", "Toronto. Life sciences and piano.", "", 0.85),
    ("daniel", "Daniel Okoro", "08035550114", "University of Lagos", "NG", "200 Level", "Lagos. Maths and computing.", "", 0.76),
    ("aisha", "Aisha Bello", "08035550115", "University of Abuja", "NG", "300 Level", "Abuja. Maths practice and good vibes.", "", 0.74),
]

# username, name, phone, headline, bio, specialties, years, institution, languages, verify(True/False/None=pending)
TEACHERS = [
    ("mr_whitaker", "James Whitaker", "+447700900201", "Mathematics tutor — GCSE to first-year university",
     "Former secondary-school head of maths in London. I build intuition first, then exam technique, with short weekly check-ins and worked examples for every topic.",
     [{"subject": "Mathematics", "topics": ["Algebra", "Geometry", "Statistics"]}], 12, "University College London", ["English"], True),
    ("ms_adams", "Rachel Adams", "+12025550201", "English writing & comprehension coach",
     "I help students write clearly and read critically: grammar, essays and comprehension with detailed written feedback on every piece you send me.",
     [{"subject": "English", "topics": ["Grammar", "Essay Writing", "Comprehension"]}], 9, "Columbia University", ["English", "French"], True),

]

COUNTRY_HUE = {"UK": 226, "US": 348, "CA": 0, "NG": 140}


# ------------------------------------------------------------------ http
class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/") + "/api"

    def call(self, method: str, path: str, body=None, tok: str | None = None, form: dict | None = None, ok=(200, 201)):
        headers, data = {}, None
        if form is not None:
            bd = uuid.uuid4().hex
            data = ("".join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in form.items()) + f"--{bd}--\r\n").encode()
            headers["Content-Type"] = f"multipart/form-data; boundary={bd}"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if tok:
            headers["Authorization"] = "Bearer " + tok
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                payload = json.loads(raw)
            except Exception:  # noqa: BLE001
                payload = {"detail": raw[:300].decode(errors="replace")}
            return error.code, payload

    def must(self, method, path, body=None, tok=None, form=None):
        status, payload = self.call(method, path, body, tok, form)
        if status not in (200, 201):
            raise RuntimeError(f"{method} {path} -> {status} {str(payload)[:300]}")
        return payload


def say(text: str) -> None:
    print("  " + text, flush=True)


# ------------------------------------------------------------- phase 0: content
def clean_content() -> None:
    """Keep only English/Maths active without deleting legacy course history."""
    from app.seed import PRIZES, seed_all

    init_db()
    with SessionLocal() as db:
        seed_all(db)  # idempotent — creates the general courses/exams/materials if missing
        allowed = ACTIVE_COURSE_CODES
        for course in db.scalars(select(Course)).all():
            course.is_active = course.code in allowed
        for note in db.scalars(select(Notification)).all():
            text = f"{note.title} {note.message} {note.target_course or ''}"
            if "LAW " in text or "Jurisprudence" in text:
                # Preserve the historical row, but do not keep obsolete subject copy
                # in the student-facing notice feed.
                note.title = "Archived historical announcement"
                note.message = "This announcement is retained for records and is no longer active."
                note.target_course = None
                note.is_pinned = False
        by_order = {row["sort_order"]: row for row in PRIZES}
        for prize in db.scalars(select(Prize)).all():
            if ("₦" in prize.title or "Arena Champion" in prize.title) and prize.sort_order in by_order:
                prize.title = by_order[prize.sort_order]["title"]
                prize.description = by_order[prize.sort_order]["description"]
        config = db.get(Config, 1)
        if config is not None:
            if "Nigeria" in (config.institution or "") or not config.institution:
                config.institution = "Absolute Genesis Academy"
            if "UNEC" in (config.campus or "") or "Enugu" in (config.campus or ""):
                config.campus = "Online Campus"
            if "Law" in (config.faculty or ""):
                config.faculty = "General Studies"
            if "₦" in (config.prize_pool_note or ""):
                config.prize_pool_note = "Season prizes: champion trophy, data bundles, merch and vouchers."
        db.commit()
        courses = db.scalars(select(Course).where(Course.is_active.is_(True), Course.code.in_(ACTIVE_COURSE_CODES)).order_by(Course.code)).all()
        say("Active courses: " + ", ".join(c.code for c in courses))


# ------------------------------------------------------------- phase 1: people
def ensure_account(api: Api, username: str, name: str, phone: str) -> str:
    status, payload = api.call("POST", "/auth/register", {"username": username, "phone": phone, "password": PASSWORD, "display_name": name})
    if status not in (200, 201):
        status, payload = api.call("POST", "/auth/student", {"identifier": username, "password": PASSWORD})
        if status != 200:
            raise RuntimeError(f"cannot create or sign in {username}: {payload}")
    return payload.get("token") or payload.get("access_token")


def answer_key() -> dict[int, str]:
    with SessionLocal() as db:
        return {qid: correct for qid, correct in db.execute(select(Question.id, Question.correct)).all()}


def pick_answer(key: dict[int, str], qid: int, skill: float, options: list[str] | None = None) -> str:
    right = key.get(qid, "A")
    if rng.random() < skill:
        return right
    wrong = [o for o in (options or ["A", "B", "C", "D"]) if o != right]
    return rng.choice(wrong) if wrong else right


def take_exams(api: Api, tokens: dict, skills: dict, key: dict) -> int:
    with SessionLocal() as db:
        exams = [q.id for q in db.scalars(select(Quiz).where(Quiz.status == "active", Quiz.is_bank.is_(False))).all()]
        done = {(a.student_id, a.quiz_id) for a in db.scalars(select(Attempt)).all()}
        ids = {u: db.scalar(select(Student.id).where(Student.username == u)) for u in tokens}
    taken = 0
    for username, tok in tokens.items():
        k = rng.randint(2, min(5, len(exams))) if username != "emma" else len(exams)
        for quiz_id in rng.sample(exams, k):
            if (ids[username], quiz_id) in done:
                continue
            status, state = api.call("POST", f"/exams/{quiz_id}/start", {}, tok)
            if status != 200:
                continue
            attempt_id = (state.get("attempt") or {}).get("id") or state.get("attempt_id") or state.get("id")
            for question in state.get("questions") or []:
                qid = question.get("id") or question.get("question_id")
                opts = [o.get("key") for o in question.get("options") or [] if isinstance(o, dict) and o.get("key")] or None
                api.call("POST", f"/exams/attempts/{attempt_id}/answer", {"question_id": qid, "selected": pick_answer(key, qid, skills[username], opts), "seconds_spent": rng.uniform(8, 40)}, tok)
            api.call("POST", f"/exams/attempts/{attempt_id}/submit", {"submission_type": "early"}, tok)
            taken += 1
    return taken


def run_practice(api: Api, tokens: dict, skills: dict, key: dict) -> int:
    with SessionLocal() as db:
        courses = [(c.id, c.code) for c in db.scalars(select(Course).where(Course.is_active.is_(True))).all()]
    status, catalog = api.call("GET", "/arena/practice/catalog", tok=next(iter(tokens.values())))
    topics = {row["id"]: [t["key"] for t in row.get("topics", [])] for row in (catalog or {}).get("courses", [])} if status == 200 else {}
    counts = {(row["id"], t["key"]): t["count"] for row in (catalog or {}).get("courses", []) for t in row.get("topics", [])} if status == 200 else {}
    runs = 0
    for username, tok in tokens.items():
        for _ in range(rng.randint(1, 3) if username != "emma" else 4):
            course_id, _code = rng.choice(courses)
            keys = topics.get(course_id) or []
            chosen = rng.sample(keys, min(len(keys), rng.choice([1, 2]))) if keys else []
            size = max(1, min(5, sum(counts.get((course_id, k), 0) for k in chosen) or 5))
            status, run = api.call("POST", "/arena/practice/start", {"mode": "custom", "course_id": course_id, "topics": chosen, "size": size, "time_limit_seconds": 600}, tok)
            if status != 200:
                status, run = api.call("POST", "/arena/practice/start", {"mode": "custom", "course_id": course_id, "size": 5, "time_limit_seconds": 600}, tok)
            if status != 200:
                continue
            token = run.get("token")
            for question in run.get("questions") or []:
                qid = question.get("id")
                api.call("POST", "/arena/practice/answer", {"token": token, "question_id": qid, "selected": pick_answer(key, qid, skills[username]), "elapsed_ms": rng.randint(4000, 25000)}, tok)
            api.call("POST", f"/arena/practice/finish?token={token}&elapsed_ms={rng.randint(60000, 300000)}", None, tok)
            runs += 1
    return runs


def make_friends(api: Api, tokens: dict, ids: dict) -> int:
    pairs: set[tuple[str, str]] = set()
    names = list(tokens)
    for other in names:
        if other != "emma" and (STUDENT_COUNTRY[other] == "UK" or rng.random() < 0.45):
            pairs.add(("emma", other))
    for user in names:
        for other in rng.sample(names, 4):
            if other != user:
                pairs.add(tuple(sorted((user, other))))
    made = 0
    for a, b in pairs:
        status, _ = api.call("POST", "/friends", {"student_id": ids[b]}, tokens[a])
        made += status == 200
    return made


def chat(api: Api, tokens: dict, ids: dict, lines: list[tuple[str, str, str]]) -> None:
    for pair in {tuple(sorted((a, b))) for a, b, _ in lines}:
        api.call("POST", "/friends", {"student_id": ids[pair[1]]}, tokens[pair[0]])
    for sender, receiver, body in lines:
        api.call("POST", "/chat", {"to": ids[receiver], "body": body, "kind": "text"}, tokens[sender])


def build_groups(api: Api, tokens: dict, ids: dict, course_ids: dict) -> list[int]:
    plans = [
        {
            "owner": "oliver", "name": MARKER_GROUP, "course": "MTH 101", "goal": "Everyone above 80% in the maths mock",
            "description": "UK students revising algebra, geometry and statistics together. Daily drills, weekend duels.",
            "members": ["emma", "isla", "harry", "jack", "priya", "freya", "george", "charlotte"], "mod": "emma",
            "chat": [
                ("oliver", "Morning all 👋 Mock is in 10 days — daily algebra drill at 7pm?"),
                ("emma", "I'm in. Can we start with factorising? I keep slipping on difference of two squares."),
                ("isla", "x² − 9 = (x + 3)(x − 3). Spot the two squares and the minus sign, done 😄"),
                ("priya", "Sharing my percentage-change trick tonight: always divide by the ORIGINAL."),
                ("jack", "Duel after the drill? Loser buys coffee ☕"),
                ("freya", "Count me in!"),
            ],
            "announcement": ("Mock exam moved to Friday 4pm", "We'll run the group quiz straight after to go through the answers together.", "high"),
            "question": ("Why do we divide by the original in percentage change?", "If a price goes from £40 to £50, why isn't the increase 20%?", "Fractions & Percentages",
                         "isla", "Because the change (£10) is compared with where you STARTED. 10 ÷ 40 = 25%. Dividing by 50 gives the percentage decrease from 50 back to 40 instead."),
            "quiz": ("Algebra Sprint", "Algebra", 8),
        },
        {
            "owner": "ava", "name": "SAT & AP Prep Squad", "course": "ENG 101", "goal": "Hit our target scores this spring",
            "description": "US students prepping English and maths. Weekly group quizzes and accountability check-ins.",
            "members": ["olivia", "noah", "liam", "zoe", "jayden", "chloe", "mason", "emma", "sarah"], "mod": "olivia",
            "chat": [
                ("ava", "Welcome to the squad! 🎯 Group quiz every Thursday at 8pm ET."),
                ("olivia", "Can we do a grammar round first? Subject–verb agreement keeps getting me."),
                ("noah", "Trick: cross out the 'of …' phrase. 'The list of items IS on the desk.'"),
                ("zoe", "That just saved me like 3 questions on my last practice test 😅"),
                ("liam", "Who's up for a mixed-topic practice run tonight?"),
                ("emma", "Hi from London! Happy to join the grammar round 🇬🇧"),
            ],
            "announcement": ("Thursday quiz: Grammar & Punctuation", "20 questions, 30 seconds each. Top 3 get bonus coins!", "normal"),
            "question": ("When do I use a semicolon instead of a comma?", "I see semicolons in essays but never know when they're allowed.", "Punctuation",
                         "olivia", "Use a semicolon to join two complete sentences that are closely related: 'It rained; the match was cancelled.' A comma alone there would be a comma splice."),
            "quiz": ("Grammar Showdown", "Grammar", 8),
        },

    ]
    made = []
    for plan in plans:
        owner = tokens[plan["owner"]]
        group = api.must("POST", "/groups", {"name": plan["name"], "goal": plan["goal"], "description": plan["description"]}, owner)
        gid, code = group["id"], group["code"]
        for member in plan["members"]:
            api.call("POST", f"/groups/join/{code}", None, tokens[member])
        api.call("PATCH", f"/groups/{gid}/members/{ids[plan['mod']]}", {"role": "moderator"}, owner)
        last = None
        for who, body in plan["chat"]:
            status, msg = api.call("POST", f"/groups/{gid}/messages", {"body": body, **({"reply_to_id": last} if last and rng.random() < 0.3 else {})}, tokens[who])
            if status == 200 and isinstance(msg, dict):
                last = msg.get("id")
                if rng.random() < 0.5:
                    api.call("POST", f"/groups/{gid}/messages/{last}/react", {"emoji": rng.choice(["🔥", "👍", "🎉", "😂", "✅"])}, tokens[rng.choice(plan["members"])])
        title, body, priority = plan["announcement"]
        api.call("POST", f"/groups/{gid}/announcements", {"title": title, "body": body, "priority": priority, "pinned": priority == "high"}, owner)
        qtitle, qbody, qtopic, answerer, answer = plan["question"]
        asker = plan["members"][0]
        status, q = api.call("POST", f"/groups/{gid}/questions", {"title": qtitle, "body": qbody, "topic": qtopic}, tokens[asker])
        if status == 200:
            status, a = api.call("POST", f"/groups/{gid}/questions/{q['id']}/answers", {"body": answer}, tokens[answerer])
            if status == 200:
                api.call("POST", f"/groups/{gid}/questions/{q['id']}/answers/{a['id']}/useful", None, tokens[asker])
                api.call("POST", f"/groups/{gid}/questions/{q['id']}/answers/{a['id']}/best", None, tokens[asker])
        qz_title, qz_topic, count = plan["quiz"]
        api.call("POST", f"/groups/{gid}/quizzes", {"title": qz_title, "course_id": course_ids[plan["course"]], "topic": "", "description": f"{count} quick questions on {qz_topic.lower()}.",
                                                   "question_count": count, "per_question_seconds": 30, "max_attempts": 2, "reward_xp": 120, "reward_coins": 40, "pass_score": 60}, owner)
        api.call("POST", f"/groups/{gid}/duels", {"opponent_id": ids[plan["members"][0]], "course_id": course_ids[plan["course"]], "question_count": 6, "public": True, "message": "Warm-up duel!"}, owner)
        made.append(gid)
        say(f"Study group '{plan['name']}' (code {code}) with {len(plan['members']) + 1} members")
    return made


def build_teachers(api: Api, admin: str, tokens: dict, ids: dict) -> None:
    teacher_tokens, profiles = {}, {}
    for username, name, phone, headline, bio, specs, years, inst, langs, verify in TEACHERS:
        tok = ensure_account(api, username, name, phone)
        teacher_tokens[username] = tok
        api.call("PUT", "/teachers/me/profile", {
            "headline": headline, "bio": bio, "experience_years": years, "experience": "Taught secondary-school and university students, online and in person.",
            "institution": inst, "languages": langs, "formats": "both",
            "availability": [{"day": d, "start": "17:00", "end": "20:00"} for d in (0, 2, 4)], "accepting": True, "specialties": specs,
        }, tok)
        api.call("POST", "/teachers/me/qualifications", tok=tok, form={"title": f"Degree in {specs[0]['subject']}", "institution": inst, "year": str(2024 - years)})
        api.call("POST", "/teachers/me/submit", {}, tok)
        status, me = api.call("GET", "/teachers/me/profile", tok=tok)
        pid = (me or {}).get("profile", {}).get("id")
        profiles[username] = pid
        if pid and verify is not None:
            api.call("POST", f"/admin/teachers/{pid}/action", {"action": "approve", "note": "Documents checked", "message": ""}, admin)
            if verify:
                api.call("POST", f"/admin/teachers/{pid}/action", {"action": "verify", "note": "Identity and qualifications verified", "message": ""}, admin)
        say(f"Teacher {name} ({'verified' if verify else 'approved' if verify is False else 'pending review'})")

    links = [
        ("mr_whitaker", "emma", "Mathematics", "Algebra", "I'd love help with factorising and quadratics before my mock.", True),
        ("mr_whitaker", "noah", "Mathematics", "Statistics", "Probability questions with two events confuse me.", True),
        ("mr_whitaker", "isla", "Mathematics", "Geometry", "Circle theorems please!", False),
        ("ms_adams", "olivia", "English", "Essay Writing", "Can you review my argumentative essays weekly?", True),
        ("ms_adams", "charlotte", "English", "Grammar", "I want to fix my comma splices for good.", True),
        ("ms_adams", "emma", "English", "Comprehension", "Help with inference questions.", False),
    ]
    rels = {}
    for teacher, student, subject, topic, message, accept in links:
        pid = profiles.get(teacher)
        if not pid:
            continue
        status, req = api.call("POST", f"/teachers/{pid}/requests", {"subject": subject, "topic": topic, "message": message, "format": "one", "preferred_time": "Weekday evenings"}, tokens[student])
        if status != 200:
            continue
        rid = req.get("id") or (req.get("request") or {}).get("id")
        if accept:
            api.call("POST", f"/teachers/studio/requests/{rid}/accept", {"note": "Happy to help — let's start this week!"}, teacher_tokens[teacher])
            rels[(teacher, student)] = True

    # Teachers and their students connect so they can message each other.
    with SessionLocal() as db:
        teacher_ids = {u: db.scalar(select(Student.id).where(Student.username == u)) for u in teacher_tokens}
    for (teacher, student) in rels:
        api.call("POST", "/friends", {"student_id": teacher_ids[teacher]}, tokens[student])

    # Conversations, materials, quizzes, a class group and reviews
    def teacher_student_id(teacher: str) -> int | None:
        with SessionLocal() as db:
            return db.scalar(select(Student.id).where(Student.username == teacher))

    convo = [
        ("mr_whitaker", "emma", "Hi Emma! Send me the factorising question you got stuck on and we'll go through it."),
        ("emma", "mr_whitaker", "Thank you! It's x² − 5x + 6 = 0 — I never know which numbers to pick."),
        ("mr_whitaker", "emma", "Find two numbers that multiply to +6 and add to −5: that's −2 and −3. So (x − 2)(x − 3) = 0 → x = 2 or 3."),
        ("emma", "mr_whitaker", "That makes so much sense now 🙌"),
        ("ms_adams", "olivia", "Got your essay — strong argument! Let's tighten the introduction together."),
        ("olivia", "ms_adams", "Thank you, I'll send the revised version tonight."),
    ]
    for sender, receiver, body in convo:
        to_id = ids.get(receiver) or teacher_student_id(receiver)
        tok = teacher_tokens.get(sender) or tokens.get(sender)
        if to_id and tok:
            api.call("POST", "/chat", {"to": to_id, "body": body, "kind": "text"}, tok)

    api.call("POST", "/teachers/studio/materials", {"title": "Quadratics cheat sheet", "description": "Factorising, the formula and worked examples", "subject": "Mathematics", "topic": "Algebra",
                                                    "kind": "text", "body": "x² + bx + c: find two numbers that multiply to c and add to b.\nDifference of two squares: a² − b² = (a + b)(a − b).\nIf it won't factorise, use the quadratic formula.", "visibility": "students"}, teacher_tokens["mr_whitaker"])
    api.call("POST", "/teachers/studio/materials", {"title": "Essay structure in 5 steps", "description": "Hook, thesis, three points, counter-argument, conclusion", "subject": "English", "topic": "Essay Writing",
                                                    "kind": "text", "body": "1. Hook the reader.\n2. State a clear thesis.\n3. One idea per paragraph with evidence.\n4. Address the counter-argument.\n5. Conclude by answering 'so what?'.", "visibility": "students"}, teacher_tokens["ms_adams"])
    status, quiz = api.call("POST", "/teachers/studio/quizzes", {
        "title": "Quadratics check", "subject": "Mathematics", "topic": "Algebra", "time_limit_minutes": 10, "pass_mark": 60, "visibility": "students",
        "questions": [
            {"kind": "mcq", "prompt": "Solve x² − 5x + 6 = 0", "options": ["x = 2 or 3", "x = −2 or −3", "x = 1 or 6", "x = 5 or 6"], "answer": "A"},
            {"kind": "mcq", "prompt": "Factorise x² − 16", "options": ["(x − 4)²", "(x + 4)(x − 4)", "(x + 8)(x − 2)", "x(x − 16)"], "answer": "B"},
            {"kind": "tf", "prompt": "x² + 4 can be factorised over the real numbers.", "answer": "false"},
        ],
    }, teacher_tokens["mr_whitaker"])
    if status == 200:
        api.call("POST", f"/teachers/studio/quizzes/{quiz.get('id') or quiz['quiz']['id']}/publish", {}, teacher_tokens["mr_whitaker"])
    api.call("POST", "/teachers/studio/groups", {"name": "Thursday Maths Clinic", "description": "Weekly algebra and statistics practice with Mr Whitaker", "subject": "Mathematics",
                                                 "topic": "Algebra", "capacity": 20, "privacy": "request"}, teacher_tokens["mr_whitaker"])

    reviews = [
        ("mr_whitaker", "noah", 5, "Mr Whitaker made probability finally click. My practice scores went from 55% to 85% in three weeks!", "Brilliant work, Noah — keep that momentum!"),
        ("ms_adams", "charlotte", 5, "Clear, kind and really detailed feedback on every essay.", "Thank you Charlotte, your writing has improved so much."),
    ]
    for teacher, student, rating, body, reply in reviews:
        status, learning = api.call("GET", "/teachers/me/learning", tok=tokens[student])
        rel = next((row.get("relationship", {}).get("id") for row in (learning or {}).get("teachers", []) if row.get("teacher", {}).get("id") == profiles.get(teacher)), None)
        if not rel:
            continue
        api.call("POST", f"/teachers/relationships/{rel}/complete", {}, tokens[student])
        status, review = api.call("POST", f"/teachers/{profiles[teacher]}/reviews", {"rating": rating, "body": body, "anonymous": False}, tokens[student])
        if status == 200 and reply:
            api.call("POST", f"/teachers/reviews/{review.get('id') or review['review']['id']}/response", {"response": reply}, teacher_tokens[teacher])


def broadcast(api: Api, admin: str) -> None:
    notices = [
        {"title": "Welcome to the new season 🎉", "message": "English and Mathematics exams, plus new study groups. Jump into the English Mock or a Maths Speed Round to start climbing the leaderboard.", "kind": "exam", "is_pinned": True},
        {"title": "Mixed-topic practice is here", "message": "Pick several topics at once in Practice — perfect for revision before a mock exam.", "kind": "general"},
        {"title": "Find a teacher", "message": "Verified English and Mathematics teachers are now accepting students.", "kind": "general"},
    ]
    for row in notices:
        api.call("POST", "/admin/notifications", row, admin)


# ------------------------------------------------------------- phase 2: polish
def polish() -> None:
    # Anchor demo history to the start of today and use a per-record random
    # stream. A completed seed can be run again without changing stats or
    # pushing exam/activity timestamps further into the past.
    anchor = datetime.combine(date.today(), datetime.min.time())
    with SessionLocal() as db:
        by_user = {s.username: s for s in db.scalars(select(Student).where(Student.username.in_([r[0] for r in STUDENTS] + [t[0] for t in TEACHERS]))).all()}
        for username, name, _phone, school, country, level, bio, status_text, skill in STUDENTS:
            s = by_user.get(username)
            if not s:
                continue
            profile_rng = random.Random(f"absolute-genesis-demo-profile:{username}")
            s.name, s.bio, s.status_text = name, bio, status_text
            s.campus, s.faculty, s.level = school, {"UK": "United Kingdom", "US": "United States", "CA": "Canada", "NG": "Nigeria"}[country], level
            s.country = {"UK": "GB", "US": "US", "CA": "CA", "NG": "NG"}[country]
            s.class_name = f"{country} Students"
            s.avatar_hue = (COUNTRY_HUE[country] + profile_rng.randint(-25, 25)) % 360
            s.created_at = anchor - timedelta(days=profile_rng.randint(20, 75))
            s.streak = 12 if username == "emma" else profile_rng.randint(0, 9)
            s.best_streak = max(s.streak, profile_rng.randint(s.streak, s.streak + 10))
            s.last_active = date.today() if s.streak else date.today() - timedelta(days=profile_rng.randint(1, 4))
            s.ranked_rating = int(1000 + (skill - 0.6) * 1400 + profile_rng.randint(-60, 60))
            s.ranked_played = profile_rng.randint(4, 30)
            s.ranked_won = int(s.ranked_played * min(0.9, skill * profile_rng.uniform(0.6, 0.9)))
            s.duels_played = profile_rng.randint(3, 25)
            s.duels_won = int(s.duels_played * min(0.9, skill * profile_rng.uniform(0.5, 0.9)))
            s.duels_lost = s.duels_played - s.duels_won
            s.coins = max(s.coins, profile_rng.randint(250, 1400))
            s.diamonds = max(s.diamonds, profile_rng.randint(5, 60))
        for t in TEACHERS:
            s = by_user.get(t[0])
            if s:
                s.campus, s.bio = t[7], t[3]
                s.country = "GB" if t[2].startswith("+44") else "US" if t[2].startswith("+1") else ""

        ids = [s.id for s in by_user.values()]
        username_by_id = {s.id: s.username for s in by_user.values()}
        for attempt in db.scalars(select(Attempt).where(Attempt.student_id.in_(ids)).order_by(Attempt.id)).all():
            username = username_by_id.get(attempt.student_id, "demo")
            history_rng = random.Random(f"absolute-genesis-demo-attempt:{username}:{attempt.id}")
            if attempt.started_at:
                target_start = anchor - timedelta(days=history_rng.randint(0, 20), hours=history_rng.randint(0, 12))
                shift = target_start - attempt.started_at
                for field in ("started_at", "deadline_at", "submitted_at"):
                    value = getattr(attempt, field, None)
                    if value:
                        setattr(attempt, field, value + shift)

        for activity in db.scalars(select(Activity).where(Activity.student_id.in_(ids)).order_by(Activity.id)).all():
            username = username_by_id.get(activity.student_id, "demo")
            history_rng = random.Random(f"absolute-genesis-demo-activity:{username}:{activity.id}")
            activity.created_at = anchor - timedelta(days=history_rng.randint(0, 14), hours=history_rng.randint(0, 20))
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.getenv("ARENA_API", "http://127.0.0.1:3000"))
    args = parser.parse_args()
    api = Api(args.url)

    print("▸ Cleaning content")
    clean_content()

    try:
        status, _ = api.call("GET", "/health")
    except OSError:
        status = 0
    if status != 200:
        raise SystemExit(f"The API at {args.url} is not responding — start the app first (./start-arena.sh).")
    admin = api.must("POST", "/auth/admin", {"email": DEFAULT_ADMIN_EMAIL, "password": DEFAULT_ADMIN_PASSWORD})
    admin = admin.get("token") or admin.get("access_token")

    with SessionLocal() as db:
        already = db.scalar(select(StudyGroup.id).where(StudyGroup.name == MARKER_GROUP)) is not None
        course_ids = {c.code: c.id for c in db.scalars(select(Course)).all()}

    print("▸ Accounts")
    tokens = {u: ensure_account(api, u, n, p) for u, n, p, *_ in STUDENTS}
    skills = {r[0]: r[8] for r in STUDENTS}
    with SessionLocal() as db:
        ids = {u: db.scalar(select(Student.id).where(Student.username == u)) for u in tokens}
    say(f"{len(tokens)} students ready (UK {sum(r[4] == 'UK' for r in STUDENTS)}, US {sum(r[4] == 'US' for r in STUDENTS)}, other {sum(r[4] not in ('UK', 'US') for r in STUDENTS)})")

    key = answer_key()
    if not already:
        print("▸ Exams and practice")
        say(f"{take_exams(api, tokens, skills, key)} exam attempts submitted")
        say(f"{run_practice(api, tokens, skills, key)} practice runs finished")

    if already:
        say("Social world already built — skipping friends, groups and teachers (delete the demo accounts to rebuild).")
    else:
        print("▸ Friends and chats")
        say(f"{make_friends(api, tokens, ids)} friendships")
        chat(api, tokens, ids, [
            ("oliver", "emma", "Ready for the maths mock? 😅"),
            ("emma", "oliver", "Almost! Doing one more practice run on algebra + statistics tonight."),
            ("oliver", "emma", "Duel me after — loser buys coffee ☕"),
            ("ava", "emma", "Thanks for joining the Prep Squad! Grammar round is Thursday."),
            ("emma", "ava", "Can't wait 🙌"),
            ("liam", "harper", "Did you finish the algebra section in the new material?"),
            ("harper", "liam", "Yes! The worked example made the method click."),
        ])
        print("▸ Study groups")
        build_groups(api, tokens, ids, course_ids)
        print("▸ Teachers")
        build_teachers(api, admin, tokens, ids)
        broadcast(api, admin)

    print("▸ Polishing profiles and timelines")
    polish()
    print("\n✓ Demo world ready.")
    print("  Showcase student:  emma / demo1234   (London, friends, 4 groups, 2 teachers, exam history)")
    print("  US student:        ava / demo1234    ·  more: oliver, liam, olivia, noah, lucas, harper …")
    print("  Teacher:           mr_whitaker / demo1234   (verified, students, quiz, reviews)")
    print(f"  Admin:             {DEFAULT_ADMIN_EMAIL} / (your admin password)")


STUDENT_COUNTRY = {r[0]: r[4] for r in STUDENTS}

if __name__ == "__main__":
    main()
