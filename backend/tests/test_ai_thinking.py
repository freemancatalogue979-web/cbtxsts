"""Think mode: synthetic provider streams, private chat, bounded recovery, no network."""

from __future__ import annotations

import asyncio
import io
import json
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

from app.ai_thinking import (
    THINK_DEADLINE_SECONDS,
    THINK_LEASE_SECONDS,
    THINK_MAX_TOKENS,
    THINK_MODEL,
    ThinkingError,
    read_completion,
)
from app.clover_ai_models import AIMessage
from app.models import utcnow
from tests import test_clover_ai as fixture


def sse(*events: dict | str) -> bytes:
    chunks = [b": keep-alive\n\n"]
    for event in events:
        data = event if isinstance(event, str) else json.dumps(event, ensure_ascii=False)
        chunks.append(b"data: " + data.encode() + b"\n\n")
    return b"".join(chunks)


def choice(delta: dict, reason: str | None = None) -> dict:
    return {"choices": [{"delta": delta, "finish_reason": reason}]}


async def stream_request(path: str, token: str, payload: dict):
    """Keep the synthetic ASGI connection open until the stream finishes."""
    parsed = urlsplit(path)
    body = json.dumps(payload).encode()
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": parsed.path,
        "raw_path": parsed.path.encode(),
        "query_string": parsed.query.encode(),
        "root_path": "",
        "client": ("198.51.100.9", 1234),
        "server": ("testserver", 443),
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"authorization", f"Bearer {token}".encode()),
        ],
    }
    sent, received = [], False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        sent.append(message)

    await fixture.app(scope, receive, send)
    start = next(message for message in sent if message["type"] == "http.response.start")
    content = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return start["status"], content.decode(), dict(start["headers"])


class ThinkParserTests(unittest.TestCase):
    def test_real_stages_only_and_no_reasoning_leaves_parser(self):
        stages = []
        raw = sse(
            choice({"reasoning_content": "SECRET_UNTRUSTED_THOUGHT"}),
            choice({"reasoning_content": " more"}),
            choice({"content": "First "}),
            choice({"content": "answer 🟢"}, "stop"),
            {"choices": [], "usage": {"completion_tokens": 3}},
            "[DONE]",
        )
        result = read_completion(io.BytesIO(raw), stages.append)
        self.assertEqual(stages, ["thinking", "writing"])
        self.assertEqual(result, {"text": "First answer 🟢", "finish_reason": "stop", "reasoning_seen": True})
        self.assertNotIn("SECRET_UNTRUSTED_THOUGHT", json.dumps(result))

    def test_interrupted_empty_oversized_and_timeout_are_safe(self):
        with self.assertRaisesRegex(ThinkingError, "interrupted"):
            read_completion(io.BytesIO(sse(choice({"reasoning_content": "private"}))))
        with self.assertRaisesRegex(ThinkingError, "budget"):
            read_completion(io.BytesIO(sse(choice({"reasoning_content": "private"}, "length"), "[DONE]")))
        with self.assertRaisesRegex(ThinkingError, "no answer"):
            read_completion(io.BytesIO(sse(choice({}, "stop"), "[DONE]")))
        with self.assertRaisesRegex(ThinkingError, "too large"):
            read_completion(io.BytesIO(b"data: " + b"x" * 140000 + b"\n\n"))
        ticks = iter([0, THINK_DEADLINE_SECONDS + 1])
        with self.assertRaisesRegex(ThinkingError, "too long"):
            read_completion(io.BytesIO(b""), clock=lambda: next(ticks))
        with self.assertRaisesRegex(ThinkingError, "couldn’t be completed"):
            read_completion(io.BytesIO(b'data: {"error":"SECRET_KEY"}\n\n'))
        self.assertGreater(THINK_LEASE_SECONDS, THINK_DEADLINE_SECONDS + 90)

    def test_ordinary_stream_without_reasoning_is_not_marked_deep(self):
        stages = []
        result = read_completion(
            io.BytesIO(sse(choice({"content": "A normal reply."}, "stop"), "[DONE]")), stages.append
        )
        self.assertFalse(result["reasoning_seen"])
        self.assertEqual(stages, ["writing"])


class ThinkIntegrationTests(unittest.TestCase):
    setUp = fixture.CloverAITests.setUp
    tearDown = fixture.CloverAITests.tearDown
    req = fixture.CloverAITests.req
    new_chat = fixture.CloverAITests.new_chat

    def test_opt_in_uses_stronger_model_effort_and_preserves_privacy_and_history(self):
        chat = self.new_chat()
        payloads = []
        provider_timeouts = []

        def provider(req, timeout):
            data = json.loads(req.data)
            payloads.append(data)
            provider_timeouts.append(timeout)
            if data.get("stream"):
                return io.BytesIO(
                    sse(
                        choice({"reasoning_content": "PRIVATE_INTERNAL_REASONING"}),
                        choice({"content": "Recommendation: play around the objective."}, "stop"),
                        "[DONE]",
                    )
                )
            return io.BytesIO(b'{"choices":[{"message":{"content":"A follow-up."}}]}')

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            status, result, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "Analyze Alice rotations",
                    "think": True,
                    "web_mode": "off",
                    "auto_esports": False,
                },
            )
            self.assertEqual(status, 201)
            self.assertEqual(result["assistant_message"]["mode"], "think")
            self.assertEqual(result["user_message"]["mode"], "user")
            self.assertNotIn("PRIVATE_INTERNAL_REASONING", json.dumps(result))
            deep = payloads[0]
            self.assertEqual(deep["model"], THINK_MODEL)
            self.assertEqual(deep["thinking"], {"type": "enabled"})
            self.assertEqual(deep["reasoning_effort"], "max")
            self.assertEqual(deep["max_tokens"], THINK_MAX_TOKENS)
            self.assertTrue(deep["stream"])
            self.assertNotIn("temperature", deep)
            self.assertGreater(provider_timeouts[0], 40)
            self.assertIn("key factors", deep["messages"][0]["content"])
            with self.factory() as db:
                messages = db.query(AIMessage).filter_by(conversation_id=chat).order_by(AIMessage.id).all()
                self.assertEqual([m.mode for m in messages], ["user_think", "think"])
                self.assertNotIn("PRIVATE_INTERNAL_REASONING", " ".join(m.content for m in messages))
            self.assertEqual(self.req("GET", f"/conversations/{chat}/messages", "other")[0], 404)
            self.assertEqual(self.req("GET", f"/conversations/{chat}/messages", "admin")[0], 404)
            status, _, _ = self.req(
                "POST",
                f"/conversations/{chat}/messages",
                payload={
                    "text": "What next?",
                    "auto_esports": False,
                },
            )
            self.assertEqual(status, 201)
            normal = payloads[-1]
            self.assertEqual(normal["thinking"], {"type": "disabled"})
            self.assertIn("Recommendation: play around the objective.", json.dumps(normal))
            self.assertNotIn("PRIVATE_INTERNAL_REASONING", json.dumps(normal))

    def test_no_unconfirmed_thinking_badge_or_fabricated_answer(self):
        chat = self.new_chat()
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(
                open=lambda req, timeout: io.BytesIO(sse(choice({"content": "Normal."}, "stop"), "[DONE]"))
            ),
        ):
            result = self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Analyze", "think": True})[1][
                "assistant_message"
            ]
            self.assertEqual(result["mode"], "ai")
            self.assertIn("could not be confirmed", result["note"])
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener",
            return_value=SimpleNamespace(
                open=lambda req, timeout: io.BytesIO(sse(choice({"reasoning_content": "secret"}, "length"), "[DONE]"))
            ),
        ):
            result = self.req(
                "POST", f"/conversations/{chat}/messages", payload={"text": "Analyze again", "think": True}
            )[1]["assistant_message"]
            self.assertEqual(result["mode"], "facts")
            self.assertIn("budget", result["note"])
            self.assertNotIn("secret", json.dumps(result))
        self.assertEqual(
            self.req("POST", f"/conversations/{chat}/messages", payload={"text": "Analyze", "think": "true"})[0], 422
        )

    def test_thinking_actions_remain_reviewed_admin_only_and_local_guidance_is_honest(self):
        chat = self.new_chat("admin")
        calls = []
        proposal = {
            "answer": "Here is a strategy to review.",
            "proposal": {
                "kind": "create_strategy",
                "payload": {"title": "Turtle timing", "body": "Group early and secure vision."},
            },
        }

        def provider(req, timeout):
            calls.append(json.loads(req.data))
            return io.BytesIO(
                sse(
                    choice({"reasoning_content": "PRIVATE_REASONING"}),
                    choice({"content": json.dumps(proposal)}, "stop"),
                    "[DONE]",
                )
            )

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            path = f"/conversations/{chat}/messages"
            response = self.req("POST", path, "admin", {"text": "Create a strategy for turtle timing", "think": True})
            self.assertEqual(response[0], 201)
            message = response[1]["assistant_message"]
            self.assertEqual(message["mode"], "think")
            self.assertEqual(message["proposal"]["status"], "pending")
            self.assertEqual(calls[-1]["response_format"], {"type": "json_object"})
            self.assertIn("nothing changes", message["content"].lower())
            # Exact patch changes are local proposals, not falsely labeled as a model thought.
            before = len(calls)
            result = self.req("POST", path, "admin", {"text": "Change the Draft Lab patch to 2.2.30", "think": True})[1]
            self.assertEqual(result["assistant_message"]["mode"], "guidance")
            self.assertEqual(len(calls), before)
            player_chat = self.new_chat("owner")
            self.assertEqual(
                self.req(
                    "POST",
                    f"/conversations/{player_chat}/messages",
                    "owner",
                    {
                        "text": "Create a strategy",
                        "think": True,
                        "request_action": True,
                    },
                )[0],
                403,
            )

    def test_disconnected_stream_finishes_and_saves_the_owner_reply(self):
        from app.routers import clover_ai

        chat = self.new_chat()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        original = clover_ai._send_message

        def tracking(*args, **kwargs):
            try:
                return original(*args, **kwargs)
            finally:
                finished.set()

        def provider(req, timeout):
            started.set()
            if not release.wait(5):
                raise TimeoutError("test timed out")
            return io.BytesIO(
                sse(
                    choice({"reasoning_content": "PRIVATE_REASONING"}),
                    choice({"content": "Saved after disconnect."}, "stop"),
                    "[DONE]",
                )
            )

        async def scenario():
            path = f"/api/ai/conversations/{chat}/messages/stream"
            disconnect = asyncio.Event()
            body = json.dumps({"text": "Analyze Alice", "think": True, "auto_esports": False}).encode()
            scope = {
                "type": "http",
                "asgi": {"version": "3.0", "spec_version": "2.3"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "https",
                "path": path,
                "raw_path": path.encode(),
                "query_string": b"",
                "root_path": "",
                "client": ("198.51.100.9", 1234),
                "server": ("testserver", 443),
                "headers": [
                    (b"host", b"testserver"),
                    (b"content-type", b"application/json"),
                    (b"authorization", f"Bearer {self.tokens['owner']}".encode()),
                ],
            }
            received = False

            async def receive():
                nonlocal received
                if not received:
                    received = True
                    return {"type": "http.request", "body": body, "more_body": False}
                await disconnect.wait()
                return {"type": "http.disconnect"}

            async def send(message):
                if b'"stage": "connecting"' in message.get("body", b""):
                    disconnect.set()

            try:
                await asyncio.wait_for(fixture.app(scope, receive, send), timeout=3)
                self.assertTrue(await asyncio.to_thread(started.wait, 3))
            finally:
                release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 3))
            status, result, _ = await fixture.asgi_request(
                "GET", f"/api/ai/conversations/{chat}/messages", self.tokens["owner"]
            )
            self.assertEqual(status, 200)
            self.assertFalse(result["processing"])
            self.assertEqual(result["messages"][-1]["content"], "Saved after disconnect.")
            self.assertNotIn("PRIVATE_REASONING", json.dumps(result))

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ), patch.object(clover_ai, "_send_message", side_effect=tracking):
            asyncio.run(scenario())

    def test_stream_reports_progress_and_recovery_while_preserving_lease(self):
        chat = self.new_chat()
        started, release = threading.Event(), threading.Event()
        data = sse(
            choice({"reasoning_content": "PRIVATE_REASONING"}),
            choice({"content": "A grounded recommendation."}, "stop"),
            "[DONE]",
        )

        def provider(req, timeout):
            started.set()
            if not release.wait(5):
                raise TimeoutError("test timed out")
            return io.BytesIO(data)

        async def scenario():
            path = f"/api/ai/conversations/{chat}/messages"
            pending = asyncio.create_task(
                stream_request(
                    path + "/stream",
                    self.tokens["owner"],
                    {"text": "Analyze Alice", "think": True, "auto_esports": False},
                )
            )
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 3))
                status, body, _ = await fixture.asgi_request("GET", path, self.tokens["owner"])
                self.assertEqual(status, 200)
                self.assertTrue(body["processing"])
                self.assertTrue(body["processing_think"])
                with self.factory() as db:
                    from app.clover_ai_models import AIConversation

                    locked = db.get(AIConversation, chat)
                    self.assertGreater((locked.busy_until - utcnow()).total_seconds(), 600)
                other, _, _ = await fixture.asgi_request("GET", path, self.tokens["admin"])
                self.assertEqual(other, 404)
                concurrent, _, _ = await fixture.asgi_request(
                    "POST", path, self.tokens["owner"], {"text": "Do not duplicate"}
                )
                self.assertEqual(concurrent, 409)
            finally:
                release.set()
            status, body, headers = await pending
            self.assertEqual(status, 200)
            self.assertEqual(headers[b"cache-control"], b"no-store")
            events = [json.loads(line) for line in body.splitlines()]
            stages = [item["stage"] for item in events if item["type"] == "status"]
            self.assertEqual(stages, ["preparing", "checking", "connecting", "thinking", "writing", "finishing"])
            self.assertEqual(events[-1]["result"]["assistant_message"]["mode"], "think")
            self.assertNotIn("PRIVATE_REASONING", body)
            status, body, _ = await fixture.asgi_request("GET", path, self.tokens["owner"])
            self.assertEqual(status, 200)
            self.assertFalse(body["processing"])
            self.assertEqual(body["messages"][-1]["content"], "A grounded recommendation.")

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "synthetic-key"}), patch(
            "app.clover_ai_service.urllib.request.build_opener", return_value=SimpleNamespace(open=provider)
        ):
            asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
