"""Pydantic request bodies + a few response envelopes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from .security import is_valid_phone, normalize_phone

OptionKey = Literal["A", "B", "C", "D"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
USERNAME_RE = r"^[a-zA-Z0-9_]{3,20}$"


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    phone: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=6, max_length=72)
    display_name: str | None = Field(default=None, max_length=160)

    @field_validator("username")
    @classmethod
    def _valid_username(cls, value: str) -> str:
        import re

        cleaned = value.strip().lower()
        if not re.match(USERNAME_RE, cleaned):
            raise ValueError("Username: 3-20 letters, numbers or underscore")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if not is_valid_phone(normalized):
            raise ValueError("Enter a valid 11-digit Nigerian phone number")
        return normalized


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=40)  # phone number or username
    password: str = Field(min_length=1, max_length=72)


class PhoneLoginRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=20)
    display_name: str | None = Field(default=None, max_length=160)

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if not is_valid_phone(normalized):
            raise ValueError("Enter a valid 11-digit Nigerian phone number, e.g. 08031234567")
        return normalized


class ChatSendIn(BaseModel):
    to: int
    kind: Literal["text", "duel", "quiz"] = "text"
    body: str = Field(default="", max_length=600)
    meta: dict[str, Any] = Field(default_factory=dict)


class ChatEditIn(BaseModel):
    body: str = Field(min_length=1, max_length=600)


class ChatReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class ChatReportIn(BaseModel):
    """A report carries the reporter's words only — never the private thread."""

    reason: str = Field(default="", max_length=400)


class PhoneLookupRequest(BaseModel):
    """Pre-flight check: does this number already own an arena profile?"""

    phone: str = Field(min_length=7, max_length=20)

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if not is_valid_phone(normalized):
            raise ValueError("Enter a valid 11-digit Nigerian phone number, e.g. 08031234567")
        return normalized


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class SessionResponse(BaseModel):
    token: str
    role: Literal["student", "admin"]
    profile: dict[str, Any]


# ---------------------------------------------------------------------------
# Content authoring (admin)
# ---------------------------------------------------------------------------
class CourseIn(BaseModel):
    code: str = Field(min_length=2, max_length=24)
    title: str = Field(min_length=2, max_length=180)
    description: str = ""
    credit_units: int = 3
    semester: str = "First Semester"
    lecturer: str = ""
    accent: Literal["red", "violet", "blue", "amber"] = "violet"
    is_active: bool = True


class PhotoIn(BaseModel):
    image: str  # data URL: data:image/(jpeg|png|webp);base64,...


class BankDrawIn(BaseModel):
    count: int = Field(default=20, ge=1, le=200)


class QuestionIn(BaseModel):
    """Admin question payload.

    ``correct`` is validated against the canonical A–D answer space (or sorted
    multi-keys such as ``"AC"`` for multi-answer types) and *never* defaulted —
    an invalid answer is rejected with a clear message instead of becoming A.
    """

    text: str = Field(min_length=3)
    option_a: str = Field(min_length=1)
    option_b: str = Field(min_length=1)
    option_c: str = ""
    option_d: str = ""
    correct: str = ""
    explanation: str = ""
    points: int = 1
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    position: int | None = None
    question_type: str = "mcq"
    topic: str = ""
    subtopic: str = ""
    objective: str = ""
    tags: list[str] = Field(default_factory=list)
    source: str = ""
    reference: str = ""
    author: str = ""
    hint: str = ""
    admin_notes: str = ""
    media: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)
    status: Literal["draft", "approved", "rejected", "archived"] = "approved"
    visible: bool = True
    flag_reason: str = ""
    order_locked: bool = False
    flashcard_enabled: bool = True
    duel_enabled: bool = True
    practice_enabled: bool = True
    time_limit_seconds: int = 0
    quiz_id: int | None = None
    course_id: int | None = None

    @field_validator("correct")
    @classmethod
    def _valid_answer(cls, value: str, info: ValidationInfo) -> str:
        from .services.questions import AnswerValidationError, normalize_answer

        # The answer may be a letter (B) or the exact text of the correct
        # option ("Savigny") — resolved here against the sibling option fields
        # so uploads never depend on display order.
        options = {
            "A": str(info.data.get("option_a") or ""),
            "B": str(info.data.get("option_b") or ""),
            "C": str(info.data.get("option_c") or ""),
            "D": str(info.data.get("option_d") or ""),
        }
        try:
            return normalize_answer(value, allow_multi=True, options=options)
        except AnswerValidationError as error:
            raise ValueError(error.message) from error

    @field_validator("question_type")
    @classmethod
    def _valid_type(cls, value: str) -> str:
        from .services.questions import QUESTION_TYPES

        cleaned = (value or "mcq").strip().lower()
        if cleaned not in QUESTION_TYPES:
            raise ValueError(f"Unknown question type “{value}”")
        return cleaned

    @field_validator("difficulty")
    @classmethod
    def _valid_difficulty(cls, value: str) -> str:
        cleaned = (value or "medium").strip().lower()
        if cleaned not in {"easy", "medium", "hard"}:
            raise ValueError("Difficulty must be easy, medium or hard")
        return cleaned


class QuestionBulkIn(BaseModel):
    """Bulk import: either structured questions or a raw pasted paper."""

    questions: list[QuestionIn] = Field(default_factory=list)
    raw: str = ""
    mode: Literal["append", "replace"] = "append"
    default_points: int = 1
    default_difficulty: Literal["easy", "medium", "hard"] = "medium"
    skip_duplicates: bool = True


class QuestionPatchIn(BaseModel):
    """Partial edit — only the fields present are written."""

    model_config = ConfigDict(extra="ignore")

    text: str | None = None
    option_a: str | None = None
    option_b: str | None = None
    option_c: str | None = None
    option_d: str | None = None
    correct: str | None = None
    explanation: str | None = None
    points: int | None = None
    difficulty: str | None = None
    position: int | None = None
    question_type: str | None = None
    topic: str | None = None
    subtopic: str | None = None
    objective: str | None = None
    tags: list[str] | None = None
    source: str | None = None
    reference: str | None = None
    author: str | None = None
    hint: str | None = None
    admin_notes: str | None = None
    media: dict[str, Any] | None = None
    content: dict[str, Any] | None = None
    status: str | None = None
    visible: bool | None = None
    flag_reason: str | None = None
    order_locked: bool | None = None
    flashcard_enabled: bool | None = None
    duel_enabled: bool | None = None
    practice_enabled: bool | None = None
    time_limit_seconds: int | None = None
    quiz_id: int | None = None
    course_id: int | None = None


class QuestionBulkActionIn(BaseModel):
    ids: list[int] = Field(min_length=1)
    action: Literal[
        "delete",
        "archive",
        "publish",
        "draft",
        "flag",
        "unflag",
        "tag",
        "untag",
        "difficulty",
        "points",
        "answer",
        "move",
        "duplicate",
        "topic",
        "status",
        "toggle_mode",
    ]
    value: str = ""
    tags: list[str] = Field(default_factory=list)
    quiz_id: int | None = None
    topic: str = ""
    difficulty: str = ""
    points: int | None = None
    correct: str | None = None
    status: str | None = None
    mode: str = ""  # flashcard|duel|practice for toggle_mode
    enabled: bool = True


class QuestionFlagIn(BaseModel):
    reason: str = "unclear"
    note: str = ""


class QuestionImportIn(BaseModel):
    raw: str = ""
    payload: dict[str, Any] | list[Any] | None = None
    quiz_id: int | None = None
    course_id: int | None = None
    mode: Literal["append", "replace"] = "append"
    skip_duplicates: bool = True
    publish: bool = True


class QuestionOrderIn(BaseModel):
    ids: list[int] = Field(min_length=1)
    lock: bool = False


class BlueprintIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    course_id: int | None = None
    quiz_id: int | None = None
    is_template: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class BlueprintGenerateIn(BaseModel):
    quiz_id: int | None = None
    title: str = ""
    versions: int = Field(default=1, ge=1, le=6)
    activate: bool = False


class QuizDuplicateIn(BaseModel):
    title: str = ""
    with_questions: bool = True
    as_template: bool = False


class FlashcardDeckIn(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    description: str = ""
    kind: Literal[
        "custom", "course", "topic", "difficulty", "weakness", "wrong", "favorites", "recent", "mixed", "admin"
    ] = "custom"
    config: dict[str, Any] = Field(default_factory=dict)
    is_public: bool = False


class FlashcardGradeIn(BaseModel):
    card_id: int | None = None
    question_id: int
    grade: Literal["again", "hard", "good", "easy"]
    mode: Literal["q_to_a", "a_to_q"] = "q_to_a"
    elapsed_ms: int = 0


class FlashcardNoteIn(BaseModel):
    card_id: int
    notes: str = ""
    bookmarked: bool | None = None


class PracticeStartIn(BaseModel):
    mode: str = "sprint"
    # 0 means "use the mode's own default size" — the UI sends it when the player
    # has not picked a length. The upper bound is only a sanity guard: custom
    # practice is capped by what the chosen topic's bank actually holds.
    size: int = Field(default=0, ge=0, le=200)
    course_id: int | None = None
    quiz_id: int | None = None
    topic: str = ""
    difficulty: str = ""
    adaptive: bool = True
    time_limit_seconds: int = 0
    lives: int = 1
    target_score: int = 0


class PracticeAnswerIn(BaseModel):
    token: str
    question_id: int
    selected: str | None = None
    elapsed_ms: int = 0
    combo: int = 0
    risk: int = 0
    powerup: str = ""


class BossStartIn(BaseModel):
    boss_key: Literal["boss_quiz", "final_boss", "daily_boss", "weekly_boss", "community"] = "boss_quiz"
    course_id: int | None = None
    size: int = Field(default=0, ge=0, le=40)
    lives: int = Field(default=3, ge=1, le=5)
    difficulty: str = "hard"


class BossAnswerIn(BaseModel):
    run_id: int
    question_id: int
    selected: str | None = None
    elapsed_ms: int = 0
    combo: int = 0
    powerup: str = ""


class TournamentIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    scope: Literal["weekly", "monthly", "campus", "course", "class"] = "weekly"
    kind: Literal["ladder", "bracket"] = "ladder"
    course_id: int | None = None
    scope_value: str = ""
    size: int = Field(default=8, ge=2, le=32)
    prize_xp: int = 500
    prize_coins: int = 300


class StudyGroupIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    description: str = ""
    course_id: int | None = None
    goal: str = ""


class GroupMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=600)


class DuelSeriesIn(BaseModel):
    quiz_id: int | None = None
    course_id: int | None = None
    topic: str = ""
    question_count: int = Field(default=10, ge=3, le=30)
    stake_coins: int = 0
    best_of: Literal[1, 3, 5] = 1
    mode: Literal["casual", "ranked", "friendly", "tournament"] = "casual"
    difficulty: str = ""
    opponent_id: int | None = None
    opponent_phone: str = ""
    sudden_death: bool = False


class QuizIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    course_id: int | None = None
    instructions: str = ""
    duration_minutes: int = Field(default=25, ge=1, le=300)
    status: Literal["draft", "scheduled", "active", "completed"] = "scheduled"
    scheduled_at: datetime | None = None
    end_at: datetime | None = None
    shuffle_questions: bool = True
    allow_duel: bool = True
    rules: str = ""
    version_label: str = Field(default="", max_length=12)
    template_of: int | None = None
    blueprint_id: int | None = None
    shuffle_options: bool = False
    per_question_seconds: int = Field(default=0, ge=0, le=3600)
    grace_seconds: int = Field(default=0, ge=0, le=600)
    auto_submit: bool = True
    calculator: bool = False
    review_before_submit: bool = True
    max_attempts: int = Field(default=1, ge=0, le=50)
    practice_mode: bool = False


class QuizBuilderIn(BaseModel):
    """Partial builder update — nothing is required, only sent fields change."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    course_id: int | None = None
    instructions: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=300)
    status: Literal["draft", "scheduled", "active", "completed"] | None = None
    scheduled_at: datetime | None = None
    end_at: datetime | None = None
    shuffle_questions: bool | None = None
    allow_duel: bool | None = None
    rules: str | None = None
    version_label: str | None = Field(default=None, max_length=12)
    blueprint_id: int | None = None
    shuffle_options: bool | None = None
    per_question_seconds: int | None = Field(default=None, ge=0, le=3600)
    grace_seconds: int | None = Field(default=None, ge=0, le=600)
    auto_submit: bool | None = None
    calculator: bool | None = None
    review_before_submit: bool | None = None
    max_attempts: int | None = Field(default=None, ge=0, le=50)
    practice_mode: bool | None = None


class QuizStatusIn(BaseModel):
    status: Literal["draft", "scheduled", "active", "completed"]


class StudentIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    phone: str = Field(min_length=7, max_length=20)
    reg_no: str | None = None
    level: str = "400 Level"
    faculty: str = "Faculty of Law"
    campus: str = "UNEC (Enugu Campus)"
    class_name: str = "030 Law Class"

    @field_validator("phone")
    @classmethod
    def _valid(cls, value: str) -> str:
        normalized = normalize_phone(value)
        if not is_valid_phone(normalized):
            raise ValueError("Enter a valid 11-digit Nigerian phone number")
        return normalized


class NotificationIn(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    message: str = ""
    kind: Literal["exam", "result", "duel", "prize", "general"] = "general"
    target_course: str = ""
    is_pinned: bool = False


class PrizeIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = ""
    tier: Literal["platinum", "gold", "silver", "bronze"] = "gold"
    kind: Literal["rank", "coins"] = "rank"
    min_rank: int = 1
    max_rank: int = 1
    cost_coins: int = 0
    icon: str = "gift"
    stock: int = -1
    is_active: bool = True
    sort_order: int = 0


class ConfigIn(BaseModel):
    institution: str | None = None
    campus: str | None = None
    faculty: str | None = None
    season_name: str | None = None
    prize_pool_note: str | None = None
    grading_scale: list[dict[str, Any]] | None = None
    duels_enabled: bool | None = None
    exams_enabled: bool | None = None


class ClaimStatusIn(BaseModel):
    status: Literal["pending", "approved", "delivered", "rejected"]
    note: str = ""


# ---------------------------------------------------------------------------
# Gameplay
# ---------------------------------------------------------------------------
class AnswerIn(BaseModel):
    question_id: int
    selected: OptionKey | None = None
    seconds_spent: float = Field(default=0.0, ge=0)
    flagged: bool | None = None


class SubmitIn(BaseModel):
    submission_type: Literal["early", "auto_timer"] = "early"


class DuelCreateIn(BaseModel):
    opponent_phone: str | None = None
    opponent_id: int | None = None
    quiz_id: int | None = None
    course_id: int | None = None
    topic: str = "General Arena"
    question_count: int = Field(default=10, ge=3, le=100)
    stake_coins: int = Field(default=25, ge=0, le=500)
    mode: Literal["casual", "ranked", "friendly", "tournament"] = "casual"
    best_of: Literal[1, 3, 5] = 1
    difficulty: str = ""
    sudden_death: bool = False

    @field_validator("opponent_phone")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value else None


class DuelActionIn(BaseModel):
    pass


class CreateRoomIn(BaseModel):
    """Host settings for a new multiplayer room."""

    title: str = "Arena Room"
    course_id: int | None = None
    question_count: int = 10
    per_question_seconds: int = 30


class RoomAnswerIn(BaseModel):
    selected: str
    elapsed_ms: int = 0


class DuelAnswerIn(BaseModel):
    question_id: int
    selected: OptionKey
    elapsed_ms: int = Field(default=0, ge=0)


class FriendRequestIn(BaseModel):
    phone: str | None = None
    student_id: int | None = None
    code: str | None = None

    @field_validator("phone")
    @classmethod
    def _normalize(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value else None


class ProfileUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    avatar_hue: int | None = Field(default=None, ge=0, le=360)
    bio: str | None = Field(default=None, max_length=240)
    status_text: str | None = Field(default=None, max_length=80)


class RushItem(BaseModel):
    question_id: int
    answer: str = ""


class RushGradeIn(BaseModel):
    mode: Literal["blitz", "sudden"]
    issued_at: str
    items: list[RushItem] = Field(default_factory=list)


class DailySubmitIn(BaseModel):
    day: str
    items: list[RushItem] = Field(default_factory=list)


class FlashLogIn(BaseModel):
    reviewed: int = Field(default=0, ge=0, le=200)
    known: int = Field(default=0, ge=0, le=200)


class HelpAskIn(BaseModel):
    to: int
    question_id: int


class HelpAnswerIn(BaseModel):
    answer: str = Field(min_length=1, max_length=1)


class ShopBuyIn(BaseModel):
    sku: str


class MatchGradeIn(BaseModel):
    issued_at: str
    moves: int = Field(default=0, ge=0, le=500)
    matched: int = Field(default=0, ge=0, le=12)
    elapsed_ms: int = Field(default=0, ge=0, le=3_600_000)


class ClaimPrizeIn(BaseModel):
    note: str = ""

# ---------------------------------------------------------------- materials
class MaterialSectionIn(BaseModel):
    id: int | None = None
    title: str = Field(default="", max_length=200)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    estimated_minutes: int = Field(default=3, ge=1, le=120)
    check_enabled: bool = False


class MaterialIn(BaseModel):
    title: str = Field(default="", max_length=200)
    course_id: int | None = None
    quiz_id: int | None = None
    topic: str = Field(default="", max_length=120)
    subtopic: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=500)
    difficulty: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    estimated_minutes: int = Field(default=10, ge=1, le=600)
    tags: list[str] = Field(default_factory=list)
    summary: list[str] = Field(default_factory=list)
    author: str = Field(default="", max_length=120)
    status: Literal["draft", "published", "archived"] = "draft"
    icon: str = Field(default="book", max_length=40)
    accent: str = Field(default="violet", max_length=16)
    allow_discussion: bool = True
    sections: list[MaterialSectionIn] | None = None


class MaterialProgressIn(BaseModel):
    section_id: int | None = None
    seconds: int = Field(default=0, ge=0, le=3600)


class MaterialHighlightIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    colour: Literal["yellow", "blue", "green", "red"] = "yellow"
    section_id: int | None = None
    note: str = Field(default="", max_length=300)


class MaterialNoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    section_id: int | None = None
    quote: str = Field(default="", max_length=600)


class MaterialBookmarkIn(BaseModel):
    section_id: int | None = None
    label: str = Field(default="", max_length=200)
    snippet: str = Field(default="", max_length=600)
    position: str = Field(default="", max_length=40)


class MaterialConfusionIn(BaseModel):
    section_id: int | None = None
    quote: str = Field(default="", max_length=800)
    question: str = Field(default="", max_length=600)
    friend_ids: list[int] = Field(default_factory=list)
    group_id: int | None = None


class MaterialPostIn(BaseModel):
    body: str = Field(min_length=1, max_length=1500)
    section_id: int | None = None
    parent_id: int | None = None
    kind: Literal["question", "answer", "tip"] = "question"
    quote: str = Field(default="", max_length=600)


class MaterialLinkQuestionsIn(BaseModel):
    question_ids: list[int] = Field(default_factory=list, max_length=500)
    section_id: int | None = None


class SelfTestAnswerIn(BaseModel):
    question_id: int
    choice: str = Field(min_length=1, max_length=8)


class MaterialFeedbackIn(BaseModel):
    verdict: Literal["yes", "somewhat", "no"] = "yes"
    comment: str = Field(default="", max_length=400)


# ------------------------------------------------------------- game + study
class StudySessionIn(BaseModel):
    mode: Literal["material", "flashcards", "questions", "mixed"] = "mixed"
    planned_minutes: int = Field(default=25, ge=1, le=180)


class StudySessionFinishIn(BaseModel):
    session_id: int
    seconds: int = Field(default=0, ge=0, le=60 * 60 * 6)
    completed: bool = False


class GameSessionStartIn(BaseModel):
    mode: Literal["survival", "score_attack", "time_trial", "daily"] = "survival"


class GameSessionFinishIn(BaseModel):
    session_id: int
    score: int = Field(default=0, ge=0, le=10_000_000)
    seconds: int = Field(default=0, ge=0, le=60 * 60)
    combo: int = Field(default=0, ge=0, le=100_000)
    collected: int = Field(default=0, ge=0, le=100_000)
    wave: int = Field(default=0, ge=0, le=10_000)


class GameChallengeIn(BaseModel):
    opponent_id: int
    mode: Literal["survival", "score_attack", "time_trial"] = "score_attack"
    target_score: int = Field(default=0, ge=0, le=10_000_000)
    target_seconds: int = Field(default=0, ge=0, le=600)


class GameCosmeticsIn(BaseModel):
    character: str | None = Field(default=None, max_length=24)
    trail: str | None = Field(default=None, max_length=24)


class RankedQueueIn(BaseModel):
    """Join the matchmaking queue for one course."""

    course_id: int


class RankedAnswerIn(BaseModel):
    selected: str
    elapsed_ms: int = 0


class EventCreateIn(BaseModel):
    """Admin fields for a new arena event."""

    name: str = Field(min_length=3, max_length=160)
    description: str = ""
    course_id: int | None = None
    topics: list[str] = []
    starts_at: datetime
    ends_at: datetime
    question_count: int = Field(default=15, ge=3, le=100)
    time_mode: Literal["untimed", "fixed", "per_question"] = "fixed"
    duration_minutes: int = Field(default=20, ge=1, le=600)
    per_question_seconds: int = Field(default=30, ge=5, le=300)
    entry_xp: int = Field(default=0, ge=0, le=100_000)
    visibility: Literal["public", "course"] = "public"
    rewards: dict = {}
    banner: str = ""
    scoring_note: str = ""
    allow_join_during: bool = True
    allow_leave: bool = True
    leaderboard_visible: bool = True


class EventUpdateIn(BaseModel):
    """Admin edits to an event that has not finished."""

    name: str | None = None
    description: str | None = None
    topics: list[str] | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    question_count: int | None = Field(default=None, ge=3, le=100)
    time_mode: Literal["untimed", "fixed", "per_question"] | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    per_question_seconds: int | None = Field(default=None, ge=5, le=300)
    entry_xp: int | None = Field(default=None, ge=0, le=100_000)
    visibility: Literal["public", "course"] | None = None
    rewards: dict | None = None
    banner: str | None = None
    scoring_note: str | None = None
    allow_join_during: bool | None = None
    allow_leave: bool | None = None
    leaderboard_visible: bool | None = None
    status: Literal["scheduled", "live", "finished", "cancelled"] | None = None


class EventAnswerIn(BaseModel):
    selected: str
    elapsed_ms: int = 0


def _naive_utc(value: datetime) -> datetime:
    """Events are stored naive-UTC (SQLite convention across the app)."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


class _NaiveUtc(BaseModel):
    """Mixin: normalizes any inbound datetime to naive UTC.

    Runs *after* parsing so it catches both native ``datetime`` objects and
    ISO-8601 strings (``...Z`` / ``+00:00``) that pydantic decodes into
    timezone-aware datetimes — the browser sends the latter, and an aware value
    stored on a model would later blow up when compared against naive UTC.
    """

    @field_validator("*", mode="after")
    @classmethod
    def _to_naive_utc(cls, value):  # noqa: ANN001
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class EventCreateInUtc(_NaiveUtc, EventCreateIn):
    pass


class EventUpdateInUtc(_NaiveUtc, EventUpdateIn):
    pass


# ---------------------------------------------------------------------------
# Study groups — the community workspace (chat, quizzes, Q&A, announcements)
# ---------------------------------------------------------------------------
class GroupSendIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    reply_to_id: int | None = None


class GroupEditIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class GroupReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class GroupAnnouncementIn(_NaiveUtc):
    title: str = Field(min_length=2, max_length=180)
    body: str = Field(default="", max_length=4000)
    image: str = ""
    priority: Literal["normal", "high"] = "normal"
    pinned: bool = False
    scheduled_at: datetime | None = None


class GroupAnnouncementPatchIn(_NaiveUtc):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    body: str | None = Field(default=None, max_length=4000)
    image: str | None = None
    priority: Literal["normal", "high"] | None = None
    pinned: bool | None = None
    scheduled_at: datetime | None = None


class GroupQuizIn(_NaiveUtc):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=1000)
    course_id: int | None = None
    topic: str = Field(default="", max_length=120)
    question_count: int = Field(default=10, ge=1, le=100)  # hard cap: 100 questions
    per_question_seconds: int = Field(default=30, ge=5, le=300)
    duration_minutes: int = Field(default=0, ge=0, le=240)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_attempts: int = Field(default=1, ge=0, le=10)  # 0 = unlimited
    randomize: bool = True
    visibility: Literal["group"] = "group"
    reward_xp: int = Field(default=0, ge=0, le=5000)
    reward_coins: int = Field(default=0, ge=0, le=5000)
    pass_score: int = Field(default=50, ge=0, le=100)


class GroupQuizAnswerIn(BaseModel):
    question_id: int
    selected: str = Field(min_length=1, max_length=8)
    elapsed_ms: int = Field(default=0, ge=0, le=600_000)


class GroupQuestionIn(BaseModel):
    title: str = Field(min_length=5, max_length=220)
    body: str = Field(default="", max_length=4000)
    course_id: int | None = None
    topic: str = Field(default="", max_length=120)
    attachment: str = Field(default="", max_length=400_000)  # optional image data URL


class GroupReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = None


class GroupDuelIn(BaseModel):
    opponent_id: int
    course_id: int | None = None
    topic: str = Field(default="", max_length=120)
    question_count: int = Field(default=10, ge=3, le=100)  # hard cap: 100 questions
    public: bool = True
    message: str = Field(default="", max_length=240)


class GroupInviteIn(BaseModel):
    student_id: int


class GroupRoleIn(BaseModel):
    role: Literal["moderator", "member"]


class GroupSettingsIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=140)
    description: str | None = Field(default=None, max_length=300)
    goal: str | None = Field(default=None, max_length=200)
    course_id: int | None = None
