"""Demo data for the Teacher Network.

Run against a running API (default http://127.0.0.1:3000):

    python backend/scripts/demo_seed.py [base_url]

Creates teachers adaeze (verified), emeka (approved), ibrahim (pending) and
students tobi, chidi, ngozi, amaka — all with password demo1234 — plus a
relationship, chat, material, quiz, study group and a review with a reply.
Uses only the public API (no direct database access). Run it once per fresh
database; usernames are fixed, so a second run fails on registration.
"""

import json
import sys
import urllib.error
import urllib.request
import uuid

B = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/") + "/api"
PASSWORD = "demo1234"


def call(method, path, body=None, tok=None, form=None):
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
    try:
        with urllib.request.urlopen(urllib.request.Request(B + path, data=data, method=method, headers=headers)) as resp:
            return json.loads(resp.read() or "null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read()[:300]!r}")


def token(r):
    return r.get("token") or r.get("access_token")


def register(user, name, phone, country):
    session = call("POST", "/auth/register", {
        "username": user, "phone": phone, "password": PASSWORD, "display_name": name,
    })
    tok = token(session)
    call("PATCH", "/me", {"country": country}, tok)
    return tok


admin = token(call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"}))


def teacher(user, name, phone, country, headline, bio, specs, years, inst, verify):
    t = register(user, name, phone, country)
    call("PUT", "/teachers/me/profile", {
        "headline": headline, "bio": bio, "experience_years": years,
        "experience": "Taught secondary and university students.", "institution": inst,
        "languages": ["English", "Igbo"], "formats": "both",
        "availability": [{"day": d, "start": "17:00", "end": "20:00"} for d in (0, 2, 4)],
        "accepting": True, "specialties": specs,
    }, t)
    call("POST", "/teachers/me/qualifications", tok=t, form={"title": "B.Sc. " + specs[0]["subject"], "institution": inst, "year": "2015"})
    call("POST", "/teachers/me/submit", {}, t)
    pid = call("GET", "/teachers/me/profile", tok=t)["profile"]["id"]
    if verify is not None:
        call("POST", f"/admin/teachers/{pid}/action", {"action": "approve", "note": "Documents checked", "message": ""}, admin)
        if verify:
            call("POST", f"/admin/teachers/{pid}/action", {"action": "verify", "note": "Verified", "message": ""}, admin)
    return t, pid


T, tid = teacher("adaeze", "Adaeze Okafor", "+447700900501", "GB", "Calculus tutor for first-year students",
                 "I help first-year students build intuition for calculus and algebra with worked examples, short quizzes and weekly check-ins tailored to each learner.",
                 [{"subject": "Mathematics", "topics": ["Calculus", "Algebra"]}, {"subject": "English", "topics": ["Comprehension"]}], 8, "University College London", True)
teacher("emeka", "Emeka Nwosu", "+12025550502", "US", "Algebra and statistics made practical",
        "I teach algebra, geometry and statistics with clear worked examples, short quizzes and focused exam-technique sessions.",
        [{"subject": "Mathematics", "topics": ["Geometry", "Statistics"]}, {"subject": "English", "topics": ["Grammar"]}], 5, "University of Chicago", False)
teacher("ibrahim", "Ibrahim Musa", "+447700900503", "GB", "English language and literature coach",
        "I coach students on comprehension, essay writing and literature analysis with a calm, structured approach and lots of written feedback on every essay.",
        [{"subject": "English", "topics": ["Essay Writing", "Comprehension"]}], 3, "University of Oxford", None)

S = {
    user: register(user, name, phone, country)
    for user, name, phone, country in (
        ("tobi", "Tobi Adeyemi", "+12025550504", "US"),
        ("chidi", "Chidi Eze", "+447700900505", "GB"),
        ("ngozi", "Ngozi Obi", "+12025550506", "US"),
        ("amaka", "Amaka Uche", "+447700900507", "GB"),
    )
}


def request(student, topic, msg):
    r = call("POST", f"/teachers/{tid}/requests", {"subject": "Mathematics", "topic": topic, "message": msg, "format": "one", "preferred_time": "Weekday evenings"}, S[student])
    return r.get("id") or r["request"]["id"]


r1 = request("tobi", "Calculus", "I struggle with the chain rule and implicit differentiation before my MTH101 exam.")
r2 = request("chidi", "Algebra", "Need help with quadratic equations and logarithms please.")
request("ngozi", "Calculus", "Could you help me with integration by parts for my test next week?")
call("POST", f"/teachers/studio/requests/{r1}/accept", {"note": "Happy to help!"}, T)
call("POST", f"/teachers/studio/requests/{r2}/accept", {"note": ""}, T)

tobi_teacher = call("GET", "/teachers/me/learning", tok=S["tobi"])["teachers"][0]
chidi_rel = call("GET", "/teachers/me/learning", tok=S["chidi"])["teachers"][0]["relationship"]["id"]
students = call("GET", "/teachers/studio/students", tok=T)
items = students.get("items", students) if isinstance(students, dict) else students
tobi_id = next(s["student"]["id"] for s in items if s["student"]["name"].startswith("Tobi"))

call("POST", "/chat", {"to": tobi_id, "body": "Hi Tobi! Send me a question you got stuck on.", "kind": "text"}, T)
call("POST", "/chat", {"to": tobi_teacher["teacher"]["student_id"], "body": "Thanks! Question 4 from the past paper — chain rule with sin(x²).", "kind": "text"}, S["tobi"])

call("POST", "/teachers/studio/materials", {"title": "Chain rule cheat sheet", "description": "Worked examples", "subject": "Mathematics", "topic": "Calculus",
                                            "kind": "text", "body": "d/dx f(g(x)) = f'(g(x)) · g'(x)", "visibility": "students"}, T)
quiz = call("POST", "/teachers/studio/quizzes", {
    "title": "Chain rule check", "subject": "Mathematics", "topic": "Calculus", "time_limit_minutes": 10, "pass_mark": 60, "visibility": "students",
    "questions": [
        {"kind": "mcq", "prompt": "d/dx sin(x^2) = ?", "options": ["cos(x^2)", "2x cos(x^2)", "2x sin(x)", "x cos(x^2)"], "answer": "B"},
        {"kind": "tf", "prompt": "d/dx e^(2x) = 2e^(2x)", "answer": "true"},
    ],
}, T)
call("POST", f"/teachers/studio/quizzes/{quiz.get('id') or quiz['quiz']['id']}/publish", {}, T)
call("POST", "/teachers/studio/groups", {"name": "MTH101 Evening Class", "description": "Weekly calculus practice", "subject": "Mathematics",
                                         "topic": "Calculus", "capacity": 20, "privacy": "request"}, T)

call("POST", f"/teachers/relationships/{chidi_rel}/complete", {}, S["chidi"])
review = call("POST", f"/teachers/{tid}/reviews", {"rating": 5, "body": "Adaeze explained logarithms so clearly. My test score went from 45 to 78!", "anonymous": False}, S["chidi"])
call("POST", f"/teachers/reviews/{review.get('id') or review['review']['id']}/response", {"response": "So proud of your progress, Chidi. Keep practising!"}, T)

print(f"Seeded. Log in as adaeze / emeka / ibrahim / tobi / chidi / ngozi / amaka with password {PASSWORD}")
