"""“Make it easy to read”: rewrite material sections with Google Gemini.

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
import re
import urllib.error
import urllib.request
from typing import Any

from ..config import gemini_settings
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
4. Wrap key terms and important numbers in **double stars** so they show in bold (for example: **osmosis**, **1999**, **Section 36**). Do not bold whole sentences.
5. Return the SAME sections (same "index" values) with blocks using ONLY these types:
   heading, subheading, paragraph, list, numbers, table, keyterm, definition, note, tip, example, summary, quote, reference, image, video, attachment, divider.
   - paragraph/heading/subheading/note/tip/example/summary/quote/reference/definition use "text" (definition may also have "title").
   - list and numbers use "items" (array of strings).
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


def status() -> dict:
    settings = gemini_settings()
    return {
        "configured": bool(settings["key"]),
        "provider": "Google Gemini",
        "model": settings["model"],
        "styles": [{"id": key, "label": {"easy": "Easy to read", "fun": "Fun to learn", "exam": "Exam-ready"}[key]} for key in STYLES],
        "setup": None
        if settings["key"]
        else "Create a free key at aistudio.google.com (Get API key), add GEMINI_API_KEY=your-key to backend/.env, then restart the API.",
    }


# ------------------------------------------------------------------- gemini
def _call(model: str, prompt: str, settings: dict) -> str:
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4, "responseMimeType": "application/json"},
    }
    request = urllib.request.Request(
        f"{settings['base']}/models/{model}:generateContent",
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": settings["key"]},
    )
    try:
        with urllib.request.urlopen(request, timeout=settings["timeout"]) as response:
            payload = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = json.loads(error.read() or b"{}").get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001 - best effort message
            pass
        if error.code == 404:
            raise LookupError(detail or f"model {model} not found") from error
        if error.code == 429:
            raise AIError("Gemini's free limit was reached. Wait a minute and try again (fewer sections at a time helps).", 429) from error
        if error.code in (400, 401, 403) and ("key" in detail.lower() or error.code in (401, 403)):
            raise AIError("Gemini refused the API key. Check GEMINI_API_KEY in backend/.env.", 502) from error
        raise AIError(f"Gemini returned an error ({error.code}). {detail[:200]}", 502) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
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


def _generate(prompt: str) -> tuple[str, str]:
    settings = gemini_settings()
    if not settings["key"]:
        raise AIError(status()["setup"] or "AI is not set up.", 503)
    tried: list[str] = []
    for model in [settings["model"], *[m for m in settings["fallbacks"] if m != settings["model"]]]:
        try:
            return _call(model, prompt, settings), model
        except LookupError:
            tried.append(model)
            continue
    raise AIError(f"None of these Gemini models are available to your key: {', '.join(tried)}. Set GEMINI_MODEL in backend/.env.", 502)


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
            raise AIError("Gemini's answer was not in the expected format. Try again.", 502) from None
        try:
            data = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise AIError("Gemini's answer was cut off or malformed. Try fewer sections at a time.", 502) from error
    sections = data.get("sections") if isinstance(data, dict) else data
    if not isinstance(sections, list):
        raise AIError("Gemini's answer had no sections. Try again.", 502)
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


def rewrite(title: str, sections: list[dict], style: str) -> dict:
    """Rewrite ``sections`` (each {index, title, blocks}); returns suggestions + warnings."""
    style = style if style in STYLES else "easy"
    clean_sections = []
    for row in sections:
        blocks = engine.sanitise_blocks(row.get("blocks") or [])
        clean_sections.append({"index": int(row.get("index", len(clean_sections))), "title": engine.clean_text(row.get("title"), 200), "blocks": blocks})
    if not clean_sections:
        raise AIError("Choose at least one section to rewrite.", 422)
    size = len(json.dumps(clean_sections))
    if size > 60000:
        raise AIError("That is too much text for one go. Rewrite fewer sections at a time.", 413)

    prompt = (
        f"Style: {STYLES[style]}\n\nMaterial title: {engine.clean_text(title, 200) or 'Untitled'}\n\n"
        f"Rewrite these sections and reply with JSON only:\n{json.dumps({'sections': clean_sections}, ensure_ascii=False)}"
    )
    text, model = _generate(prompt)
    returned = {int(row.get("index", -1)): row for row in _parse(text) if str(row.get("index", "")).lstrip("-").isdigit()}

    results = []
    for original in clean_sections:
        row = returned.get(original["index"])
        if row is None:
            results.append({"index": original["index"], "title": original["title"], "blocks": original["blocks"], "warnings": ["Gemini skipped this section — it is unchanged."], "changed": False})
            continue
        blocks = engine.sanitise_blocks(row.get("blocks") or [])
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
                "title": engine.clean_text(row.get("title"), 200) or original["title"],
                "blocks": blocks,
                "warnings": warnings,
                "changed": True,
            }
        )
    return {"style": style, "model": model, "sections": results}
