"""Friends, player discovery and the personal activity feed."""
from __future__ import annotations

from datetime import timedelta

import base64

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import game
from ..db import get_db
from ..deps import require_student
from ..events import dispatch, to_student
from ..models import Activity, Duel, DuelParticipant, Friendship, InboxNote, Reaction, Student, utcnow
from ..schemas import FriendRequestIn
from ..security import normalize_phone
from ..serializers import activity_public, student_public
from ..ws import hub

router = APIRouter(tags=["social"])


def _friendship(db: Session, student_id: int, friend_id: int) -> Friendship | None:
    return db.scalar(
        select(Friendship).where(
            or_(
                (Friendship.student_id == student_id) & (Friendship.friend_id == friend_id),
                (Friendship.student_id == friend_id) & (Friendship.friend_id == student_id),
            )
        )
    )


@router.get("/friends")
def list_friends(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    rows = db.scalars(
        select(Friendship).where(
            or_(Friendship.student_id == student.id, Friendship.friend_id == student.id)
        )
    ).all()
    friends, incoming = [], []
    for row in rows:
        other_id = row.friend_id if row.student_id == student.id else row.student_id
        other = db.get(Student, other_id)
        if other is None:
            continue
        entry = student_public(other, viewer_id=student.id)
        entry["online"] = hub.is_online(other.id)
        entry["friendship_status"] = row.status
        entry["direction"] = "outgoing" if row.student_id == student.id else "incoming"
        entry["friendship_id"] = row.id
        if row.status == "accepted":
            friends.append(entry)
        elif row.student_id != student.id:
            incoming.append(entry)

    # Rivals you have dueled but not friended — handy for rematches.
    rival_ids = db.scalars(
        select(DuelParticipant.student_id)
        .join(Duel, Duel.id == DuelParticipant.duel_id)
        .where(
            DuelParticipant.student_id != student.id,
            Duel.id.in_(
                select(DuelParticipant.duel_id).where(DuelParticipant.student_id == student.id)
            ),
        )
        .distinct()
    ).all()
    known = {f["id"] for f in friends} | {i["id"] for i in incoming} | {student.id}
    rivals = []
    for rival_id in rival_ids:
        if rival_id in known:
            continue
        rival = db.get(Student, rival_id)
        if rival:
            entry = student_public(rival, viewer_id=student.id)
            entry["online"] = hub.is_online(rival.id)
            rivals.append(entry)

    friends.sort(key=lambda row: (-int(row["online"]), -row["xp"]))
    return {"friends": friends, "requests": incoming, "rivals": rivals[:12]}


@router.post("/friends")
async def add_friend(
    payload: FriendRequestIn,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    target_id = payload.student_id
    if not target_id and payload.phone:
        target_id = db.scalar(select(Student.id).where(Student.phone == normalize_phone(payload.phone)))
    if not target_id and payload.code:
        target_id = db.scalar(select(Student.id).where(Student.player_code == payload.code.strip().upper()))
    if not target_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No player found with those details.")
    if target_id == student.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot add yourself.")

    existing = _friendship(db, student.id, target_id)
    if existing and existing.status == "accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, "You are already friends.")
    if existing and existing.status == "pending":
        existing.status = "accepted"
        events = _friend_events(db, student, target_id, accepted=True)
        db.commit()
        await dispatch(events)
        return {"ok": True, "status": "accepted"}

    db.add(Friendship(student_id=student.id, friend_id=target_id, status="accepted"))
    db.flush()
    events = _friend_events(db, student, target_id, accepted=False)
    db.commit()
    await dispatch(events)
    return {"ok": True, "status": "accepted"}


def _friend_events(db: Session, student: Student, friend_id: int, *, accepted: bool) -> list:
    """Reward the socialite badge and notify the new friend."""
    rewards = game.grant(
        db,
        student,
        xp=20,
        coins=10,
        kind="xp",
        title="Friend added",
        detail="Your arena network is growing",
        touch=False,
    )
    events = [to_student(student.id, "reward", {"source": "friend", "rewards": rewards})]
    friend = db.get(Student, friend_id)
    if friend:
        events.append(
            to_student(
                friend.id,
                "friend_added",
                {"student": student_public(student, viewer_id=friend.id), "accepted": accepted},
            )
        )
    return events


@router.delete("/friends/{friend_id}")
def remove_friend(friend_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    row = _friendship(db, student.id, friend_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Friendship not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/players/search")
def search_players(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    q: str = Query("", max_length=60),
    limit: int = Query(12, ge=1, le=50),
) -> list[dict]:
    term = q.strip()
    query = select(Student).where(Student.id != student.id, Student.is_banned.is_(False))
    if term:
        needle = normalize_phone(term) if term.isdigit() else term
        if term.isdigit():
            query = query.where(Student.phone.like(f"%{needle}%"))
        else:
            query = query.where(Student.name.ilike(f"%{needle}%"))
    rows = db.scalars(query.order_by(Student.xp.desc()).limit(limit)).all()
    payload = [student_public(row, viewer_id=student.id) for row in rows]
    for entry, row in zip(payload, rows):
        entry["online"] = hub.is_online(row.id)
    return payload


@router.get("/players/{player_id}")
def read_player(player_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    player = db.get(Student, player_id)
    if player is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found.")
    payload = student_public(player, viewer_id=student.id)
    payload["online"] = hub.is_online(player.id)
    payload["is_friend"] = _friendship(db, student.id, player.id) is not None
    duels = db.scalar(
        select(func.count(Duel.id))
        .where(Duel.status == "finished")
        .where(Duel.participants.any(student_id=player.id))
    )
    payload["duels_played"] = int(duels or player.duels_played)
    return payload


@router.get("/players/{player_id}/photo")
def player_photo(player_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> Response:
    """Signed-in players can fetch anyone's profile photo (chat, ranks, friends...)."""
    target = db.get(Student, player_id)
    photo = target.photo if target else None
    if not photo or ";base64," not in photo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile photo yet.")
    header, _, body = photo.partition(";base64,")
    mime = header.removeprefix("data:") or "image/jpeg"
    try:
        raw = base64.b64decode(body)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile photo yet.") from error
    return Response(content=raw, media_type=mime, headers={"Cache-Control": "private, max-age=300"})


@router.get("/activity")
def my_activity(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    limit: int = Query(40, ge=5, le=200),
) -> list[dict]:
    rows = db.scalars(
        select(Activity)
        .where(Activity.student_id == student.id)
        .order_by(Activity.created_at.desc())
        .limit(limit)
    ).all()
    return _with_reactions(db, rows, student.id)


def _with_reactions(db: Session, rows: list[Activity], viewer_id: int | None) -> list[dict]:
    """Attach heart counts (and whether the viewer reacted) to feed rows."""
    ids = [row.id for row in rows]
    counts: dict[int, int] = {}
    mine: set[int] = set()
    if ids:
        for activity_id, count in db.execute(
            select(Reaction.activity_id, func.count(Reaction.id)).where(Reaction.activity_id.in_(ids)).group_by(Reaction.activity_id)
        ).all():
            counts[activity_id] = count
        if viewer_id:
            mine = set(
                db.scalars(select(Reaction.activity_id).where(Reaction.activity_id.in_(ids), Reaction.student_id == viewer_id)).all()
            )
    payload = []
    for row in rows:
        entry = activity_public(row)
        entry["reactions"] = counts.get(row.id, 0)
        entry["reacted"] = row.id in mine
        payload.append(entry)
    return payload


def _note_public(note: InboxNote) -> dict:
    import json

    from ..serializers import iso

    return {
        "id": note.id,
        "kind": note.kind,
        "title": note.title,
        "message": note.message,
        "meta": json.loads(note.meta or "{}"),
        "read": note.read_at is not None,
        "created_at": iso(note.created_at),
    }


@router.post("/activity/{activity_id}/react")
def react_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    activity = db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That moment is gone.")
    existing = db.scalar(select(Reaction).where(Reaction.activity_id == activity_id, Reaction.student_id == student.id))
    if existing:
        db.delete(existing)
        mine = False
    else:
        db.add(Reaction(student_id=student.id, activity_id=activity_id))
        mine = True
    db.commit()
    count = db.scalar(select(func.count(Reaction.id)).where(Reaction.activity_id == activity_id)) or 0
    return {"ok": True, "mine": mine, "count": int(count)}


@router.post("/friends/{friend_id}/nudge")
async def nudge_friend(
    friend_id: int,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    friendship = _friendship(db, student.id, friend_id)
    if friendship is None or friendship.status != "accepted":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only nudge friends.")
    recent = db.scalar(
        select(InboxNote.id).where(
            InboxNote.student_id == friend_id,
            InboxNote.kind == "nudge",
            InboxNote.created_at >= utcnow() - timedelta(minutes=5),
        )
    )
    if recent:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Give them a breather — you nudged recently.")
    note = InboxNote(
        student_id=friend_id,
        kind="nudge",
        title=f"{student.name.split(' ')[0]} nudged you 👋",
        message="They want to duel, study or just say hi. Open the Friends tab and reply!",
        meta='{"from": %d}' % student.id,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    payload = _note_public(note)
    await dispatch([to_student(friend_id, "notify", payload)])
    return {"ok": True, "note": payload}


@router.get("/inbox")
def inbox(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    limit: int = Query(40, ge=5, le=100),
) -> dict:
    rows = db.scalars(
        select(InboxNote).where(InboxNote.student_id == student.id).order_by(InboxNote.created_at.desc()).limit(limit)
    ).all()
    unread = db.scalar(
        select(func.count(InboxNote.id)).where(InboxNote.student_id == student.id, InboxNote.read_at.is_(None))
    )
    return {"notes": [_note_public(row) for row in rows], "unread": int(unread or 0)}


@router.post("/inbox/read")
def inbox_read(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    now = utcnow()
    rows = db.scalars(select(InboxNote).where(InboxNote.student_id == student.id, InboxNote.read_at.is_(None))).all()
    for row in rows:
        row.read_at = now
    db.commit()
    return {"marked": len(rows)}


@router.get("/activity/global")
def global_activity(
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
    limit: int = Query(25, ge=5, le=100),
) -> list[dict]:
    """Public arena feed: level-ups, badge unlocks and duel wins across players."""
    rows = db.scalars(
        select(Activity)
        .where(Activity.kind.in_(["level", "badge", "duel", "prize"]))
        .order_by(Activity.created_at.desc())
        .limit(limit)
    ).all()
    payload = _with_reactions(db, rows, student.id)
    for entry, row in zip(payload, rows):
        entry["student"] = student_public(row.student, mask=True) if row.student else None
        payload.append(entry)
    return payload
