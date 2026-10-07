"""Static reference data the UI needs to build forms."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import CURRENT_PATCH, TEAM_NAME, TEAM_TAGLINE
from ..models import ACTIVITY_CATEGORIES, ACTIVITY_STATUSES, EVENT_KINDS, STRATEGY_CATEGORIES
from ..security import LANES, ROLE_LABELS

router = APIRouter(prefix="/meta", tags=["meta"])

HERO_STATUSES = ["META", "STRONG", "VIABLE", "SITUATIONAL", "WEAK", "BANNED/RESTRICTED"]
HERO_TIERS = ["S", "A", "B", "C", "D"]
POOL_CATEGORIES = ["comfort", "meta", "pocket", "emergency"]
REVIEW_STATUSES = ["open", "in_progress", "resolved"]
SCRIM_FORMATS = ["BO1", "BO3", "BO5"]
DRAFT_STATUSES = ["idea", "testing", "approved", "archived"]


@router.get("")
def meta():
    return {
        "team_name": TEAM_NAME,
        "team_tagline": TEAM_TAGLINE,
        "season_patch": CURRENT_PATCH,
        "lanes": LANES,
        "roles": ROLE_LABELS,
        "activity_categories": ACTIVITY_CATEGORIES,
        "activity_statuses": ACTIVITY_STATUSES,
        "hero_statuses": HERO_STATUSES,
        "hero_tiers": HERO_TIERS,
        "pool_categories": POOL_CATEGORIES,
        "review_statuses": REVIEW_STATUSES,
        "scrim_formats": SCRIM_FORMATS,
        "draft_statuses": DRAFT_STATUSES,
        "strategy_categories": STRATEGY_CATEGORIES,
        "event_kinds": EVENT_KINDS,
        "dev_categories": ["GENERAL", "MECHANICS", "MACRO", "MICRO", "MENTAL", "LANE",
                           "OBJECTIVE", "TEAMFIGHT", "SHOTCALLING", "HERO POOL", "POSITIONING"],
    }
