"""Home dashboard: training block, next activity, results, team performance."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import (
    Event,
    MatchReview,
    Scrim,
    ScrimGame,
    TeamSettings,
    TrainingActivity,
    TrainingWeek,
    loads,
)
from ..serializers import activity_out, event_out, scrim_out, settings_out, week_out

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def team_performance(db: Session, limit_games: int = 15) -> dict:
    """Aggregate the most recent scrim games into the dashboard metric sheet."""
    played = db.scalars(select(Scrim).where(Scrim.status == "played")).all()
    series_won = sum(1 for s in played if s.result == "WIN")
    series_lost = len(played) - series_won

    games = db.scalars(
        select(ScrimGame).join(Scrim, ScrimGame.scrim_id == Scrim.id)
        .where(Scrim.status == "played")
        .order_by(ScrimGame.id.desc())
        .limit(limit_games)
    ).all()
    if not games:
        return {"games_analyzed": 0}
    n = len(games)
    wins = turtles_first = lord_games = lord_converted = 0
    tf_won = tf_total = 0
    dur = 0.0
    gd10 = k10 = d10 = 0.0
    obj_us = obj_total = 0
    for g in games:
        st = loads(g.stats, {})
        wins += 1 if g.result == "WIN" else 0
        dur += g.duration_min or 0
        gd10 += float(st.get("gold_diff_10") or 0)
        k10 += float(st.get("kills_10") or 0)
        d10 += float(st.get("deaths_10") or 0)
        tf_won += int(st.get("teamfights_won") or 0)
        tf_total += int(st.get("teamfights_total") or 0)
        us_obj = int(st.get("turtles") or 0) + int(st.get("lords") or 0)
        them_obj = int(st.get("enemy_turtles") or 0) + int(st.get("enemy_lords") or 0)
        obj_us += us_obj
        obj_total += us_obj + them_obj
        first_turtle = st.get("first_turtle")
        if first_turtle is None:  # heuristic fall-back for legacy rows
            first_turtle = us_obj > 0 and int(st.get("turtles") or 0) >= int(st.get("enemy_turtles") or 0)
        turtles_first += 1 if first_turtle else 0
        if int(st.get("lords") or 0) > 0:
            lord_games += 1
            lord_converted += 1 if g.result == "WIN" else 0
    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0
    return {
        "games_analyzed": n,
        "win_rate": pct(wins, n),
        "objective_control": pct(obj_us, obj_total),
        "first_turtle_rate": pct(turtles_first, n),
        "lord_conversion": pct(lord_converted, lord_games) if lord_games else None,
        "teamfight_success": pct(tf_won, tf_total),
        "avg_game_time_min": round(dur / n, 1),
        "gold_diff_10": round(gd10 / n),
        "kills_10": round(k10 / n, 1),
        "deaths_10": round(d10 / n, 1),
        "record": {"series_won": series_won, "series_lost": series_lost,
                   "games_won": wins, "games_lost": n - wins},
    }


def pending_reviews(db: Session) -> list[Scrim]:
    played_losses = db.scalars(
        select(Scrim).where(Scrim.status == "played", Scrim.result == "LOSS")
        .order_by(Scrim.scrim_date.desc())
    ).all()
    return [s for s in played_losses if s.review is None]


def open_action_items(db: Session) -> int:
    reviews = db.scalars(
        select(MatchReview).where(MatchReview.status.in_(["open", "in_progress"]))
    ).all()
    return sum(1 for r in reviews if r.action_item)


@router.get("")
def dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()

    week = db.scalar(select(TrainingWeek).where(TrainingWeek.status == "active").limit(1))
    if week is None:
        week = db.scalar(
            select(TrainingWeek).where(TrainingWeek.start_date >= today).order_by(TrainingWeek.start_date).limit(1)
        )

    next_activity = db.scalar(
        select(TrainingActivity)
        .where(TrainingActivity.status == "scheduled", TrainingActivity.activity_date >= today)
        .order_by(TrainingActivity.activity_date, TrainingActivity.start_time)
        .limit(5)
    )

    upcoming_events = db.scalars(
        select(Event).where(Event.event_date >= today).order_by(Event.event_date, Event.start_time).limit(6)
    ).all()

    recent_results = db.scalars(
        select(Scrim).where(Scrim.status == "played").order_by(Scrim.scrim_date.desc(), Scrim.number.desc()).limit(5)
    ).all()

    settings = db.get(TeamSettings, 1)
    weakness = None
    if settings and settings.current_weakness:
        if week is not None:
            done_drills = [
                a for a in week.activities
                if a.status == "done" and a.category.upper() == settings.weakness_category.upper()
            ]
        else:
            done_drills = []
        remaining = max(settings.weakness_drills_target - len(done_drills), 0)
        weakness = {
            **settings_out(settings),
            "drills_done": len(done_drills),
            "drills_remaining": remaining,
        }

    next_scrim = db.scalar(
        select(Scrim).where(Scrim.status == "scheduled", Scrim.scrim_date >= today)
        .order_by(Scrim.scrim_date, Scrim.start_time).limit(1)
    )

    return {
        "team": {"name": "9 CLOVER", "tagline": "PLAY. REVIEW. ADAPT. DOMINATE."},
        "current_week": week_out(week) if week else None,
        "next_activity": activity_out(next_activity) if next_activity else None,
        "next_scrim": scrim_out(next_scrim, with_games=False) if next_scrim else None,
        "upcoming_events": [event_out(e) for e in upcoming_events],
        "recent_results": [scrim_out(s, with_games=False) for s in recent_results],
        "performance": team_performance(db),
        "weakness": weakness,
        "mandatory_reviews": [scrim_out(s, with_games=False) for s in pending_reviews(db)],
        "open_action_items": open_action_items(db),
    }
