"""Event objects emitted by sync services, dispatched by async routers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Scope = Literal["room", "student", "admins", "global"]


@dataclass(slots=True)
class Event:
    event: str
    data: dict[str, Any] = field(default_factory=dict)
    scope: Scope = "global"
    room: str = "live"
    student_id: int | None = None


def to_room(room: str, event: str, data: dict[str, Any]) -> Event:
    return Event(event=event, data=data, scope="room", room=room)


def to_student(student_id: int, event: str, data: dict[str, Any]) -> Event:
    return Event(event=event, data=data, scope="student", student_id=student_id)


def to_admins(event: str, data: dict[str, Any]) -> Event:
    return Event(event=event, data=data, scope="admins")


def to_everyone(event: str, data: dict[str, Any]) -> Event:
    return Event(event=event, data=data, scope="global")


async def dispatch(events: list[Event]) -> None:
    """Push queued service events out over the websocket hub."""
    from .ws import hub

    for event in events:
        if event.scope == "room":
            await hub.broadcast(event.event, event.data, room=event.room)
        elif event.scope == "student" and event.student_id is not None:
            await hub.send_to_student(event.student_id, event.event, event.data)
        elif event.scope == "admins":
            await hub.broadcast_to_admins(event.event, event.data)
        else:
            await hub.broadcast(event.event, event.data)
