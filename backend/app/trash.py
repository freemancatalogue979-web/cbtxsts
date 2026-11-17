"""Trash — anything deleted in the hub lands here first and can be restored.

Before a delete runs, ``send_to_trash`` snapshots the row *and everything the
database would remove with it* (cascade children such as a scrim's games or a
locker's drops and comments). It also remembers links that the delete blanks
out, such as a review pointing at the deleted scrim, so a restore re-attaches
them. Files are moved into ``data/trash`` instead of being unlinked.

``restore`` puts every row back with its original id when that id is free, or
under a new id with all child links remapped. It refuses with a clear message
if a unique value has been taken meanwhile, or if a required parent is gone.

Visibility: private things (AI chats and memory, private archive drops, a
member's own inbox) are ``restricted`` and only their ``viewer_ids`` can see,
restore or purge them, admins included. Everything else is visible to the
person who deleted it and to admins; only admins purge shared items.
"""
from __future__ import annotations

import base64
import contextvars
import secrets
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Iterable

from fastapi import HTTPException
from sqlalchemy import Table, UniqueConstraint, and_, insert, inspect as sa_inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import DATA_DIR, TRASH_DIR
from .db import Base
from .models import TrashItem, User, dumps, loads, utcnow

# Friendly names for snapshot summaries ("3 scrim games · 1 review link").
TABLE_LABELS: dict[str, tuple[str, str]] = {
    "scrims": ("scrim", "scrims"),
    "scrim_games": ("game", "games"),
    "match_reviews": ("review", "reviews"),
    "tournaments": ("tournament", "tournaments"),
    "tournament_matches": ("match", "matches"),
    "training_weeks": ("training week", "training weeks"),
    "training_activities": ("activity", "activities"),
    "training_programs": ("program", "programs"),
    "program_weeks": ("program week", "program weeks"),
    "week_progress": ("progress entry", "progress entries"),
    "archive_folders": ("locker", "lockers"),
    "archive_items": ("drop", "drops"),
    "archive_comments": ("comment", "comments"),
    "notifications": ("notification", "notifications"),
    "events": ("event", "events"),
    "draft_plans": ("draft", "drafts"),
    "map_boards": ("map board", "map boards"),
    "ban_entries": ("ban", "bans"),
    "strategy_notes": ("note", "notes"),
    "development_entries": ("development entry", "development entries"),
    "hero_pool": ("pool hero", "pool heroes"),
    "heroes": ("hero", "heroes"),
    "team_equipment": ("equipment record", "equipment records"),
    "clover_ai_conversations": ("conversation", "conversations"),
    "clover_ai_messages": ("message", "messages"),
    "clover_ai_memory_notes": ("coaching note", "coaching notes"),
    "clover_ai_learned_memory": ("learned note", "learned notes"),
    "clover_ai_knowledge": ("knowledge note", "knowledge notes"),
    "clover_ai_contributions": ("submission", "submissions"),
    "users": ("member", "members"),
}

# Request-scoped list of trash ids created while handling one request; the
# middleware in main.py sends them back as the X-Clover-Trash header so the
# app can offer "Undo".
_request_ids: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("clover_trash_ids", default=None)


def begin_request() -> list[int]:
    ids: list[int] = []
    _request_ids.set(ids)
    return ids


class RestoreConflict(Exception):
    """Restoring would clash with data created since the delete."""


# --------------------------------------------------------------------------- #
# value encoding
# --------------------------------------------------------------------------- #
def _enc(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"$dt": value.isoformat()}
    if isinstance(value, date):
        return {"$d": value.isoformat()}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"$b": base64.b64encode(bytes(value)).decode()}
    return value


def _dec(value: Any) -> Any:
    if isinstance(value, dict) and len(value) == 1:
        if "$dt" in value:
            return datetime.fromisoformat(value["$dt"])
        if "$d" in value:
            return date.fromisoformat(value["$d"])
        if "$b" in value:
            return base64.b64decode(value["$b"])
    return value


# --------------------------------------------------------------------------- #
# schema introspection
# --------------------------------------------------------------------------- #
def _tables() -> dict[str, Table]:
    return {t.name: t for t in Base.metadata.sorted_tables}


def _order() -> dict[str, int]:
    return {t.name: i for i, t in enumerate(Base.metadata.sorted_tables)}


def _orm_cascades() -> set[tuple[str, str]]:
    """(child_table, fk_column) pairs the ORM deletes along with the parent,
    even where the database FK has no ON DELETE CASCADE."""
    pairs: set[tuple[str, str]] = set()
    for mapper in Base.registry.mappers:
        for rel in mapper.relationships:
            if rel.secondary is not None:
                for col in rel.secondary.columns:
                    if any(fk.column.table is mapper.local_table for fk in col.foreign_keys):
                        pairs.add((rel.secondary.name, col.name))
            elif rel.direction.name == "ONETOMANY" and rel.cascade.delete:
                for _local, remote in rel.local_remote_pairs:
                    pairs.add((remote.table.name, remote.name))
    return pairs


def _pk(table: Table, row: dict) -> tuple:
    return tuple(row[c.name] for c in table.primary_key.columns)


def _chunks(values: list, size: int = 400) -> Iterable[list]:
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _row_dicts(db: Session, table: Table, where) -> list[dict]:
    return [dict(r) for r in db.execute(select(table).where(where)).mappings().all()]


# --------------------------------------------------------------------------- #
# snapshot
# --------------------------------------------------------------------------- #
def snapshot(db: Session, roots: list[tuple[Table, list[dict]]]) -> dict:
    """Rows that deleting ``roots`` removes (cascades included) plus links it blanks."""
    tables = list(_tables().values())
    cascades = _orm_cascades()
    seen: dict[str, dict[tuple, dict]] = {}
    links: list[dict] = []
    queue = list(roots)
    while queue:
        table, batch = queue.pop()
        bucket = seen.setdefault(table.name, {})
        fresh = []
        for row in batch:
            key = _pk(table, row)
            if key not in bucket:
                bucket[key] = row
                fresh.append(row)
        if not fresh:
            continue
        for child in tables:
            for fk in child.foreign_keys:
                if fk.column.table is not table:
                    continue
                values = sorted({r[fk.column.name] for r in fresh if r.get(fk.column.name) is not None}, key=str)
                if not values:
                    continue
                found: list[dict] = []
                for chunk in _chunks(values):
                    found += _row_dicts(db, child, fk.parent.in_(chunk))
                if not found:
                    continue
                if (fk.ondelete or "").upper() == "CASCADE" or (child.name, fk.parent.name) in cascades:
                    queue.append((child, found))
                else:  # SET NULL / ORM nulling: remember the link to re-attach it
                    for r in found:
                        links.append({"t": child.name, "pk": {c.name: _enc(r[c.name]) for c in child.primary_key.columns},
                                      "c": fk.parent.name, "v": _enc(r[fk.parent.name])})
    order = _order()
    rows = [{"t": name, "d": {k: _enc(v) for k, v in row.items()}}
            for name in sorted(seen, key=lambda n: order.get(n, 0)) for row in seen[name].values()]
    tables_by_name = _tables()
    deleted = {(r["t"], dumps([r["d"][c.name] for c in tables_by_name[r["t"]].primary_key.columns])) for r in rows}
    links = [lk for lk in links
             if (lk["t"], dumps([lk["pk"][c.name] for c in tables_by_name[lk["t"]].primary_key.columns])) not in deleted]
    return {"rows": rows, "links": links}


def _summary(snap: dict, root_table: str) -> str:
    counts: dict[str, int] = {}
    for r in snap.get("rows", []):
        counts[r["t"]] = counts.get(r["t"], 0) + 1
    counts[root_table] = counts.get(root_table, 0) - 1  # the item itself
    parts = []
    for name, n in counts.items():
        if n <= 0:
            continue
        one, many = TABLE_LABELS.get(name, (name.replace("_", " ").rstrip("s"), name.replace("_", " ")))
        parts.append(f"{n} {one if n == 1 else many}")
    linked = len(snap.get("links", []))
    if linked:
        parts.append(f"{linked} {'link' if linked == 1 else 'links'}")
    return " · ".join(parts)


def _orm_rows(db: Session, objs: Iterable[Any]) -> list[tuple[Table, list[dict]]]:
    db.flush()
    grouped: dict[str, tuple[Table, list[dict]]] = {}
    for obj in objs:
        table: Table = obj.__table__
        ident = sa_inspect(obj).identity
        if ident is None:
            continue
        where = and_(*[c == v for c, v in zip(table.primary_key.columns, ident)])
        rows = _row_dicts(db, table, where)
        grouped.setdefault(table.name, (table, []))[1].extend(rows)
    return list(grouped.values())


def _move_file(path: Path) -> dict | None:
    try:
        path = Path(path)
        if not path.is_file():
            return None
        dest = TRASH_DIR / f"{secrets.token_hex(8)}_{path.name}"
        shutil.move(str(path), dest)
        try:
            original = str(path.resolve().relative_to(DATA_DIR.resolve()))
        except ValueError:
            original = str(path.resolve())
        return {"trash": dest.name, "original": original}
    except OSError:
        return None


def send_to_trash(
    db: Session, objs: Iterable[Any] | None = None, *, user: User | None, kind: str, area: str, label: str,
    restricted: bool = False, viewers: Iterable[int | None] = (), files: Iterable[Path] = (),
    tables: list[tuple[Table, list[dict]]] | None = None, custom: dict | None = None,
    summary: str | None = None, target_id: Any = None,
) -> TrashItem:
    """Snapshot what is about to be deleted. Call it *before* ``db.delete``/the
    DELETE statement, inside the same transaction, then commit as usual."""
    roots = tables if tables is not None else _orm_rows(db, objs or [])
    snap = snapshot(db, roots) if roots else {"rows": [], "links": []}
    if custom is not None:
        snap["custom"] = custom
    if target_id is None and roots and roots[0][1]:
        first_table, first_rows = roots[0]
        target_id = _pk(first_table, first_rows[0])[0]
    moved = [m for m in (_move_file(p) for p in files if p) if m]
    viewer_set = sorted({int(v) for v in viewers if v})
    item = TrashItem(
        kind=kind, area=area, label=(label or kind)[:200],
        summary=(summary if summary is not None else _summary(snap, roots[0][0].name if roots else ""))[:300],
        target_id="" if target_id is None else str(target_id),
        deleted_by=user.id if user else None, deleted_at=utcnow(),
        restricted=restricted, viewer_ids=dumps(viewer_set),
        payload=dumps(snap), files=dumps(moved), row_count=len(snap["rows"]),
    )
    db.add(item)
    db.flush()
    ids = _request_ids.get()
    if ids is not None:
        ids.append(item.id)
    return item


# --------------------------------------------------------------------------- #
# access
# --------------------------------------------------------------------------- #
def can_see(user: User, item: TrashItem) -> bool:
    if user.id in loads(item.viewer_ids, []):
        return True
    if item.restricted:
        return False
    return user.role == "admin" or item.deleted_by == user.id


def can_purge(user: User, item: TrashItem) -> bool:
    if item.restricted:
        return user.id in loads(item.viewer_ids, [])
    return user.role == "admin"


# --------------------------------------------------------------------------- #
# restore
# --------------------------------------------------------------------------- #
# table → fn(db, row) -> (row | None, warning | None), run before a row goes back.
# Lets a table pick a free slot or skip an exact duplicate instead of refusing.
ROW_FIXERS: dict[str, Callable[[Session, dict], tuple[dict | None, str | None]]] = {}
# kind → fn(db, item, remap) run after rows are back (e.g. re-score a scrim).
RESTORE_HOOKS: dict[str, Callable[[Session, TrashItem, dict], list[str] | None]] = {}
# kind → fn(db, item) for snapshots that aren't plain rows (e.g. a cleared game sheet).
CUSTOM_RESTORERS: dict[str, Callable[[Session, TrashItem], list[str] | None]] = {}


def _label(table_name: str) -> str:
    return TABLE_LABELS.get(table_name, (table_name.replace("_", " "),))[0]


def _taken(table: Table, cols: list, vals: list) -> str:
    label = _label(table.name)
    owner = [c.name[:-3].replace("_", " ") for c in cols if c.name.endswith("_id")]
    plain = [f"{c.name.replace('_', ' ')} {v}" for c, v in zip(cols, vals) if not c.name.endswith("_id")]
    if owner and not plain:
        what = f"there's already a {label} for that {owner[0]}"
    else:
        what = f"another {label} already has {', '.join(plain)}"
    return f"Can't restore: {what}. Change or delete that one, then restore."


def _exists(db: Session, table: Table, where) -> bool:
    return db.execute(select(1).select_from(table).where(where).limit(1)).first() is not None


def restore(db: Session, item: TrashItem) -> dict:
    """Put a trash item back. Raises HTTP 409 with a readable reason on conflict."""
    try:
        result = _restore(db, item)
    except RestoreConflict as err:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(err)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Can't restore this — something newer clashes with it.") from None
    return result


def _restore(db: Session, item: TrashItem) -> dict:
    snap = loads(item.payload, {})
    tables = _tables()
    warnings: list[str] = []
    remap: dict[tuple[str, Any], Any] = {}
    rows = [(tables[r["t"]], {k: _dec(v) for k, v in r["d"].items()}) for r in snap.get("rows", []) if r["t"] in tables]

    def provided(table: Table, column: str, value: Any) -> bool:
        return any(t is table and d.get(column) == value for t, d in rows)

    for table, data in rows:
        if table.name in ROW_FIXERS:
            fixed, note = ROW_FIXERS[table.name](db, data)
            if note:
                warnings.append(note)
            if fixed is None:
                continue
            data.update(fixed)
        # 1) point foreign keys at remapped parents; drop/refuse links to parents that are gone
        for col in table.columns:
            value = data.get(col.name)
            if value is None:
                continue
            for fk in col.foreign_keys:
                parent, pcol = fk.column.table, fk.column.name
                if (parent.name, value) in remap and pcol in [c.name for c in parent.primary_key.columns]:
                    data[col.name] = value = remap[(parent.name, value)]
                    continue
                if provided(parent, pcol, value) or _exists(db, parent, fk.column == value):
                    continue
                if col.nullable:
                    data[col.name] = None
                    warnings.append(f"Its link to a {_label(parent.name)} was dropped because that {_label(parent.name)} no longer exists.")
                else:
                    raise RestoreConflict(
                        f"Can't restore: the {_label(parent.name)} it belongs to no longer exists. "
                        f"Restore that {_label(parent.name)} from Trash first.")
        pk_cols = list(table.primary_key.columns)
        # 2) a row the delete didn't actually remove (raw wipes, ORM nulling a
        # child instead of deleting it): re-attach it instead of duplicating it
        if all(data.get(c.name) is not None for c in pk_cols):
            current = db.execute(select(table).where(and_(*[c == data[c.name] for c in pk_cols]))).mappings().first()
            if current is not None and all(
                    current[c.name] == data.get(c.name) or (current[c.name] is None and c.foreign_keys)
                    for c in table.columns):
                fill = {c.name: data[c.name] for c in table.columns
                        if current[c.name] is None and data.get(c.name) is not None}
                if fill:
                    db.execute(update(table).where(and_(*[c == data[c.name] for c in pk_cols])).values(**fill))
                continue
        # 3) unique values taken since the delete
        for cons in table.constraints:
            cols = list(getattr(cons, "columns", []))
            if not isinstance(cons, UniqueConstraint) or not cols:
                continue
            vals = [data.get(c.name) for c in cols]
            if any(v is None for v in vals):
                continue
            if _exists(db, table, and_(*[c == v for c, v in zip(cols, vals)])):
                raise RestoreConflict(_taken(table, cols, vals))
        for col in table.columns:
            if col.unique and not col.primary_key and data.get(col.name) is not None \
                    and _exists(db, table, col == data[col.name]):
                raise RestoreConflict(_taken(table, [col], [data[col.name]]))
        # 4) insert, keeping the old id if it's free
        if len(pk_cols) == 1 and data.get(pk_cols[0].name) is not None \
                and _exists(db, table, pk_cols[0] == data[pk_cols[0].name]):
            old = data[pk_cols[0].name]
            if not isinstance(old, int):
                raise RestoreConflict(f"Can't restore: a {_label(table.name)} with the same id already exists.")
            data.pop(pk_cols[0].name)
            new = db.execute(insert(table).values(**data)).inserted_primary_key[0]
            remap[(table.name, old)] = new
        else:
            db.execute(insert(table).values(**data))

    # 5) re-attach links the delete blanked (only where nobody re-linked them since)
    for link in snap.get("links", []):
        table = tables.get(link["t"])
        if table is None:
            continue
        col = table.columns[link["c"]]
        value = _dec(link["v"])
        for fk in col.foreign_keys:
            value = remap.get((fk.column.table.name, value), value)
        pk = {k: _dec(v) for k, v in link["pk"].items()}
        db.execute(update(table).where(and_(*[table.columns[k] == v for k, v in pk.items()]), col.is_(None))
                   .values({col.name: value}))

    if snap.get("custom") is not None and item.kind in CUSTOM_RESTORERS:
        warnings += CUSTOM_RESTORERS[item.kind](db, item) or []
    if item.kind in RESTORE_HOOKS:
        warnings += RESTORE_HOOKS[item.kind](db, item, remap) or []

    db.flush()
    moved_back: list[tuple[Path, Path]] = []
    try:
        for f in loads(item.files, []):
            src = TRASH_DIR / f["trash"]
            dest = Path(f["original"])
            dest = dest if dest.is_absolute() else DATA_DIR / dest
            if not src.exists():
                warnings.append("An attached file was already gone and couldn't be brought back.")
                continue
            if dest.exists():
                raise RestoreConflict("Can't restore: a newer file is in its place. Remove that one first.")
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), dest)
            moved_back.append((dest, src))
        target = item.target_id
        root = rows[0][0].name if rows else ""
        if rows:
            first_table, first = rows[0]
            pk_name = list(first_table.primary_key.columns)[0].name
            target = str(first.get(pk_name) if first.get(pk_name) is not None
                         else remap.get((root, int(item.target_id) if item.target_id.isdigit() else item.target_id), item.target_id))
        out = {"id": item.id, "kind": item.kind, "area": item.area, "label": item.label,
               "target_id": target, "warnings": list(dict.fromkeys(warnings))}
        db.delete(item)
        db.commit()
        return out
    except Exception:
        for dest, src in moved_back:
            try:
                shutil.move(str(dest), src)
            except OSError:
                pass
        raise


def purge(db: Session, item: TrashItem) -> None:
    for f in loads(item.files, []):
        try:
            (TRASH_DIR / f["trash"]).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(item)
