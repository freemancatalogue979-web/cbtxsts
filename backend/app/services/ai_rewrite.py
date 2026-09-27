"""“Make it easy to read”: rewrite material sections with Google Gemini or DeepSeek.

Staff pick a style, Gemini rewrites the chosen sections, and staff review the
result next to the original before anything is used (nothing is saved here).

Guard rails:

* the model only sees and returns the same block structure the reader
  renders; its output goes through ``sanitise_blocks`` like any other save;
* every number in the original (dates, sections of an Act, amounts, marks) is
  checked in the rewrite — missing ones are reported as warnings;
* a rewrite that is much shorter than the original is flagged as possibly
  dropping content;
* key terms and important numbers come back wrapped in ``**double stars**``,
  which the reader shows in bold.
"""
from __future__ import annotations

import json
import time
import socket
import re
import urllib.error
import urllib.request
from typing import Any

from ..config import ai_provider, deepseek_settings, gemini_settings
from . import materials as engine

STYLES: dict[str, str] = {
    "easy": (
        "EASY TO READ. Plain, simple English a first-year student understands on the first read. "
        "Short sentences (mostly under 20 words), one idea per sentence, active voice. "
        "Explain every technical or legal word in brackets the first time it appears. "
        "Break long paragraphs into two or three shorter ones, or into a bullet list when it lists things."
    ),
    "fun": (
        "FUN TO LEARN. Everything from EASY TO READ, plus a warm, friendly, lightly playful tone — like a "
        "brilliant senior student explaining it over lunch. Use relatable everyday examples (Nigerian "
        "student life is welcome: market, NEPA/light, danfo, jollof, exams). Ask the reader a quick question "
        "now and then. You may add at most ONE extra block per section of type \"tip\" or \"example\". "
        "No emojis, no slang that hides the meaning, never silly about serious topics."
    ),
    "exam": (
        "EXAM-READY. Everything from EASY TO READ, focused on what examiners ask: definitions stated "
        "crisply, steps numbered, causes / effects / differences made explicit. End each section with ONE "
        "extra block of type \"summary\" that starts with \"Remember:\" and lists the 2–4 must-know points "
        "in one or two sentences."
    ),
}

SYSTEM = """You rewrite university course material so students understand it easily.

Rules you must follow:
1. Keep EVERY fact. Never invent facts, cases, dates, statistics, names or references. If unsure, keep the original wording.
2. Keep every number, date, amount, formula, section/article number, case name and quotation exactly as written.
3. Fix spelling and grammar. Use British/Nigerian English spelling (colour, organisation, programme, centre, judgement).
4. Highlight sparingly with **double stars** (shown in bold). Bold ONLY, and only the FIRST time it appears in a section:
   - the term being defined or explained (e.g. **mischief rule**, **deponent**, **osmosis**);
   - case names (e.g. **Donoghue v Stevenson**) and statute / rule references (e.g. **Section 36**, **Rule 14 of the RPC**);
   - Latin maxims and terms of art (e.g. **ejusdem generis**, **locus standi**);
   - a number, date or amount that must be remembered (a deadline, a limit, a year of enactment).
   Never bold: whole sentences or clauses (more than 5 words), headings or section titles, list numbering, ordinary words, words already bold earlier in the section, or law-report citations such as (2004) 12 NWLR (Pt. 887) 1. Aim for about one bold phrase per two or three sentences — if everything is bold, nothing stands out.
5. Return the SAME sections (same "index" values) with blocks using ONLY these types:
   heading, subheading, paragraph, list, numbers, table, keyterm, definition, note, tip, example, summary, quote, reference, image, video, attachment, divider.
   - paragraph/heading/subheading/note/tip/example/summary/quote/reference/definition use "text" (definition may also have "title").
   - list and numbers use "items" (array of strings). Copy any "style", "wrap", "start" and "level" fields of a list unchanged — they keep the notes' own numbering such as (a), (b) or (i), (ii).
   - table uses "head" (array) and "rows" (array of arrays) — keep the same number of rows and columns; you may simplify cell wording.
   - keyterm uses "term" and "meaning".
   - image/video/attachment/divider blocks: copy them unchanged.
   - Keep the order of the material. You may split a long paragraph into several blocks.
6. Keep section titles short and clear (you may simplify them).
7. No markdown other than **bold**. No HTML. No emojis.

Reply with JSON only, in exactly this shape:
{"sections": [{"index": 0, "title": "...", "blocks": [{"type": "paragraph", "text": "..."}]}]}
"""


class AIError(Exception):
    """A readable problem to show staff (``status`` is the HTTP status to use)."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


PROVIDERS = {"gemini": "Google Gemini", "deepseek": "DeepSeek"}
SETUP = {
    "gemini": "Create a free key at aistudio.google.com (Get API key), add GEMINI_API_KEY=your-key to backend/.env, then restart the API.",
    "deepseek": "Create a key at platform.deepseek.com (API keys) and add a small balance, put DEEPSEEK_API_KEY=your-key in backend/.env, then restart the API.",
}


def _settings(provider: str) -> dict:
    return deepseek_settings() if provider == "deepseek" else gemini_settings()


def status() -> dict:
    provider = ai_provider()
    settings = _settings(provider)
    return {
        "configured": bool(settings["key"]),
        "provider": PROVIDERS[provider],
        "provider_id": provider,
        "model": settings["model"],
        "styles": [{"id": key, "label": {"easy": "Easy to read", "fun": "Fun to learn", "exam": "Exam-ready"}[key]} for key in STYLES],
        "setup": None if settings["key"] else SETUP[provider],
    }


# ------------------------------------------------------------------- gemini
class _ThinkingUnsupported(Exception):
    """The model rejected thinkingConfig; retry once without it."""


def _call(model: str, prompt: str, settings: dict, timeout: float | None = None, think: bool = False) -> str:
    config: dict = {"temperature": 0.4, "responseMimeType": "application/json"}
    if not think:
        # Rewriting needs no "thinking" pass; skipping it makes answers several times faster.
        config["thinkingConfig"] = {"thinkingBudget": 0}
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": config,
    }
    request = urllib.request.Request(
        f"{settings['base']}/models/{model}:generateContent",
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings["key"]},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout or settings["timeout"]) as response:
            payload = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = json.loads(error.read() or b"{}").get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001 - best effort message
            pass
        if error.code == 404:
            raise LookupError(detail or f"model {model} not found") from error
        if error.code == 400 and not think and "think" in detail.lower():
            raise _ThinkingUnsupported(detail) from error
        if error.code == 429:
            raise AIError("Gemini's free limit was reached. Wait a minute and try again (fewer sections at a time helps).", 429) from error
        if error.code in (400, 401, 403) and ("key" in detail.lower() or error.code in (401, 403)):
            raise AIError("Gemini refused the API key. Check GEMINI_API_KEY in backend/.env.", 502) from error
        raise AIError(f"Gemini returned an error ({error.code}). {detail[:200]}", 502) from error
    except (TimeoutError, socket.timeout) as error:
        raise AIError("Gemini took too long to answer. Try again with fewer sections at a time.", 504) from error
    except (urllib.error.URLError, OSError) as error:
        if isinstance(getattr(error, "reason", None), (TimeoutError, socket.timeout)):
            raise AIError("Gemini took too long to answer. Try again with fewer sections at a time.", 504) from error
        raise AIError("Could not reach Gemini. Check the server's internet connection and try again.", 504) from error

    candidates = payload.get("candidates") or []
    if not candidates:
        reason = (payload.get("promptFeedback") or {}).get("blockReason")
        raise AIError(f"Gemini returned nothing{f' ({reason})' if reason else ''}. Try a smaller part of the material.", 502)
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
    if not text.strip():
        raise AIError(f"Gemini returned an empty answer ({candidates[0].get('finishReason', 'unknown')}). Try again.", 502)
    return text


def _generate(prompt: str, budget: float | None = None) -> tuple[str, str]:
    if ai_provider() == "deepseek":
        return _generate_deepseek(prompt, budget)
    settings = dict(gemini_settings())
    if budget:
        settings["budget"] = budget
    if not settings["key"]:
        raise AIError(status()["setup"] or "AI is not set up.", 503)
    tried: list[str] = []
    # One overall budget for the whole request (fallbacks included), so the API
    # always answers before a proxy's 100-120 s read timeout cuts it off.
    deadline = time.monotonic() + settings["budget"]
    for model in [settings["model"], *[m for m in settings["fallbacks"] if m != settings["model"]]]:
        left = deadline - time.monotonic()
        if tried and left < min(5.0, settings["budget"] / 10):  # not worth starting another model this late
            raise AIError("Gemini took too long to answer. Try again with fewer sections at a time.", 504)
        try:
            try:
                return _call(model, prompt, settings, timeout=min(settings["timeout"], left)), model
            except _ThinkingUnsupported:
                left = deadline - time.monotonic()
                if left < 2:
                    raise AIError("Gemini took too long to answer. Try again with fewer sections at a time.", 504) from None
                return _call(model, prompt, settings, timeout=min(settings["timeout"], left), think=True), model
        except LookupError:
            tried.append(model)
            continue
    raise AIError(f"None of these Gemini models are available to your key: {', '.join(tried)}. Set GEMINI_MODEL in backend/.env.", 502)


# ----------------------------------------------------------------- deepseek
def _deepseek_call(model: str, prompt: str, settings: dict, timeout: float, think: bool = False) -> str:
    """OpenAI-style chat completion against DeepSeek."""
    body: dict = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    if not think:
        body["thinking"] = {"type": "disabled"}  # much faster; not needed to rewrite
    request = urllib.request.Request(
        f"{settings['base']}/chat/completions",
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings['key']}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = str(json.loads(error.read() or b"{}").get("error", {}).get("message", ""))
        except Exception:  # noqa: BLE001 - best effort message
            pass
        low = detail.lower()
        if error.code in (400, 404) and "model" in low and ("not exist" in low or "not found" in low or "invalid" in low or "unknown" in low):
            raise LookupError(detail or f"model {model} not found") from error
        if error.code in (400, 422) and not think and "think" in low:
            raise _ThinkingUnsupported(detail) from error
        if error.code == 401:
            raise AIError("DeepSeek refused the API key. Check DEEPSEEK_API_KEY in backend/.env.", 502) from error
        if error.code == 402:
            raise AIError("Your DeepSeek balance is empty. Top up at platform.deepseek.com, then try again.", 402) from error
        if error.code == 429:
            raise AIError("DeepSeek is rate-limiting requests. Wait a minute and try again.", 429) from error
        if error.code in (500, 502, 503):
            raise AIError("DeepSeek is busy right now. Try again in a minute.", 503) from error
        raise AIError(f"DeepSeek returned an error ({error.code}). {detail[:200]}", 502) from error
    except (TimeoutError, socket.timeout) as error:
        raise AIError("DeepSeek took too long to answer. Try again with fewer sections at a time.", 504) from error
    except (urllib.error.URLError, OSError) as error:
        if isinstance(getattr(error, "reason", None), (TimeoutError, socket.timeout)):
            raise AIError("DeepSeek took too long to answer. Try again with fewer sections at a time.", 504) from error
        raise AIError("Could not reach DeepSeek. Check the server's internet connection and try again.", 504) from error

    choices = payload.get("choices") or []
    if not choices:
        raise AIError("DeepSeek returned nothing. Try again.", 502)
    message = choices[0].get("message") or {}
    text = message.get("content") or ""
    if not text.strip():
        raise AIError(f"DeepSeek returned an empty answer ({choices[0].get('finish_reason', 'unknown')}). Try again.", 502)
    if choices[0].get("finish_reason") == "length":
        raise AIError("DeepSeek's answer was cut off. Rewrite fewer sections at a time.", 502)
    return text


def _generate_deepseek(prompt: str, budget: float | None = None) -> tuple[str, str]:
    settings = dict(deepseek_settings())
    if budget:
        settings["budget"] = budget
    if not settings["key"]:
        raise AIError(SETUP["deepseek"], 503)
    deadline = time.monotonic() + settings["budget"]
    tried: list[str] = []
    for model in [settings["model"], *[m for m in settings["fallbacks"] if m != settings["model"]]]:
        left = deadline - time.monotonic()
        if tried and left < min(5.0, settings["budget"] / 10):
            raise AIError("DeepSeek took too long to answer. Try again with fewer sections at a time.", 504)
        try:
            try:
                return _deepseek_call(model, prompt, settings, timeout=min(settings["timeout"], left)), model
            except _ThinkingUnsupported:
                left = deadline - time.monotonic()
                if left < 2:
                    raise AIError("DeepSeek took too long to answer. Try again with fewer sections at a time.", 504) from None
                return _deepseek_call(model, prompt, settings, timeout=min(settings["timeout"], left), think=True), model
        except LookupError:
            tried.append(model)
    raise AIError(f"None of these DeepSeek models are available: {', '.join(tried)}. Set DEEPSEEK_MODEL in backend/.env.", 502)


def _parse(text: str) -> list[dict]:
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.S)
    if fence:
        cleaned = fence.group(1)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise AIError("The AI's answer was not in the expected format. Try again.", 502) from None
        try:
            data = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise AIError("The AI's answer was cut off or malformed. Try fewer sections at a time.", 502) from error
    sections = data.get("sections") if isinstance(data, dict) else data
    if not isinstance(sections, list):
        raise AIError("The AI's answer had no sections. Try again.", 502)
    return [row for row in sections if isinstance(row, dict)]


# ------------------------------------------------------------------- checks
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(blocks: list[dict]) -> set[str]:
    found: set[str] = set()
    for text in _texts(blocks):
        for match in _NUMBER_RE.finditer(text):
            found.add(match.group(0).replace(",", ""))
    return found


def _texts(blocks: list[dict]) -> list[str]:
    out: list[str] = []
    for block in blocks:
        for key in ("text", "title", "term", "meaning", "caption"):
            if isinstance(block.get(key), str):
                out.append(block[key])
        out.extend(str(item) for item in block.get("items") or [])
        out.extend(str(cell) for cell in block.get("head") or [])
        for row in block.get("rows") or []:
            out.extend(str(cell) for cell in row)
    return out


def _words(blocks: list[dict]) -> int:
    return sum(len(text.split()) for text in _texts(blocks))


# ---------------------------------------------------------------- highlights
_BOLD_RE = re.compile(r"\*\*([^*\n]+?)\*\*")
_PLAIN_BLOCKS = {"heading", "subheading"}
_BORING = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "be", "it", "this", "that",
    "these", "those", "with", "as", "by", "at", "from", "not", "no", "yes", "note", "important", "remember",
}
_CITATION_RE = re.compile(r"^[\(\[]\d{4}[\)\]]\s*\d*\s*[A-Z][A-Za-z.]*")


def _unbold(text: str) -> str:
    return _BOLD_RE.sub(r"\1", text)


def tidy_bold(blocks: list[dict]) -> list[dict]:
    """Keep AI highlighting useful: short phrases only, first mention per section,
    nothing in headings, a density cap per block. Returns new blocks."""
    seen: set[str] = set()

    def fix(text: str, cap: int) -> str:
        kept = 0

        def one(match: re.Match) -> str:
            nonlocal kept
            inner = match.group(1).strip()
            key = re.sub(r"\s+", " ", inner.lower()).strip(" .,;:")
            words = inner.split()
            bad = (
                not key
                or len(words) > 6
                or len(inner) > 60
                or all(word.lower().strip(".,;:()") in _BORING for word in words)
                or _CITATION_RE.match(inner)
                or key in seen
                or kept >= cap
            )
            if bad:
                return match.group(1)
            seen.add(key)
            kept += 1
            return match.group(0)

        return _BOLD_RE.sub(one, text)

    def cap_for(text: str) -> int:
        return max(2, len(_unbold(text).split()) // 14 + 1)

    out: list[dict] = []
    for block in blocks:
        block = dict(block)
        kind = block.get("type")
        for key in ("text", "title", "meaning", "caption"):
            value = block.get(key)
            if not isinstance(value, str) or "**" not in value:
                continue
            if kind in _PLAIN_BLOCKS or (key == "title" and kind == "definition"):
                block[key] = _unbold(value)
            else:
                block[key] = fix(value, cap_for(value))
        if isinstance(block.get("term"), str):
            block["term"] = _unbold(block["term"])  # the key-term box already stands out
        if isinstance(block.get("items"), list):
            block["items"] = [fix(item, 2) if isinstance(item, str) else item for item in block["items"]]
        if isinstance(block.get("head"), list):
            block["head"] = [_unbold(cell) if isinstance(cell, str) else cell for cell in block["head"]]
        if isinstance(block.get("rows"), list):
            block["rows"] = [[fix(cell, 1) if isinstance(cell, str) else cell for cell in row] if isinstance(row, list) else row for row in block["rows"]]
        out.append(block)
    return out


def _clean_sections(sections: list[dict]) -> list[dict]:
    clean_sections = []
    for row in sections:
        blocks = engine.sanitise_blocks(row.get("blocks") or [])
        clean_sections.append({"index": int(row.get("index", len(clean_sections))), "title": engine.clean_text(row.get("title"), 200), "blocks": blocks})
    return clean_sections


def rewrite(title: str, sections: list[dict], style: str, budget: float | None = None) -> dict:
    """Rewrite ``sections`` (each {index, title, blocks}); returns suggestions + warnings."""
    style = style if style in STYLES else "easy"
    clean_sections = _clean_sections(sections)
    if not clean_sections:
        raise AIError("Choose at least one section to rewrite.", 422)
    size = len(json.dumps(clean_sections))
    if size > 60000:
        raise AIError("That is too much text for one go. Rewrite fewer sections at a time.", 413)

    prompt = (
        f"Style: {STYLES[style]}\n\nMaterial title: {engine.clean_text(title, 200) or 'Untitled'}\n\n"
        f"Rewrite these sections and reply with JSON only:\n{json.dumps({'sections': clean_sections}, ensure_ascii=False)}"
    )
    text, model = _generate(prompt, budget)
    returned = {int(row.get("index", -1)): row for row in _parse(text) if str(row.get("index", "")).lstrip("-").isdigit()}

    results = []
    for original in clean_sections:
        row = returned.get(original["index"])
        if row is None:
            results.append({"index": original["index"], "title": original["title"], "blocks": original["blocks"], "warnings": ["The AI skipped this section — it is unchanged."], "changed": False})
            continue
        blocks = tidy_bold(engine.sanitise_blocks(row.get("blocks") or []))
        # media blocks must survive untouched
        media = [block for block in original["blocks"] if block["type"] in {"image", "video", "attachment"}]
        for block in media:
            if block not in blocks:
                blocks.append(block)
        warnings: list[str] = []
        if not blocks:
            results.append({"index": original["index"], "title": original["title"], "blocks": original["blocks"], "warnings": ["Gemini returned no content for this section — it is unchanged."], "changed": False})
            continue
        missing = sorted(_numbers(original["blocks"]) - _numbers(blocks), key=lambda value: (len(value), value))
        if missing:
            shown = ", ".join(missing[:8]) + ("…" if len(missing) > 8 else "")
            warnings.append(f"Check the facts: these numbers from the original are missing — {shown}.")
        before, after = _words(original["blocks"]), _words(blocks)
        if before >= 40 and after < before * 0.45:
            warnings.append(f"Much shorter than the original ({after} vs {before} words) — make sure nothing important was dropped.")
        results.append(
            {
                "index": original["index"],
                "title": _unbold(engine.clean_text(row.get("title"), 200)) or original["title"],
                "blocks": blocks,
                "warnings": warnings,
                "changed": True,
            }
        )
    return {"style": style, "model": model, "sections": results}


# ------------------------------------------------------------ background jobs
# A long material (dozens of sections) takes minutes to rewrite. Doing that in
# one browser request trips proxy limits (Cloudflare ~100 s → 520/524, other
# proxies 120 s). Instead the server works through the sections in a thread and
# the editor polls for progress with short requests. One API worker (see
# main.run) means an in-memory registry is enough.
import threading
import uuid

JOB_TTL = 3 * 3600
MAX_JOBS = 30
BATCH_CHARS = 6000
BATCH_SECTIONS = 2
BACKGROUND_BUDGET = 150.0  # per batch; no proxy is waiting on it
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _batches(sections: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    current: list[dict] = []
    size = 0
    for section in sections:
        weight = len(json.dumps(section, ensure_ascii=False))
        if current and (len(current) >= BATCH_SECTIONS or size + weight > BATCH_CHARS):
            out.append(current)
            current, size = [], 0
        current.append(section)
        size += weight
    if current:
        out.append(current)
    return out


def _retry_wait(error: AIError, attempt: int) -> float | None:
    """Seconds to wait before retrying a batch, or None when retrying is pointless."""
    text = str(error).lower()
    if error.status in (401, 402, 403, 413, 422) or any(
        hint in text for hint in ("api key", "balance", "not set up", "none of these", "backend/.env")
    ):
        return None  # a wrong key, empty balance or bad model name won't fix itself
    if error.status == 429:
        return (20.0, 40.0, 60.0)[min(attempt, 2)]  # free-tier per-minute limits
    return (2.0, 4.0, 8.0)[min(attempt, 2)]


def _sleep(job: dict, seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end and not job["cancel"]:
        time.sleep(0.25)


def _run_job(job: dict, batches: list[list[dict]]) -> None:
    fatal = ""
    for batch in batches:
        if job["cancel"] or fatal:
            job["failed"].extend(row["index"] for row in batch)
            continue
        indexes = [row["index"] for row in batch]
        job["current"] = indexes
        for attempt in range(4):
            try:
                result = rewrite(job["title"], batch, job["style"], budget=BACKGROUND_BUDGET)
            except AIError as error:
                wait = _retry_wait(error, attempt)
                job["last_error"] = str(error)
                if wait is None:
                    fatal = str(error)
                    job["failed"].extend(indexes)
                    break
                if attempt == 3:
                    job["failed"].extend(indexes)
                    break
                job["waiting"] = round(wait)
                _sleep(job, wait)
                job["waiting"] = 0
                if job["cancel"]:
                    job["failed"].extend(indexes)
                    break
            except Exception as error:  # noqa: BLE001 - one bad batch must not kill the job
                import logging

                logging.getLogger("arena").exception("rewrite batch failed")
                job["last_error"] = f"Rewrite failed ({type(error).__name__})."
                job["failed"].extend(indexes)
                break
            else:
                job["model"] = result["model"]
                with _jobs_lock:
                    for row in result["sections"]:
                        job["seq"] += 1
                        job["results"].append({**row, "seq": job["seq"]})
                break
        job["done"] = len(job["results"]) + len(job["failed"])
    job["current"] = []
    job["error"] = fatal or (job["last_error"] if job["failed"] and not job["cancel"] else "")
    job["status"] = "cancelled" if job["cancel"] else ("done" if not fatal else "failed")
    job["finished_at"] = time.time()


def _prune() -> None:
    now = time.time()
    for key, job in list(_jobs.items()):
        if job.get("finished_at") and now - job["finished_at"] > JOB_TTL:
            _jobs.pop(key, None)
    while len(_jobs) >= MAX_JOBS:
        oldest = min(_jobs.values(), key=lambda job: job["created_at"])
        oldest["cancel"] = True
        _jobs.pop(oldest["id"], None)


def start_job(title: str, sections: list[dict], style: str, owner: str = "") -> dict:
    """Queue a rewrite of any number of sections; returns the job's public state."""
    style = style if style in STYLES else "easy"
    clean = [row for row in _clean_sections(sections) if row["blocks"]]
    if not clean:
        raise AIError("Choose at least one section to rewrite.", 422)
    if len(clean) > 300:
        raise AIError("That is too many sections for one go (300 max).", 413)
    if not status()["configured"]:
        raise AIError(status()["setup"] or "AI is not set up.", 503)
    job = {
        "id": uuid.uuid4().hex,
        "owner": owner,
        "title": title,
        "style": style,
        "total": len(clean),
        "done": 0,
        "results": [],
        "failed": [],
        "seq": 0,
        "current": [],
        "waiting": 0,
        "model": "",
        "error": "",
        "last_error": "",
        "status": "running",
        "cancel": False,
        "created_at": time.time(),
        "finished_at": None,
    }
    with _jobs_lock:
        _prune()
        _jobs[job["id"]] = job
    threading.Thread(target=_run_job, args=(job, _batches(clean)), name=f"rewrite-{job['id'][:6]}", daemon=True).start()
    return job_state(job["id"], owner)


def job_state(job_id: str, owner: str = "", after: int = 0) -> dict:
    job = _jobs.get(job_id)
    if job is None or (job["owner"] and owner and job["owner"] != owner):
        raise AIError("That rewrite is no longer available (the server may have restarted). Start it again.", 404)
    with _jobs_lock:
        fresh = [row for row in job["results"] if row["seq"] > after]
    return {
        "id": job["id"],
        "status": job["status"],
        "style": job["style"],
        "total": job["total"],
        "done": job["done"],
        "current": list(job["current"]),
        "waiting": job["waiting"],
        "failed": sorted(job["failed"]),
        "model": job["model"],
        "error": job["error"],
        "seq": job["seq"],
        "sections": fresh,
    }


def cancel_job(job_id: str, owner: str = "") -> dict:
    job = _jobs.get(job_id)
    if job is None or (job["owner"] and owner and job["owner"] != owner):
        raise AIError("That rewrite is no longer available.", 404)
    job["cancel"] = True
    return job_state(job_id, owner)
