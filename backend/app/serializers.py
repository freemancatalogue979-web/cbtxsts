"""Model → JSON-serializable dicts (JSON text columns are parsed)."""
from __future__ import annotations

from datetime import date as _date

from .config import AVATAR_DIR
from .models import (
    BanEntry,
    DevelopmentEntry,
    DraftPlan,
    Event,
    Hero,
    HeroPoolEntry,
    MapBoard,
    MatchReview,
    Scrim,
    ScrimGame,
    StrategyNote,
    TeamSettings,
    TrainingActivity,
    TrainingWeek,
    User,
    loads,
)
from .security import ROLE_LABELS


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "ign": u.ign,
        "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role.title()),
        "main_role": u.main_role,
        "bio": u.bio,
        "active": u.active,
        "roster": u.roster,
        "avatar": avatar_url(u.id),
    }


def user_brief(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"id": u.id, "name": u.name, "ign": u.ign, "main_role": u.main_role, "role": u.role}


def hero_out(h: Hero) -> dict:
    return {
        "id": h.id,
        "name": h.name,
        "role": h.role,
        "hero_class": h.hero_class,
        "difficulty": h.difficulty,
        "meta_status": h.meta_status,
        "tier": h.tier,
        "patch": h.patch,
        "win_rate": h.win_rate,
        "pick_rate": h.pick_rate,
        "ban_rate": h.ban_rate,
        "clover_rating": h.clover_rating,
        "notes": h.notes,
        "strong_against": loads(h.strong_against),
        "weak_against": loads(h.weak_against),
        "synergy": loads(h.synergy),
    }


def pool_out(entry: HeroPoolEntry) -> dict:
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "hero_id": entry.hero_id,
        "hero_name": entry.hero.name if entry.hero else "",
        "hero_role": entry.hero.role if entry.hero else "",
        "hero_status": entry.hero.meta_status if entry.hero else "",
        "category": entry.category,
        "confidence": entry.confidence,
        "last_played": entry.last_played.isoformat() if entry.last_played else None,
        "games": entry.games,
        "wins": entry.wins,
        "losses": entry.losses,
        "win_rate": round(100 * entry.wins / entry.games, 1) if entry.games else None,
        "coach_notes": entry.coach_notes,
    }


def week_out(w: TrainingWeek, *, with_activities: bool = False) -> dict:
    acts = w.activities or []
    done = sum(1 for a in acts if a.status == "done")
    counted = [a for a in acts if a.status != "cancelled"]
    progress = round(100 * done / len(counted)) if counted else 0
    data = {
        "id": w.id,
        "number": w.number,
        "focus": w.focus,
        "objective": w.objective,
        "performance_target": w.performance_target,
        "notes": w.notes,
        "start_date": w.start_date.isoformat() if w.start_date else None,
        "end_date": w.end_date.isoformat() if w.end_date else None,
        "status": w.status,
        "weakness_text": w.weakness_text,
        "weakness_drills_target": w.weakness_drills_target,
        "progress": progress,
        "activity_counts": {
            "total": len(counted),
            "done": done,
            "scheduled": sum(1 for a in acts if a.status == "scheduled"),
        },
    }
    if with_activities:
        data["activities"] = [
            activity_out(a)
            for a in sorted(acts, key=lambda a: (a.activity_date or _date.max, a.start_time))
        ]
    return data


def activity_out(a: TrainingActivity) -> dict:
    return {
        "id": a.id,
        "week_id": a.week_id,
        "week_number": a.week.number if a.week else None,
        "title": a.title,
        "description": a.description,
        "category": a.category,
        "date": a.activity_date.isoformat() if a.activity_date else None,
        "time": a.start_time,
        "duration_min": a.duration_min,
        "coach_name": a.coach_name,
        "assigned_player_ids": loads(a.assigned_player_ids),
        "required": a.required,
        "status": a.status,
        "notes": a.notes,
        "attachments": loads(a.attachments),
        "result": a.result,
        "score": a.score,
        "lessons": a.lessons,
        "scrim_id": a.scrim_id,
    }


def game_out(g: ScrimGame) -> dict:
    return {
        "id": g.id,
        "scrim_id": g.scrim_id,
        "game_no": g.game_no,
        "result": g.result,
        "duration_min": g.duration_min,
        "stats": loads(g.stats, {}),
        "draft": loads(g.draft, {}),
    }


def scrim_out(s: Scrim, *, with_games: bool = True) -> dict:
    return {
        "id": s.id,
        "number": s.number,
        "opponent": s.opponent,
        "date": s.scrim_date.isoformat() if s.scrim_date else None,
        "time": s.start_time,
        "format": s.format,
        "server": s.server,
        "tournament_prep": s.tournament_prep,
        "lineup": loads(s.lineup, {}),
        "substitutes": loads(s.substitutes),
        "notes": s.notes,
        "expected_strategy": s.expected_strategy,
        "status": s.status,
        "result": s.result or None,
        "score_us": s.score_us,
        "score_them": s.score_them,
        "attachments": loads(s.attachments),
        "has_review": s.review is not None,
        "review_status": s.review.status if s.review else None,
        "needs_review": bool(s.status == "played" and s.result == "LOSS" and s.review is None),
        "games": [game_out(g) for g in s.games] if with_games else [],
        "created_by": s.created_by,
    }


def review_out(r: MatchReview) -> dict:
    return {
        "id": r.id,
        "scrim_id": r.scrim_id,
        "scrim_number": r.scrim.number if r.scrim else None,
        "opponent": r.opponent,
        "date": r.review_date.isoformat() if r.review_date else None,
        "duration_min": r.duration_min,
        "result": r.result,
        "player_ids": loads(r.player_ids),
        "stats": loads(r.stats, {}),
        "draft": loads(r.draft, {}),
        "biggest_mistakes": loads(r.biggest_mistakes),
        "why_happened": r.why_happened,
        "should_have_done": r.should_have_done,
        "who_involved": r.who_involved,
        "what_change": r.what_change,
        "lesson": r.lesson,
        "action_item": r.action_item,
        "action_assignee_id": r.action_assignee_id,
        "action_deadline": r.action_deadline.isoformat() if r.action_deadline else None,
        "status": r.status,
        "mandatory": r.mandatory,
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def ban_out(b: BanEntry) -> dict:
    return {
        "id": b.id,
        "scope": b.scope,
        "priority": b.priority,
        "opponent": b.opponent,
        "patch": b.patch,
        "hero_id": b.hero_id,
        "hero_name": b.hero_name,
        "reason": b.reason,
        "active": b.active,
    }


def event_out(e: Event) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "kind": e.kind,
        "date": e.event_date.isoformat() if e.event_date else None,
        "time": e.start_time,
        "end_time": e.end_time,
        "location": e.location,
        "description": e.description,
        "link": e.link,
        "scrim_id": e.scrim_id,
    }


def strategy_out(n: StrategyNote) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "category": n.category,
        "body": n.body,
        "tags": loads(n.tags),
        "opponent": n.opponent,
        "patch": n.patch,
        "pinned": n.pinned,
        "author_id": n.author_id,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def draft_out(d: DraftPlan) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "opponent": d.opponent,
        "patch": d.patch,
        "notes": d.notes,
        "draft": loads(d.draft, {}),
        "status": d.status,
        "created_by": d.created_by,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def dev_out(e: DevelopmentEntry, users: dict[int, str] | None = None) -> dict:
    return {
        "id": e.id,
        "user_id": e.user_id,
        "date": e.entry_date.isoformat() if e.entry_date else None,
        "source": e.source,
        "category": e.category,
        "rating": e.rating,
        "notes": e.notes,
        "created_by": e.created_by,
        "created_by_name": (users or {}).get(e.created_by) if e.created_by else None,
    }


def settings_out(s: TeamSettings) -> dict:
    return {
        "current_weakness": s.current_weakness,
        "weakness_category": s.weakness_category,
        "weakness_drills_target": s.weakness_drills_target,
        "season_name": s.season_name,
    }


def avatar_url(user_id: int) -> str | None:
    p = AVATAR_DIR / f"{user_id}.png"
    if p.exists():
        return f"/api/users/{user_id}/avatar?v={int(p.stat().st_mtime)}"
    return None


def board_out(b: MapBoard) -> dict:
    return {
        "id": b.id,
        "name": b.name,
        "kind": b.kind,
        "opponent": b.opponent,
        "draft_id": b.draft_id,
        "data": loads(b.data),
        "notes": b.notes,
        "author_id": b.author_id,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }
