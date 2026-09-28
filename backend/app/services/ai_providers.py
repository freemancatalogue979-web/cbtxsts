"""AI provider layer for the tutor.

    AIService (ai_tutor)  ->  AIProvider  ->  DeepSeekProvider | GeminiProvider

Every provider speaks the same small interface so the rest of the app never
cares which company answers:

* ``messages`` are OpenAI-style ``[{"role": "system|user|assistant", "content": ...}]``
  (content may be a list with ``{"type": "image_url"}`` parts for images).
* ``stream()`` returns a :class:`StreamHandle` yielding ``("delta", text)``,
  ``("usage", {...})`` and ``("finish", reason)``; ``close()`` really closes the
  upstream connection (used by Stop).
* ``complete()`` returns ``(text, usage, finish_reason)``.
* Usage is normalised to ``{"input", "output", "cached"}`` token counts.

Errors are raised as :class:`ProviderError` with a *technical* message for the
logs. Students only ever see the friendly message (``FRIENDLY``); the detail is
stored on the usage event for staff.

Keys never leave the server. Prices live in ``AI_PRICING_CONFIG`` (USD per
million tokens) so cost estimates are changed in one place.
"""

from __future__ import annotations

import json
import logging
import os
import re
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Iterator

from ..config import deepseek_settings, gemini_settings

log = logging.getLogger("arena.ai")

FRIENDLY = "AI Tutor is temporarily unavailable. Please try again."

# USD per 1M tokens. "cached" = cache-hit input tokens. Estimates only — edit
# here (or with AI_PRICE_* env vars) when a provider changes its prices.
AI_PRICING_CONFIG: dict[str, dict[str, dict[str, float]]] = {
    "deepseek": {
        "deepseek-flash": {"input": 0.14, "cached": 0.028, "output": 0.28},
        "deepseek-v4-flash": {"input": 0.14, "cached": 0.028, "output": 0.28},
        "deepseek-chat": {"input": 0.27, "cached": 0.07, "output": 1.10},
        "deepseek-v4-pro": {"input": 0.55, "cached": 0.14, "output": 2.19},
        "default": {"input": 0.14, "cached": 0.028, "output": 0.28},
    },
    "gemini": {
        "gemini-flash-latest": {"input": 0.30, "cached": 0.03, "output": 2.50},
        "gemini-2.5-flash": {"input": 0.30, "cached": 0.03, "output": 2.50},
        "gemini-flash-lite-latest": {"input": 0.10, "cached": 0.01, "output": 0.40},
        "gemini-2.5-flash-lite": {"input": 0.10, "cached": 0.01, "output": 0.40},
        "default": {"input": 0.30, "cached": 0.03, "output": 2.50},
    },
}


def price_for(provider: str, model: str) -> dict[str, float]:
    table = AI_PRICING_CONFIG.get(provider) or AI_PRICING_CONFIG["deepseek"]
    price = dict(table.get(model) or table["default"])
    # env overrides (TUTOR_PRICE_* kept for older .env files)
    for key, names in {"input": ("AI_PRICE_INPUT", "TUTOR_PRICE_INPUT"), "cached": ("AI_PRICE_CACHED", "TUTOR_PRICE_CACHED"), "output": ("AI_PRICE_OUTPUT", "TUTOR_PRICE_OUTPUT")}.items():
        for name in names:
            raw = os.getenv(name, "").strip()
            if raw:
                try:
                    price[key] = float(raw)
                except ValueError:
                    pass
                break
    return price


def estimate_cost(provider: str, model: str, usage: dict | None) -> float:
    usage = usage or {}
    price = price_for(provider, model)
    cached = int(usage.get("cached") or 0)
    fresh = max(0, int(usage.get("input") or 0) - cached)
    return round((fresh * price["input"] + cached * price["cached"] + int(usage.get("output") or 0) * price["output"]) / 1_000_000, 6)


class ProviderError(Exception):
    """``str(error)`` is technical (logs/staff). ``friendly`` is what students see."""

    def __init__(self, technical: str, status: int = 503, code: str = "upstream", retryable: bool = False):
        super().__init__(technical)
        self.status = status
        self.code = code
        self.retryable = retryable
        self.friendly = FRIENDLY


class ModelMissing(Exception):
    pass


class _ThinkingUnsupported(Exception):
    pass


def retry_base() -> float:
    try:
        return max(0.0, float(os.getenv("AI_RETRY_BASE", os.getenv("TUTOR_RETRY_BASE", "1"))))
    except ValueError:
        return 1.0


def with_retries(call, *, attempts: int = 4, budget: float = 40.0):
    """Run ``call()``; on retryable errors (429, 5xx, network) wait 1s, 2s, 4s
    and try again. Gives up early if the total budget would be exceeded."""
    started = time.monotonic()
    base = retry_base()
    last: ProviderError | None = None
    for attempt in range(attempts):
        try:
            return call()
        except ProviderError as error:
            last = error
            if not error.retryable or attempt == attempts - 1:
                raise
            delay = base * (2 ** attempt)
            if time.monotonic() - started + delay > budget:
                raise
            log.warning("AI request failed (%s, %s) — retrying in %.1fs", error.code, error, delay)
            time.sleep(delay)
    raise last or ProviderError("retry loop ended")  # pragma: no cover


def _http_error_detail(error: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(error.read() or b"{}")
    except Exception:  # noqa: BLE001
        return ""
    err = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(err, dict):
        return str(err.get("message") or err.get("status") or "")[:300]
    return str(err or "")[:300]


def _classify(error: urllib.error.HTTPError, detail: str, provider: str) -> ProviderError:
    code = error.code
    if code in (401, 403):
        return ProviderError(f"{provider}: key rejected ({code}) {detail}", 502, "bad_key")
    if code == 402:
        return ProviderError(f"{provider}: balance empty (402) {detail}", 502, "balance")
    if code == 429:
        return ProviderError(f"{provider}: rate limited (429) {detail}", 503, "upstream_rate", retryable=True)
    if code >= 500:
        return ProviderError(f"{provider}: server error ({code}) {detail}", 503, "upstream_busy", retryable=True)
    if code == 400 and "api key" in detail.lower():
        return ProviderError(f"{provider}: key rejected ({code}) {detail}", 502, "bad_key")
    return ProviderError(f"{provider}: HTTP {code} {detail}", 502, "upstream")


def _urlopen(request: urllib.request.Request, timeout: float, provider: str):
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        detail = _http_error_detail(error)
        low = detail.lower()
        if error.code in (400, 404) and "model" in low and any(w in low for w in ("not exist", "not found", "invalid", "unknown", "not supported")):
            raise ModelMissing(detail) from error
        if error.code in (400, 422) and "think" in low:
            raise _ThinkingUnsupported(detail) from error
        raise _classify(error, detail, provider) from error
    except (TimeoutError, socket.timeout) as error:
        raise ProviderError(f"{provider}: timed out after {timeout:.0f}s", 504, "timeout", retryable=True) from error
    except (urllib.error.URLError, OSError) as error:
        raise ProviderError(f"{provider}: unreachable ({error})", 503, "unreachable", retryable=True) from error


class StreamHandle:
    """Iterate for events; ``close()`` aborts the upstream request."""

    def __init__(self, response, parser):
        self._response = response
        self._parser = parser
        self.closed = False

    def __iter__(self) -> Iterator[tuple[str, Any]]:
        try:
            for raw in self._response:
                if self.closed:
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                yield from self._parser(chunk)
        except (TimeoutError, socket.timeout) as error:
            raise ProviderError("stream stalled (timeout)", 504, "timeout") from error
        except (ValueError, OSError) as error:
            if self.closed:
                return
            raise ProviderError(f"stream broke: {error}", 503, "stream_broken") from error
        finally:
            self.close()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self._response.close()
        except Exception:  # noqa: BLE001
            pass


class AIProvider:
    name = "base"
    label = "Base"
    supports_images = False

    def settings(self) -> dict:  # pragma: no cover - overridden
        return {}

    def configured(self) -> bool:
        return bool(self.settings().get("key"))

    def default_model(self) -> str:
        return self.settings().get("model", "")

    def models(self, preferred: str = "") -> list[str]:
        s = self.settings()
        first = preferred or s.get("model", "")
        return [first, *[m for m in s.get("fallbacks", []) if m != first]]

    # subclasses implement _open(model, messages, max_tokens, temperature, json_mode, stream, timeout, thinking)
    def _open(self, **kwargs):  # pragma: no cover
        raise NotImplementedError

    def _parse_chunk(self, chunk: dict) -> Iterator[tuple[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def _parse_complete(self, payload: dict) -> tuple[str, dict, str]:  # pragma: no cover
        raise NotImplementedError

    def _open_any(self, messages: list[dict], *, model: str, max_tokens: int, temperature: float, json_mode: bool, stream: bool, tools: list[dict] | None = None):
        if not self.configured():
            raise ProviderError(f"{self.name}: no API key configured", 503, "not_configured")
        s = self.settings()
        timeout = float(os.getenv("TUTOR_STREAM_TIMEOUT", "45")) if stream else float(s.get("timeout", 60))
        tried = []
        for candidate in self.models(model):
            def attempt(thinking: bool, name: str = candidate):
                return self._open(model=name, messages=messages, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode, stream=stream, timeout=timeout, thinking=thinking, tools=tools)

            try:
                try:
                    return with_retries(lambda: attempt(True)), candidate
                except _ThinkingUnsupported:
                    return with_retries(lambda: attempt(False)), candidate
            except ModelMissing as missing:
                tried.append(f"{candidate} ({missing})")
        raise ProviderError(f"{self.name}: no available model among {', '.join(tried)}", 502, "no_model")

    def stream(self, messages: list[dict], *, model: str = "", max_tokens: int = 1500, temperature: float = 0.5, json_mode: bool = False) -> tuple[StreamHandle, str]:
        response, used = self._open_any(messages, model=model, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode, stream=True)
        return StreamHandle(response, self._parse_chunk), used

    def complete(self, messages: list[dict], *, model: str = "", max_tokens: int = 1500, temperature: float = 0.4, json_mode: bool = False) -> tuple[str, dict, str, str]:
        """Returns (text, usage, finish_reason, model)."""
        response, used = self._open_any(messages, model=model, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode, stream=False)
        try:
            payload = json.loads(response.read() or b"{}")
        except (TimeoutError, socket.timeout) as error:
            raise ProviderError(f"{self.name}: read timed out", 504, "timeout") from error
        except json.JSONDecodeError as error:
            raise ProviderError(f"{self.name}: non-JSON response", 502, "upstream") from error
        finally:
            response.close()
        text, usage, finish = self._parse_complete(payload)
        return text, usage, finish, used

    # ------------------------------------------------------------ tool calls
    def complete_tools(self, messages: list[dict], tools: list[dict], *, model: str = "", max_tokens: int = 1500, temperature: float = 0.3) -> dict:
        """One model turn that may request tools.

        ``tools`` are OpenAI-style function specs (``{"name", "description",
        "parameters"}``). Messages stay OpenAI-style too: an assistant turn with
        ``tool_calls`` and ``{"role": "tool", "tool_call_id", "name", "content"}``
        replies. Returns ``{"text", "tool_calls": [{"id","name","arguments"}],
        "usage", "finish", "model", "assistant"}`` where ``assistant`` is the
        message to append to the history before the tool replies."""
        response, used = self._open_any(messages, model=model, max_tokens=max_tokens, temperature=temperature, json_mode=False, stream=False, tools=tools)
        try:
            payload = json.loads(response.read() or b"{}")
        except (TimeoutError, socket.timeout) as error:
            raise ProviderError(f"{self.name}: read timed out", 504, "timeout") from error
        except json.JSONDecodeError as error:
            raise ProviderError(f"{self.name}: non-JSON response", 502, "upstream") from error
        finally:
            response.close()
        out = self._parse_tools(payload)
        out["model"] = used
        return out

    def _parse_tools(self, payload: dict) -> dict:  # pragma: no cover - overridden
        raise NotImplementedError


# ---------------------------------------------------------------- DeepSeek
class DeepSeekProvider(AIProvider):
    name = "deepseek"
    label = "DeepSeek"
    supports_images = True  # sent as image_url parts; DeepSeek text models ignore/refuse, handled upstream

    def settings(self) -> dict:
        return deepseek_settings()

    def _open(self, *, model, messages, max_tokens, temperature, json_mode, stream, timeout, thinking, tools=None):
        s = self.settings()
        body: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": stream}
        if tools:
            body["tools"] = [{"type": "function", "function": t} for t in tools]
            body["tool_choice"] = "auto"
        if thinking:
            body["thinking"] = {"type": "disabled"}
        if stream:
            body["stream_options"] = {"include_usage": True}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        request = urllib.request.Request(
            f"{s['base']}/chat/completions", method="POST", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {s['key']}", "Accept": "text/event-stream" if stream else "application/json"},
        )
        return _urlopen(request, timeout, self.name)

    @staticmethod
    def _usage(raw: dict | None) -> dict:
        raw = raw or {}
        return {"input": int(raw.get("prompt_tokens") or 0), "output": int(raw.get("completion_tokens") or 0), "cached": int(raw.get("prompt_cache_hit_tokens") or (raw.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)}

    def _parse_chunk(self, chunk: dict) -> Iterator[tuple[str, Any]]:
        if chunk.get("usage"):
            yield "usage", self._usage(chunk["usage"])
        for choice in chunk.get("choices") or []:
            text = (choice.get("delta") or {}).get("content")
            if text:
                yield "delta", text
            if choice.get("finish_reason"):
                yield "finish", choice["finish_reason"]

    def _parse_complete(self, payload: dict) -> tuple[str, dict, str]:
        choices = payload.get("choices") or []
        text = ((choices[0].get("message") or {}).get("content") or "") if choices else ""
        finish = choices[0].get("finish_reason") if choices else ""
        return text, self._usage(payload.get("usage")), finish or ""

    def _parse_tools(self, payload: dict) -> dict:
        choices = payload.get("choices") or []
        message = (choices[0].get("message") or {}) if choices else {}
        calls = []
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            calls.append({"id": call.get("id") or f"call_{len(calls)}", "name": fn.get("name") or "", "arguments": fn.get("arguments") or "{}"})
        text = message.get("content") or ""
        assistant: dict[str, Any] = {"role": "assistant", "content": text}
        if calls:
            assistant["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in calls]
        return {"text": text, "tool_calls": calls, "usage": self._usage(payload.get("usage")), "finish": (choices[0].get("finish_reason") if choices else "") or "", "assistant": assistant}


# ------------------------------------------------------------------ Gemini
_DATA_URL = re.compile(r"^data:(image/[a-z+]+);base64,(.+)$", re.S)


def to_gemini(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts, contents = [], []
    for message in messages:
        role, content = message.get("role"), message.get("content")
        if role == "system":
            system_parts.append(content if isinstance(content, str) else json.dumps(content))
            continue
        parts: list[dict] = []
        if role == "tool":
            try:
                result = json.loads(content) if isinstance(content, str) else content
            except json.JSONDecodeError:
                result = {"text": content}
            parts.append({"functionResponse": {"name": message.get("name") or "tool", "response": result if isinstance(result, dict) else {"result": result}}})
            role = "user"
        elif role == "assistant" and message.get("tool_calls"):
            if content:
                parts.append({"text": content})
            for call in message["tool_calls"]:
                fn = call.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                parts.append({"functionCall": {"name": fn.get("name") or "", "args": args}})
            content = None
        if content is None:
            pass
        elif isinstance(content, str):
            parts.append({"text": content})
        else:
            for part in content or []:
                if part.get("type") == "text":
                    parts.append({"text": part.get("text", "")})
                elif part.get("type") == "image_url":
                    match = _DATA_URL.match((part.get("image_url") or {}).get("url", ""))
                    if match:
                        parts.append({"inlineData": {"mimeType": match.group(1), "data": re.sub(r"\s+", "", match.group(2))}})
        g_role = "model" if role == "assistant" else "user"
        if contents and contents[-1]["role"] == g_role:
            contents[-1]["parts"].extend(parts)  # Gemini wants alternating turns
        else:
            contents.append({"role": g_role, "parts": parts})
    if not contents or contents[0]["role"] != "user":
        contents.insert(0, {"role": "user", "parts": [{"text": "(start)"}]})
    return "\n\n".join(system_parts), contents


class GeminiProvider(AIProvider):
    name = "gemini"
    label = "Google Gemini"
    supports_images = True

    def settings(self) -> dict:
        return gemini_settings()

    def _open(self, *, model, messages, max_tokens, temperature, json_mode, stream, timeout, thinking, tools=None):
        s = self.settings()
        system, contents = to_gemini(messages)
        config: dict[str, Any] = {"maxOutputTokens": max_tokens, "temperature": temperature}
        if json_mode:
            config["responseMimeType"] = "application/json"
        if thinking:
            config["thinkingConfig"] = {"thinkingBudget": 0}
        body: dict[str, Any] = {"contents": contents, "generationConfig": config}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if tools:
            body["tools"] = [{"functionDeclarations": [{"name": t["name"], "description": t.get("description", ""), "parameters": _gemini_schema(t.get("parameters") or {"type": "object", "properties": {}})} for t in tools]}]
        action = "streamGenerateContent?alt=sse" if stream else "generateContent"
        request = urllib.request.Request(
            f"{s['base']}/models/{model}:{action}", method="POST", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": s["key"]},
        )
        return _urlopen(request, timeout, self.name)

    @staticmethod
    def _usage(meta: dict | None) -> dict:
        meta = meta or {}
        return {"input": int(meta.get("promptTokenCount") or 0), "output": int(meta.get("candidatesTokenCount") or 0) + int(meta.get("thoughtsTokenCount") or 0), "cached": int(meta.get("cachedContentTokenCount") or 0)}

    @staticmethod
    def _finish(reason: str | None) -> str:
        return {"STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter"}.get(reason or "", (reason or "").lower())

    def _parse_chunk(self, chunk: dict) -> Iterator[tuple[str, Any]]:
        for candidate in chunk.get("candidates") or []:
            for part in (candidate.get("content") or {}).get("parts") or []:
                if part.get("text") and not part.get("thought"):
                    yield "delta", part["text"]
            if candidate.get("finishReason"):
                yield "finish", self._finish(candidate["finishReason"])
        if chunk.get("usageMetadata"):
            yield "usage", self._usage(chunk["usageMetadata"])

    def _parse_complete(self, payload: dict) -> tuple[str, dict, str]:
        candidates = payload.get("candidates") or []
        text = ""
        finish = ""
        if candidates:
            text = "".join(p.get("text", "") for p in (candidates[0].get("content") or {}).get("parts") or [] if not p.get("thought"))
            finish = self._finish(candidates[0].get("finishReason"))
        return text, self._usage(payload.get("usageMetadata")), finish

    def _parse_tools(self, payload: dict) -> dict:
        candidates = payload.get("candidates") or []
        parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
        text = "".join(p.get("text", "") for p in parts if p.get("text") and not p.get("thought"))
        calls = []
        for part in parts:
            fc = part.get("functionCall")
            if fc:
                calls.append({"id": f"call_{len(calls)}", "name": fc.get("name") or "", "arguments": json.dumps(fc.get("args") or {})})
        assistant: dict[str, Any] = {"role": "assistant", "content": text}
        if calls:
            assistant["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in calls]
        return {"text": text, "tool_calls": calls, "usage": self._usage(payload.get("usageMetadata")), "finish": self._finish(candidates[0].get("finishReason") if candidates else ""), "assistant": assistant}


def _gemini_schema(schema: dict) -> dict:
    """Gemini accepts an OpenAPI subset: drop keys it rejects (additionalProperties, defaults…)."""
    allowed = {"type", "description", "properties", "required", "items", "enum", "minimum", "maximum", "nullable", "format"}
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in allowed:
            continue
        if key == "properties":
            out[key] = {k: _gemini_schema(v) for k, v in value.items()}
        elif key == "items":
            out[key] = _gemini_schema(value)
        else:
            out[key] = value
    return out


PROVIDERS: dict[str, AIProvider] = {"deepseek": DeepSeekProvider(), "gemini": GeminiProvider()}


def resolve(provider: str = "", model: str = "") -> tuple[AIProvider, str]:
    """Staff choice (Config) → env (AI_PROVIDER / AI_MODEL) → whichever has a key."""
    chosen = (provider or os.getenv("AI_TUTOR_PROVIDER", "") or os.getenv("AI_PROVIDER", "")).strip().lower()
    if chosen not in PROVIDERS:
        chosen = "deepseek" if PROVIDERS["deepseek"].configured() or not PROVIDERS["gemini"].configured() else "gemini"
    impl = PROVIDERS[chosen]
    env_model = os.getenv("AI_MODEL", "").strip() or (os.getenv("TUTOR_MODEL", "").strip() if chosen == "deepseek" else "")
    return impl, (model or env_model or impl.default_model())
