"""AI Tutor v2 schema migration — backup, upgrade, downgrade, verify.

The app already upgrades itself on start (create_all + add missing columns +
``ensure_indexes`` + moving v1 saved items). This module makes the same steps
explicit and reversible for staff:

    python scripts/migrate_ai.py backup      # copy the SQLite file (timestamped)
    python scripts/migrate_ai.py upgrade     # tables, columns, indexes, move v1 data
    python scripts/migrate_ai.py verify      # check tables/columns/indexes exist
    python scripts/migrate_ai.py downgrade   # move library data back to v1 JSON, drop v2 tables

Downgrade always takes a backup first.
"""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text

from ..db import engine, init_db, session_scope

V2_TABLES = [
    "ai_flashcard_reviews", "ai_flashcards", "ai_flashcard_decks", "ai_generated_questions", "ai_practice_sets",
    "ai_generated_materials", "ai_study_plan_items", "ai_study_plans", "ai_feedback", "ai_user_settings", "ai_learning_profiles",
    "ai_mini_exam_items", "ai_mini_exams", "ai_tool_calls", "ai_proposals", "ai_staff_usage",
]
V2_COLUMNS = {
    "ai_conversations": ["archived_at", "context_type", "title_final"],
    "ai_usage_events": ["course_id", "output_chars"],
}
INDEXES = {
    "ix_ai_events_status_time": ("ai_usage_events", "status, created_at"),
    "ix_ai_events_kind_time": ("ai_usage_events", "kind, created_at"),
    "ix_ai_events_course_time": ("ai_usage_events", "course_id, created_at"),
    "ix_ai_conv_user_deleted": ("ai_conversations", "user_id, deleted_at, archived"),
    "ix_ai_messages_conv_id": ("ai_messages", "conversation_id, id"),
    "ix_ai_flashcards_due": ("ai_flashcards", "deck_id, next_review_at"),
    "ix_ai_genq_set_pos": ("ai_generated_questions", "set_id, position"),
    "ix_ai_plan_items_date": ("ai_study_plan_items", "plan_id, date"),
    "ix_ai_feedback_rating_time": ("ai_feedback", "rating, created_at"),
    "ix_ai_practice_user_saved": ("ai_practice_sets", "user_id, saved"),
    "ix_ai_materials_user_type": ("ai_generated_materials", "user_id, material_type"),
}


def _db_file() -> Path | None:
    url = str(engine.url)
    if not url.startswith("sqlite"):
        return None
    path = engine.url.database
    return Path(path) if path and path != ":memory:" else None


def backup(label: str = "manual") -> str | None:
    path = _db_file()
    if path is None or not path.exists():
        return None
    with engine.begin() as conn:  # flush the WAL into the main file first
        try:
            conn.execute(text("PRAGMA wal_checkpoint(FULL)"))
        except Exception:  # noqa: BLE001
            pass
    target = path.with_name(f"{path.stem}.backup-{label}-{datetime.now().strftime('%Y%m%d-%H%M%S')}{path.suffix}")
    shutil.copy2(path, target)
    return str(target)


def ensure_indexes() -> list[str]:
    tables = set(inspect(engine).get_table_names())
    created = []
    with engine.begin() as conn:
        for name, (table, cols) in INDEXES.items():
            if table in tables:
                conn.execute(text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({cols})'))
                created.append(name)
    return created


def upgrade() -> dict:
    init_db()  # new tables + missing columns (idempotent)
    indexes = ensure_indexes()
    from .ai_library import migrate_legacy_saved

    with session_scope() as db:
        moved = migrate_legacy_saved(db)
    return {"indexes": len(indexes), "moved_saved_items": moved, "verify": verify()}


def verify() -> dict:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    missing_tables = [t for t in V2_TABLES if t not in tables]
    missing_columns = []
    for table, cols in V2_COLUMNS.items():
        if table in tables:
            live = {c["name"] for c in insp.get_columns(table)}
            missing_columns += [f"{table}.{c}" for c in cols if c not in live]
    live_indexes = set()
    for table in {t for t, _ in INDEXES.values()} & tables:
        live_indexes |= {i["name"] for i in insp.get_indexes(table)}
    missing_indexes = [n for n, (t, _) in INDEXES.items() if t in tables and n not in live_indexes]
    config_cols = {c["name"] for c in insp.get_columns("config")} if "config" in tables else set()
    missing_config = [c for c in ("ai_exam_mode", "ai_provider", "ai_model", "ai_monthly_budget_usd", "ai_feat_flashcards") if config_cols and c not in config_cols]
    ok = not (missing_tables or missing_columns or missing_indexes or missing_config)
    return {"ok": ok, "missing_tables": missing_tables, "missing_columns": missing_columns, "missing_indexes": missing_indexes, "missing_config_columns": missing_config}


def downgrade() -> dict:
    """Back to the v1 layout: library rows → ai_saved_items JSON, then drop v2 tables."""
    saved = backup("pre-downgrade")
    from ..models import AISavedItem, Student
    from . import ai_library

    moved = 0
    tables = set(inspect(engine).get_table_names())
    if "ai_flashcard_decks" in tables:
        with session_scope() as db:
            for student in db.query(Student).all():
                for kind in ai_library.KINDS:
                    for row in ai_library.list_items(db, student, kind):
                        full = ai_library.row(kind, ai_library.get_owned(db, student, kind, row["id"]), full=True)
                        data = full["data"]
                        if kind == "plan":  # v1 plans were Markdown text
                            lines = [f"# {full['title']}", data.get("overview", "")]
                            for day in data.get("days", []):
                                lines.append(f"\n**{day['date']}**")
                                lines += [f"- {i['topic']}: {i['activity']} ({i['duration']} min)" for i in day["items"]]
                            data = {"title": full["title"], "content": "\n".join(lines)}
                        db.add(AISavedItem(user_id=student.id, kind=kind, title=full["title"], course_id=full["course_id"], topic=full.get("topic") or "", data=data))
                        moved += 1
    with engine.begin() as conn:
        for table in V2_TABLES:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        for name, (table, _) in INDEXES.items():
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
        dropped_columns = []
        for table, cols in V2_COLUMNS.items():
            for col in cols:
                try:  # SQLite ≥ 3.35 can drop columns; older versions keep them (harmless)
                    conn.execute(text(f'ALTER TABLE "{table}" DROP COLUMN "{col}"'))
                    dropped_columns.append(f"{table}.{col}")
                except Exception:  # noqa: BLE001
                    pass
    return {"backup": saved, "moved_back": moved, "dropped_tables": V2_TABLES, "dropped_columns": dropped_columns}
