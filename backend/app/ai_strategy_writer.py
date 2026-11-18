"""Write a strategy note from the team's own records.

The AI gets a compact, factual picture of 9 Clover — scrim and tournament
records, the history against the chosen opponent (results, drafts), each
player's form, best heroes and heroes to work on, and comfort pools — and
returns a note in the Strategy page's shape. Nothing is saved: the note fills
the Strategy form, a coach/captain/admin edits it and presses Save.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .ai_scoreboard import ReadError, ai_key
from .config import CURRENT_PATCH
from .esports_ai import ENDPOINT, MODEL, _NoRedirect
from .models import STRATEGY_CATEGORIES, HeroPoolEntry, Scrim, StrategyNote, TournamentMatch, User, loads
from .performance import appearances, hero_rows, player_performance

SYSTEM = """You are 9 Clover's Mobile Legends: Bang Bang coach writing a strategy note for the team's playbook.

Use the supplied team records: name the actual players and heroes, use their real records, and build the plan around the team's strengths and the heroes that are working. Be direct and specific — a coach's instructions, not a hedged essay.

Return one JSON object:
{
  "title": "short, specific title",
  "category": one of the allowed categories,
  "opponent": "opponent name or empty",
  "tags": ["3-6 short tags"],
  "body": "the note in Markdown"
}

The body must include these sections (Markdown headings):
## Win condition — what wins this game for us and why, in two or three sentences.
## Draft — priority picks and bans for us with the players who play them, flex options, what to deny.
## Early game (0–5 min) — lanes, jungle path, first rotations, first turtle.
## Mid game (5–12 min) — objectives, vision, where to group, who initiates.
## Late game (12+) — lord setups, split pressure, the teamfight call.
## Player jobs — one line per player: their hero options and their job.
## Drills before the next scrim — 3 concrete drills, tied to the heroes/players that need work.

Keep it under about 700 words. Return only the JSON object."""


def _compact_summary(s: dict) -> dict:
    out = {"games": s["games"], "wins": s["wins"], "losses": s["losses"], "win_rate": s["win_rate"]}
    if s.get("kda"):
        out["kda"] = s["kda"]["ratio"]
    if s.get("rating") and s["rating"].get("avg") is not None:
        out["avg_rating"] = s["rating"]["avg"]
    return out


def team_context(db: Session, opponent: str = "") -> dict:
    """Facts the writer (and the chat AI) can rely on — all from recorded games."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played").order_by(Scrim.scrim_date.desc())).all()
    apps = appearances(db)
    players = []
    roster = db.scalars(select(User).where(User.roster.is_(True), User.active.is_(True))).all()
    for u in roster:
        perf = player_performance(db, u.id)
        pool = db.scalars(select(HeroPoolEntry).where(HeroPoolEntry.user_id == u.id)).all()
        players.append({
            "name": u.ign or u.name,
            "main_lane": u.main_role or perf["overall"]["main_lane"],
            "all_games": _compact_summary(perf["overall"]),
            "scrims": _compact_summary(perf["scrims"]),
            "tournaments": _compact_summary(perf["tournaments"]),
            "best_heroes": [{"hero": h["hero"], "games": h["games"], "win_rate": h["win_rate"],
                             **({"kda": h["kda"]["ratio"]} if h["kda"] else {})} for h in perf["heroes"][:4]],
            "comfort_pool": [e.hero.name for e in pool if e.category == "comfort" and e.hero][:5],
            "heroes_to_work_on": [a["title"] for a in perf["focus"] if a["tone"] != "good"][:3],
        })
    games = [g for s in played for g in s.games]
    ctx: dict = {
        "team": "9 Clover",
        "patch": CURRENT_PATCH,
        "scrim_record": {"series": len(played), "series_wins": sum(1 for s in played if s.result == "WIN"),
                         "series_losses": sum(1 for s in played if s.result == "LOSS"),
                         "games": len(games), "game_wins": sum(1 for g in games if g.result == "WIN"),
                         "game_losses": sum(1 for g in games if g.result == "LOSS")},
        "recent_scrims": [{"date": s.scrim_date.isoformat() if s.scrim_date else None, "opponent": s.opponent,
                           "result": s.result, "score": f"{s.score_us}-{s.score_them}"} for s in played[:8]],
        "players": players,
        "team_most_played_heroes": [{"hero": h["hero"], "games": h["games"], "win_rate": h["win_rate"]}
                                    for h in hero_rows(apps)[:12]],
    }
    if opponent.strip():
        key = opponent.strip().casefold()
        history = []
        for s in played:
            if s.opponent.strip().casefold() != key:
                continue
            for g in s.games:
                d = loads(g.draft or "{}", {})
                history.append({"source": "scrim", "date": s.scrim_date.isoformat() if s.scrim_date else None,
                                "game": g.game_no, "result": g.result, "our_picks": d.get("our_picks") or {},
                                "their_picks": d.get("enemy_picks") or {}, "their_bans": [b for b in d.get("enemy_bans") or [] if b]})
        from .routers.tournaments import implied_result, match_games

        for m in db.scalars(select(TournamentMatch).where(func.lower(TournamentMatch.opponent) == key)).all():
            for g in match_games(m):
                history.append({"source": "tournament", "date": m.scheduled_date.isoformat() if m.scheduled_date else None,
                                "game": g["game_no"], "result": implied_result(m, g),
                                "our_picks": g["draft"].get("our_picks") or {}, "their_picks": g["draft"].get("enemy_picks") or {},
                                "their_bans": [b for b in g["draft"].get("enemy_bans") or [] if b]})
        ctx["against_opponent"] = {"opponent": opponent.strip()[:120], "games": history[:20],
                                   "wins": sum(h["result"] == "WIN" for h in history),
                                   "losses": sum(h["result"] == "LOSS" for h in history)}
    ctx["existing_strategy_titles"] = [t for (t,) in db.execute(
        select(StrategyNote.title).order_by(StrategyNote.updated_at.desc()).limit(15)).all()]
    return ctx


def call_model(api_key: str, system: str, text: str) -> dict:
    """One JSON chat request. Tests replace this."""
    body = {"model": MODEL, "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}],
            "thinking": {"type": "disabled"}, "temperature": 0.5, "max_tokens": 4000,
            "response_format": {"type": "json_object"}}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=90) as resp:
            raw = resp.read(400_001)
        parsed = json.loads(json.loads(raw)["choices"][0]["message"]["content"])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ReadError("The AI service didn't answer. Try again in a minute.", 502) from exc
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ReadError("The AI's note came back garbled. Try again.", 502) from exc
    if not isinstance(parsed, dict):
        raise ReadError("The AI's note came back garbled. Try again.", 502)
    return parsed


MAX_DOC_CHARS = 14000


def document_text(url: str) -> tuple[str, str]:
    """An uploaded PDF / Word / text / sheet → (file name, its text) to write the note from."""
    from .ai_game_import import docx_text, pdf_text, resolve, rows_text, sheet_rows, _decode
    path, name, ext = resolve(url)
    if ext in ("png", "jpg", "jpeg", "webp", "gif"):
        raise ReadError("For a strategy, upload a document (PDF, Word, text) or a spreadsheet — not a picture.")
    if ext == "pdf":
        text = pdf_text(path)
    elif ext == "docx":
        text = docx_text(path)
    elif ext in ("csv", "tsv", "xlsx"):
        text = rows_text(sheet_rows(path, ext))
    else:
        text = _decode(path.read_bytes())
    text = text.strip()
    if len(text) < 20:
        raise ReadError("That document looks empty. Upload one with some text in it.")
    return name, text[:MAX_DOC_CHARS]


def write_strategy(db: Session, user: User, *, topic: str, category: str = "", opponent: str = "",
                   document_url: str = "") -> dict:
    topic = topic.strip()[:600]
    doc = document_text(document_url) if document_url.strip() else None
    if not topic and not opponent.strip() and not doc:
        raise ReadError("Say what the strategy is about (or pick an opponent).")
    api_key = ai_key(db, user)
    request = {
        "topic": topic or (f"Game plan against {opponent.strip()}" if opponent.strip()
                           else "Turn the attached document into a playbook note"),
        "wanted_category": category if category in STRATEGY_CATEGORIES else "",
        "allowed_categories": STRATEGY_CATEGORIES,
        "team_records": team_context(db, opponent),
    }
    if doc:
        request["reference_document"] = {
            "file": doc[0], "text": doc[1],
            "how_to_use": "The staff's own notes/plan. Build the note from it, backed by team_records where they agree.",
        }
    raw = call_model(api_key, SYSTEM, json.dumps(request, ensure_ascii=False))
    title = str(raw.get("title") or "").strip()[:160]
    body = str(raw.get("body") or "").strip()[:12000]
    if not title or not body:
        raise ReadError("The AI's note came back empty. Try again with a clearer topic.", 502)
    cat = str(raw.get("category") or "").strip().upper()
    if category in STRATEGY_CATEGORIES:
        cat = category
    tags = [str(t).strip().lstrip("#")[:40] for t in (raw.get("tags") or []) if str(t).strip()][:8] \
        if isinstance(raw.get("tags"), list) else []
    return {
        "title": title,
        "category": cat if cat in STRATEGY_CATEGORIES else "GENERAL",
        "body": body,
        "tags": tags,
        "opponent": (opponent.strip() or str(raw.get("opponent") or "").strip())[:120],
        "patch": CURRENT_PATCH,
    }
