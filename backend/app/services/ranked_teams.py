"""Team Ranked — friend lobbies, server matchmaking, paced 1v1 … 5v5.

The client never picks opponents, teams or questions: the server owns lobby
membership, pairing (size + course + rating proximity), the per-player
question deals, the round clock, scoring and rank points. Pacing is DB-only
(countdown/deadline columns), so the duel ticker's rules apply — a match
survives a refresh, a rejoin, even a server restart.

Match shape: each lobby becomes one team. Every player answers their OWN
dealt set on the shared round index — same round number, different question,
no cross-player leakage — and the team score is the honest sum.
"""
from __future__ import annotations

import random
import string
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import game
from ..events import Event, to_student
from ..models import (
    Course,
    Friendship,
    Question,
    RankedLobby,
    RankedLobbyMember,
    Student,
    TeamMatch,
    TeamMatchPlayer,
    utcnow,
)
from ..serializers import question_public
from ..services import study_lab
from ..services.duel import question_pool
from ..services.question_sets import NotEnoughQuestionsError, create_multiplayer_question_sets
from ..services.questions import answer_matches, display_order, label_to_key, mastery_scope_update

COUNTDOWN_SECONDS = 5
ROUND_SECONDS = 20
BASE_QUESTIONS = 8
MAX_TEAM = 5
MIN_TEAM = 1
RATING_WINDOW = 250  # legacy: rating used to gate squad pairing; now it only ranks candidates
MATCHING_TIMEOUT = 150  # seconds before a search politely gives up
K_FACTOR = 32

# lobby_id -> when its search started. Purely a timer convenience: if the
# process restarts, searches simply get their full window again.
_SEARCH_START: dict[int, object] = {}
_LAST_ERROR: dict[int, str] = {}


class LobbyError(Exception):
    pass


# ------------------------------------------------------------------- helpers
def _code() -> str:
    alphabet = "".join(string.ascii_uppercase)
    return "".join(random.choice(alphabet) for _ in range(6))


def lobby_public(db: Session, lobby: RankedLobby, *, viewer_id: int | None = None) -> dict:
    members = db.scalars(
        select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id).order_by(RankedLobbyMember.joined_at)
    ).all()
    from ..ws import hub

    rows = []
    for member in members:
        student = db.get(Student, member.student_id)
        if student is None:
            continue
        rows.append(
            {
                "student_id": student.id,
                "name": student.name,
                "avatar": getattr(student, "avatar", "") or "",
                "is_host": bool(member.is_host),
                "ready": bool(member.ready),
                "rating": student.ranked_rating,
                "connection": "online" if hub.is_online(student.id) else "offline",
            }
        )
    course = db.get(Course, lobby.course_id) if lobby.course_id else None
    return {
        "id": lobby.id,
        "code": lobby.code,
        "status": lobby.status,
        "team_size": lobby.team_size,
        "course_id": lobby.course_id,
        "course_title": course.title if course else "Any course",
        "members": rows,
        "full": len(rows) >= lobby.team_size,
        "viewer_is_member": viewer_id is not None and any(r["student_id"] == viewer_id for r in rows),
        "viewer_is_host": viewer_id is not None and any(r["student_id"] == viewer_id and r["is_host"] for r in rows),
        "error": _LAST_ERROR.pop(lobby.id, None),
    }


def member_lobby(db: Session, student_id: int) -> RankedLobby | None:
    row = db.scalar(
        select(RankedLobbyMember)
        .join(RankedLobby, RankedLobby.id == RankedLobbyMember.lobby_id)
        .where(RankedLobbyMember.student_id == student_id, RankedLobby.status.in_(("open", "matching")))
        .order_by(RankedLobbyMember.id.desc())
    )
    return db.get(RankedLobby, row.lobby_id) if row else None


def my_lobby(db: Session, student: Student) -> RankedLobby | None:
    """The player's own live lobby. A launched lobby still resolves while its
    match is unfinished so the results screen can find it."""
    row = db.scalar(
        select(RankedLobbyMember)
        .join(RankedLobby, RankedLobby.id == RankedLobbyMember.lobby_id)
        .where(RankedLobbyMember.student_id == student.id)
        .order_by(RankedLobbyMember.id.desc())
    )
    if row is None:
        return None
    lobby = db.get(RankedLobby, row.lobby_id)
    if lobby is None:
        return None
    if lobby.status == "launched":
        match = db.get(TeamMatch, lobby.match_id) if lobby.match_id else None
        if match is not None and match.status in ("starting", "live"):
            return lobby
        return None
    if lobby.status in ("dissolved",):
        return None
    return lobby


# ------------------------------------------------------------------ lobby ops
def create_lobby(db: Session, student: Student, team_size: int, course_id: int | None) -> RankedLobby:
    if not MIN_TEAM <= team_size <= MAX_TEAM:
        raise LobbyError(f"Team size must be between {MIN_TEAM} and {MAX_TEAM}.")
    if member_lobby(db, student.id) is not None:
        raise LobbyError("You are already in a ranked lobby — leave it first.")
    if course_id is not None:
        course = db.get(Course, course_id)
        if course is None or not course.is_active:
            raise LobbyError("That course is not available for ranked.")
    for _ in range(12):
        code = _code()
        if db.scalar(select(func.count(RankedLobby.id)).where(RankedLobby.code == code)) == 0:
            break
    else:  # pragma: no cover - astronomically unlikely
        raise LobbyError("Could not mint a lobby code — try again.")
    lobby = RankedLobby(code=code, host_student_id=student.id, team_size=team_size, course_id=course_id)
    db.add(lobby)
    db.flush()
    db.add(RankedLobbyMember(lobby_id=lobby.id, student_id=student.id, is_host=True, ready=False))
    db.flush()
    return lobby


def join_lobby(db: Session, student: Student, code: str) -> RankedLobby:
    lobby = db.scalar(select(RankedLobby).where(RankedLobby.code == (code or "").strip().upper()))
    if lobby is None or lobby.status not in ("open",):
        raise LobbyError("That lobby is not open for joining.")
    if member_lobby(db, student.id) is not None:
        raise LobbyError("You are already in a ranked lobby.")
    count = db.scalar(select(func.count(RankedLobbyMember.id)).where(RankedLobbyMember.lobby_id == lobby.id)) or 0
    if count >= lobby.team_size:
        raise LobbyError("That lobby is full.")
    db.add(RankedLobbyMember(lobby_id=lobby.id, student_id=student.id, ready=False))
    db.flush()
    return lobby


def _require_membership(db: Session, lobby: RankedLobby, student: Student) -> RankedLobbyMember:
    member = db.scalar(
        select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id, RankedLobbyMember.student_id == student.id)
    )
    if member is None:
        raise LobbyError("You are not in that lobby.")
    return member


def leave_lobby(db: Session, lobby: RankedLobby, student: Student) -> list[Event]:
    member = _require_membership(db, lobby, student)
    events: list[Event] = []
    db.delete(member)
    db.flush()
    remaining = db.scalars(select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id)).all()
    if not remaining:
        lobby.status = "dissolved"
    elif member.is_host:
        # Host privilege passes to whoever joined next — lobbies never orphan.
        new_host = min(remaining, key=lambda m: (m.joined_at, m.id))
        new_host.is_host = True
        lobby.host_student_id = new_host.student_id
        if lobby.status == "matching":
            lobby.status = "open"
            _SEARCH_START.pop(lobby.id, None)
    if lobby.status == "matching" and not all(m.ready for m in remaining):
        lobby.status = "open"
        _SEARCH_START.pop(lobby.id, None)
    events += lobby_update_event(db, lobby)
    return events


def kick_member(db: Session, lobby: RankedLobby, host: Student, student_id: int) -> list[Event]:
    me = _require_membership(db, lobby, host)
    if not me.is_host:
        raise LobbyError("Only the host can remove players.")
    if lobby.status == "matching":
        raise LobbyError("Pause matchmaking before changing the roster.")
    target = db.scalar(
        select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id, RankedLobbyMember.student_id == student_id)
    )
    if target is None:
        raise LobbyError("That player is not in your lobby.")
    if target.is_host:
        raise LobbyError("The host cannot be removed.")
    db.delete(target)
    db.flush()
    events: list[Event] = [to_student(student_id, "team_lobby_left", {"lobby_id": lobby.id, "kicked": True})]
    events += lobby_update_event(db, lobby)
    return events


def set_ready(db: Session, lobby: RankedLobby, student: Student, ready: bool) -> list[Event]:
    member = _require_membership(db, lobby, student)
    if lobby.status == "matching" and not ready:
        raise LobbyError("Cancel matchmaking before un-readying.")
    member.ready = bool(ready)
    db.flush()
    return lobby_update_event(db, lobby)


def invite_friend(db: Session, lobby: RankedLobby, host: Student, student_id: int) -> tuple[Student, list[Event]]:
    _require_membership(db, lobby, host)
    if not _is_friend(db, host.id, student_id):
        raise LobbyError("You can only invite friends.")
    friend = db.get(Student, student_id)
    if friend is None or friend.is_banned:
        raise LobbyError("That player cannot be invited.")
    if member_lobby(db, student_id) is not None:
        raise LobbyError(f"{friend.name} is already in a ranked lobby.")
    from ..models import InboxNote

    note = InboxNote(
        student_id=student_id,
        kind="general",
        title=f"{host.name} invited you to a Ranked lobby",
        message=f"Code {lobby.code} · {lobby.team_size}v{lobby.team_size}"
        + (f" · {db.get(Course, lobby.course_id).title}" if lobby.course_id else ""),
        meta=f'{{"lobby_code": "{lobby.code}"}}',
    )
    db.add(note)
    db.flush()
    from ..routers.social import _note_public

    return friend, [to_student(student_id, "notify", _note_public(note)), to_student(host.id, "team_invite_sent", {"friend_id": student_id})]


def _is_friend(db: Session, a: int, b: int) -> bool:
    return (
        db.scalar(
            select(func.count(Friendship.id)).where(
                Friendship.status == "accepted",
                Friendship.student_id == a,
                Friendship.friend_id == b,
            )
        )
        or db.scalar(
            select(func.count(Friendship.id)).where(
                Friendship.status == "accepted",
                Friendship.student_id == b,
                Friendship.friend_id == a,
            )
        )
        or 0
    ) > 0


def start_search(db: Session, lobby: RankedLobby, student: Student) -> list[Event]:
    _require_membership(db, lobby, student)
    member = db.scalar(
        select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id, RankedLobbyMember.student_id == student.id)
    )
    if member is None or not member.is_host:
        raise LobbyError("Only the host can start matchmaking.")
    if lobby.status == "matching":
        raise LobbyError("Already searching for opponents.")
    members = db.scalars(select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby.id)).all()
    if not all(m.ready for m in members):
        raise LobbyError("Everyone in the lobby must be ready before you can search.")
    if lobby.status == "launched":
        raise LobbyError("This lobby already launched a match.")
    lobby.status = "matching"
    _SEARCH_START[lobby.id] = utcnow()
    _LAST_ERROR.pop(lobby.id, None)
    db.flush()
    return lobby_update_event(db, lobby)


def cancel_search(db: Session, lobby: RankedLobby, student: Student) -> list[Event]:
    member = _require_membership(db, lobby, student)
    if not member.is_host:
        raise LobbyError("Only the host can cancel matchmaking.")
    if lobby.status != "matching":
        raise LobbyError("No search is running.")
    lobby.status = "open"
    _SEARCH_START.pop(lobby.id, None)
    db.flush()
    return lobby_update_event(db, lobby)


def lobby_update_event(db: Session, lobby: RankedLobby) -> list[Event]:
    payload = lobby_public(db, lobby)
    return [to_student(m.student_id, "team_lobby", payload) for m in members_of(db, lobby.id)]


def members_of(db: Session, lobby_id: int) -> list[RankedLobbyMember]:
    return list(db.scalars(select(RankedLobbyMember).where(RankedLobbyMember.lobby_id == lobby_id).order_by(RankedLobbyMember.joined_at)).all())


# ----------------------------------------------------------------- matching
def _avg_rating(db: Session, lobby_id: int) -> int:
    rows = members_of(db, lobby_id)
    ratings = [db.get(Student, r.student_id).ranked_rating for r in rows if db.get(Student, r.student_id)]
    return int(sum(ratings) / len(ratings)) if ratings else 1000


def _compatible(a: RankedLobby, b: RankedLobby) -> bool:
    """Two squads may meet when both are searching, equally sized and after the
    same course. Rank is deliberately NOT a gate — waiting teams get each
    other, whoever they are; the matcher only prefers the closest averages."""
    if a.id == b.id or a.status != "matching" or b.status != "matching":
        return False
    if a.team_size != b.team_size:
        return False
    return (a.course_id or None) == (b.course_id or None)


def poll_lobbies(db: Session) -> list[Event]:
    """Pair waiting squads. Deterministic: same size, same course, everyone
    ready, nobody already in a match. Rank is not a filter — two ready squads
    hunting on the same course always meet; rating only decides which pair
    forms first when several are waiting."""
    events: list[Event] = []
    matching = list(
        db.scalars(select(RankedLobby).where(RankedLobby.status == "matching").order_by(RankedLobby.id)).all()
    )
    used: set[int] = set()
    now = utcnow()
    for lobby in matching:
        if lobby.id in used:
            continue
        started = _SEARCH_START.get(lobby.id)
        if started is not None and (now - started).total_seconds() > MATCHING_TIMEOUT:
            lobby.status = "open"
            _SEARCH_START.pop(lobby.id, None)
            _LAST_ERROR[lobby.id] = "No balanced squad found in time — ready up and search again."
            events += lobby_update_event(db, lobby)
            db.commit()
            continue
        best: tuple[int, RankedLobby] | None = None
        for other in matching:
            if other.id in used or other.id <= lobby.id:
                continue
            members_o = members_of(db, other.id)
            if not all(m.ready for m in members_o):
                continue
            if any(active_match_for(db, m.student_id) for m in members_o):
                continue
            if not _compatible(lobby, other):
                continue
            gap = abs(_avg_rating(db, lobby.id) - _avg_rating(db, other.id))
            if best is None or gap < best[0]:
                best = (gap, other)
        if best is None:
            continue
        partner = best[1]
        used.add(lobby.id)
        used.add(partner.id)
        try:
            events += create_match(db, lobby, partner)
        except LobbyError as error:
            for row in (lobby, partner):
                row.status = "open"
                _SEARCH_START.pop(row.id, None)
                _LAST_ERROR[row.id] = str(error)
            events += lobby_update_event(db, lobby)
            events += lobby_update_event(db, partner)
        db.commit()
    return events


def active_match_for(db: Session, student_id: int) -> TeamMatch | None:
    row = db.scalar(
        select(TeamMatchPlayer)
        .join(TeamMatch, TeamMatch.id == TeamMatchPlayer.match_id)
        .where(TeamMatchPlayer.student_id == student_id, TeamMatch.status.in_(("starting", "live")))
        .order_by(TeamMatchPlayer.id.desc())
    )
    return db.get(TeamMatch, row.match_id) if row else None


def create_match(db: Session, lobby_a: RankedLobby, lobby_b: RankedLobby) -> list[Event]:
    team_a = [m.student_id for m in members_of(db, lobby_a.id)]
    team_b = [m.student_id for m in members_of(db, lobby_b.id)]
    players = team_a + team_b
    pool = question_pool(db, None, course_id=lobby_a.course_id)
    if not pool:
        raise LobbyError("That course bank is empty right now — matchmaking will retry when questions are approved.")
    # Global multiplayer rule: each player gets their own unique set, no
    # overlap inside the match; shrink (never share) if the bank is thin.
    per_player = min(BASE_QUESTIONS, max(0, len(pool) // max(1, len(players))))
    sets: dict[int, list[Question]] | None = None
    while per_player >= 3:
        try:
            sets = create_multiplayer_question_sets(pool, players, per_player, strict=True)
            break
        except NotEnoughQuestionsError:
            per_player -= 1
    if sets is None:
        raise LobbyError(
            "Not enough unique questions in this bank for every player to get their own set — "
            "approve more questions for the course."
        )
    host_a = db.get(Student, lobby_a.host_student_id)
    host_b = db.get(Student, lobby_b.host_student_id)
    match = TeamMatch(
        code=lobby_a.code,
        status="starting",
        team_size=lobby_a.team_size,
        course_id=lobby_a.course_id,
        teams=[team_a, team_b],
        team_names=[
            f"{(host_a.name.split(' ')[0] if host_a else 'Squad')}'s squad",
            f"{(host_b.name.split(' ')[0] if host_b else 'Rivals')}'s squad",
        ],
        question_count=per_player,
        per_question_seconds=ROUND_SECONDS,
        countdown_ends_at=utcnow() + timedelta(seconds=COUNTDOWN_SECONDS),
    )
    db.add(match)
    db.flush()
    for team, roster in enumerate((team_a, team_b)):
        for student_id in roster:
            student = db.get(Student, student_id)
            db.add(
                TeamMatchPlayer(
                    match_id=match.id,
                    student_id=student_id,
                    team=team,
                    set_ids=[q.id for q in sets[student_id]],
                    rating_before=int(student.ranked_rating if student else 1000),
                )
            )
    for lobby in (lobby_a, lobby_b):
        lobby.status = "launched"
        lobby.match_id = match.id
        _SEARCH_START.pop(lobby.id, None)
    db.flush()
    events: list[Event] = []
    for player in match_players(db, match.id):
        events.append(to_student(player.student_id, "team_match", {"match_id": match.id}))
    return events


# -------------------------------------------------------------- match engine
def match_players(db: Session, match_id: int) -> list[TeamMatchPlayer]:
    return list(db.scalars(select(TeamMatchPlayer).where(TeamMatchPlayer.match_id == match_id).order_by(TeamMatchPlayer.id)).all())


def _player_row(db: Session, match_id: int, student_id: int) -> TeamMatchPlayer | None:
    return db.scalar(select(TeamMatchPlayer).where(TeamMatchPlayer.match_id == match_id, TeamMatchPlayer.student_id == student_id))


def match_state(db: Session, match: TeamMatch, viewer_id: int | None) -> dict:
    players = match_players(db, match.id)
    by_team: dict[int, list[dict]] = {0: [], 1: []}
    for player in players:
        student = db.get(Student, player.student_id)
        by_team.setdefault(player.team, []).append(
            {
                "student_id": player.student_id,
                "name": student.name if student else "?",
                "avatar": getattr(student, "avatar", "") or "" if student else "",
                "score": player.score,
                "correct": player.correct,
                "answered": player.answered,
                "total": len(player.set_ids or []),
                "streak": player.streak,
                "connected": bool(player.last_seen and (utcnow() - player.last_seen).total_seconds() < 60),
                "rating_before": player.rating_before,
                "rating_delta": player.rating_delta,
                "you": player.student_id == viewer_id,
            }
        )
    team_totals = []
    for team in (0, 1):
        rows = by_team.get(team, [])
        team_totals.append(
            {
                "team": team,
                "name": (match.team_names or ["", ""])[team] if len(match.team_names or []) > team else f"Team {team + 1}",
                "score": sum(r["score"] for r in rows),
                "correct": sum(r["correct"] for r in rows),
                "answered": sum(r["answered"] for r in rows),
                "total": sum(r["total"] for r in rows),
                "members": rows,
            }
        )
    viewer_row = next((p for p in players if p.student_id == viewer_id), None) if viewer_id else None
    current = None
    if viewer_row is not None and match.status == "live" and 0 <= match.round_index < len(viewer_row.set_ids or []):
        question = db.get(Question, (viewer_row.set_ids or [])[match.round_index])
        if question is not None:
            order = display_order(question, shuffle=True, seed=f"team:{match.id}:{question.id}")
            current = question_public(question, order=order)
    return {
        "match": {
            "id": match.id,
            "status": match.status,
            "team_size": match.team_size,
            "question_count": match.question_count,
            "round_index": match.round_index,
            "countdown_ends_at": (match.countdown_ends_at.isoformat() + "Z") if match.countdown_ends_at else None,
            "round_deadline": (match.round_deadline.isoformat() + "Z") if match.round_deadline else None,
            "winner_team": match.winner_team,
            "finished_at": (match.finished_at.isoformat() + "Z") if match.finished_at else None,
            "server_now": utcnow().isoformat() + "Z",
        },
        "teams": team_totals,
        "you": (
            {
                "team": viewer_row.team,
                "position": viewer_row.position,
                "score": viewer_row.score,
                "correct": viewer_row.correct,
                "wrong": viewer_row.wrong,
                "streak": viewer_row.streak,
                "best_streak": viewer_row.best_streak,
                "rating_before": viewer_row.rating_before,
                "rating_delta": viewer_row.rating_delta,
                "xp": viewer_row.xp_awarded,
                "coins": viewer_row.coins_awarded,
                "answers": dict(viewer_row.answers or {}),
            }
            if viewer_row is not None
            else None
        ),
        "current": current,
    }


def advance_team_matches(db: Session) -> list[Event]:
    events: list[Event] = []
    matches = db.scalars(select(TeamMatch).where(TeamMatch.status.in_(("starting", "live"))).order_by(TeamMatch.id)).all()
    now = utcnow()
    for match in matches:
        players = match_players(db, match.id)
        if not players:
            match.status = "cancelled"
            continue
        if match.status == "starting":
            if match.countdown_ends_at is None or now < match.countdown_ends_at:
                continue
            match.status = "live"
            match.round_index = 0
            match.round_opened_at = now
            match.round_deadline = now + timedelta(seconds=match.per_question_seconds)
            events += _push_round(db, match, players)
            db.commit()
            continue
        everyone_in = all(p.position > match.round_index for p in players)
        timed_out = match.round_deadline is not None and now > match.round_deadline
        if not (everyone_in or timed_out):
            continue
        # Close the round: per-player reveal first (only ever their own row),
        # then auto-advance the stragglers' cursors.
        # Stragglers: their streak breaks on an unanswered round; reveal lands
        # only for those who answered (the missed round shows as "no answer").
        events += [to_student(p.student_id, "team_reveal", _reveal_for(db, match, p)) for p in players]
        for player in players:
            if player.position == match.round_index:
                player.position = match.round_index + 1
                player.streak = 0  # unanswered earns nothing and breaks the streak
        db.flush()
        if match.round_index >= match.question_count - 1:
            events += _finish(db, match)
        else:
            match.round_index += 1
            match.round_opened_at = now
            match.round_deadline = now + timedelta(seconds=match.per_question_seconds)
            events += _push_round(db, match, players)
        db.commit()
    return events


def _push_round(db: Session, match: TeamMatch, players: list[TeamMatchPlayer]) -> list[Event]:
    return [
        to_student(
            p.student_id,
            "team_round",
            {
                "match_id": match.id,
                "round_index": match.round_index,
                "total": match.question_count,
                "deadline": match.round_deadline.isoformat() + "Z" if match.round_deadline else None,
                "server_now": utcnow().isoformat() + "Z",
            },
        )
        for p in players
    ]


def _reveal_for(db: Session, match: TeamMatch, player: TeamMatchPlayer) -> dict:
    """The player's own last-round result — never anyone else's."""
    index = match.round_index
    ids = list(player.set_ids or [])
    if index >= len(ids):
        return {"match_id": match.id, "round_index": index, "answered": False}
    qid = ids[index]
    entry = (player.answers or {}).get(str(qid))
    if entry is None:
        return {"match_id": match.id, "round_index": index, "answered": False}
    question = db.get(Question, qid)
    return {
        "match_id": match.id,
        "round_index": index,
        "answered": True,
        "question_id": qid,
        "correct": bool(entry.get("correct")),
        "correct_answer": question.correct if question else "",
        "explanation": (question.explanation if question else "") or "",
        "selected": entry.get("selected", ""),
        "points": entry.get("points", 0),
    }


def submit_answer(db: Session, match: TeamMatch, student: Student, question_id: int, selected: str, elapsed_ms: int) -> dict:
    if match.status != "live":
        raise LobbyError("No round is open yet — the countdown is running.")
    player = _player_row(db, match.id, student.id)
    if player is None:
        raise LobbyError("You are not in this match.")
    ids = list(player.set_ids or [])
    index = match.round_index
    if player.position > index:
        raise LobbyError("You already answered this round.")
    if not (0 <= index < len(ids)) or ids[index] != question_id:
        raise LobbyError("That question is not on the clock right now.")
    if match.round_deadline is not None and utcnow() > match.round_deadline:
        raise LobbyError("Too slow — the clock on that question already ran out.")
    question = db.get(Question, question_id)
    if question is None:
        raise LobbyError("That question left the bank mid-round.")
    order = display_order(question, shuffle=True, seed=f"team:{match.id}:{question.id}")
    canonical = label_to_key(question, order, selected) or selected
    correct = bool(answer_matches(question.correct, canonical))

    window = max(1, int(match.per_question_seconds or ROUND_SECONDS))
    remaining = 0.0
    if match.round_deadline is not None and match.round_opened_at is not None:
        left = (match.round_deadline - utcnow()).total_seconds()
        remaining = max(0.0, min(1.0, left / window))
    points = (100 + int(50 * remaining)) if correct else 0
    player.streak = player.streak + 1 if correct else 0
    player.best_streak = max(player.best_streak or 0, player.streak)
    if player.streak >= 2:
        points += min(50, 10 * (player.streak - 1))  # streak bonus, capped
    player.score += points
    player.answered += 1
    player.correct += 1 if correct else 0
    player.wrong += 0 if correct else 1
    player.elapsed_ms += max(0, int(elapsed_ms or 0))
    player.position = index + 1
    player.last_seen = utcnow()
    _stash_answer(player, question.id, selected, correct, points)

    mastery_scope_update(db, student.id, scope_type="topic", scope_key=question.topic or "General", correct=correct)
    if correct:
        study_lab.resolve_mistake(db, student.id, question.id)
    else:
        study_lab.record_mistake(db, student.id, question, selected=canonical, source="ranked")
    db.flush()

    players = match_players(db, match.id)
    everyone = all(p.position > index for p in players)
    return {
        "correct": correct,
        "selected": selected,
        "correct_answer": question.correct,
        "explanation": question.explanation or "",
        "topic": question.topic or "",
        "points": points,
        "streak": player.streak,
        "everyone_answered": everyone,
        "position": player.position,
    }


def _stash_answer(player: TeamMatchPlayer, qid: int, selected: str, correct: bool, points: int) -> None:
    """Answers ride on the row as JSON so a refresh restores the review strip."""
    raw = dict(player.answers or {})
    raw[str(qid)] = {"selected": selected, "correct": bool(correct), "points": int(points)}
    player.answers = raw


# -------------------------------------------------------------------- finish
def _finish(db: Session, match: TeamMatch) -> list[Event]:
    match.status = "finished"
    match.finished_at = utcnow()
    players = match_players(db, match.id)
    team_scores = {0: 0, 1: 0}
    team_correct = {0: 0, 1: 0}
    for player in players:
        team_scores[player.team] = team_scores.get(player.team, 0) + player.score
        team_correct[player.team] = team_correct.get(player.team, 0) + player.correct
    if team_scores[0] > team_scores[1] or (team_scores[0] == team_scores[1] and team_correct[0] > team_correct[1]):
        winner = 0
    elif team_scores[1] > team_scores[0] or (team_scores[0] == team_scores[1] and team_correct[1] > team_correct[0]):
        winner = 1
    else:
        winner = None
    match.winner_team = winner

    avgs = {
        team: (sum(p.rating_before for p in players if p.team == team) / max(1, len([p for p in players if p.team == team])))
        for team in (0, 1)
    }
    events: list[Event] = []
    for player in players:
        student = db.get(Student, player.student_id)
        if student is None:
            continue
        my_team, opp_team = player.team, 1 - player.team
        result = 0.5 if winner is None else (1.0 if winner == my_team else 0.0)
        expected = 1.0 / (1.0 + 10.0 ** ((avgs[opp_team] - avgs[my_team]) / 400.0))
        team_delta = max(-K_FACTOR, min(K_FACTOR, round(K_FACTOR * (result - expected))))
        team_avg_score = max(1, team_scores.get(my_team, 0) // max(1, len([p for p in players if p.team == my_team])))
        share = (player.score - team_avg_score) / max(1, team_avg_score + 100)
        contribution = max(-8, min(8, round(share * 16)))  # individual relevance, bounded
        delta = team_delta + contribution
        player.rating_delta = delta
        student.ranked_rating = max(100, player.rating_before + delta)
        student.ranked_played = int(student.ranked_played or 0) + 1
        if result == 1.0:
            student.ranked_won = int(student.ranked_won or 0) + 1
        xp = (30 if result == 1.0 else 10) + 4 * player.correct
        coins = (8 if result == 1.0 else 3) + player.correct
        player.xp_awarded = xp
        player.coins_awarded = coins
        game.grant(
            db,
            student,
            xp=xp,
            coins=coins,
            kind="xp",
            title=f"Team ranked — {'victory' if result == 1.0 else ('draw' if result == 0.5 else 'defeat')}",
            detail=f"{player.correct}/{len(player.set_ids or [])} correct · {delta:+d} rating",
        )
        events.append(
            to_student(
                student.id,
                "team_match_result",
                {
                    "match_id": match.id,
                    "winner_team": winner,
                    "your_team": player.team,
                    "delta": delta,
                    "rating": student.ranked_rating,
                    "xp": xp,
                    "coins": coins,
                },
            )
        )
    db.flush()
    return events


# ------------------------------------------------------------------ dashboard
def recent_team_matches(db: Session, student_id: int, limit: int = 5) -> list[dict]:
    rows = db.scalars(
        select(TeamMatchPlayer)
        .join(TeamMatch, TeamMatch.id == TeamMatchPlayer.match_id)
        .where(TeamMatchPlayer.student_id == student_id, TeamMatch.status == "finished")
        .order_by(TeamMatch.finished_at.desc())
        .limit(limit)
    ).all()
    out = []
    for row in rows:
        match = db.get(TeamMatch, row.match_id)
        if match is None:
            continue
        won = match.winner_team == row.team
        out.append(
            {
                "match_id": match.id,
                "finished_at": match.finished_at.isoformat() + "Z" if match.finished_at else None,
                "score": row.score,
                "correct": row.correct,
                "total": len(row.set_ids or []),
                "delta": row.rating_delta,
                "won": bool(won),
                "draw": match.winner_team is None,
                "team_size": match.team_size,
                "course_id": match.course_id,
            }
        )
    return out


def friends_in_lobbies(db: Session, student: Student) -> list[dict]:
    friend_ids = [
        row[0]
        for row in db.execute(
            select(Friendship.friend_id).where(Friendship.student_id == student.id, Friendship.status == "accepted")
        ).all()
    ] + [
        row[0]
        for row in db.execute(
            select(Friendship.student_id).where(Friendship.friend_id == student.id, Friendship.status == "accepted")
        ).all()
    ]
    if not friend_ids:
        return []
    rows = db.scalars(
        select(RankedLobbyMember)
        .join(RankedLobby, RankedLobby.id == RankedLobbyMember.lobby_id)
        .where(RankedLobbyMember.student_id.in_(friend_ids), RankedLobby.status.in_(("open", "matching")))
    ).all()
    out, seen = [], set()
    for row in rows:
        if row.student_id in seen:
            continue
        seen.add(row.student_id)
        student_row = db.get(Student, row.student_id)
        lobby = db.get(RankedLobby, row.lobby_id)
        out.append(
            {
                "student_id": row.student_id,
                "name": student_row.name if student_row else "?",
                "lobby_code": lobby.code if lobby else "",
                "team_size": lobby.team_size if lobby else 1,
                "lobby_status": lobby.status if lobby else "",
            }
        )
    return out


def open_lobbies(db: Session, student: Student, limit: int = 8) -> list[dict]:
    rows = db.scalars(
        select(RankedLobby).where(RankedLobby.status == "open").order_by(RankedLobby.id.desc()).limit(30)
    ).all()
    out = []
    for lobby in rows:
        if my_lobby(db, student) is not None and my_lobby(db, student).id == lobby.id:
            continue
        payload = lobby_public(db, lobby, viewer_id=student.id)
        if payload["full"]:
            continue
        out.append(payload)
        if len(out) >= limit:
            break
    return out


def ranked_courses(db: Session) -> list[dict]:
    rows = db.scalars(select(Course).where(Course.is_active.is_(True)).order_by(Course.title)).all()
    out = []
    for course in rows:
        pool = int(
            db.scalar(
                select(func.count(Question.id)).where(
                    Question.course_id == course.id, Question.status == "approved", Question.visible.is_(True)
                )
            )
            or 0
        )
        out.append({"id": course.id, "title": course.title, "code": course.code, "pool": pool, "playable": pool >= 3})
    return out
