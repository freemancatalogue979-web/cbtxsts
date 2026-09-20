"""One-time converter: legacy JSON files -> Python seed modules for the SQLite DB."""
import json, random, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEGACY = ROOT / "my-unn-quiz-app-1" / "src" / "data"
OUT = Path(__file__).resolve().parents[1] / "app" / "seed_data"
OUT.mkdir(parents=True, exist_ok=True)

students = json.loads((LEGACY / "students.json").read_text(encoding="utf-8"))
questions = json.loads((LEGACY / "seedQuestions.json").read_text(encoding="utf-8"))

PREFIXES = ["0803", "0813", "0703", "0816", "0903", "0706", "0810", "0902", "0705", "0814"]
used = set()
roster = []
for i, s in enumerate(students, start=1):
    rng = random.Random(90210 + i * 7919)
    while True:
        phone = rng.choice(PREFIXES) + "".join(str(rng.randint(0, 9)) for _ in range(7))
        if phone not in used:
            used.add(phone)
            break
    name = re.sub(r"\s+", " ", s["name"]).strip()
    roster.append({
        "phone": phone,
        "name": name,
        "reg_no": s.get("regNo", ""),
        "faculty": s.get("faculty", "Faculty of Law"),
        "campus": s.get("campus", "UNEC (Enugu Campus)"),
        "class_name": s.get("class", "030 Law Class"),
        "level": s.get("level", "400 Level"),
    })

qrows = []
for i, q in enumerate(questions, start=1):
    o = q["options"]
    qrows.append({
        "text": q["questionText"].strip(),
        "option_a": o["A"].strip(), "option_b": o["B"].strip(),
        "option_c": o.get("C", "").strip(), "option_d": o.get("D", "").strip(),
        "correct": q["correctAnswer"].strip().upper()[:1],
        "explanation": (q.get("explanation") or "").strip(),
    })

def dump(name: str, var: str, rows, header: str) -> None:
    body = ",\n".join("    " + repr(r) for r in rows)
    (OUT / name).write_text(f'"""{header}"""\n\n{var} = [\n{body},\n]\n', encoding="utf-8")

dump("roster.py", "ROSTER", roster, "Legacy UNEC Faculty of Law class roster, migrated with generated phone numbers.")
dump("questions.py", "QUESTIONS", qrows, "Legacy 70-question Nigerian Constitutional Law bank, migrated into the database seed.")
(OUT / "__init__.py").write_text("", encoding="utf-8")
print(f"roster={len(roster)} questions={len(qrows)}")
print("sample:", roster[0])
print("sample q:", qrows[0]["text"][:70], "->", qrows[0]["correct"])
