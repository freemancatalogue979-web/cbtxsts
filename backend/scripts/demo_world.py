#!/usr/bin/env python3
"""Build a lived-in demo world for presentations.

    cd backend && .venv/bin/python scripts/demo_world.py [--url http://127.0.0.1:3000]

(or simply ``./start-arena.sh demo`` / ``start-arena.bat demo`` while the app runs)

What it does
  1. Removes the old Law demo content (LAW 411 / 421 / 431 courses, their exams,
     questions and materials) and the Naira-era notices/prize names.
  2. Makes sure the general-subject courses exist (English, Maths, Biology,
     Chemistry, Physics, Computer Science) with questions, exams and materials.
  3. Creates students — mostly United States and United Kingdom — and gives them
     real history through the normal API: exams taken, practice runs, friends,
     study groups with chat / announcements / Q&A / group quizzes, private chats,
     teachers with students, materials, quizzes, reviews and replies.
  4. Polishes profiles (schools, bios, streaks, ratings) and spreads activity
     over the last few weeks so feeds and leaderboards look natural.

It only touches content it owns (the Law demo courses and the demo usernames
below) — your own accounts, courses and uploads are left alone. Safe to re-run:
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
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from sqlalchemy import or_, select  # noqa: E402

from app.config import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
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
    utcnow,
)

PASSWORD = "demo1234"
LAW_CODES = ("LAW 411", "LAW 421", "LAW 431")
MARKER_GROUP = "London Maths Circle"
rng = random.Random(2026)

# username, display name, phone, school/campus, country, level, bio, status, skill 0..1
STUDENTS = [
    ("emma", "Emma Wilson", "+447700900101", "King's College London", "UK", "Year 2", "Maths & biology nerd from London. Coffee, flashcards and a 6am study club.", "Revising for mocks ☕", 0.86),
    ("oliver", "Oliver Bennett", "+447700900102", "University of Manchester", "UK", "Year 1", "Physics first, football second. Ask me about Newton's laws.", "Speed round anyone?", 0.78),
    ("amelia", "Amelia Hughes", "+447700900103", "University of Leeds", "UK", "Year 2", "Future doctor. Biology flashcards are my love language.", "", 0.82),
    ("harry", "Harry Clarke", "+447700900104", "University of Birmingham", "UK", "Year 1", "Coding, chess and chemistry.", "In the library 📚", 0.64),
    ("isla", "Isla Murray", "+447700900105", "University of Edinburgh", "UK", "Year 3", "Scottish, sarcastic, and strangely good at algebra.", "", 0.74),
    ("george", "George Patel", "+447700900106", "University of Leicester", "UK", "Year 2", "Computer science student. I explain binary at parties.", "Building a study bot", 0.8),
    ("charlotte", "Charlotte Evans", "+447700900107", "Cardiff University", "UK", "Year 1", "English literature + a bit of everything.", "", 0.69),
    ("jack", "Jack Robinson", "+447700900108", "University of Bristol", "UK", "Year 2", "Engineering student. Physics duels at 9pm.", "", 0.71),
    ("priya", "Priya Sharma", "+447700900109", "University College London", "UK", "Year 3", "Chemistry is just cooking with more maths.", "Mock exam Friday!", 0.88),
    ("freya", "Freya Morgan", "+447700900110", "University of Oxford", "UK", "Year 1", "Languages and linguistics. Grammar police (friendly).", "", 0.84),
    ("liam", "Liam Johnson", "+12025550101", "University of Texas at Austin", "US", "Sophomore", "Pre-med from Austin. Bio + chem all day.", "Grinding practice sets", 0.79),
    ("olivia", "Olivia Martinez", "+12025550102", "UCLA", "US", "Junior", "LA born. Writing, debate and way too much iced coffee.", "", 0.75),
    ("noah", "Noah Williams", "+12025550103", "University of Chicago", "US", "Freshman", "Math major. Probability puzzles welcome.", "", 0.83),
    ("ava", "Ava Thompson", "+12025550104", "New York University", "US", "Sophomore", "SAT/AP tutor on weekends. Running the Prep Squad.", "Group quiz tonight 8pm", 0.87),
    ("ethan", "Ethan Brooks", "+12025550105", "University of Washington", "US", "Junior", "Seattle. CS + physics. Rainy days = study days.", "", 0.72),
    ("mia", "Mia Rodriguez", "+12025550106", "University of Miami", "US", "Freshman", "Marine biology dreams 🐠", "", 0.66),
    ("lucas", "Lucas Kim", "+12025550107", "UC Berkeley", "US", "Senior", "Software engineering. Running Code Club 101.", "Shipping side projects", 0.9),
    ("harper", "Harper Davis", "+12025550108", "Boston University", "US", "Sophomore", "Biology night owl. Ask me about genetics.", "", 0.77),
    ("jayden", "Jayden Carter", "+12025550109", "Georgia Tech", "US", "Junior", "Atlanta. Engineering + basketball.", "", 0.68),
    ("chloe", "Chloe Anderson", "+12025550110", "University of Colorado Boulder", "US", "Freshman", "Environmental science, hiking, and ecology quizzes.", "", 0.7),
    ("mason", "Mason Lee", "+12025550111", "Rice University", "US", "Sophomore", "Houston. Chemistry lab rat.", "", 0.73),
    ("zoe", "Zoe Mitchell", "+12025550112", "University of Pennsylvania", "US", "Junior", "Economics + statistics. Spreadsheets are art.", "", 0.81),
    ("sarah", "Sarah Chen", "+14165550113", "University of Toronto", "CA", "Year 2", "Toronto. Life sciences and piano.", "", 0.85),
    ("daniel", "Daniel Okoro", "08035550114", "University of Lagos", "NG", "200 Level", "Lagos. Maths and computing.", "", 0.76),
    ("aisha", "Aisha Bello", "08035550115", "University of Abuja", "NG", "300 Level", "Abuja. Biochemistry and good vibes.", "", 0.74),
]

# username, name, phone, headline, bio, specialties, years, institution, languages, verify(True/False/None=pending)
TEACHERS = [
    ("mr_whitaker", "James Whitaker", "+447700900201", "Maths & physics tutor — GCSE to first-year university",
     "Former secondary-school head of maths in London. I build intuition first, then exam technique, with short weekly check-ins and worked examples for every topic.",
     [{"subject": "Mathematics", "topics": ["Algebra", "Geometry", "Statistics"]}, {"subject": "Physics", "topics": ["Mechanics", "Electricity"]}], 12, "University College London", ["English"], True),
    ("ms_adams", "Rachel Adams", "+12025550201", "English writing & comprehension coach",
     "I help students write clearly and read critically: grammar, essays and comprehension with detailed written feedback on every piece you send me.",
     [{"subject": "English", "topics": ["Grammar", "Essay Writing", "Comprehension"]}], 9, "Columbia University", ["English", "French"], True),
    ("dr_thompson", "Michael Thompson", "+12025550202", "Chemistry & biology made simple",
     "PhD chemist and former lab instructor. I break hard topics into small steps, then practise with real exam-style questions every week.",
     [{"subject": "Chemistry", "topics": ["Chemical Bonding", "Stoichiometry"]}, {"subject": "Biology", "topics": ["Cell Biology", "Genetics"]}], 7, "University of Michigan", ["English"], False),
    ("ms_price", "Hannah Price", "+447700900202", "Computer science & coding mentor",
     "Software engineer turned teacher. Algorithms, programming basics and networks taught through small projects you can actually run.",
     [{"subject": "Computer Science", "topics": ["Programming", "Algorithms", "Computer Networks"]}], 6, "University of Cambridge", ["English"], True),
    ("ms_liu", "Grace Liu", "+14165550203", "Biology tutor — genetics and ecology",
     "Graduate student in molecular biology. Friendly, patient and big on diagrams.",
     [{"subject": "Biology", "topics": ["Genetics", "Ecology"]}], 3, "McGill University", ["English", "French"], None),
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
    """Remove the Law demo bank and Naira-era copy; ensure the general courses exist."""
    from app.seed import PRIZES, seed_all

    init_db()
    with SessionLocal() as db:
        seed_all(db)  # idempotent — creates the general courses/exams/materials if missing
        removed_q = removed_quiz = removed_mat = 0
        for code in LAW_CODES:
            course = db.scalar(select(Course).where(Course.code == code))
            if course is None:
                continue
            for material in db.scalars(select(Material).where(Material.course_id == course.id)).all():
                db.delete(material)
                removed_mat += 1
            quizzes = db.scalars(select(Quiz).where(Quiz.course_id == course.id)).all()
            quiz_ids = [q.id for q in quizzes]
            questions = db.scalars(select(Question).where(or_(Question.course_id == course.id, Question.quiz_id.in_(quiz_ids or [-1])))).all()
            for question in questions:
                db.delete(question)
                removed_q += 1
            db.flush()
            for quiz in quizzes:
                db.delete(quiz)
                removed_quiz += 1
            db.flush()
            db.delete(course)
            db.flush()
        for note in db.scalars(select(Notification)).all():
            text = f"{note.title} {note.message} {note.target_course or ''}"
            if "LAW " in text or "Constitutional" in text or "₦" in text or "Jurisprudence" in text:
                db.delete(note)
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
        courses = db.scalars(select(Course).order_by(Course.id)).all()
        say(f"Removed Law demo content: {removed_q} questions, {removed_quiz} exams, {removed_mat} materials.")
        say("Courses now: " + ", ".join(c.code for c in courses))


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
        courses = [(c.id, c.code) for c in db.scalars(select(Course).where(Course.code.notin_(LAW_CODES))).all()]
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
            "description": "US students prepping grammar, reading and math sections. Weekly group quizzes and accountability check-ins.",
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
        {
            "owner": "harper", "name": "Biology Night Owls", "course": "BIO 101", "goal": "Master cells, genetics and the human body",
            "description": "Late-night biology sessions for pre-med and life-science students on both sides of the Atlantic.",
            "members": ["amelia", "liam", "mia", "sarah", "aisha", "emma", "chloe"], "mod": "amelia",
            "chat": [
                ("harper", "Tonight: genetics. Bring your Punnett squares 🧬"),
                ("amelia", "Tt × Tt → 1 TT : 2 Tt : 1 tt. So 1/4 show the recessive trait."),
                ("mia", "Wait, so 3/4 look dominant even though only 1/4 are TT?"),
                ("sarah", "Exactly — Tt still shows the dominant trait."),
                ("liam", "Can someone explain osmosis vs diffusion simply?"),
                ("aisha", "Osmosis is just diffusion of WATER across a partially permeable membrane 💧"),
            ],
            "announcement": ("New material: Cells, Genes & the Human Body", "Read sections 1–2 before Thursday — we'll quiz on them.", "normal"),
            "question": ("Why are mitochondria called the powerhouse?", "Is it just a nickname or is there a real reason?", "Cell Biology",
                         "sarah", "They carry out aerobic respiration, releasing the energy (as ATP) that the cell uses for almost everything."),
            "quiz": ("Genetics Quickfire", "Genetics", 6),
        },
        {
            "owner": "lucas", "name": "Code Club 101", "course": "CSC 101", "goal": "From binary to building our first app",
            "description": "Beginner-friendly computer science: binary, algorithms, networks and programming basics.",
            "members": ["george", "ethan", "harry", "daniel", "noah", "emma"], "mod": "george",
            "chat": [
                ("lucas", "Hey coders 👩‍💻 This week: binary and hexadecimal."),
                ("george", "Quick one: 1010 in binary = 8 + 2 = 10."),
                ("ethan", "And F in hex is 15 — everything clicked once I learned that."),
                ("daniel", "Binary search next? It's my favourite algorithm."),
                ("harry", "Why does it need the list to be sorted?"),
                ("lucas", "Because it throws away half each step — it only works if order tells you which half to drop."),
            ],
            "announcement": ("Project week", "Build a tiny program that converts decimal to binary. Share it here by Sunday!", "normal"),
            "question": ("What does 17 % 5 mean?", "I saw % in some Python code and it's not percent?", "Programming Basics",
                         "george", "% is the modulus operator — it gives the remainder. 17 = 3 × 5 + 2, so 17 % 5 = 2."),
            "quiz": ("Binary & Algorithms", "Number Systems", 6),
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
                    api.call("POST", f"/groups/{gid}/messages/{last}/react", {"emoji": rng.choice(["🔥", "👏", "💯", "😂", "🙌"])}, tokens[rng.choice(plan["members"])])
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
        ("mr_whitaker", "jack", "Physics", "Mechanics", "Struggling with F = ma problems with friction.", True),
        ("mr_whitaker", "noah", "Mathematics", "Statistics", "Probability questions with two events confuse me.", True),
        ("mr_whitaker", "isla", "Mathematics", "Geometry", "Circle theorems please!", False),
        ("ms_adams", "olivia", "English", "Essay Writing", "Can you review my argumentative essays weekly?", True),
        ("ms_adams", "charlotte", "English", "Grammar", "I want to fix my comma splices for good.", True),
        ("ms_adams", "emma", "English", "Comprehension", "Help with inference questions.", False),
        ("dr_thompson", "liam", "Chemistry", "Chemical Bonding", "Ionic vs covalent keeps tripping me up.", True),
        ("dr_thompson", "priya", "Biology", "Genetics", "Monohybrid crosses practice please.", True),
        ("ms_price", "harry", "Computer Science", "Programming", "Complete beginner — want to learn Python basics.", True),
        ("ms_price", "daniel", "Computer Science", "Algorithms", "Binary search and sorting.", True),
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
        ("ms_price", "harry", "Welcome Harry! First task: write a program that prints 1 to 10."),
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
        ("dr_thompson", "liam", 4, "Great explanations of bonding with loads of practice questions.", ""),
        ("ms_price", "daniel", 5, "Hannah explains algorithms with real code you can run. Highly recommend.", "Thanks Daniel! Can't wait to see your next project."),
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
        {"title": "Welcome to the new season 🎉", "message": "Six subjects, fresh exams and new study groups. Jump into the English Mock or a Maths Speed Round to start climbing the leaderboard.", "kind": "exam", "is_pinned": True},
        {"title": "Mixed-topic practice is here", "message": "Pick several topics at once in Practice — perfect for revision before a mock exam.", "kind": "general"},
        {"title": "Find a teacher", "message": "Verified teachers in Maths, English, Sciences and Computer Science are now accepting students.", "kind": "general"},
    ]
    for row in notices:
        api.call("POST", "/admin/notifications", row, admin)


# ------------------------------------------------------------- phase 2: polish
def polish() -> None:
    now = utcnow()
    with SessionLocal() as db:
        by_user = {s.username: s for s in db.scalars(select(Student).where(Student.username.in_([r[0] for r in STUDENTS] + [t[0] for t in TEACHERS]))).all()}
        for username, name, _phone, school, country, level, bio, status_text, skill in STUDENTS:
            s = by_user.get(username)
            if not s:
                continue
            s.name, s.bio, s.status_text = name, bio, status_text
            s.campus, s.faculty, s.level = school, {"UK": "United Kingdom", "US": "United States", "CA": "Canada", "NG": "Nigeria"}[country], level
            s.class_name = f"{country} Students"
            s.avatar_hue = (COUNTRY_HUE[country] + rng.randint(-25, 25)) % 360
            s.created_at = now - timedelta(days=rng.randint(20, 75))
            s.streak = 12 if username == "emma" else rng.randint(0, 9)
            s.best_streak = max(s.streak, rng.randint(s.streak, s.streak + 10))
            s.last_active = date.today() if s.streak else date.today() - timedelta(days=rng.randint(1, 4))
            s.ranked_rating = int(1000 + (skill - 0.6) * 1400 + rng.randint(-60, 60))
            s.ranked_played = rng.randint(4, 30)
            s.ranked_won = int(s.ranked_played * min(0.9, skill * rng.uniform(0.6, 0.9)))
            s.duels_played = rng.randint(3, 25)
            s.duels_won = int(s.duels_played * min(0.9, skill * rng.uniform(0.5, 0.9)))
            s.duels_lost = s.duels_played - s.duels_won
            s.coins = max(s.coins, rng.randint(250, 1400))
            s.diamonds = max(s.diamonds, rng.randint(5, 60))
        for t in TEACHERS:
            s = by_user.get(t[0])
            if s:
                s.campus, s.bio = t[7], t[3]
        ids = [s.id for s in by_user.values()]
        # Spread history across the past three weeks so feeds look natural.
        for attempt in db.scalars(select(Attempt).where(Attempt.student_id.in_(ids))).all():
            shift = timedelta(days=rng.randint(0, 20), hours=rng.randint(0, 12))
            for field in ("started_at", "deadline_at", "submitted_at"):
                if getattr(attempt, field, None):
                    setattr(attempt, field, getattr(attempt, field) - shift)
        for activity in db.scalars(select(Activity).where(Activity.student_id.in_(ids))).all():
            activity.created_at = activity.created_at - timedelta(days=rng.randint(0, 14), hours=rng.randint(0, 20))
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
            ("liam", "harper", "Did you finish the genetics section in the new material?"),
            ("harper", "liam", "Yes! The Punnett square example is so clear."),
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
