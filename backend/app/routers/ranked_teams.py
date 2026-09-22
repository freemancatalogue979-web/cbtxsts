"""Team Ranked + the full Ranked dashboard endpoints.

Thin HTTP skin over services/ranked_teams — every decision (who plays whom,
which questions, who won, how many rank points) is made server-side there.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_student
from ..events import dispatch
from ..models import (
    Question,
    RankedLobby,
    Student,
    TeamMatch,
    TeamMatchPlayer,
    utcnow,
)
from ..schemas import (
    RankedLobbyCodeIn,
    RankedLobbyCreateIn,
    RankedLobbyReadyIn,
    RankedLobbyStudentIn,
    TeamMatchAnswerIn,
)
from ..services import ranked as ranked_service
from ..services import ranked_teams as teams
from ..services.ranked_teams import LobbyError

router = APIRouter(prefix="/ranked", tags=["ranked-teams"])


def _lobby_or_404(db: Session, student: Student) -> RankedLobby:
    lobby = teams.my_lobby(db, student)
    if lobby is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You are not in a ranked lobby.")
    return lobby


def _match_or_404(db: Session, student: Student, match_id: int) -> TeamMatch:
    match = db.get(TeamMatch, match_id)
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    row = db.scalar(
        select(TeamMatchPlayer).where(TeamMatchPlayer.match_id == match.id, TeamMatchPlayer.student_id == student.id)
    )
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in this match.")
    return match


# ------------------------------------------------------------------- dashboard
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = teams.my_lobby(db, student)
    meta = ranked_service.tier_for(student.ranked_rating)
    history = db.scalars(
        select(TeamMatchPlayer)
        .join(TeamMatch, TeamMatch.id == TeamMatchPlayer.match_id)
        .where(TeamMatchPlayer.student_id == student.id, TeamMatch.status == "finished")
    ).all()
    team_wins = sum(1 for row in history if (db.get(TeamMatch, row.match_id).winner_team or -1) == row.team)
    answered = sum(int(row.answered or 0) for row in history)
    correct = sum(int(row.correct or 0) for row in history)
    score_total = sum(int(row.score or 0) for row in history)
    streak = 0
    for row in teams.recent_team_matches(db, student.id, limit=20):
        if row["won"]:
            streak += 1
        else:
            break
    match = teams.active_match_for(db, student.id) if lobby is None else None
    return {
        "rating": student.ranked_rating,
        "tier": meta,
        "season": ranked_service.season_summary(db, student) if hasattr(ranked_service, "season_summary") else None,
        "played": int(student.ranked_played or 0),
        "won": int(student.ranked_won or 0),
        "team_matches": len(history),
        "team_wins": team_wins,
        "accuracy": round(correct / answered * 100, 1) if answered else None,
        "avg_score": round(score_total / len(history)) if history else None,
        "win_streak": streak,
        "recent": teams.recent_team_matches(db, student.id),
        "friends_in_lobbies": teams.friends_in_lobbies(db, student),
        "open_lobbies": teams.open_lobbies(db, student),
        "courses": teams.ranked_courses(db),
        "my_lobby": teams.lobby_public(db, lobby, viewer_id=student.id) if lobby is not None else None,
        "active_match_id": match.id if match is not None else None,
        "queue_active": db.scalar(
            select(func.count()).select_from(ranked_service.RankedQueue).where(ranked_service.RankedQueue.student_id == student.id)
        )
        > 0
        if hasattr(ranked_service, "RankedQueue")
        else False,
        "server_now": utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------- lobbies
@router.post("/lobby")
async def create_lobby(payload: RankedLobbyCreateIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        lobby = teams.create_lobby(db, student, payload.team_size, payload.course_id)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    payload_out = teams.lobby_public(db, lobby, viewer_id=student.id)
    await dispatch(teams.lobby_update_event(db, lobby))
    return {"lobby": payload_out}


@router.get("/lobby")
def read_lobby(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = teams.my_lobby(db, student)
    if lobby is None:
        return {"lobby": None}
    return {"lobby": teams.lobby_public(db, lobby, viewer_id=student.id)}


@router.post("/lobby/join")
async def join_lobby(payload: RankedLobbyCodeIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    try:
        lobby = teams.join_lobby(db, student, payload.code)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(teams.lobby_update_event(db, lobby))
    return {"lobby": teams.lobby_public(db, lobby, viewer_id=student.id)}


@router.post("/lobby/leave")
async def leave_lobby(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    events = teams.leave_lobby(db, lobby, student)
    db.commit()
    await dispatch(events)
    return {"left": True}


@router.post("/lobby/kick")
async def kick(payload: RankedLobbyStudentIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    try:
        events = teams.kick_member(db, lobby, student, payload.student_id)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(events)
    return {"kicked": payload.student_id, "lobby": teams.lobby_public(db, lobby, viewer_id=student.id)}


@router.post("/lobby/ready")
async def ready(payload: RankedLobbyReadyIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    try:
        events = teams.set_ready(db, lobby, student, payload.ready)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(events)
    return {"ready": payload.ready, "lobby": teams.lobby_public(db, lobby, viewer_id=student.id)}


@router.post("/lobby/invite")
async def invite(payload: RankedLobbyStudentIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    try:
        friend, events = teams.invite_friend(db, lobby, student, payload.student_id)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(events)
    return {"invited": friend.name}


@router.post("/lobby/find")
async def find(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    try:
        events = teams.start_search(db, lobby, student)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(events)
    # Pair right now if an opponent is already searching — nobody waits a
    # whole tick for a match that is already standing there.
    paired = teams.poll_lobbies(db)
    if paired:
        await dispatch(paired)
    db.refresh(lobby)
    return {
        "lobby": teams.lobby_public(db, lobby, viewer_id=student.id),
        "match_id": lobby.match_id if lobby.status == "launched" else None,
    }


@router.post("/lobby/cancel-search")
async def cancel_search(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    lobby = _lobby_or_404(db, student)
    try:
        events = teams.cancel_search(db, lobby, student)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    await dispatch(events)
    return {"lobby": teams.lobby_public(db, lobby, viewer_id=student.id)}


@router.get("/lobby/open-list")
def lobby_list(db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    return {"lobbies": teams.open_lobbies(db, student)}


# ------------------------------------------------------------------- matches
@router.get("/team-match/{match_id}")
def team_match(match_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    match = _match_or_404(db, student, match_id)
    row = db.scalar(
        select(TeamMatchPlayer).where(TeamMatchPlayer.match_id == match.id, TeamMatchPlayer.student_id == student.id)
    )
    if row is not None:
        row.last_seen = utcnow()
        db.commit()
    return teams.match_state(db, match, student.id)


@router.post("/team-match/{match_id}/answer")
def team_answer(match_id: int, payload: TeamMatchAnswerIn, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    match = _match_or_404(db, student, match_id)
    try:
        result = teams.submit_answer(db, match, student, payload.question_id, payload.selected, payload.elapsed_ms)
    except LobbyError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
    db.commit()
    return {"result": result, "state": teams.match_state(db, match, student.id)}


@router.get("/team-match/{match_id}/review")
def team_review(match_id: int, db: Session = Depends(get_db), student: Student = Depends(require_student)) -> dict:
    match = _match_or_404(db, student, match_id)
    row = db.scalar(
        select(TeamMatchPlayer).where(TeamMatchPlayer.match_id == match.id, TeamMatchPlayer.student_id == student.id)
    )
    items = []
    answers = dict(row.answers or {}) if row else {}
    for index, qid in enumerate(list((row.set_ids if row else None) or [])):
        question = db.get(Question, int(qid))
        if question is None:
            continue
        entry = answers.get(str(qid)) or {}
        items.append(
            {
                "position": index,
                "question_id": question.id,
                "question": question.text,
                "your_answer": entry.get("selected", ""),
                "correct_answer": question.correct,
                "correct": bool(entry.get("correct")) if entry else None,
                "unanswered": not entry,
                "why": question.explanation or "",
                "topic": question.topic or "",
                "difficulty": question.difficulty,
            }
        )
    teams_rows = []
    for team in (0, 1):
        members = []
        for player in teams.match_players(db, match.id):
            if player.team != team:
                continue
            s = db.get(Student, player.student_id)
            members.append(
                {
                    "student_id": player.student_id,
                    "name": s.name if s else "?",
                    "score": player.score,
                    "correct": player.correct,
                    "total": len(player.set_ids or []),
                    "accuracy": round(player.correct / max(1, len(player.set_ids or [])) * 100, 1),
                    "streak": player.best_streak,
                    "delta": player.rating_delta,
                    "xp": player.xp_awarded,
                    "coins": player.coins_awarded,
                    "you": player.student_id == student.id,
                }
            )
        teams_rows.append(
            {
                "team": team,
                "name": (match.team_names or ["Team 1", "Team 2"])[team],
                "score": sum(m["score"] for m in members),
                "members": members,
            }
        )
    return {
        "match": {
            "id": match.id,
            "status": match.status,
            "winner_team": match.winner_team,
            "team_size": match.team_size,
            "question_count": match.question_count,
        },
        "teams": teams_rows,
        "items": items,
    }
