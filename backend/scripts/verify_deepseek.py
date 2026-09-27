"""DeepSeek provider for "Make it easy to read", checked against a local mock.

No internet, API server or database needed:

    cd backend && ./.venv/bin/python scripts/verify_deepseek.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 3997
os.environ.update(
    {
        "AI_PROVIDER": "auto",
        "DEEPSEEK_API_KEY": "ds-test-key",
        "CBT_AI_KEYS_FILE": str(Path(__import__("tempfile").gettempdir()) / f"no_saved_keys_{os.getpid()}.json"),
        "DEEPSEEK_API_BASE": f"http://127.0.0.1:{PORT}",
        "DEEPSEEK_TIMEOUT": "2",
        "DEEPSEEK_BUDGET": "3",
    }
)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import ai_rewrite as ai  # noqa: E402

PASSED = FAILED = 0
MODE = {"value": "ok"}
SEEN: list[dict] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(detail)[:300]}")


class MockDeepSeek(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # quiet
        pass

    def reply(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError:
            pass

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        mode = MODE["value"]
        if mode == "slow":
            time.sleep(4)
        if mode == "old-names" and body["model"] != "deepseek-chat":
            return self.reply(400, {"error": {"message": "Model Not Exist", "type": "invalid_request_error"}})
        if mode == "no-thinking" and "thinking" in body:
            return self.reply(400, {"error": {"message": "Unknown parameter: thinking"}})
        if mode in {"401", "402", "429", "503"}:
            return self.reply(int(mode), {"error": {"message": "nope"}})
        if mode == "cut":
            return self.reply(200, {"choices": [{"message": {"content": '{"sections": [{"index": 0'}, "finish_reason": "length"}]})
        prompt = body["messages"][-1]["content"]
        check("the prompt asks for JSON (DeepSeek's JSON mode needs it)", "json" in prompt.lower())
        sections = json.loads(prompt[prompt.index("{") :])["sections"]
        rewritten = [
            {"index": row["index"], "title": row["title"], "blocks": [{"type": "paragraph", "text": "In simple words: " + " ".join(b.get("text", "") for b in row["blocks"])}]}
            for row in sections
        ]
        self.reply(200, {"choices": [{"message": {"role": "assistant", "content": json.dumps({"sections": rewritten})}, "finish_reason": "stop"}]})


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), MockDeepSeek)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    sections = [{"index": 0, "title": "Osmosis", "blocks": [{"type": "paragraph", "text": "Osmosis is the net movement of water across a membrane in 2 solutions."}]}]
    try:
        info = ai.status()
        check("a DeepSeek key makes DeepSeek the provider", info["provider"] == "DeepSeek" and info["provider_id"] == "deepseek" and info["configured"], info)
        check("status never shows the key", "ds-test-key" not in json.dumps(info), info)

        MODE["value"] = "ok"
        SEEN.clear()
        result = ai.rewrite("Cells", sections, "easy")
        sent = SEEN[-1]
        check("rewrite comes back", result["sections"][0]["changed"] and "In simple words" in json.dumps(result["sections"][0]["blocks"]), result)
        check("numbers survive (no warning)", not result["sections"][0]["warnings"], result["sections"][0]["warnings"])
        check("OpenAI-style endpoint + bearer key", sent["path"] == "/chat/completions" and sent["auth"] == "Bearer ds-test-key", sent["path"])
        check("JSON mode and thinking off are requested", sent["body"]["response_format"] == {"type": "json_object"} and sent["body"]["thinking"] == {"type": "disabled"}, sent["body"].keys())
        check("the rules go in the system message", sent["body"]["messages"][0]["role"] == "system" and "Keep EVERY fact" in sent["body"]["messages"][0]["content"])
        check("default model is deepseek-flash", result["model"] == "deepseek-flash", result["model"])

        MODE["value"] = "old-names"
        SEEN.clear()
        result = ai.rewrite("Cells", sections, "easy")
        check("unknown model names fall back to deepseek-chat", result["model"] == "deepseek-chat" and [s["body"]["model"] for s in SEEN] == ["deepseek-flash", "deepseek-v4-flash", "deepseek-chat"], [s["body"]["model"] for s in SEEN])

        MODE["value"] = "no-thinking"
        SEEN.clear()
        result = ai.rewrite("Cells", sections, "easy")
        check("a model that rejects 'thinking' is retried without it", result["sections"][0]["changed"] and ["thinking" in s["body"] for s in SEEN] == [True, False], ["thinking" in s["body"] for s in SEEN])

        for mode, code, words in [("401", 502, "refused the API key"), ("402", 402, "balance is empty"), ("429", 429, "rate-limiting"), ("503", 503, "busy"), ("cut", 502, "cut off")]:
            MODE["value"] = mode
            try:
                ai.rewrite("Cells", sections, "easy")
                check(f"HTTP {mode} → clear message", False, "no error")
            except ai.AIError as error:
                check(f"{mode} → {code} “{words}”", error.status == code and words in str(error), (error.status, str(error)))

        MODE["value"] = "slow"
        started = time.monotonic()
        try:
            ai.rewrite("Cells", sections, "easy")
            check("slow answers are cut off", False, "no error")
        except ai.AIError as error:
            took = time.monotonic() - started
            check("a slow answer stops at the time limit with a clear message", error.status == 504 and "too long" in str(error) and took < 3.5, (error.status, str(error), round(took, 1)))

        os.environ["AI_PROVIDER"] = "gemini"
        check("AI_PROVIDER=gemini switches back to Gemini", ai.status()["provider"] == "Google Gemini")
        os.environ["AI_PROVIDER"] = "auto"
        os.environ["DEEPSEEK_API_KEY"] = ""
        check("without a DeepSeek key, Gemini is used", ai.status()["provider_id"] == "gemini")
    finally:
        server.shutdown()

    print(f"\nverify_deepseek: {PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
