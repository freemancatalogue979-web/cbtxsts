"""Strict, bounded inputs for manually reviewed platform reference records."""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
PatchLabel = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]


class EquipmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ShortName
    category: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] = ""
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)]
    patch: PatchLabel = ""
    source_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2048)] = ""

    @field_validator("source_url")
    @classmethod
    def safe_url(cls, value: str) -> str:
        if value:
            from .clover_ai_service import safe_source_url

            return safe_source_url(value)
        return ""

    @field_validator("patch")
    @classmethod
    def valid_patch(cls, value: str) -> str:
        if value and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+ _-]{0,19}", value):
            raise ValueError("Invalid patch label.")
        return value


class EquipmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ShortName | None = None
    category: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)] | None = None
    patch: PatchLabel | None = None
    source_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2048)] | None = None
