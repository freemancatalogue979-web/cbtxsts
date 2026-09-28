"""Absolute Genesis AI core.

    AI orchestrator (orchestrator.run)
        ├── registry      — tool specs, permission checks, argument validation, audit
        ├── student_tools — the tutor's read tools + create_mini_exam
        ├── admin_tools   — staff read tools + propose_* (review before anything changes)
        └── proposals     — approve / reject staff proposals

The AI never gets database access: it asks for a tool, the backend checks who
is asking, validates the arguments, runs a scoped query and returns only what
that tool is meant to return. Provider calls go through ai_providers (DeepSeek
or Gemini) — nothing else in the app calls a model API directly.
"""

from . import admin_tools, student_tools  # noqa: F401  (registers the tools)
from .orchestrator import ADMIN_SYSTEM, STUDENT_AGENT_RULES, run  # noqa: F401
from .registry import OWNER, STAFF, STUDENT, ToolContext  # noqa: F401
