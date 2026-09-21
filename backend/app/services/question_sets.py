"""One reusable question-assignment system for every multiplayer mode.

Global rule: in any competitive activity with two or more players, nobody
shares a question set. The server — never a browser — picks each player's
questions at random from the same pool, keeps the difficulty shape identical
across players (e.g. 5 easy + 5 medium + 2 hard each, but different questions),
never repeats a question inside one player's set, and avoids handing the same
question to two players in the same match whenever the bank is large enough.

Two modes, one entry point:

``strict=True``  – for matches where every player is known up front (duels,
    ranked matches, room nights). Requires enough unique questions for the
    full anti-overlap guarantee and raises :class:`NotEnoughQuestionsError`
    ("Not enough unique questions are available for this match.") instead of
    silently reusing anything.

``strict=False`` – for activities players trickle into over hours (group
    quizzes, arena events). Best effort: fresh questions first, then the
    globally least-used ones, never a repeat inside a player's own set, and
    never a blocked join. ``usage_counts`` tells the picker how often each
    question was already served in this activity.

Single-player modes keep their own selection logic and never call this.
"""
from __future__ import annotations

import random as _random
from collections import Counter
from typing import Any, Iterable, Sequence

NOT_ENOUGH_MESSAGE = "Not enough unique questions are available for this match."


class NotEnoughQuestionsError(Exception):
    """The bank cannot cover this match without reusing questions."""

    def __init__(self, message: str = NOT_ENOUGH_MESSAGE) -> None:
        super().__init__(message)


def _difficulty_of(question: Any) -> str:
    return ((getattr(question, "difficulty", "") or "").strip().lower()) or "mixed"


def _qid(question: Any) -> int:
    return int(question.id)


def difficulty_distribution(pool: Sequence[Any], per_player: int) -> dict[str, int]:
    """Mirror the pool's difficulty mix in each player's set (largest remainder).

    A 10-question draw from a pool that is 50% easy / 30% medium / 20% hard
    becomes {easy: 5, medium: 3, hard: 2} for *every* player — same shape,
    different questions.
    """
    counts = Counter(_difficulty_of(q) for q in pool)
    total = sum(counts.values())
    per_player = max(0, min(int(per_player), total))
    if per_player == 0 or total == 0:
        return {}
    raw = {d: counts[d] * per_player / total for d in counts}
    base = {d: int(raw[d]) for d in counts}
    remainder = per_player - sum(base.values())
    order = sorted(counts, key=lambda d: (-(raw[d] - base[d]), -counts[d], d))
    for d in order[:remainder]:
        base[d] += 1
    return {d: n for d, n in base.items() if n > 0}


def _buckets(pool: Iterable[Any], rng: Any) -> dict[str, list[Any]]:
    buckets: dict[str, list[Any]] = {}
    for question in pool:
        buckets.setdefault(_difficulty_of(question), []).append(question)
    for row in buckets.values():
        rng.shuffle(row)
    return buckets


def _normalise(dist: dict[str, int] | None, pool: Sequence[Any], per_player: int) -> dict[str, int]:
    if not dist:
        return difficulty_distribution(pool, per_player)
    normalised = {
        (str(k).strip().lower() or "mixed"): max(0, int(v))
        for k, v in dist.items()
    }
    normalised = {d: n for d, n in normalised.items() if n > 0}
    short = per_player - sum(normalised.values())
    if short > 0:  # top up proportionally so every set has exactly per_player questions
        extra = difficulty_distribution(pool, short)
        for d, n in extra.items():
            normalised[d] = normalised.get(d, 0) + n
    return normalised


def _strict_sets(
    pool: Sequence[Any],
    players: Sequence[Any],
    per_player: int,
    dist: dict[str, int],
    rng: Any,
) -> dict[Any, list[Any]]:
    buckets = _buckets(pool, rng)
    n = len(players)
    if len(pool) < per_player * n:
        raise NotEnoughQuestionsError()
    for difficulty, need in dist.items():
        if len(buckets.get(difficulty, [])) < need * n:
            raise NotEnoughQuestionsError()
    sets: dict[Any, list[Any]] = {p: [] for p in players}
    for difficulty, need in dist.items():
        draw = buckets[difficulty][: need * n]
        for index, player in enumerate(players):
            sets[player].extend(draw[index * need : (index + 1) * need])
    for row in sets.values():
        rng.shuffle(row)
    return sets


def _relaxed_sets(
    pool: Sequence[Any],
    players: Sequence[Any],
    per_player: int,
    dist: dict[str, int],
    usage: dict[int, int],
    rng: Any,
) -> dict[Any, list[Any]]:
    buckets = _buckets(pool, rng)
    by_id = {_qid(q): q for q in pool}
    taken_now: Counter[int] = Counter()  # handed out during this call
    sets: dict[Any, list[Any]] = {p: [] for p in players}

    def cost(qid: int) -> tuple[int, int]:
        return (usage.get(qid, 0) + taken_now[qid], taken_now[qid])

    def fresh(difficulty: str | None, own: set[int]) -> Any | None:
        order = [difficulty] if difficulty else list(buckets.keys())
        if difficulty is None:
            rng.shuffle(order)
        for key in order:
            for question in buckets.get(key, []):
                qid = _qid(question)
                if qid in own or taken_now[qid] or usage.get(qid, 0):
                    continue
                return question
        return None

    def least_used(own: set[int]) -> Any | None:
        candidates = [q for q in pool if _qid(q) not in own]
        if not candidates:
            return None
        candidates.sort(key=lambda q: (cost(_qid(q)), rng.random()))
        return candidates[0]

    for player in players:
        schedule: list[str | None] = []
        for difficulty, need in dist.items():
            schedule += [difficulty] * need
        rng.shuffle(schedule)
        own: set[int] = set()
        for difficulty in schedule:
            question = fresh(difficulty, own) or fresh(None, own) or least_used(own)
            if question is None:
                break  # the whole bank is inside this player's set already
            qid = _qid(question)
            sets[player].append(question)
            own.add(qid)
            taken_now[qid] += 1
    return sets


def create_multiplayer_question_sets(
    question_pool: Sequence[Any],
    player_ids: Sequence[Any],
    questions_per_player: int,
    difficulty_distribution: dict[str, int] | None = None,
    *,
    usage_counts: dict[int, int] | None = None,
    strict: bool = True,
    rng: Any = None,
) -> dict[Any, list[Any]]:
    """Assign every player their own random, non-overlapping question set.

    Returns ``{player_id: [Question, ...]}`` — each list has exactly
    ``questions_per_player`` items in strict mode (or as many as the bank can
    offer without repeats in relaxed mode), shares one difficulty shape across
    players, and never repeats a question inside a single player's set.
    """
    rng = rng or _random
    players = [p for p in dict.fromkeys(player_ids)]
    pool = list(question_pool)
    if not players:
        return {}
    if strict:
        # No silent shrink: a strict match either gets exactly what it asked
        # for, uniquely per player, or it does not happen at all.
        per_player = max(0, int(questions_per_player))
        if per_player == 0:
            return {p: [] for p in players}
        if len(pool) < per_player * len(players):
            raise NotEnoughQuestionsError()
    else:
        # Trickle-in activities never block a joiner: serve what the bank has.
        per_player = max(0, min(int(questions_per_player), len(pool)))
        if per_player == 0 or not pool:
            return {p: [] for p in players}
    dist = _normalise(difficulty_distribution, pool, per_player)
    if strict:
        return _strict_sets(pool, players, per_player, dist, rng)
    return _relaxed_sets(pool, players, per_player, dist, dict(usage_counts or {}), rng)
