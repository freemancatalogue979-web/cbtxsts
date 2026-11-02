"""Presentation helpers for keeping the underlying AI provider out of member UI.

This is branding/privacy at the application boundary, not protection against
someone with access to source code, server configuration, logs or backups.
"""

from __future__ import annotations

import re

_PROVIDER_NAME = re.compile(r"\bdeep[\s_-]*seek(?:[\s_-]+(?:chat|reasoner|flash|v\d[\w.\-]*))?\b", re.IGNORECASE)


def public_ai_text(value: str) -> str:
    """Remove provider/model branding from provider-authored messages and errors."""
    return _PROVIDER_NAME.sub("9 Clover AI", value) if isinstance(value, str) else ""


def public_ai_mode(value: str) -> str:
    # Historic messages keep their original DB value; normalize API output.
    return "ai" if value in {"deepseek", "ai"} else value
