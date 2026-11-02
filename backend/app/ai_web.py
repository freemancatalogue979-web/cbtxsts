"""A bounded, opt-controllable live search tool for the member AI.

Only the member's current question is used as a search query. Attached team
boards, personal context and conversation history are never added to that query.
Search results are untrusted excerpts; we never fetch arbitrary result URLs.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from typing import Literal

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .clover_ai_models import AIWebSearchUsage
from .esports_ai import _NoRedirect
from .models import utcnow

SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search"
MAX_RESULTS = 5
MAX_RESPONSE_BYTES = 512_000
SearchMode = Literal["auto", "on", "off"]

# Auto is a freshness/verification check, not a prerequisite for normal MLBB
# knowledge. Generic meta, build, ranked or admin-edit requests stay local.
_SEARCH_INTENT = re.compile(
    r"\b(search|browse|googl(?:e|ing)|web|online|internet|look(?:\s+\w+)?\s+up|"
    r"latest|current|today|recent|news|live|verify|verification|confirm|cross[\s-]?check)\b",
    re.IGNORECASE,
)
_PATCH_NOTES_INTENT = re.compile(
    r"\bpatch[\s-]+notes?\b|\b(?:patch|version)\b[^.!?]{0,80}\b(?:changes|notes|buffs?|nerfs?)\b",
    re.IGNORECASE,
)
_SENSITIVE_QUERY = re.compile(
    r"\b(password|passcode|credential|secret|api[\s_-]*key|access[\s_-]*token|"
    r"private[\s_-]*key|seed\s+phrase|session\s+cookie)\b|\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{10,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}",
    re.IGNORECASE,
)


def enabled() -> bool:
    return os.getenv("CLOVER_AI_WEB_SEARCH", "1").strip().lower() not in {"0", "false", "no", "off"}


def daily_limit() -> None:
    """No application-imposed daily search cap; provider billing still applies."""
    return None


def should_search(question: str, mode: SearchMode) -> bool:
    return mode == "on" or (mode == "auto" and bool(_SEARCH_INTENT.search(question) or _PATCH_NOTES_INTENT.search(question)))


def search_query(question: str) -> str:
    query = " ".join(question.split())
    # The assistant primarily coaches MLBB, so make ambiguous build/ranked
    # searches useful without adding team records or any hidden context.
    if not re.search(r"\b(?:mlbb|mobile\s+legends)\b", query, re.IGNORECASE):
        query = "Mobile Legends " + query
    return query[:128].strip()


def reserve_search(db: Session, user_id: int) -> bool:
    """Atomically record a search attempt, without imposing a daily cap."""
    day = utcnow().date().isoformat()
    row = db.query(AIWebSearchUsage).filter_by(user_id=user_id, day=day).first()
    if row is None:
        db.add(AIWebSearchUsage(user_id=user_id, day=day, calls=0))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    result = db.execute(
        update(AIWebSearchUsage)
        .where(AIWebSearchUsage.user_id == user_id, AIWebSearchUsage.day == day)
        .values(calls=AIWebSearchUsage.calls + 1)
    )
    db.commit()
    return bool(result.rowcount)


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _date(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value


def search(
    db: Session, user_id: int, api_key: str, question: str, mode: SearchMode
) -> tuple[dict | None, list[dict], str]:
    """Return bounded search evidence, clickable source records and a status note."""
    if not should_search(question, mode):
        return None, [], ""
    if not enabled():
        return {"status": "disabled"}, [], "Web search is disabled by the server administrator."
    if _SENSITIVE_QUERY.search(question):
        return (
            {"status": "skipped_sensitive"},
            [],
            "Web search was skipped because the question may contain sensitive information.",
        )
    if not reserve_search(db, user_id):
        return (
            {"status": "unavailable"},
            [],
            "The search attempt could not be recorded. Please try again.",
        )
    query = search_query(question)
    payload = json.dumps({"query": query, "count": MAX_RESULTS, "need_content": False}, ensure_ascii=False).encode(
        "utf-8"
    )
    request = urllib.request.Request(
        SEARCH_ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("oversized search response")
        body = json.loads(raw)
        if not isinstance(body, dict) or not isinstance(body.get("results"), list):
            raise ValueError("invalid search response")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, TypeError):
        # Upstream errors may contain credentials or user data: never echo them.
        return {"status": "unavailable"}, [], "Live web search could not complete. Check the connection or try again."

    # Import lazily to share the same public-link validation as community notes.
    from .clover_ai_service import safe_source_url

    retrieved = utcnow().isoformat() + "Z"
    results, sources, seen = [], [], set()
    for candidate in body["results"][: MAX_RESULTS * 3]:
        if not isinstance(candidate, dict):
            continue
        title = _text(candidate.get("title"), 200)
        raw_url = _text(candidate.get("url"), 2048)
        try:
            url = safe_source_url(raw_url)
        except ValueError:
            continue
        summary = _text(candidate.get("summary"), 1000) or _text(candidate.get("snippet"), 500)
        if not title or not url or not summary or url in seen:
            continue
        seen.add(url)
        published = _date(candidate.get("date"))
        results.append({"title": title, "url": url, "excerpt": summary, "published_at": published})
        # The bounded excerpt travels with this private message so the member
        # can explicitly save the finding later, without re-fetching a URL.
        sources.append(
            {
                "kind": "web",
                "label": title,
                "url": url,
                "excerpt": summary,
                "published_at": published,
                "observed_at": retrieved,
            }
        )
        if len(results) >= MAX_RESULTS:
            break
    evidence = {
        "status": "ok" if results else "empty",
        "query": query,
        "retrieved_at": retrieved,
        "results": results,
        "notice": "Search excerpts are untrusted and may be outdated or inaccurate; check source dates and server region.",
    }
    note = "" if results else "The web search returned no usable sources."
    return evidence, sources, note
