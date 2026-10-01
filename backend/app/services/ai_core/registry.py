"""Tool registry — the only way the AI touches platform data.

    AI  ->  asks for a tool by name with JSON arguments
    registry.execute()
        1. the tool exists and this role may use it     (else: denied)
        2. arguments match the tool's JSON schema       (else: invalid)
        3. the handler runs with the caller's identity  (student / staff)
        4. the result is trimmed and every call is audited (AIToolCall)

Handlers never receive raw SQL or table names from the model — only validated,
typed arguments — and they scope every query to the caller themselves.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import Admin, AIToolCall, Student

log = logging.getLogger("arena.ai.tools")

MAX_RESULT_CHARS = 9000  # what one tool reply may add to the prompt

STUDENT = "student"
TEACHER = "teacher"
STAFF = "staff"
OWNER = "owner"
STAFF_ROLES = frozenset({STAFF, OWNER})


class ToolError(Exception):
    """Raised by handlers for expected problems (the model sees ``message``)."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class ToolContext:
    db: Session
    role: str
    request_id: str
    student: Student | None = None
    admin: Admin | None = None
    conversation_id: int | None = None
    course_hint: int | None = None
    policy: dict = field(default_factory=dict)
    # Things the app should render under the reply (mini exam cards, proposals…)
    actions: list[dict] = field(default_factory=list)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    handler: Callable[[ToolContext, dict], Any]
    roles: frozenset[str]
    label: str  # shown to the user while it runs: "Checking your weak topics"
    writes: bool = False

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


_TOOLS: dict[str, Tool] = {}


def tool(name: str, *, description: str, parameters: dict | None = None, roles: set[str] | frozenset[str], label: str, writes: bool = False):
    params = parameters or {"type": "object", "properties": {}}
    params.setdefault("type", "object")
    params.setdefault("properties", {})

    def register(fn: Callable[[ToolContext, dict], Any]):
        _TOOLS[name] = Tool(name=name, description=description, parameters=params, handler=fn, roles=frozenset(roles), label=label, writes=writes)
        return fn

    return register


def _allowed(tool: Tool, role: str) -> bool:
    # Teachers may use staff lookup/analysis tools, but never tools that write
    # platform data. Their generated lessons remain drafts until platform staff
    # publish them through normal review workflows.
    return role in tool.roles or (role == TEACHER and STAFF in tool.roles and not tool.writes)


def specs_for(role: str) -> list[dict]:
    return [t.spec() for t in _TOOLS.values() if _allowed(t, role)]


def label_for(name: str) -> str:
    t = _TOOLS.get(name)
    return t.label if t else "Working"


def names_for(role: str) -> list[str]:
    return [t.name for t in _TOOLS.values() if _allowed(t, role)]


# ------------------------------------------------------------- validation
class _Invalid(Exception):
    pass


def _coerce(value: Any, schema: dict, path: str) -> Any:
    kind = schema.get("type")
    if value is None:
        if schema.get("nullable"):
            return None
        raise _Invalid(f"{path} is required")
    if kind == "string":
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            value = str(value)
        if not isinstance(value, str):
            raise _Invalid(f"{path} must be text")
        value = value.strip()
        if "enum" in schema and value not in schema["enum"]:
            raise _Invalid(f"{path} must be one of {', '.join(schema['enum'])}")
        limit = schema.get("maxLength", 4000)
        return value[:limit]
    if kind in {"integer", "number"}:
        if isinstance(value, bool):
            raise _Invalid(f"{path} must be a number")
        try:
            value = int(value) if kind == "integer" else float(value)
        except (TypeError, ValueError):
            raise _Invalid(f"{path} must be a number") from None
        if "minimum" in schema and value < schema["minimum"]:
            value = schema["minimum"]
        if "maximum" in schema and value > schema["maximum"]:
            value = schema["maximum"]
        return value
    if kind == "boolean":
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes"}
        return bool(value)
    if kind == "array":
        if not isinstance(value, list):
            value = [value]
        limit = schema.get("maxItems", 100)
        items = schema.get("items") or {}
        return [_coerce(v, items, f"{path}[{i}]") for i, v in enumerate(value[:limit]) if v is not None]
    if kind == "object":
        if not isinstance(value, dict):
            raise _Invalid(f"{path} must be an object")
        props = schema.get("properties") or {}
        out = {}
        for key in schema.get("required") or []:
            if value.get(key) in (None, ""):
                raise _Invalid(f"{path}.{key} is required" if path else f"{key} is required")
        for key, sub in props.items():
            if key in value and value[key] is not None and value[key] != "":
                out[key] = _coerce(value[key], sub, f"{path}.{key}" if path else key)
        return out  # unknown keys are dropped, never passed through
    return value


def validate(tool_: Tool, raw: Any) -> dict:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except json.JSONDecodeError:
            raise _Invalid("arguments were not valid JSON") from None
    return _coerce(raw or {}, tool_.parameters, "")


# -------------------------------------------------------------- execution
def _trim(result: Any) -> str:
    text = json.dumps(result, default=str, ensure_ascii=False)
    if len(text) <= MAX_RESULT_CHARS:
        return text
    return json.dumps({"truncated": True, "partial": text[:MAX_RESULT_CHARS]}, ensure_ascii=False)


def _summary(result: Any) -> str:
    if isinstance(result, dict):
        if "summary" in result and isinstance(result["summary"], str):
            return result["summary"][:300]
        keys = [k for k, v in result.items() if isinstance(v, list)]
        if keys:
            return ", ".join(f"{len(result[k])} {k}" for k in keys[:3])[:300]
    return ""


def execute(ctx: ToolContext, name: str, raw_args: Any) -> tuple[str, dict]:
    """Run one tool call. Returns (json text for the model, audit info for the UI)."""
    started = time.monotonic()
    t = _TOOLS.get(name)
    args: dict = {}
    status, summary = "ok", ""
    try:
        if t is None:
            status = "invalid"
            result: Any = {"error": f"Unknown tool '{name}'."}
        elif not _allowed(t, ctx.role):
            status = "denied"
            result = {"error": "You are not allowed to use this tool."}
        else:
            args = validate(t, raw_args)
            result = t.handler(ctx, args)
            summary = _summary(result)
    except _Invalid as error:
        status, result = "invalid", {"error": f"Invalid arguments: {error}"}
    except ToolError as error:
        status, result = "error", {"error": error.message}
        summary = error.message[:300]
    except Exception:  # noqa: BLE001 — never crash the conversation over one tool
        log.exception("tool %s crashed", name)
        ctx.db.rollback()
        status, result = "error", {"error": "That lookup failed on the server."}
    latency = int((time.monotonic() - started) * 1000)
    try:
        ctx.db.add(AIToolCall(
            request_id=ctx.request_id, actor_role=ctx.role, student_id=ctx.student.id if ctx.student else None,
            admin_id=ctx.admin.id if ctx.admin else None, tool=name[:60], arguments=args, status=status,
            summary=summary, latency_ms=latency,
        ))
        ctx.db.flush()
    except Exception:  # noqa: BLE001
        log.exception("could not audit tool call")
    return _trim(result), {"name": name, "label": label_for(name), "status": status, "summary": summary, "ms": latency}
