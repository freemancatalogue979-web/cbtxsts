"""Exam integrity: device lock, screen-leave log and a staff-facing summary.

Principles
----------
* **Record, don't punish.** Nothing here fails a paper. Staff see a calm summary
  ("left the exam screen 4×, 1m 50s away") and decide. Phones get calls, apps
  pop up, networks drop — an honest student must never lose an exam to a
  heuristic.
* **One device holds the paper.** The browser sends a random per-device id in
  the ``X-Arena-Device`` header. The first device to open an attempt holds it.
  A different device gets a clear "continue here?" choice (a dead phone must not
  end an exam); taking over is logged and the old device is locked out.
* **Bounded, sanitised input.** Client events are untrusted: types come from a
  fixed list, durations are clamped, and the stored log is capped.
"""
from __future__ import annotations

import re
from typing import Any

from ..models import Attempt, utcnow

DEVICE_HEADER = "X-Arena-Device"
_DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

# Types a client may report. ``away`` = the exam page was hidden / lost focus
# (seconds = how long); ``offline`` = connection lost (seconds = how long);
# ``paste`` / ``copy`` = clipboard use on the exam page; ``fullscreen_exit``.
CLIENT_EVENT_TYPES = {"away", "offline", "copy", "paste", "fullscreen_exit"}
MAX_EVENTS_STORED = 300
MAX_EVENT_SECONDS = 6 * 3600

# Review thresholds (tuned to stay quiet for normal phone use).
REVIEW_FOCUS_LOST = 3
REVIEW_AWAY_SECONDS = 60
HIGH_FOCUS_LOST = 8
HIGH_AWAY_SECONDS = 300


class DeviceConflict(Exception):
    """The attempt is held by another device and no takeover was requested."""


def clean_device_id(raw: str | None) -> str | None:
    value = (raw or "").strip()
    return value if _DEVICE_RE.match(value) else None


def _log(attempt: Attempt) -> dict[str, Any]:
    data = dict(attempt.integrity or {})
    data.setdefault("events", [])
    data.setdefault("focus_lost", 0)
    data.setdefault("away_seconds", 0)
    data.setdefault("offline_seconds", 0)
    data.setdefault("offline_spells", 0)
    data.setdefault("device_switches", 0)
    data.setdefault("clipboard", 0)
    data.setdefault("fullscreen_exits", 0)
    return data


def _append(data: dict[str, Any], event: dict[str, Any]) -> None:
    events = list(data.get("events") or [])
    events.append(event)
    data["events"] = events[-MAX_EVENTS_STORED:]


def check_device(attempt: Attempt, device_id: str | None, *, takeover: bool = False) -> bool:
    """Bind the attempt to a device; returns True when a takeover happened.

    Requests without a (valid) device id are allowed — older clients and API
    scripts — but they never displace a device that holds the paper.
    """
    device = clean_device_id(device_id)
    if device is None or attempt.status != "in_progress":
        return False
    if not attempt.device_id:
        attempt.device_id = device
        return False
    if attempt.device_id == device:
        return False
    if not takeover:
        raise DeviceConflict()
    data = _log(attempt)
    data["device_switches"] = int(data["device_switches"]) + 1
    _append(data, {"type": "device_switch", "at": utcnow().isoformat(), "from": attempt.device_id[:6], "to": device[:6]})
    attempt.integrity = data
    attempt.device_id = device
    return True


def record_client_events(attempt: Attempt, events: list[dict[str, Any]] | None) -> int:
    """Store sanitised client events; returns how many were kept."""
    if not events:
        return 0
    data = _log(attempt)
    kept = 0
    now = utcnow().isoformat()
    for raw in events[:100]:
        kind = str(raw.get("type") or "").strip()
        if kind not in CLIENT_EVENT_TYPES:
            continue
        try:
            seconds = int(round(float(raw.get("seconds") or 0)))
        except (TypeError, ValueError):
            seconds = 0
        seconds = max(0, min(MAX_EVENT_SECONDS, seconds))
        # Question index is display-only context for staff; clamp it.
        try:
            question = int(raw.get("question") or 0)
        except (TypeError, ValueError):
            question = 0
        question = max(0, min(10_000, question))
        if kind == "away":
            if seconds < 1:
                continue  # a flicker (notification shade, rotation) is not a leave
            data["focus_lost"] = int(data["focus_lost"]) + 1
            data["away_seconds"] = int(data["away_seconds"]) + seconds
        elif kind == "offline":
            data["offline_spells"] = int(data["offline_spells"]) + 1
            data["offline_seconds"] = int(data["offline_seconds"]) + seconds
        elif kind in {"copy", "paste"}:
            data["clipboard"] = int(data["clipboard"]) + 1
        elif kind == "fullscreen_exit":
            data["fullscreen_exits"] = int(data["fullscreen_exits"]) + 1
        _append(data, {"type": kind, "at": now, "seconds": seconds, **({"question": question} if question else {})})
        kept += 1
    if kept:
        attempt.integrity = data
    return kept


def summary(attempt: Attempt) -> dict[str, Any]:
    """Staff-facing digest with a calm three-level signal."""
    data = _log(attempt)
    focus = int(data["focus_lost"])
    away = int(data["away_seconds"])
    switches = int(data["device_switches"])
    level = "clean"
    reasons: list[str] = []
    if focus >= REVIEW_FOCUS_LOST:
        reasons.append(f"left the exam screen {focus}×")
    if away >= REVIEW_AWAY_SECONDS:
        reasons.append(f"{away // 60}m {away % 60}s away from the exam")
    if switches:
        reasons.append(f"moved to another device {switches}×")
    if int(data["clipboard"]):
        reasons.append(f"used copy/paste {int(data['clipboard'])}×")
    if reasons:
        level = "review"
    if focus >= HIGH_FOCUS_LOST or away >= HIGH_AWAY_SECONDS or switches >= 2:
        level = "high"
    return {
        "level": level,
        "reasons": reasons,
        "focus_lost": focus,
        "away_seconds": away,
        "offline_spells": int(data["offline_spells"]),
        "offline_seconds": int(data["offline_seconds"]),
        "device_switches": switches,
        "clipboard": int(data["clipboard"]),
        "fullscreen_exits": int(data["fullscreen_exits"]),
    }


def timeline(attempt: Attempt) -> list[dict[str, Any]]:
    return list(_log(attempt)["events"])
