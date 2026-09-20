"""ORM models — the single source of truth lives in SQLite (no JSON, no Firebase)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    """Naive UTC timestamp.

    SQLite has no native datetime type, so values come back tz-naive. Keeping
    every timestamp naive-UTC avoids offset-aware/naive comparison errors and
    serializes cleanly as ISO-8601 with a trailing ``Z``.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today() -> date:
    return utcnow().date()


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
class Student(Base):
    __tablename__ = "students"
    __table_args__ = (Index("ix_students_name", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(24), unique=True, index=True, default="")
    password_hash: Mapped[str] = mapped_column(String(120), default="")
    name: Mapped[str] = mapped_column(String(160))
    reg_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    faculty: Mapped[str] = mapped_column(String(120), default="Faculty of Law")
    campus: Mapped[str] = mapped_column(String(120), default="UNEC (Enugu Campus)")
    class_name: Mapped[str] = mapped_column(String(120), default="030 Law Class")
    level: Mapped[str] = mapped_column(String(40), default="400 Level")
    avatar_hue: Mapped[int] = mapped_column(Integer, default=265)
    photo: Mapped[str | None] = mapped_column(Text, nullable=True)  # base64 data URL, ≤ ~400KB

    # --- progression -------------------------------------------------------
    xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    # Diamonds are the prestige currency: only milestones, majors and events pay
    # them, and nothing in the arena can convert coins into diamonds.
    diamonds: Mapped[int] = mapped_column(Integer, default=0)
    # Equipped cosmetics, one key per slot: {"avatar": "mage", "aura": "fire", …}
    loadout: Mapped[str] = mapped_column(Text, default="{}")
    # Unopened chests by kind: {"common": 2, "rare": 1, "legendary": 0}
    chests: Mapped[str] = mapped_column(Text, default="{}")
    streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_active: Mapped[date | None] = mapped_column(Date, nullable=True)
    weekly_xp: Mapped[int] = mapped_column(Integer, default=0)
    week_key: Mapped[str] = mapped_column(String(10), default="")

    # --- record ------------------------------------------------------------
    exams_taken: Mapped[int] = mapped_column(Integer, default=0)
    exams_won: Mapped[int] = mapped_column(Integer, default=0)  # ranked #1 in a quiz
    best_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    duels_played: Mapped[int] = mapped_column(Integer, default=0)
    duels_won: Mapped[int] = mapped_column(Integer, default=0)
    duels_lost: Mapped[int] = mapped_column(Integer, default=0)
    ranked_rating: Mapped[int] = mapped_column(Integer, default=1000, index=True)
    ranked_played: Mapped[int] = mapped_column(Integer, default=0)
    ranked_won: Mapped[int] = mapped_column(Integer, default=0)
    correct_answers: Mapped[int] = mapped_column(Integer, default=0)
    questions_answered: Mapped[int] = mapped_column(Integer, default=0)
    best_run: Mapped[int] = mapped_column(Integer, default=0)  # longest correct streak

    # --- social & study ------------------------------------------------------
    bio: Mapped[str] = mapped_column(String(240), default="")
    status_text: Mapped[str] = mapped_column(String(80), default="")
    player_code: Mapped[str] = mapped_column(String(8), default="", index=True)
    flair: Mapped[str] = mapped_column(String(12), default="")  # "", gold, mint, flare, nova
    helper_points: Mapped[int] = mapped_column(Integer, default=0)
    streak_freezes: Mapped[int] = mapped_column(Integer, default=0)
    xp_boost_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_spin_at: Mapped[date | None] = mapped_column(Date, nullable=True)

    is_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempts: Mapped[list["Attempt"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    badges: Mapped[list["StudentBadge"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    activities: Mapped[list["Activity"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    cosmetics: Mapped[list["Cosmetic"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    milestones: Mapped[list["StudentMilestone"]] = relationship(back_populates="student", cascade="all, delete-orphan")


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="Administrator")
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="owner")  # owner | staff
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChatMessage(Base):
    """A direct message between two players (text, duel invite or quiz plan)."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text|duel|quiz
    body: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Editing keeps the original text so "edited" can be shown honestly, and
    # deletes are soft: both sides keep a tombstone instead of vanishing rows.
    edited_at: Mapped[datetime | None] = mapped_column(nullable=True)
    original_body: Mapped[str] = mapped_column(Text, default="")
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    # {"👍": [student_id, …]} — small enough to keep on the row.
    reactions: Mapped[str] = mapped_column(Text, default="{}")

    sender: Mapped["Student"] = relationship(foreign_keys=[sender_id])
    recipient: Mapped["Student"] = relationship(foreign_keys=[recipient_id])


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("student_id", "friend_id", name="uq_friendship_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    friend_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="accepted")  # pending | accepted
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(foreign_keys=[student_id])
    friend: Mapped[Student] = relationship(foreign_keys=[friend_id])


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------
class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    credit_units: Mapped[int] = mapped_column(Integer, default=3)
    semester: Mapped[str] = mapped_column(String(60), default="First Semester")
    lecturer: Mapped[str] = mapped_column(String(160), default="")
    accent: Mapped[str] = mapped_column(String(20), default="violet")  # red | violet | blue | amber
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    quizzes: Mapped[list["Quiz"]] = relationship(back_populates="course", cascade="all, delete-orphan")


class Quiz(Base):
    __tablename__ = "quizzes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200))
    instructions: Mapped[str] = mapped_column(Text, default="")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=25)
    status: Mapped[str] = mapped_column(String(16), default="scheduled", index=True)  # draft|scheduled|active|completed
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_duel: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # --- exam builder (next wave) -----------------------------------------
    rules: Mapped[str] = mapped_column(Text, default="")  # exam-rules screen copy
    version_label: Mapped[str] = mapped_column(String(12), default="")  # A / B / C / D
    template_of: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blueprint_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=False)
    per_question_seconds: Mapped[int] = mapped_column(Integer, default=0)  # 0 = one global clock
    grace_seconds: Mapped[int] = mapped_column(Integer, default=0)
    auto_submit: Mapped[bool] = mapped_column(Boolean, default=True)
    calculator: Mapped[bool] = mapped_column(Boolean, default=False)
    review_before_submit: Mapped[bool] = mapped_column(Boolean, default=True)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1)  # 0 = unlimited retakes
    practice_mode: Mapped[bool] = mapped_column(Boolean, default=False)

    course: Mapped[Course | None] = relationship(back_populates="quizzes")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan", order_by="Question.position"
    )
    attempts: Mapped[list["Attempt"]] = relationship(back_populates="quiz", cascade="all, delete-orphan")


QUESTION_TYPES = (
    "mcq",  # classic single-answer multiple choice (A-D) — the default
    "true_false",
    "multi_select",
    "fill_blank",
    "short_answer",
    "matching",
    "ordering",
    "image_choice",
    "audio",
    "scenario",
    "passage",
    "assertion_reason",
)


class Question(Base):
    """One exam question.

    ``Question.correct`` is the single authoritative answer field for the whole
    application — the stored value is exactly what the administrator chose.
    For the classic four-option shape it is one of ``A``/``B``/``C``/``D``. For
    multi-answer types (multiple select, ordering, matching) it holds the keys
    sorted, e.g. ``"AC"``. Nothing anywhere may infer an answer from option
    order, position, import order or cached client state.
    """

    __tablename__ = "questions"
    __table_args__ = (
        Index("ix_questions_quiz_position", "quiz_id", "position"),
        Index("ix_questions_course_status", "course_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("questions.id", ondelete="SET NULL"), nullable=True, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    option_a: Mapped[str] = mapped_column(Text, default="")
    option_b: Mapped[str] = mapped_column(Text, default="")
    option_c: Mapped[str] = mapped_column(Text, default="")
    option_d: Mapped[str] = mapped_column(Text, default="")
    correct: Mapped[str] = mapped_column(String(8), default="A")
    explanation: Mapped[str] = mapped_column(Text, default="")
    points: Mapped[int] = mapped_column(Integer, default=1)
    difficulty: Mapped[str] = mapped_column(String(12), default="medium")  # easy|medium|hard
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # --- classification & metadata (all optional, backwards compatible) -----
    question_type: Mapped[str] = mapped_column(String(24), default="mcq", index=True)
    topic: Mapped[str] = mapped_column(String(120), default="", index=True)
    subtopic: Mapped[str] = mapped_column(String(120), default="")
    objective: Mapped[str] = mapped_column(String(240), default="")  # learning objective
    tags: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(160), default="")  # textbook / past paper / lecturer
    reference: Mapped[str] = mapped_column(String(240), default="")
    author: Mapped[str] = mapped_column(String(120), default="")
    hint: Mapped[str] = mapped_column(Text, default="")
    admin_notes: Mapped[str] = mapped_column(Text, default="")
    media: Mapped[dict] = mapped_column(JSON, default=dict)
    content: Mapped[dict] = mapped_column(JSON, default=dict)  # flexible payload for new types

    # --- workflow ----------------------------------------------------------
    status: Mapped[str] = mapped_column(String(16), default="approved", index=True)  # draft|approved|rejected|archived
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    flag_reason: Mapped[str] = mapped_column(String(240), default="")
    flagged_by: Mapped[str] = mapped_column(String(120), default="")
    flagged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    order_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # --- mode eligibility --------------------------------------------------
    flashcard_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    duel_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    practice_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, default=0)  # 0 = inherit exam clock

    # --- bookkeeping & live analytics -------------------------------------
    version: Mapped[int] = mapped_column(Integer, default=1)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    total_ms: Mapped[int] = mapped_column(Integer, default=0)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    updated_by: Mapped[str] = mapped_column(String(120), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    quiz: Mapped[Quiz] = relationship(back_populates="questions")

    @property
    def options(self) -> dict[str, str]:
        return {"A": self.option_a, "B": self.option_b, "C": self.option_c, "D": self.option_d}

    @property
    def option_keys(self) -> list[str]:
        """Keys that actually carry option text (never inferred from order)."""
        return [key for key in ("A", "B", "C", "D") if (self.options.get(key) or "").strip()]

    @property
    def answer_keys(self) -> list[str]:
        """Canonical answers, split from the authoritative ``correct`` field."""
        raw = (self.correct or "").strip().upper()
        return [char for char in raw if char in "ABCD"]


class QuestionVersion(Base):
    """Immutable snapshot of a question after every save — history + restore."""

    __tablename__ = "question_versions"
    __table_args__ = (Index("ix_question_versions_question", "question_id", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    note: Mapped[str] = mapped_column(String(240), default="")
    author: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AuditLog(Base):
    """Who changed what, when — the staff console's audit trail."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(160), default="")
    role: Mapped[str] = mapped_column(String(20), default="staff")
    action: Mapped[str] = mapped_column(String(60), default="")
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[int] = mapped_column(Integer, default=0)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ContentReport(Base):
    """Player report about chat, material, question or a profile — the moderation queue.

    Deliberately stores the reporter's own words and a reference only: staff see
    *what was reported and why*, not the private conversation around it.
    """

    __tablename__ = "content_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), default="chat_message")  # chat_message|material|question|profile
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(String(400), default="")
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved|dismissed
    resolved_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class QuestionFlag(Base):
    """A player-reported problem with a question — feeds the review queue."""

    __tablename__ = "question_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(String(60), default="unclear")
    note: Mapped[str] = mapped_column(String(400), default="")
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved|dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Exams
# ---------------------------------------------------------------------------
class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint("quiz_id", "student_id", name="uq_attempt_per_student_quiz"),
        Index("ix_attempts_quiz_status", "quiz_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quiz_id: Mapped[int] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="in_progress")  # in_progress|submitted|expired
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    deadline_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    time_remaining_seconds: Mapped[int] = mapped_column(Integer, default=0)
    submission_type: Mapped[str] = mapped_column(String(16), default="early")  # early|auto_timer|expired

    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    unanswered_count: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[int] = mapped_column(Integer, default=0)
    percentage: Mapped[float] = mapped_column(Float, default=0.0)
    grade: Mapped[str] = mapped_column(String(4), default="-")
    xp_awarded: Mapped[int] = mapped_column(Integer, default=0)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0)
    flagged: Mapped[str] = mapped_column(JSON, default=list)  # list of question ids
    # Deterministic display order per question: {question_id: ["C","A","D","B"]}.
    # Option shuffling never touches Question.correct — it only changes which
    # display letter the player sees, and the server maps it back before grading.
    option_orders: Mapped[dict] = mapped_column(JSON, default=dict)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=False)
    # First time each question was put on screen: {question_id: ISO timestamp}.
    # Used to enforce per-question timers on the server, never in the browser.
    question_times: Mapped[dict] = mapped_column(JSON, default=dict)

    student: Mapped[Student] = relationship(back_populates="attempts")
    quiz: Mapped[Quiz] = relationship(back_populates="attempts")
    answers: Mapped[list["Answer"]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_answer_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    selected: Mapped[str | None] = mapped_column(String(1), nullable=True)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    seconds_spent: Mapped[float] = mapped_column(Float, default=0.0)
    answered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempt: Mapped[Attempt] = relationship(back_populates="answers")


# ---------------------------------------------------------------------------
# Duels (live head-to-head over websockets)
# ---------------------------------------------------------------------------
class Duel(Base):
    __tablename__ = "duels"
    __table_args__ = (Index("ix_duels_status", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    topic: Mapped[str] = mapped_column(String(160), default="General Arena")
    quiz_id: Mapped[int | None] = mapped_column(ForeignKey("quizzes.id", ondelete="SET NULL"), nullable=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    question_count: Mapped[int] = mapped_column(Integer, default=10)
    status: Mapped[str] = mapped_column(String(16), default="invited")  # invited|live|finished|cancelled|expired
    stake_coins: Mapped[int] = mapped_column(Integer, default=0)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, default=180)
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # --- competitive layer -------------------------------------------------
    mode: Mapped[str] = mapped_column(String(16), default="casual", index=True)  # casual|ranked|friendly|tournament
    best_of: Mapped[int] = mapped_column(Integer, default=1)  # 1 | 3 | 5
    series_id: Mapped[str] = mapped_column(String(24), default="", index=True)
    game_index: Mapped[int] = mapped_column(Integer, default=1)
    rematch_of: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tournament_id: Mapped[int | None] = mapped_column(ForeignKey("tournaments.id", ondelete="SET NULL"), nullable=True)
    topic_filter: Mapped[str] = mapped_column(String(120), default="")
    difficulty: Mapped[str] = mapped_column(String(12), default="")  # "", easy, medium, hard
    draw_on_tie: Mapped[bool] = mapped_column(Boolean, default=False)
    sudden_death: Mapped[bool] = mapped_column(Boolean, default=False)

    participants: Mapped[list["DuelParticipant"]] = relationship(
        back_populates="duel", cascade="all, delete-orphan", order_by="DuelParticipant.id"
    )
    questions: Mapped[list["DuelQuestion"]] = relationship(
        back_populates="duel", cascade="all, delete-orphan", order_by="DuelQuestion.position"
    )
    answers: Mapped[list["DuelAnswer"]] = relationship(back_populates="duel", cascade="all, delete-orphan")


class DuelParticipant(Base):
    __tablename__ = "duel_participants"
    __table_args__ = (UniqueConstraint("duel_id", "student_id", name="uq_duel_student"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    duel_id: Mapped[int] = mapped_column(ForeignKey("duels.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    seat: Mapped[str] = mapped_column(String(12), default="challenger")  # challenger | opponent
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    answered_count: Mapped[int] = mapped_column(Integer, default=0)
    best_run: Mapped[int] = mapped_column(Integer, default=0)
    current_run: Mapped[int] = mapped_column(Integer, default=0)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    forfeited: Mapped[bool] = mapped_column(Boolean, default=False)

    duel: Mapped[Duel] = relationship(back_populates="participants")
    student: Mapped[Student] = relationship()


class DuelQuestion(Base):
    __tablename__ = "duel_questions"
    __table_args__ = (UniqueConstraint("duel_id", "position", name="uq_duel_question_order"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    duel_id: Mapped[int] = mapped_column(ForeignKey("duels.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    duel: Mapped[Duel] = relationship(back_populates="questions")
    question: Mapped[Question] = relationship()


class DuelAnswer(Base):
    __tablename__ = "duel_answers"
    __table_args__ = (UniqueConstraint("duel_id", "student_id", "question_id", name="uq_duel_answer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    duel_id: Mapped[int] = mapped_column(ForeignKey("duels.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    selected: Mapped[str] = mapped_column(String(1))
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    points: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    duel: Mapped[Duel] = relationship(back_populates="answers")


# ---------------------------------------------------------------------------
# Rewards, social proof, broadcasts
# ---------------------------------------------------------------------------
class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(240), default="")
    icon: Mapped[str] = mapped_column(String(40), default="trophy")
    tier: Mapped[str] = mapped_column(String(16), default="bronze")  # bronze|silver|gold|platinum
    xp_reward: Mapped[int] = mapped_column(Integer, default=0)
    coin_reward: Mapped[int] = mapped_column(Integer, default=0)


class Room(Base):
    """A multiplayer quiz-night room: host + up to 14 guests, live rounds and chat."""

    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="Arena Room")
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    question_count: Mapped[int] = mapped_column(Integer, default=10)
    per_question_seconds: Mapped[int] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String(16), default="lobby", index=True)  # lobby|live|finished
    round_index: Mapped[int] = mapped_column(Integer, default=-1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (Index("ix_room_member_unique", "room_id", "student_id", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RoomQuestion(Base):
    __tablename__ = "room_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class RoomAnswer(Base):
    __tablename__ = "room_answers"
    __table_args__ = (Index("ix_room_answer_unique", "room_id", "question_id", "student_id", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    selected: Mapped[str] = mapped_column(String(1), default="")
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)


class RoomMessage(Base):
    __tablename__ = "room_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Ranked multiplayer (matchmade competitive matches)
# ---------------------------------------------------------------------------

class RankedQueue(Base):
    """One row per player per course waiting for a ranked match."""

    __tablename__ = "ranked_queue"
    __table_args__ = (UniqueConstraint("course_id", "student_id", name="uq_ranked_queue"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    rating: Mapped[int] = mapped_column(Integer, default=1000)  # snapshot for fair pairing
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class RankedMatch(Base):
    """A server-matchmade competitive match: everyone answers the same
    questions on a shared server clock; ratings move at the end."""

    __tablename__ = "ranked_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="lobby", index=True)  # lobby|live|finished
    question_count: Mapped[int] = mapped_column(Integer, default=10)
    per_question_seconds: Mapped[int] = mapped_column(Integer, default=20)
    round_index: Mapped[int] = mapped_column(Integer, default=-1)
    lobby_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # countdown end
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RankedQuestion(Base):
    __tablename__ = "ranked_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("ranked_matches.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class RankedParticipant(Base):
    __tablename__ = "ranked_participants"
    __table_args__ = (UniqueConstraint("match_id", "student_id", name="uq_ranked_participant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("ranked_matches.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    rating_before: Mapped[int] = mapped_column(Integer, default=1000)
    rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    answered: Mapped[int] = mapped_column(Integer, default=0)  # questions completed
    streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-based final place
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RankedAnswer(Base):
    __tablename__ = "ranked_answers"
    __table_args__ = (Index("ix_ranked_answer_unique", "match_id", "question_id", "student_id", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("ranked_matches.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    selected: Mapped[str] = mapped_column(String(8), default="")
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StudentBadge(Base):
    __tablename__ = "student_badges"
    __table_args__ = (UniqueConstraint("student_id", "badge_id", name="uq_student_badge"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    badge_id: Mapped[int] = mapped_column(ForeignKey("badges.id", ondelete="CASCADE"), index=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="badges")
    badge: Mapped[Badge] = relationship()


class Prize(Base):
    __tablename__ = "prizes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    tier: Mapped[str] = mapped_column(String(20), default="gold")  # platinum|gold|silver|bronze
    kind: Mapped[str] = mapped_column(String(20), default="rank")  # rank | coins
    min_rank: Mapped[int] = mapped_column(Integer, default=1)
    max_rank: Mapped[int] = mapped_column(Integer, default=1)
    cost_coins: Mapped[int] = mapped_column(Integer, default=0)
    icon: Mapped[str] = mapped_column(String(40), default="gift")
    stock: Mapped[int] = mapped_column(Integer, default=-1)  # -1 = unlimited
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    claims: Mapped[list["PrizeClaim"]] = relationship(back_populates="prize", cascade="all, delete-orphan")


class PrizeClaim(Base):
    __tablename__ = "prize_claims"
    __table_args__ = (UniqueConstraint("prize_id", "student_id", name="uq_claim_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prize_id: Mapped[int] = mapped_column(ForeignKey("prizes.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|approved|delivered|rejected
    note: Mapped[str] = mapped_column(String(240), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    prize: Mapped[Prize] = relationship(back_populates="claims")
    student: Mapped[Student] = relationship()


class Activity(Base):
    """XP / coin / badge ledger — powers the live feed and the reward toasts."""

    __tablename__ = "activities"
    __table_args__ = (Index("ix_activities_student_created", "student_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="xp")  # xp|coin|badge|level|exam|duel|prize|streak
    title: Mapped[str] = mapped_column(String(160))
    detail: Mapped[str] = mapped_column(String(240), default="")
    amount: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="activities")


class Cosmetic(Base):
    """One owned shop item.

    The catalogue itself lives in ``services/shop.py`` (server-side truth), so
    this row only records *what a player owns, when and how they got it* — which
    is also what makes the "owners: 183" line on an item honest.
    """

    __tablename__ = "cosmetics"
    __table_args__ = (UniqueConstraint("student_id", "item_key", name="uq_cosmetic_owner"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(64), index=True)
    # shop | chest | event | achievement | gift
    source: Mapped[str] = mapped_column(String(20), default="shop")
    # Serial number within the item (1 = first ever owner) — bragging rights.
    serial: Mapped[int] = mapped_column(Integer, default=1)
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="cosmetics")


class StudentMilestone(Base):
    """A one-off achievement that already paid out.

    Diamond and chest payouts are keyed here so a milestone can never be farmed
    twice — ``unique(student_id, key)`` is the whole guard.
    """

    __tablename__ = "student_milestones"
    __table_args__ = (UniqueConstraint("student_id", "key", name="uq_student_milestone"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="milestones")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="general")  # exam|result|duel|prize|general
    target_course: Mapped[str] = mapped_column(String(60), default="")
    author: Mapped[str] = mapped_column(String(120), default="Arena Control")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Config(Base):
    """Singleton row (id=1) holding site-wide settings."""

    __tablename__ = "config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    institution: Mapped[str] = mapped_column(String(180), default="University of Nigeria, Nsukka")
    campus: Mapped[str] = mapped_column(String(120), default="Enugu Campus (UNEC)")
    faculty: Mapped[str] = mapped_column(String(120), default="Faculty of Law")
    season_name: Mapped[str] = mapped_column(String(160), default="2025/2026 Arena Season")
    prize_pool_note: Mapped[str] = mapped_column(String(240), default="")
    grading_scale: Mapped[list] = mapped_column(JSON, default=list)
    duels_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    exams_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------------------
# Study modes, helping hands and personal notifications
# ---------------------------------------------------------------------------
class HelpRequest(Base):
    """Ask-a-friend: a question snapshot sent to a friend for help."""

    __tablename__ = "help_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asker_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    helper_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int | None] = mapped_column(ForeignKey("questions.id", ondelete="SET NULL"), nullable=True)
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[str] = mapped_column(Text, default="{}")  # JSON dict of key -> text
    correct: Mapped[str] = mapped_column(String(1), default="a")
    explanation: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | answered
    helper_answer: Mapped[str] = mapped_column(String(1), default="")
    was_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RushRun(Base):
    """One Blitz or Sudden-Death run (server-graded)."""

    __tablename__ = "rush_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(12))  # blitz | sudden
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class DailyChallengeResult(Base):
    """One player's result for one day's shared challenge."""

    __tablename__ = "daily_challenge_results"
    __table_args__ = (UniqueConstraint("student_id", "day", name="uq_daily_challenge_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MissionClaim(Base):
    """Weekly mission reward, claimed once per mission per week."""

    __tablename__ = "mission_claims"
    __table_args__ = (UniqueConstraint("student_id", "key", "week_key", name="uq_mission_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(40))
    week_key: Mapped[str] = mapped_column(String(10))
    xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Reaction(Base):
    """A heart on a feed activity row."""

    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("student_id", "activity_id", name="uq_reaction_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class InboxNote(Base):
    """Personal notification: help requests, nudges, answers, rewards."""

    __tablename__ = "inbox_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="general")  # help|answer|nudge|reward|general
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[str] = mapped_column(Text, default="{}")
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Next wave — flashcards, practice, bosses, tournaments, mastery, study groups
# ---------------------------------------------------------------------------
class FlashcardDeck(Base):
    """A deck of question cards, either auto-generated from the bank or custom."""

    __tablename__ = "flashcard_decks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), nullable=True, index=True
    )  # NULL = system/arena deck every player can study
    name: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(String(300), default="")
    kind: Mapped[str] = mapped_column(String(24), default="custom", index=True)
    # custom|course|topic|difficulty|weakness|wrong|favorites|recent|mixed|admin
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    cards: Mapped[list["FlashcardCard"]] = relationship(back_populates="deck", cascade="all, delete-orphan")


class FlashcardCard(Base):
    """One card = one question + this player's spaced-repetition state."""

    __tablename__ = "flashcard_cards"
    __table_args__ = (
        UniqueConstraint("deck_id", "question_id", "student_id", name="uq_card_once"),
        Index("ix_cards_due", "student_id", "due_on"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("flashcard_decks.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=True, index=True)
    state: Mapped[str] = mapped_column(String(12), default="new")  # new|learning|reviewing|mastered
    ease: Mapped[float] = mapped_column(Float, default=2.5)
    interval_days: Mapped[float] = mapped_column(Float, default=0.0)
    reps: Mapped[int] = mapped_column(Integer, default=0)
    lapses: Mapped[int] = mapped_column(Integer, default=0)
    streak: Mapped[int] = mapped_column(Integer, default=0)
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    last_grade: Mapped[str] = mapped_column(String(12), default="")
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bookmarked: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    deck: Mapped[FlashcardDeck] = relationship(back_populates="cards")
    question: Mapped[Question] = relationship()


class FlashcardReview(Base):
    """Every grading press — powers flashcard analytics and streak history."""

    __tablename__ = "flashcard_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    deck_id: Mapped[int | None] = mapped_column(ForeignKey("flashcard_decks.id", ondelete="SET NULL"), nullable=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    grade: Mapped[str] = mapped_column(String(12), default="good")  # again|hard|good|easy
    mode: Mapped[str] = mapped_column(String(16), default="q_to_a")  # q_to_a | a_to_q
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class PracticeRun(Base):
    """One practice / challenge run, always graded on the server."""

    __tablename__ = "practice_runs"
    __table_args__ = (Index("ix_practice_student_mode", "student_id", "mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(24), index=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    topic: Mapped[str] = mapped_column(String(120), default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    max_combo: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    perfect: Mapped[bool] = mapped_column(Boolean, default=False)
    usable: Mapped[bool] = mapped_column(Boolean, default=True)  # server-validated, non-cheating run
    powerups: Mapped[dict] = mapped_column(JSON, default=dict)
    xp_awarded: Mapped[int] = mapped_column(Integer, default=0)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class PracticeChallenge(Base):
    """A generated practice paper the player answers; keeps runs cheat-proof."""

    __tablename__ = "practice_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(24), default="sprint")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(12), default="open")  # open|done|expired
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BossRun(Base):
    """Boss battles: boss HP is the question set, correct hits damage it."""

    __tablename__ = "boss_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    boss_key: Mapped[str] = mapped_column(String(32), default="daily_boss", index=True)
    cycle_key: Mapped[str] = mapped_column(String(24), default="")  # e.g. 2026-09-17 or 2026-W38
    hp_max: Mapped[int] = mapped_column(Integer, default=0)
    hp_left: Mapped[int] = mapped_column(Integer, default=0)
    damage: Mapped[int] = mapped_column(Integer, default=0)
    max_combo: Mapped[int] = mapped_column(Integer, default=0)
    crits: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    answered: Mapped[int] = mapped_column(Integer, default=0)
    lives_left: Mapped[int] = mapped_column(Integer, default=3)
    result: Mapped[str] = mapped_column(String(12), default="lose")  # win|lose|timeout|abandoned
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    xp_awarded: Mapped[int] = mapped_column(Integer, default=0)
    coins_awarded: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class CommunityBoss(Base):
    """A shared global boss every player contributes damage to."""

    __tablename__ = "community_bosses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    boss_key: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="The Examiner")
    hp_max: Mapped[int] = mapped_column(Integer, default=5000)
    damage_taken: Mapped[int] = mapped_column(Integer, default=0)
    contributions: Mapped[int] = mapped_column(Integer, default=0)
    cycle_key: Mapped[str] = mapped_column(String(24), default="")
    defeated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Tournament(Base):
    """Weekly / monthly / campus / course / class bracket or ladder."""

    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    scope: Mapped[str] = mapped_column(String(16), default="weekly", index=True)  # weekly|monthly|campus|course|class
    kind: Mapped[str] = mapped_column(String(16), default="ladder")  # ladder|bracket
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    scope_value: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)  # open|live|finished
    size: Mapped[int] = mapped_column(Integer, default=8)
    entry_xp: Mapped[int] = mapped_column(Integer, default=0)
    prize_xp: Mapped[int] = mapped_column(Integer, default=500)
    prize_coins: Mapped[int] = mapped_column(Integer, default=300)
    badge_key: Mapped[str] = mapped_column(String(40), default="")
    cycle_key: Mapped[str] = mapped_column(String(24), default="", index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class TournamentEntry(Base):
    __tablename__ = "tournament_entries"
    __table_args__ = (UniqueConstraint("tournament_id", "student_id", name="uq_tournament_entry"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    seed: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    round_reached: Mapped[int] = mapped_column(Integer, default=0)
    eliminated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tournament: Mapped[Tournament] = relationship()
    student: Mapped[Student] = relationship()


class TournamentMatch(Base):
    __tablename__ = "tournament_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    round_no: Mapped[int] = mapped_column(Integer, default=1)
    slot: Mapped[int] = mapped_column(Integer, default=0)
    student_a: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    student_b: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    duel_id: Mapped[int | None] = mapped_column(ForeignKey("duels.id", ondelete="SET NULL"), nullable=True)
    score_a: Mapped[int] = mapped_column(Integer, default=0)
    score_b: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending|live|done
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PlayerMastery(Base):
    """Per-scope mastery: course, topic, subtopic or difficulty."""

    __tablename__ = "player_mastery"
    __table_args__ = (
        UniqueConstraint("student_id", "scope_type", "scope_key", name="uq_mastery_scope"),
        Index("ix_mastery_student", "student_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    scope_type: Mapped[str] = mapped_column(String(16), default="topic")  # course|topic|subtopic|difficulty
    scope_key: Mapped[str] = mapped_column(String(120), default="")
    answered: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    mastery: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SeasonStat(Base):
    """Per-season XP/coins so seasons can reset progression fairly."""

    __tablename__ = "season_stats"
    __table_args__ = (UniqueConstraint("student_id", "season_key", name="uq_season_stat"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    season_key: Mapped[str] = mapped_column(String(40), default="")
    xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    duels_won: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class StudyGroup(Base):
    """Social study groups: group quizzes, shared decks and a group board."""

    __tablename__ = "study_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(String(300), default="")
    owner_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    goal: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class StudyGroupMember(Base):
    __tablename__ = "study_group_members"
    __table_args__ = (UniqueConstraint("group_id", "student_id", name="uq_group_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("study_groups.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(12), default="member")  # owner|member
    week_xp: Mapped[int] = mapped_column(Integer, default=0)
    week_key: Mapped[str] = mapped_column(String(10), default="")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    group: Mapped[StudyGroup] = relationship()
    student: Mapped[Student] = relationship()


class GroupMessage(Base):
    """Study-room chat (distinct from 1:1 chat and quiz-night rooms)."""

    __tablename__ = "group_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("study_groups.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(12), default="text")  # text|live_question|system
    meta: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    student: Mapped[Student] = relationship()


class ExamBlueprint(Base):
    """Exam templates & blueprints: quotas by topic/difficulty for auto-generation."""

    __tablename__ = "exam_blueprints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    quiz_id: Mapped[int | None] = mapped_column(ForeignKey("quizzes.id", ondelete="SET NULL"), nullable=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    version_labels: Mapped[str] = mapped_column(String(60), default="A")
    is_template: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

# ===========================================================================
# Materials — the "understand it before you're tested on it" layer
# ===========================================================================
class Material(Base):
    """A learning material: a readable document attached to a course/topic."""

    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True)
    quiz_id: Mapped[int | None] = mapped_column(ForeignKey("quizzes.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    topic: Mapped[str] = mapped_column(String(120), default="", index=True)
    subtopic: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    # Everything readable lives in sections; `summary` is the exam-night digest.
    difficulty: Mapped[str] = mapped_column(String(16), default="intermediate")  # beginner|intermediate|advanced
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=10)
    tags: Mapped[str] = mapped_column(Text, default="[]")
    summary: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of key takeaways
    author: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)  # draft|published|archived
    version: Mapped[int] = mapped_column(Integer, default=1)
    icon: Mapped[str] = mapped_column(String(40), default="book")
    accent: Mapped[str] = mapped_column(String(16), default="violet")
    allow_discussion: Mapped[bool] = mapped_column(Boolean, default=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    starts: Mapped[int] = mapped_column(Integer, default=0)
    completions: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sections: Mapped[list["MaterialSection"]] = relationship(
        back_populates="material", cascade="all, delete-orphan", order_by="MaterialSection.position"
    )


class MaterialSection(Base):
    """One chapter of a material. Blocks are a JSON list of typed content rows."""

    __tablename__ = "material_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="[]")  # JSON blocks
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=3)
    check_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    material: Mapped["Material"] = relationship(back_populates="sections")


class MaterialVersion(Base):
    """Every publish/edit snapshot of a material — nothing is silently lost."""

    __tablename__ = "material_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    snapshot: Mapped[str] = mapped_column(Text, default="{}")
    note: Mapped[str] = mapped_column(String(200), default="")
    author: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class QuestClaim(Base):
    """One claimed quest per player per period.

    The unique constraint is what makes quest rewards safe: the claim row and the
    grant happen in the same transaction, so tapping "Collect" twice (or from two
    devices at once) can only ever pay once.
    """

    __tablename__ = "quest_claims"
    __table_args__ = (UniqueConstraint("student_id", "quest_key", "period_key", name="uq_quest_claim"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    quest_key: Mapped[str] = mapped_column(String(48), default="")
    period_key: Mapped[str] = mapped_column(String(24), default="")
    xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaterialProgress(Base):
    """Reading progress per player, per material — resumes exactly where they stopped."""

    __tablename__ = "material_progress"
    __table_args__ = (UniqueConstraint("material_id", "student_id", name="uq_material_progress"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="reading")  # reading|completed
    percent: Mapped[int] = mapped_column(Integer, default=0)
    last_section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_section_position: Mapped[int] = mapped_column(Integer, default=1)
    visited: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of section ids
    seconds_spent: Mapped[int] = mapped_column(Integer, default=0)
    # Anti-exploit: rewards are only paid once per section/material/page.
    rewarded_sections: Mapped[str] = mapped_column(Text, default="[]")
    rewarded_completion: Mapped[bool] = mapped_column(Boolean, default=False)
    rewarded_start: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MaterialBookmark(Base):
    __tablename__ = "material_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(200), default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MaterialNote(Base):
    __tablename__ = "material_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaterialHighlight(Base):
    __tablename__ = "material_highlights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    colour: Mapped[str] = mapped_column(String(16), default="yellow")  # yellow|blue|green|red
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MaterialConfusion(Base):
    """The "I don't understand this" queue — the standout study signal."""

    __tablename__ = "material_confusions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    quote: Mapped[str] = mapped_column(Text, default="")
    question: Mapped[str] = mapped_column(Text, default="")
    shared_with: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of friend ids
    group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|answered|resolved
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MaterialQuestion(Base):
    """Links the bank to a material/section/topic so reading and testing connect."""

    __tablename__ = "material_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="practice")  # practice|check|exam
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MaterialPost(Base):
    """Discussion attached to a material (optionally to one section)."""

    __tablename__ = "material_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="question")  # question|answer|tip
    body: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MaterialFeedback(Base):
    __tablename__ = "material_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    verdict: Mapped[str] = mapped_column(String(16), default="yes")  # yes|somewhat|no
    comment: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class StudySession(Base):
    """A focus session (timer) — the unit of Study XP and the reading streak."""

    __tablename__ = "study_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(24), default="mixed")  # material|flashcards|questions|mixed
    planned_minutes: Mapped[int] = mapped_column(Integer, default=25)
    seconds: Mapped[int] = mapped_column(Integer, default=0)
    xp_awarded: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class StudyXpLedger(Base):
    """Every Study XP award, keyed so the same action can never pay twice."""

    __tablename__ = "study_xp_ledger"
    __table_args__ = (UniqueConstraint("student_id", "reason_key", name="uq_study_xp_reason"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(String(40), default="material")
    reason_key: Mapped[str] = mapped_column(String(120), default="")
    day: Mapped[date] = mapped_column(Date, default=lambda: utcnow().date(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PlaytimeBalance(Base):
    """Server-authoritative daily playtime bank — the game's gate."""

    __tablename__ = "playtime_balances"
    __table_args__ = (UniqueConstraint("student_id", "day", name="uq_playtime_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, default=lambda: utcnow().date(), index=True)
    earned_seconds: Mapped[int] = mapped_column(Integer, default=0)
    used_seconds: Mapped[int] = mapped_column(Integer, default=0)
    study_xp: Mapped[int] = mapped_column(Integer, default=0)
    claimed_thresholds: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of xp thresholds paid
    bonus_keys: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ArenaEvent(Base):
    """Admin-created arena event: a timed, no-cap competitive run.

    Everyone works through the same fixed question order at their own pace
    (or on a shared clock for per-question events); the server owns every
    score, the leaderboard and the rewards. Players may join, leave and
    resume with their progress intact until the event ends.
    """

    __tablename__ = "arena_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True, index=True)
    topics: Mapped[list] = mapped_column(JSON, default=list)  # optional topic filter
    starts_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    question_count: Mapped[int] = mapped_column(Integer, default=15)
    time_mode: Mapped[str] = mapped_column(String(16), default="fixed")  # untimed|fixed|per_question
    duration_minutes: Mapped[int] = mapped_column(Integer, default=20)  # fixed mode
    per_question_seconds: Mapped[int] = mapped_column(Integer, default=30)  # per_question mode
    entry_xp: Mapped[int] = mapped_column(Integer, default=0)  # entry requirement (and cost)
    visibility: Mapped[str] = mapped_column(String(16), default="public")  # public|course
    rewards: Mapped[dict] = mapped_column(JSON, default=dict)  # {xp, coins, diamonds, badge_key, title, frame, avatar}
    banner: Mapped[str] = mapped_column(String(240), default="")
    scoring_note: Mapped[str] = mapped_column(String(400), default="")  # scoring rules shown to players
    allow_join_during: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_leave: Mapped[bool] = mapped_column(Boolean, default=True)
    leaderboard_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="scheduled", index=True)  # scheduled|live|finished|cancelled
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    course: Mapped[Course | None] = relationship()


class EventQuestion(Base):
    __tablename__ = "event_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("arena_events.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class EventParticipant(Base):
    __tablename__ = "event_participants"
    __table_args__ = (UniqueConstraint("event_id", "student_id", name="uq_event_participant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("arena_events.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    answered: Mapped[int] = mapped_column(Integer, default=0)  # questions completed
    current_index: Mapped[int] = mapped_column(Integer, default=0)  # next question to serve
    streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished: Mapped[bool] = mapped_column(Boolean, default=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)  # final place
    rewards: Mapped[dict] = mapped_column(JSON, default=dict)  # what was granted at finalize

    student: Mapped[Student] = relationship()


class EventAnswer(Base):
    __tablename__ = "event_answers"
    __table_args__ = (Index("ix_event_answer_unique", "event_id", "question_id", "student_id", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("arena_events.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    selected: Mapped[str] = mapped_column(String(8), default="")
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GameProfile(Base):
    """One row per player: bests, unlocks, cosmetics and lifetime counters."""

    __tablename__ = "game_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True, index=True)
    best_score: Mapped[int] = mapped_column(Integer, default=0)
    best_survival_seconds: Mapped[int] = mapped_column(Integer, default=0)
    best_combo: Mapped[int] = mapped_column(Integer, default=0)
    runs: Mapped[int] = mapped_column(Integer, default=0)
    total_seconds: Mapped[int] = mapped_column(Integer, default=0)
    total_score: Mapped[int] = mapped_column(Integer, default=0)
    character: Mapped[str] = mapped_column(String(24), default="bolt")
    trail: Mapped[str] = mapped_column(String(24), default="none")
    unlocked: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of cosmetics/characters
    achievements: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of achievement keys
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GameSession(Base):
    """A single run. The server credits it, and only within the playtime bank."""

    __tablename__ = "game_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(24), default="survival")  # survival|score_attack|time_trial
    score: Mapped[int] = mapped_column(Integer, default=0)
    seconds: Mapped[int] = mapped_column(Integer, default=0)
    combo: Mapped[int] = mapped_column(Integer, default=0)
    collected: Mapped[int] = mapped_column(Integer, default=0)
    wave: Mapped[int] = mapped_column(Integer, default=0)
    # Client-reported metrics are recorded but the *credited* time is clamped to
    # the server-tracked playtime and the wall clock between start and finish.
    client_seconds: Mapped[int] = mapped_column(Integer, default=0)
    credited_seconds: Mapped[int] = mapped_column(Integer, default=0)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    day: Mapped[date] = mapped_column(Date, default=lambda: utcnow().date(), index=True)


class GameChallenge(Base):
    """Async friend challenge: beat my score, whenever you get to it."""

    __tablename__ = "game_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    challenger_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    opponent_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(24), default="score_attack")
    target_score: Mapped[int] = mapped_column(Integer, default=0)
    target_seconds: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|beaten|lost
    result_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class StudyStreak(Base):
    """Daily reading/study streak (separate from the login streak)."""

    __tablename__ = "study_streaks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True, index=True)
    current: Mapped[int] = mapped_column(Integer, default=0)
    best: Mapped[int] = mapped_column(Integer, default=0)
    last_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    seconds_today: Mapped[int] = mapped_column(Integer, default=0)
    day: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
