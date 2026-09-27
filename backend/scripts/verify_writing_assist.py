"""Writing help for materials: spelling fixer + "Make it easy to read" (Gemini).

Spelling (offline, always available):
* finds real typos with context and a reason; British spellings, names,
  acronyms, links and the material's own terms are left alone;
* only the ids staff accept are applied; nothing is saved by the endpoint;
* non-staff are refused.

Rewrite — run against a local mock of the Gemini REST API, so no key or
internet is needed. Start the API with the mock settings first:

    GEMINI_API_KEY=test-key GEMINI_API_BASE=http://127.0.0.1:3999/v1beta \\
      .venv/bin/uvicorn app.main:app --port 3000
    .venv/bin/python scripts/verify_writing_assist.py

(Without those settings the rewrite part checks the "not set up" answer.)
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = os.getenv("ARENA_API", "http://127.0.0.1:3000/api")
MOCK_PORT = int(os.getenv("MOCK_GEMINI_PORT", "3999"))
PASSED = FAILED = 0
SEEN: list[dict] = []


def check(name: str, condition: bool, info: object = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(info)[:260]}")


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return error.code, raw.decode(errors="replace")


# ------------------------------------------------------------ mock gemini
class MockGemini(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _send(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        model = re.search(r"/models/([^:]+):generateContent", self.path)
        SEEN.append({"model": model.group(1) if model else "", "key": self.headers.get("x-goog-api-key"), "body": body})
        if self.headers.get("x-goog-api-key") != "test-key":
            return self._send(403, {"error": {"message": "API key not valid."}})
        if model and model.group(1) == "gemini-flash-latest":
            return self._send(404, {"error": {"message": "models/gemini-flash-latest is not found"}})
        prompt = body["contents"][0]["parts"][0]["text"]
        if "TRIGGER_429" in prompt:
            return self._send(429, {"error": {"message": "Resource has been exhausted"}})
        sections = json.loads(prompt[prompt.index("{") :])["sections"] if "{" in prompt else []
        out = []
        for section in sections:
            blocks = []
            for block in section["blocks"]:
                if block["type"] == "paragraph":
                    text = block["text"]
                    if section["index"] == 1:
                        text = re.sub(r"\d+", "", text)  # drop numbers → the fact check must warn
                    blocks.append({"type": "paragraph", "text": "In simple words: " + text.replace("osmosis", "**osmosis**")})
                elif block["type"] in {"image", "video", "attachment"}:
                    continue  # "forget" media → the service must put it back
                else:
                    blocks.append(block)
            if section["index"] == 0:
                blocks.append({"type": "tip", "text": "Think of a sponge <script>alert(1)</script> soaking water."})
                blocks.append({"type": "banana", "text": "unknown block type becomes a paragraph"})
            if section["index"] != 2:  # section 2 is "skipped" → the service must say so
                out.append({"index": section["index"], "title": section["title"] + " (easy)", "blocks": blocks})
        text = json.dumps({"sections": out})
        if "TRIGGER_FENCE" in prompt:
            text = "```json\n" + text + "\n```"
        return self._send(200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


def start_mock() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockGemini)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> int:
    status, auth = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    admin = auth.get("token") or auth.get("access_token")
    status, courses = call("GET", "/admin/courses", token=admin)
    courses = courses if isinstance(courses, list) else courses.get("courses", [])
    course = courses[0]

    # ---------------------------------------------------------- spelling
    print("spelling")
    doc = {
        "title": "Photosynthsis basics",
        "description": "The colour of leaves and the organisation of the the chloroplast .",
        "summary": ["i think teh Calvin cycle is key"],
        "topic": "Plant physiology",
        "course_id": course["id"],
        "sections": [
            {
                "title": "Light reactons",
                "blocks": [
                    {"type": "paragraph", "text": "In the thylakoid, light splits water.The ATP made here is used later. Dr Okonkwo taught this at UNILAG in 2019 — see https://example.com/notes.pdf."},
                    {"type": "paragraph", "text": "The goverment programme in the centre recieved funding. Stacks are called grana. This is definately a sucessful enviroment for learnng."},
                    {"type": "list", "items": ["Photosystem II absorbs light", "Electrons flow wich makes ATP", "Audi alteram partem: hear the other side", "Nemo judex in causa sua"]},
                    {"type": "keyterm", "term": "Photolysis", "meaning": "splitting of water by ligth"},
                ],
            }
        ],
    }
    status, found = call("POST", "/admin/materials/assist/spelling", doc, admin)
    check("spelling check answers", status == 200 and isinstance(found.get("changes"), list), found)
    pairs = {(row["from"], row["to"]) for row in found.get("changes", [])}
    for wrong, right in [("Photosynthsis", "Photosynthesis"), ("teh", "the"), ("recieved", "received"), ("goverment", "government"), ("wich", "which"), ("learnng", "learning"), ("ligth", "light"), ("reactons", "reactions")]:
        check(f"finds {wrong} → {right}", (wrong, right) in pairs, sorted(pairs))
    check("finds the repeated word", ("the the", "the") in pairs, sorted(pairs))
    check("finds the lone lowercase i", ("i", "I") in pairs, sorted(pairs))
    check("finds the missing space after a full stop", (".", ". ") in pairs, sorted(pairs))
    froms = {row["from"].lower() for row in found.get("changes", [])}
    for fine in ["colour", "organisation", "programme", "centre", "okonkwo", "unilag", "atp", "thylakoid", "example", "notes"]:
        check(f"leaves “{fine}” alone", fine not in froms, sorted(froms))
    for latin in ["audi", "alteram", "partem", "nemo", "judex", "causa"]:
        check(f"leaves the Latin “{latin}” alone", latin not in froms, sorted(froms))
    status, near = call("POST", "/admin/materials/assist/spelling", {"title": "", "description": "", "summary": [], "sections": [{"title": "", "blocks": [{"type": "paragraph", "text": "Photosynthesis needs ligth and watr to work."}]}]}, admin)
    check("typos next to each other are still caught", any(row["from"] == "ligth" for row in near.get("changes", [])), near.get("changes"))
    grana = [row for row in found["changes"] if row["from"] == "grana"]
    check("an unsure short-word guess is only a “maybe”", all(row["confidence"] == "maybe" for row in grana), grana)
    sample = next((row for row in found["changes"] if row["from"] == "recieved"), {})
    check("each change has context, reason and confidence", bool(sample.get("before")) and bool(sample.get("reason")) and sample.get("confidence") == "sure", sample)

    sure = [row["id"] for row in found["changes"] if row["confidence"] == "sure"]
    status, fixed = call("POST", "/admin/materials/assist/spelling", {**doc, "accept": sure}, admin)
    document = fixed.get("document", {})
    check("apply returns the corrected document", status == 200 and fixed.get("applied") == len(sure), fixed.get("applied"))
    check("title fixed", document.get("title") == "Photosynthesis basics", document.get("title"))
    check("description fixed, British spelling kept", document.get("description") == "The colour of leaves and the organisation of the chloroplast.", document.get("description"))
    body = document["sections"][0]["blocks"][1]["text"]
    check("paragraph fixed", "government programme in the centre received" in body and "definitely a successful environment for learning" in body, body)
    check("unticked “maybe” fixes are not applied", "grana" in body, body)
    check("links untouched", "https://example.com/notes.pdf" in document["sections"][0]["blocks"][0]["text"], document["sections"][0]["blocks"][0]["text"])
    status, only_one = call("POST", "/admin/materials/assist/spelling", {**doc, "accept": [sample.get("id")]}, admin)
    check("only accepted ids are applied", only_one.get("applied") == 1 and "goverment" in only_one["document"]["sections"][0]["blocks"][1]["text"], only_one.get("applied"))

    # import: sure fixes are applied automatically (and can be switched off)
    def upload(fields: dict, name: str, data: bytes):
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n\r\n'.encode() + data + b"\r\n")
        request = urllib.request.Request(API + "/admin/materials/import", method="POST", data=b"".join(parts) + f"--{boundary}--\r\n".encode(), headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {admin}"})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode(errors="replace")

    text = b"Goverment and the economy\n\nThe goverment recieved the budget in 2019. The colour of the programme was definately green. Dr Adeyemi agreed.\n"
    status, imported = upload({"course_id": course["id"], "status": "draft"}, "econ.txt", text)
    words = json.dumps(imported.get("sections", [])) if isinstance(imported, dict) else ""
    check("import fixes sure mistakes by default", status == 201 and "government received" in words and "definitely" in words and imported["import"]["spelling_fixed"] >= 3, (status, str(imported)[:300]))
    check("import keeps British spelling and names", "colour" in words and "programme" in words and "Adeyemi" in words, words[:300])
    check("import keeps the numbers", "2019" in words, words[:300])
    status, raw = upload({"course_id": course["id"], "status": "draft", "fix_spelling": "false"}, "econ.txt", text)
    check("import can leave spelling untouched", status == 201 and "goverment recieved" in json.dumps(raw.get("sections", [])) and raw["import"]["spelling_fixed"] == 0, str(raw)[:200])
    for row in (imported, raw):
        if isinstance(row, dict) and row.get("id"):
            call("DELETE", f"/admin/materials/{row['id']}", token=admin)

    reg_status, reg = call("POST", "/auth/register", {"username": f"sp{uuid.uuid4().hex[:6]}", "password": "secret123", "phone": f"080{uuid.uuid4().int % 10**8:08d}", "full_name": "Not Staff"})
    player = reg.get("token")
    check("players can't use the spelling tool", call("POST", "/admin/materials/assist/spelling", doc, player)[0] in (401, 403))
    check("players can't use the rewrite tool", call("POST", "/admin/materials/assist/rewrite", {"sections": []}, player)[0] in (401, 403))

    # ---------------------------------------------------------- rewrite
    print("rewrite")
    status, info = call("GET", "/admin/materials/assist/status", token=admin)
    check("status answers without revealing the key", status == 200 and "test-key" not in json.dumps(info) and "api_key" not in json.dumps(info.get("ai", {}).get("model", "")), info)
    configured = info.get("ai", {}).get("configured")
    sections = [
        {"index": 0, "title": "Osmosis", "blocks": [{"type": "paragraph", "text": "Osmosis is the net movement of water across a membrane; osmosis needs 2 solutions."}, {"type": "image", "url": "/img/cell.png", "caption": "A cell"}]},
        {"index": 1, "title": "History", "blocks": [{"type": "paragraph", "text": "It was described in 1748 and measured in 1877 by Pfeffer, who used 3 tubes."}]},
        {"index": 2, "title": "Skipped", "blocks": [{"type": "paragraph", "text": "This one comes back missing."}]},
    ]
    if not configured:
        status, answer = call("POST", "/admin/materials/assist/rewrite", {"title": "Cells", "style": "easy", "sections": sections}, admin)
        check("without a key the rewrite explains how to set it up", status == 503 and ("API keys" in str(answer) or "GEMINI_API_KEY" in str(answer)), answer)
        print("\n(rewrite checks against the mock were skipped: start the API with GEMINI_API_KEY=test-key GEMINI_API_BASE=http://127.0.0.1:3999/v1beta)")
    else:
        server = start_mock()
        try:
            status, answer = call("POST", "/admin/materials/assist/rewrite", {"title": "Cells", "style": "fun", "sections": sections}, admin)
            if not SEEN:
                # The API has a real key (backend/.env) rather than the mock settings.
                check("a real key that can't be reached gives a clear message", status in (502, 503, 504) and "detail" in answer, answer)
                print("\n(the API uses a real Gemini key, so the mock rewrite checks were skipped: start it with GEMINI_API_KEY=test-key GEMINI_API_BASE=http://127.0.0.1:3999/v1beta to run them)")
                print(f"\nverify_writing_assist: {PASSED} passed, {FAILED} failed")
                return 1 if FAILED else 0
            check("rewrite answers", status == 200 and len(answer.get("sections", [])) == 3, answer)
            check("falls back when the default model is unavailable", answer.get("model") == "gemini-2.5-flash" and SEEN[0]["model"] == "gemini-flash-latest", [row["model"] for row in SEEN])
            check("the key is sent in the header, not the URL", SEEN[-1]["key"] == "test-key")
            sent = SEEN[-1]["body"]
            check("the style and rules are sent", "FUN TO LEARN" in sent["contents"][0]["parts"][0]["text"] and "Keep EVERY fact" in sent["systemInstruction"]["parts"][0]["text"], sent["contents"][0]["parts"][0]["text"][:120])
            check("JSON output is requested", sent["generationConfig"].get("responseMimeType") == "application/json")
            first, second, third = answer["sections"]
            check("rewritten text comes back with **bold** terms", "**osmosis**" in first["blocks"][0]["text"], first["blocks"][0])
            check("new title comes back", first["title"] == "Osmosis (easy)", first["title"])
            check("script tags are stripped from AI output", all("<script" not in json.dumps(block) for block in first["blocks"]), first["blocks"])
            check("unknown block types become paragraphs", any(block["type"] == "paragraph" and "unknown block" in block.get("text", "") for block in first["blocks"]), first["blocks"])
            check("images the AI dropped are put back", any(block["type"] == "image" and block.get("url") == "/img/cell.png" for block in first["blocks"]), first["blocks"])
            check("no warning when every number is kept", first["warnings"] == [], first["warnings"])
            check("missing numbers are flagged for a fact check", second["warnings"] and all(value in second["warnings"][0] for value in ["1748", "1877", "3"]), second["warnings"])
            check("a skipped section stays unchanged and says so", third["changed"] is False and third["blocks"] == sections[2]["blocks"] and third["warnings"], third)

            status, fenced = call("POST", "/admin/materials/assist/rewrite", {"title": "TRIGGER_FENCE", "style": "easy", "sections": sections[:1]}, admin)
            check("```json fenced answers are understood", status == 200 and fenced["sections"][0]["changed"], fenced)
            status, limited = call("POST", "/admin/materials/assist/rewrite", {"title": "TRIGGER_429", "style": "easy", "sections": sections[:1]}, admin)
            check("free-limit errors come back as 429 with advice", status == 429 and "free limit" in str(limited), (status, limited))
            status, empty = call("POST", "/admin/materials/assist/rewrite", {"title": "x", "style": "easy", "sections": []}, admin)
            check("no sections → 422", status == 422, (status, empty))
            huge = [{"index": 0, "title": "Big", "blocks": [{"type": "paragraph", "text": "word " * 1500} for _ in range(12)]}]
            status, too_big = call("POST", "/admin/materials/assist/rewrite", {"title": "x", "style": "easy", "sections": huge}, admin)
            check("too much at once → 413 with advice", status == 413, (status, str(too_big)[:80]))
        finally:
            server.shutdown()

    print(f"\nverify_writing_assist: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
