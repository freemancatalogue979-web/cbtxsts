"""Background rewrite jobs, AI highlight tidying and PDF page clean-up.

Runs fully in-process against a local mock of the Gemini REST API — no key,
no internet and no running API needed:

    .venv/bin/python scripts/verify_rewrite_jobs.py

Checks
* a long material (9 sections → 5 batches) finishes in the background while
  the mock is slow, rate-limits once (429) and fails once (500): the job
  retries on its own and every section comes back;
* polling with ``after`` only returns new results;
* a bad key stops the job with one clear error, remaining sections listed as failed;
* cancel stops a running job;
* ``tidy_bold`` keeps AI highlighting short, first-mention-only and out of headings;
* PDF running headers / footers / page numbers are removed, real headings kept.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MOCK_PORT = int(os.getenv("MOCK_GEMINI_PORT", "3994"))
os.environ.update(
    {
        "AI_PROVIDER": "gemini",
        "GEMINI_API_KEY": "test-key",
        "GEMINI_API_BASE": f"http://127.0.0.1:{MOCK_PORT}/v1beta",
        "GEMINI_MODEL": "mock-flash",
        "GEMINI_FALLBACK_MODELS": "",
    }
)
os.environ.pop("DEEPSEEK_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import ai_rewrite  # noqa: E402
from app.services.material_import import _strip_page_furniture  # noqa: E402

PASSED = FAILED = 0
STATE = {"calls": 0, "fail_plan": [], "delay": 0.0, "bad_key": False}


def check(name: str, condition: bool, info: object = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(info)[:300]}")


class Mock(BaseHTTPRequestHandler):
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
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        STATE["calls"] += 1
        if STATE["bad_key"]:
            return self._send(403, {"error": {"message": "API key not valid"}})
        if STATE["fail_plan"]:
            code = STATE["fail_plan"].pop(0)
            return self._send(code, {"error": {"message": "mock failure"}})
        time.sleep(STATE["delay"])
        prompt = body["contents"][0]["parts"][0]["text"]
        data = json.loads(prompt[prompt.index("{", prompt.index("reply with JSON only")) :])
        sections = []
        for row in data["sections"]:
            sections.append(
                {
                    "index": row["index"],
                    "title": f"**{row['title']}**",  # bold in a title must be removed
                    "blocks": [
                        {"type": "heading", "text": "**Big heading**"},
                        {
                            "type": "paragraph",
                            "text": (
                                "The **mischief rule** asks what the law was meant to cure. "
                                "**This whole long sentence is bold for no good reason at all** and the "
                                "**mischief rule** again, plus **the** and **(2004) 12 NWLR (Pt. 887) 1**. "
                                "See **Heydon's Case** and **Section 3**. Numbers: "
                                + " ".join(block.get("text", "") for block in row["blocks"])
                            ),
                        },
                    ],
                }
            )
        text = json.dumps({"sections": sections})
        return self._send(200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


def wait(job_id: str, timeout: float = 60) -> dict:
    end = time.time() + timeout
    state = ai_rewrite.job_state(job_id)
    while state["status"] == "running" and time.time() < end:
        time.sleep(0.2)
        state = ai_rewrite.job_state(job_id)
    return state


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), Mock)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # fast retries for the test (real waits: 20/40/60 s on 429, 2/4/8 s otherwise)
    real_wait = ai_rewrite._retry_wait
    ai_rewrite._retry_wait = lambda error, attempt: None if real_wait(error, attempt) is None else 0.3

    print("\nbackground job survives slow + rate-limited + failing AI")
    sections = [
        {"index": i, "title": f"Rule {i + 1}", "blocks": [{"type": "paragraph", "text": f"Rule {i + 1} was made in {1990 + i}. " + "Counsel owes a duty to the court. " * 40}]}
        for i in range(9)
    ]
    STATE.update(calls=0, fail_plan=[429, 500], delay=0.4, bad_key=False)
    started = time.time()
    job = ai_rewrite.start_job("RPC notes", sections, "exam", owner="7")
    check("start answers at once (no waiting on the AI)", time.time() - started < 1.0, time.time() - started)
    check("start reports the total", job["total"] == 9 and job["status"] == "running", job)
    first = wait(job["id"], 5)
    seen_seq = first["seq"]
    final = wait(job["id"])
    check("job finishes", final["status"] == "done", final)
    check("every section came back", final["done"] == 9 and not final["failed"], final)
    check("retried after 429 and 500 (5 batches + 2 retries)", STATE["calls"] == 7, STATE["calls"])
    everything = ai_rewrite.job_state(job["id"], "7", 0)["sections"]
    check("all 9 results available from after=0", sorted(row["index"] for row in everything) == list(range(9)), [row["index"] for row in everything])
    newer = ai_rewrite.job_state(job["id"], "7", seen_seq)["sections"]
    check("after=<seq> returns only newer results", all(row["seq"] > seen_seq for row in newer) and len(newer) == 9 - seen_seq, (seen_seq, len(newer)))
    check("another staff member can't read the job", _raises(lambda: ai_rewrite.job_state(job["id"], "8")))

    print("\nAI highlighting is tidied")
    row = everything[0]
    para = next(block for block in row["blocks"] if block["type"] == "paragraph")["text"]
    heading = next(block for block in row["blocks"] if block["type"] == "heading")["text"]
    check("no bold in section titles", "**" not in row["title"], row["title"])
    check("no bold in headings", "**" not in heading, heading)
    check("defined term kept bold (first mention)", para.count("**mischief rule**") == 1, para[:200])
    check("long bold sentence unbolded", "**This whole" not in para and "This whole long sentence" in para)
    check("bold stop-word unbolded", "**the**" not in para)
    check("bold citation unbolded", "**(2004)" not in para and "(2004) 12 NWLR" in para)
    check("case name and section kept bold", "**Heydon's Case**" in para and "**Section 3**" in para, para)
    check("numbers from the original kept (no warning)", not any("numbers" in w for w in row["warnings"]), row["warnings"])

    print("\nfatal errors stop the job with one clear message")
    STATE.update(calls=0, fail_plan=[], delay=0, bad_key=True)
    bad = wait(ai_rewrite.start_job("RPC notes", sections, "easy")["id"])
    check("status failed", bad["status"] == "failed", bad)
    check("clear key message", "key" in bad["error"].lower(), bad["error"])
    check("no pointless retries on a bad key", STATE["calls"] == 1, STATE["calls"])
    check("every section listed as not done", bad["failed"] == list(range(9)), bad["failed"])

    print("\ncancel")
    STATE.update(calls=0, fail_plan=[], delay=0.5, bad_key=False)
    job = ai_rewrite.start_job("RPC notes", sections, "easy")
    time.sleep(0.2)
    ai_rewrite.cancel_job(job["id"])
    stopped = wait(job["id"], 10)
    check("cancelled", stopped["status"] == "cancelled", stopped)
    check("stopped early", STATE["calls"] <= 2 and len(stopped["failed"]) >= 7, (STATE["calls"], stopped["failed"]))
    check("nothing set up → 503 before starting", _no_key_refused())

    print("\nPDF page clean-up")
    pages = []
    for n in range(1, 9):
        body = "\n".join(f"Paragraph {n}.{k}: a legal practitioner shall not mislead the court in matter {k * n}." for k in range(14))
        pages.append(f"RPC Study Companion - Blue Edition\nRule {n * 3}: Duty to the court\n{body}\nwww.lawnotes.ng | Page {n} of 8\n{n}")
    cleaned = _strip_page_furniture(pages)
    joined = "\n".join(cleaned)
    check("running header removed", "Blue Edition" not in joined)
    check("footer with page number removed", "Page 3 of 8" not in joined and "lawnotes" not in joined)
    check("bare page numbers removed", not any(page.rstrip().endswith("\n5") for page in cleaned))
    check("real headings kept (Rule 3 … Rule 24)", all(f"Rule {n * 3}: Duty" in joined for n in range(1, 9)))
    check("body text kept", joined.count("a legal practitioner shall not mislead") == 8 * 14, joined.count("a legal practitioner shall not mislead"))
    aligned = []
    for n in range(1, 9):  # one rule per page: "Rule n" tracks the page number but is a heading
        body = "\n".join(f"Text {k} about rule {n} and the court's duty in detail." for k in range(10))
        aligned.append(f"Companion header\nRULE {n}: DUTY OF COUNSEL\n{body}\n{n}")
    kept = "\n".join(_strip_page_furniture(aligned))
    check("rule headings that line up with page numbers are kept", all(f"RULE {n}: DUTY" in kept for n in range(1, 9)), kept[:200])
    from app.services.material_import import build_sections
    outline = []
    for n in range(1, 151):
        outline += [("heading", 1, f"Rule {n}: Duty {n}"), ("para", "A practitioner shall not mislead the court. " * 30)]
    _, merged = build_sections(outline, fallback_title="RPC")
    check("150 rules are merged, not refused", 1 < len(merged) <= 80, len(merged))
    check("merged titles read 'Rules 1–2'", merged[0]["title"] == "Rules 1–2", merged[0]["title"])
    subs = [b["text"] for s in merged for b in s["blocks"] if b["type"] == "subheading"]
    check("every rule keeps its own subheading", len(subs) == 150 and subs[0] == "Rule 1: Duty 1", (len(subs), subs[:2]))
    short = _strip_page_furniture(["Title\nOne line", "Title\nTwo"])
    check("short documents untouched", short == ["Title\nOne line", "Title\nTwo"], short)

    server.shutdown()
    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


def _raises(fn) -> bool:
    try:
        fn()
    except ai_rewrite.AIError:
        return True
    return False


def _no_key_refused() -> bool:
    saved = os.environ.pop("GEMINI_API_KEY")
    try:
        ai_rewrite.start_job("x", [{"index": 0, "title": "a", "blocks": [{"type": "paragraph", "text": "hello"}]}], "easy")
    except ai_rewrite.AIError as error:
        return error.status == 503
    finally:
        os.environ["GEMINI_API_KEY"] = saved
    return False


if __name__ == "__main__":
    sys.exit(main())
