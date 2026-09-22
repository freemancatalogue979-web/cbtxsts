"""Customer Support — tickets with a real, threaded conversation.

Players open a ticket (bug, question, wrong exam question, shop trouble…),
staff pick it up, reply, change status, assign it and can leave internal
notes the player never sees. Every staff reply lands in the player's bell via
the existing inbox + websocket rails — no second notification system.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin, require_student
from ..models import Admin, InboxNote, Student, SupportMessage, SupportTicket, utcnow
from ..schemas import (
    SupportMessageIn,
    SupportStaffMessageIn,
    SupportTicketIn,
    SupportTicketUpdateIn,
)

router = APIRouter(prefix="/support", tags=["support"])
admin_router = APIRouter(prefix="/admin/support", tags=["support-staff"], dependencies=[Depends(require_admin)])

CATEGORIES = {"bug", "question", "account", "quiz", "duel", "ranked", "study_group", "shop", "other"}
STATUSES = {"open", "in_progress", "waiting_user", "resolved", "closed"}
STATUS_LABELS = {
    "open": "Open",
    "in_progress": "In progress",
    "waiting_user": "Waiting for user",
    "resolved": "Resolved",
    "closed": "Closed",
}
CATEGORY_LABELS = {
    "bug": "Bug",
    "question": "Question",
    "account": "Account",
    "quiz": "Quiz / exam",
    "duel": "Duel",
    "ranked": "Ranked",
    "study_group": "Study Group",
    "shop": "Shop / payment",
    "other": "Other",
}


def _ticket_public(db: Session, ticket: SupportTicket, *, staff_view: bool) -> dict:
    student = db.get(Student, ticket.student_id)
    first = db.scalar(
        select(SupportMessage)
        .where(SupportMessage.ticket_id == ticket.id, SupportMessage.author_kind == "student")
        .order_by(SupportMessage.id)
    )
    return {
        "id": ticket.id,
        "status": ticket.status,
        "status_label": STATUS_LABELS.get(ticket.status, ticket.status),
        "category": ticket.category,
        "category_label": CATEGORY_LABELS.get(ticket.category, ticket.category),
        "subject": ticket.subject,
        "created_at": ticket.created_at.isoformat() + "Z" if ticket.created_at else None,
        "last_message_at": ticket.last_message_at.isoformat() + "Z" if ticket.last_message_at else None,
        "resolved_at": ticket.resolved_at.isoformat() + "Z" if ticket.resolved_at else None,
        "assignee": ticket.assignee,
        "attachment_url": ticket.attachment_url,
        "attachment_name": ticket.attachment_name,
        "preview": (first.body if first else "")[:140],
        "student": {"id": student.id, "name": student.name, "avatar": getattr(student, "avatar", "")} if student else None,
        "staff_unread": int(ticket.staff_unread or 0) if staff_view else 0,
        "student_unread": int(ticket.student_unread or 0) if not staff_view else 0,
    }


def _messages_for(db: Session, ticket_id: int, *, staff_view: bool) -> list[dict]:
    rows = db.scalars(
        select(SupportMessage).where(SupportMessage.ticket_id == ticket_id).order_by(SupportMessage.id)
    ).all()
    return [
        {
            "id": row.id,
            "author_kind": row.author_kind,
            "author_name": row.author_name,
            "body": row.body,
            "internal": bool(row.internal),
            "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
        }
        for row in rows
        if staff_view or not row.internal
    ]


# ---------------------------------------------------------------- player side
@router.get("/tickets")
def my_tickets(
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    only_open: bool = False,
    db: Session = Depends(get_db),
    student: Student = Depends(require_student),
) -> dict:
    conds = [SupportTicket.student_id == student.id]
    if only_open:
        conds.append(SupportTicket.status.not_in(["resolved", "closed"]))
    total = int(db.scalar(select(func.count(SupportTicket.id)).where(*conds)) or 0)
    rows = db.scalars(
        select(SupportTicket).where(*conds).order_by(SupportTicket.last_message_at.desc()).limit(limit).offset(offset)
    ).all()
    unread = int(
        db.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.student_id == student.id, SupportTicket.student_unread > 0))
        or 0
    )
    return {
        "items": [_ticket_public(db, row, staff_view=False) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
        "unread": unread,
    }


@router.post("/tickets")
async def open_ticket(payload: SupportTicketIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    from ..ws import hub

    if payload.category not in CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a real category.")
    ticket = SupportTicket(
        student_id=student.id,
        category=payload.category,
        subject=payload.subject.strip()[:200],
        attachment_url=payload.attachment_url.strip()[:400],
        attachment_name=payload.attachment_name.strip()[:160],
        staff_unread=1,
    )
    db.add(ticket)
    db.flush()
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_kind="student",
            author_name=student.name,
            body=payload.message.strip()[:4000],
        )
    )
    ticket.last_message_at = utcnow()
    db.commit()
    await hub.broadcast_to_admins("support_ticket_new", _ticket_public(db, ticket, staff_view=True))
    return {"ticket": _ticket_public(db, ticket, staff_view=False), "messages": _messages_for(db, ticket.id, staff_view=False)}


@router.get("/tickets/{ticket_id}")
def my_ticket(ticket_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    ticket = db.get(SupportTicket, ticket_id)
    if ticket is None or ticket.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    if ticket.student_unread:
        ticket.student_unread = 0
        db.commit()
    return {
        "ticket": _ticket_public(db, ticket, staff_view=False),
        "messages": _messages_for(db, ticket.id, staff_view=False),
        "can_reply": ticket.status not in {"closed"},
    }


@router.post("/tickets/{ticket_id}/messages")
async def student_reply(ticket_id: int, payload: SupportMessageIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    from ..ws import hub

    ticket = db.get(SupportTicket, ticket_id)
    if ticket is None or ticket.student_id != student.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    if ticket.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This ticket is closed — open a new one and mention the old number.")
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_kind="student",
            author_name=student.name,
            body=payload.body.strip()[:4000] or "(empty message)",
        )
    )
    ticket.staff_unread = int(ticket.staff_unread or 0) + 1
    ticket.last_message_at = utcnow()
    if ticket.status in {"waiting_user", "resolved"}:
        ticket.status = "open"  # the player came back — hand it to staff again
        ticket.resolved_at = None
    db.commit()
    await hub.broadcast_to_admins("support_ticket_update", _ticket_public(db, ticket, staff_view=True))
    return {"messages": _messages_for(db, ticket.id, staff_view=False), "ticket": _ticket_public(db, ticket, staff_view=False)}


# ---------------------------------------------------------------- staff side
@admin_router.get("/tickets")
def staff_list(
    q: str = "",
    ticket_status: str = "",
    category: str = "",
    assignee: str = "",
    only_unassigned: bool = False,
    limit: int = Query(15, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    conds = []
    if ticket_status in STATUSES:
        conds.append(SupportTicket.status == ticket_status)
    if category in CATEGORIES:
        conds.append(SupportTicket.category == category)
    if assignee.strip():
        conds.append(SupportTicket.assignee == assignee.strip())
    if only_unassigned:
        conds.append(SupportTicket.assignee == "")
    if q.strip():
        needle = f"%{q.strip().lower()}%"
        # Search the subject *and* the conversation body — players quote old
        # wording and expect the ticket to come back.
        matching_ids = [
            row[0]
            for row in db.execute(
                select(SupportMessage.ticket_id).where(func.lower(SupportMessage.body).like(needle)).distinct().limit(500)
            ).all()
        ]
        conds.append(or_(func.lower(SupportTicket.subject).like(needle), SupportTicket.id.in_(matching_ids or [-1])))
    total = int(db.scalar(select(func.count(SupportTicket.id)).where(*conds)) or 0)
    rows = db.scalars(
        select(SupportTicket).where(*conds).order_by(SupportTicket.last_message_at.desc()).limit(limit).offset(offset)
    ).all()
    open_count = int(db.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.status.not_in(["resolved", "closed"]))) or 0)
    unread_count = int(db.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.staff_unread > 0)) or 0)
    return {
        "items": [_ticket_public(db, row, staff_view=True) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
        "open_count": open_count,
        "unread_count": unread_count,
        "statuses": sorted(STATUSES),
        "categories": sorted(CATEGORIES),
        "staff": [
            {"email": row.email, "name": getattr(row, "name", "") or row.email.split("@")[0]}
            for row in db.scalars(select(Admin).order_by(Admin.email)).all()
        ],
    }


@admin_router.get("/tickets/{ticket_id}")
def staff_ticket(ticket_id: int, db: Session = Depends(get_db)) -> dict:
    ticket = db.get(SupportTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    ticket.staff_unread = 0
    db.commit()
    return {
        "ticket": _ticket_public(db, ticket, staff_view=True),
        "messages": _messages_for(db, ticket.id, staff_view=True),
    }


@admin_router.post("/tickets/{ticket_id}/messages")
async def staff_reply(ticket_id: int, payload: SupportStaffMessageIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    from ..routers.social import _note_public
    from ..ws import hub

    ticket = db.get(SupportTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    body = payload.body.strip()[:4000] or "(empty message)"
    db.add(
        SupportMessage(
            ticket_id=ticket.id,
            author_kind="staff",
            author_name=getattr(admin, "name", "") or admin.email,
            body=body,
            internal=bool(payload.internal),
        )
    )
    ticket.last_message_at = utcnow()
    if not payload.internal:
        if ticket.status == "open":
            ticket.status = "in_progress"
        ticket.status = ticket.status if ticket.status != "closed" else "open"
        ticket.student_unread = int(ticket.student_unread or 0) + 1
        note = InboxNote(
            student_id=ticket.student_id,
            kind="general",
            title=f"Support replied — #{ticket.id} {ticket.subject}"[:180],
            message=body[:400],
            meta=f'{{"ticket": {ticket.id}}}',
        )
        db.add(note)
        db.flush()
        await hub.send_to_student(ticket.student_id, "notify", _note_public(note))
    db.commit()
    return {
        "messages": _messages_for(db, ticket.id, staff_view=True),
        "ticket": _ticket_public(db, ticket, staff_view=True),
    }


@admin_router.patch("/tickets/{ticket_id}")
async def staff_update(ticket_id: int, payload: SupportTicketUpdateIn, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)) -> dict:
    from ..routers.social import _note_public
    from ..ws import hub

    ticket = db.get(SupportTicket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    data = payload.model_dump(exclude_unset=True)
    if "assignee" in data:
        email = (data["assignee"] or "").strip()
        if email and db.scalar(select(func.count(Admin.id)).where(Admin.email == email)) == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That staff member does not exist.")
        ticket.assignee = email
    if "category" in data and data["category"] in CATEGORIES:
        ticket.category = data["category"]
    announce = None
    if "status" in data:
        new_status = data["status"]
        if new_status not in STATUSES and new_status != "reopened":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown status.")
        if new_status == "reopened":
            new_status = "open"
        if new_status != ticket.status:
            if new_status == "resolved":
                ticket.resolved_at = utcnow()
                announce = "A staff member marked your ticket as resolved."
            elif new_status == "closed":
                ticket.resolved_at = utcnow()
                announce = "Your ticket was closed. Open a new one any time — just mention this number."
            elif new_status == "waiting_user":
                announce = "Support needs a bit more information from you."
            elif new_status == "in_progress" and ticket.status == "open":
                announce = "Support picked up your ticket."
            ticket.status = new_status
    if announce:
        db.add(
            SupportMessage(
                ticket_id=ticket.id,
                author_kind="system",
                author_name="System",
                body=announce,
            )
        )
        note = InboxNote(
            student_id=ticket.student_id,
            kind="general",
            title=f"Support update — #{ticket.id}"[:180],
            message=announce[:400],
            meta=f'{{"ticket": {ticket.id}}}',
        )
        db.add(note)
        db.flush()
        await hub.send_to_student(ticket.student_id, "notify", _note_public(note))
    db.commit()
    await hub.broadcast_to_admins("support_ticket_update", _ticket_public(db, ticket, staff_view=True))
    return {"ticket": _ticket_public(db, ticket, staff_view=True), "messages": _messages_for(db, ticket.id, staff_view=True)}
