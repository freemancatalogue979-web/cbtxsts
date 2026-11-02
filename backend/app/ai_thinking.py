"""Bounded transport for the provider's opt-in reasoning model.

Only progress stages and the final answer leave this module. Raw reasoning is
not persisted, logged, sent to the browser, or fed into later conversation turns.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from typing import BinaryIO

# A separate operator override leaves existing normal-chat configurations alone.
THINK_MODEL = os.getenv("CLOVER_AI_THINK_MODEL", "deepseek-v4-pro").strip() or "deepseek-v4-pro"
THINK_EFFORT = "max"
THINK_MAX_TOKENS = 32768  # Includes reasoning and the final answer.
THINK_IDLE_TIMEOUT = 90
THINK_DEADLINE_SECONDS = 480
# The lease also covers connection setup, one idle read, lookups and commit time.
THINK_LEASE_SECONDS = THINK_DEADLINE_SECONDS + 2 * THINK_IDLE_TIMEOUT + 90
MAX_LINE_BYTES = 131072
MAX_STREAM_BYTES = 16 * 1024 * 1024
MAX_ANSWER_CHARS = 250000


class ThinkingError(ValueError):
    """A deliberately provider-neutral and safe error for the member."""


def report(callback: Callable[[str], None] | None, stage: str) -> None:
    if callback is not None:
        try:
            callback(stage)
        except Exception:
            # A disconnected browser must not interrupt the owner's saved reply.
            pass


def read_completion(
    response: BinaryIO,
    on_stage: Callable[[str], None] | None = None,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> dict:
    """Read provider SSE, exposing real stages but never its raw reasoning.

    Handles comment keepalives, multiple data lines, UTF-8, truncated streams,
    and bounded time/bytes. The response's socket also has an idle timeout.
    """
    deadline = clock() + THINK_DEADLINE_SECONDS
    pieces: list[str] = []
    answer_chars = 0
    total = 0
    event_lines: list[bytes] = []
    saw_reasoning = False
    saw_answer = False
    finish_reason = None
    done = False

    def process_event() -> None:
        nonlocal saw_reasoning, saw_answer, answer_chars, finish_reason, done
        if not event_lines:
            return
        data = b"\n".join(event_lines)
        event_lines.clear()
        if data.strip() == b"[DONE]":
            done = True
            return
        try:
            event = json.loads(data)
            if not isinstance(event, dict) or event.get("error"):
                raise ValueError("invalid event")
            choices = event.get("choices")
            if not isinstance(choices, list):
                raise ValueError("invalid choices")
            if not choices:  # Usage-only events are optional.
                return
            choice = choices[0]
            delta = choice.get("delta") or {}
            if not isinstance(choice, dict) or not isinstance(delta, dict):
                raise ValueError("invalid delta")
            reason = delta.get("reasoning_content")
            if reason is not None and not isinstance(reason, str):
                raise ValueError("invalid reasoning")
            if reason and not saw_reasoning:
                saw_reasoning = True
                report(on_stage, "thinking")
            content = delta.get("content")
            if content is not None and not isinstance(content, str):
                raise ValueError("invalid content")
            if content:
                if not saw_answer:
                    saw_answer = True
                    report(on_stage, "writing")
                answer_chars += len(content)
                if answer_chars > MAX_ANSWER_CHARS:
                    raise ValueError("oversized answer")
                pieces.append(content)
            if choice.get("finish_reason") is not None:
                finish_reason = choice["finish_reason"]
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, UnicodeDecodeError):
            raise ThinkingError("The deeper analysis couldn’t be completed. Please try again.") from None

    while not done:
        if clock() >= deadline:
            raise ThinkingError("Deeper analysis took too long to finish. Try a more focused question, bro.")
        line = response.readline(MAX_LINE_BYTES + 1)
        if not line:
            process_event()
            break
        total += len(line)
        if len(line) > MAX_LINE_BYTES or total > MAX_STREAM_BYTES:
            raise ThinkingError("The deeper analysis response was too large. Try a more focused question, bro.")
        line = line.rstrip(b"\r\n")
        if not line:
            process_event()
        elif line.startswith(b"data:"):
            event_lines.append(line[5:].lstrip(b" "))
        # Ignore SSE comments and fields such as event/id/retry.
    if not done:
        raise ThinkingError("The deeper analysis was interrupted before it finished. Please try again, bro.")
    text = "".join(pieces)
    if not text.strip():
        if finish_reason == "length":
            raise ThinkingError(
                "I used up the deeper analysis budget before reaching an answer. Try a narrower question, bro."
            )
        raise ThinkingError("The deeper analysis returned no answer. Please try again, bro.")
    return {"text": text, "finish_reason": finish_reason, "reasoning_seen": saw_reasoning}
