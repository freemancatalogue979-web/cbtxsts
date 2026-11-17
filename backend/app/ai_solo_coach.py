"""Learning utility: AI coaching from a member's own solo games (on request only)."""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from .ai_scoreboard import ReadError, ai_key
from .ai_strategy_writer import call_model as _text_call
from .config import CURRENT_PATCH
from .models import Hero, HeroPoolEntry, User
from .solo_games import ai_summary, user_games

MIN_GAMES_TO_COACH = 3

SYSTEM = """You are 9 Clover's MLBB coach. Coach ONE player from their own recorded games (solo queue: ranked, classic, brawl…).

Return one JSON object only:
{
  "headline": "one punchy sentence on where they stand",
  "summary": "2-3 sentences: what the numbers say about how they play",
  "strengths": [{"title": "short", "detail": "why, quoting their numbers"}],
  "fixes": [{"title": "short", "detail": "what's going wrong, quoting their numbers", "drill": "a concrete thing to do in the next games"}],
  "heroes": {
    "keep": [{"hero": "name", "why": "short"}],
    "work_on": [{"hero": "name", "why": "short"}],
    "try": [{"hero": "name", "why": "short, fits their lane/pool"}]
  },
  "next_games": ["3-5 short, specific goals for their next session"]
}

Rules:
- Be direct, confident and specific, like a teammate who has watched every game. No disclaimers or hedging.
- Use the numbers given (win rates, KDA, deaths, rating, streaks, trend) and name heroes. Never invent a number.
- 2-3 strengths, 2-4 fixes. "try" heroes must suit their main lane or pool; leave it empty if nothing fits.
- If a focus is given, centre the advice on it.
- Use the casual 9 Clover voice ("bro" is fine once). No headings or markdown inside strings."""


def _items(value, keys: tuple[str, ...], limit: int) -> list[dict]:
    out = []
    for item in value if isinstance(value, list) else []:
        if isinstance(item, dict):
            row = {k: re.sub(r"\s+", " ", str(item.get(k) or "")).strip()[:400] for k in keys}
            if row[keys[0]]:
                out.append(row)
    return out[:limit]


def coach(db: Session, user: User, focus: str = "") -> dict:
    games = user_games(db, user.id, limit=200)
    if len(games) < MIN_GAMES_TO_COACH:
        raise ReadError(f"Add at least {MIN_GAMES_TO_COACH} of your games first (Utility AI tab).", 422)
    pool = [{"hero": name, "category": category} for name, category in
            db.query(Hero.name, HeroPoolEntry.category).join(Hero, Hero.id == HeroPoolEntry.hero_id)
            .filter(HeroPoolEntry.user_id == user.id).limit(25).all()]
    prompt = {
        "player": user.ign or user.name, "main_lane": user.main_role or None, "patch": CURRENT_PATCH,
        "focus": focus.strip()[:300] or None, "hero_pool": pool, "games": ai_summary(games),
    }
    reply = _text_call(ai_key(db, user), SYSTEM, json.dumps(prompt, ensure_ascii=False, default=str))
    heroes = reply.get("heroes") if isinstance(reply.get("heroes"), dict) else {}
    out = {
        "headline": str(reply.get("headline") or "").strip()[:240],
        "summary": str(reply.get("summary") or "").strip()[:900],
        "strengths": _items(reply.get("strengths"), ("title", "detail"), 4),
        "fixes": _items(reply.get("fixes"), ("title", "detail", "drill"), 5),
        "heroes": {k: _items(heroes.get(k), ("hero", "why"), 4) for k in ("keep", "work_on", "try")},
        "next_games": [re.sub(r"\s+", " ", str(x)).strip()[:240] for x in (reply.get("next_games") or [])
                       if isinstance(x, (str, int, float)) and str(x).strip()][:6]
        if isinstance(reply.get("next_games"), list) else [],
        "games_used": len(games), "focus": focus.strip()[:300],
    }
    if not (out["headline"] or out["fixes"] or out["strengths"]):
        raise ReadError("The AI's coaching came back empty. Try again.", 502)
    return out
