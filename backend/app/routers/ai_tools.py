"""AI helpers that fill forms for a person to check and save.

* POST /ai-tools/scoreboard — read a match screenshot into a game sheet
  (who played, each player's K/D/A, rating, gold, damage, MVP, the enemy
  scoreboard, result, duration and draft). Same permission as recording games.
* POST /ai-tools/strategy — write a strategy note from the team's records.
  Same permission as writing strategies.

Neither endpoint saves anything.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai_scoreboard import ReadError, read_scoreboard
from ..ai_strategy_writer import write_strategy
from ..deps import can, get_current_user, get_db, require

router = APIRouter(prefix="/ai-tools", tags=["ai-tools"])


class ScoreboardIn(BaseModel):
    image_url: str = Field(min_length=1, max_length=300)
    opponent: str = Field(default="", max_length=120)
    result: str = Field(default="", max_length=8)
    lineup: dict[str, int | str | None] = Field(default_factory=dict)
    draft: dict[str, Any] = Field(default_factory=dict)


class StrategyAIIn(BaseModel):
    topic: str = Field(default="", max_length=600)
    category: str = Field(default="", max_length=40)
    opponent: str = Field(default="", max_length=120)


@router.post("/scoreboard")
def scoreboard(payload: ScoreboardIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.upload_results(user) or can.manage_scrims(user), "read match screenshots")
    try:
        return read_scoreboard(db, user, image_url=payload.image_url, lineup=payload.lineup, draft=payload.draft,
                               opponent=payload.opponent, result=payload.result.upper())
    except ReadError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


@router.post("/strategy")
def strategy(payload: StrategyAIIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    require(can.manage_strategy(user), "write strategies")
    try:
        return write_strategy(db, user, topic=payload.topic, category=payload.category.upper(),
                              opponent=payload.opponent)
    except ReadError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
