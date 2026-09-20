"""Device uploads: turn a .txt / .csv / .pdf / .json paper into question rows.

The file readers here never decide what a correct answer is — they hand text or
rows to :mod:`app.services.questions`, which owns validation. Anything that
cannot be read faithfully is reported as an error instead of being guessed at.
"""
from __future__ import annotations

import csv
import io
import json
import re
from typing import Any

MAX_BYTES = 8 * 1024 * 1024
TEXT_SUFFIXES = {".txt", ".md", ".text"}
CSV_SUFFIXES = {".csv", ".tsv", ".psv"}
PDF_SUFFIXES = {".pdf"}
JSON_SUFFIXES = {".json"}
SUPPORTED_SUFFIXES = TEXT_SUFFIXES | CSV_SUFFIXES | PDF_SUFFIXES | JSON_SUFFIXES

# Header spellings we accept from real papers and exports, mapped to the
# canonical keys the question engine already understands.
HEADER_ALIASES: dict[str, set[str]] = {
    "text": {"text", "question", "questions", "question_text", "prompt", "stem", "q", "body"},
    "option_a": {"option_a", "optiona", "a", "choice_a", "choicea", "answer_a", "answera", "opt_a", "opta"},
    "option_b": {"option_b", "optionb", "b", "choice_b", "choiceb", "answer_b", "answerb", "opt_b", "optb"},
    "option_c": {"option_c", "optionc", "c", "choice_c", "choicec", "answer_c", "answerc", "opt_c", "optc"},
    "option_d": {"option_d", "optiond", "d", "choice_d", "choiced", "answer_d", "answerd", "opt_d", "optd"},
    "correct": {
        "correct",
        "answer",
        "key",
        "answer_key",
        "answerkey",
        "correct_answer",
        "correctanswer",
        "correct_option",
        "correctoption",
        "right_answer",
        "rightanswer",
    },
    "explanation": {"explanation", "reason", "why", "rationale", "note", "comments", "comment"},
    "points": {"points", "marks", "mark", "score", "weight"},
    "difficulty": {"difficulty", "level"},
    "question_type": {"question_type", "type", "format", "kind"},
    "topic": {"topic", "subject", "module", "unit"},
    "subtopic": {"subtopic", "sub_topic", "section", "sub_section"},
    "tags": {"tags", "tag", "labels", "keywords"},
    "source": {"source", "origin"},
    "reference": {"reference", "ref", "citation"},
    "status": {"status", "state", "published"},
    "number": {"number", "no", "num", "n", "#", "index", "id", "sn"},
}

POSITIONAL_ORDER = [
    "number",
    "text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct",
    "explanation",
]

# ``1. Question text`` / ``Q7) ...`` — used to re-split PDFs that lost blank lines.
QUESTION_START = re.compile(r"^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\-:]\s*(?=[A-Z(])", re.I)
OPTION_LINE = re.compile(r"^\s*\(?([A-Da-d])\)?\s*[.)\-:]\s*\S")


class UploadError(ValueError):
    """A file we refuse to read, with the HTTP status the caller should use."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UploadError("That file is not readable text (unknown encoding).")


def _suffix(filename: str) -> str:
    name = (filename or "").strip().lower()
    return f".{name.rsplit('.', 1)[-1]}" if "." in name else ""


def _delimiter(first_line: str) -> str:
    counts = {char: first_line.count(char) for char in (",", ";", "\t", "|")}
    best = max(counts, key=lambda char: counts[char])
    return best if counts[best] >= 2 else ""


def _normalise_header(cell: str) -> str:
    return re.sub(r"[^a-z0-9_#]", "", (cell or "").strip().lower().replace(" ", "_"))


def _canonical_key(header: str) -> str | None:
    key = _normalise_header(header)
    for canonical, aliases in HEADER_ALIASES.items():
        if key in aliases:
            return canonical
    return None


def _looks_like_csv(text: str) -> bool:
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    delimiter = _delimiter(lines[0])
    if not delimiter:
        return False
    headers = [part for part in lines[0].split(delimiter)]
    if len(headers) < 3:
        return False
    matched = sum(1 for header in headers if _canonical_key(header))
    return matched >= 3


def _split_csv(text: str) -> list[dict[str, Any]]:
    """Read a delimited paper into import-style rows, preserving answer letters."""
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []
    delimiter = _delimiter(lines[0]) or ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    raw_rows = [row for row in reader if any((cell or "").strip() for cell in row)]
    if not raw_rows:
        return []

    header = raw_rows[0]
    mapping: dict[int, str] = {}
    for index, cell in enumerate(header):
        canonical = _canonical_key(cell)
        if canonical:
            mapping[index] = canonical
    body = raw_rows[1:]
    if len(mapping) < 3:
        # Headerless file: fall back to the documented positional order.
        mapping = {index: key for index, key in enumerate(POSITIONAL_ORDER) if index < len(header)}
        body = raw_rows

    rows: list[dict[str, Any]] = []
    for raw in body:
        row: dict[str, Any] = {}
        for index, value in enumerate(raw):
            key = mapping.get(index)
            if key is None:
                continue
            cell = (value or "").strip()
            if key == "tags":
                row[key] = [tag.strip() for tag in re.split(r"[;,|]", cell) if tag.strip()]
            elif key in {"points", "number"}:
                row[key] = int(cell) if cell.isdigit() else None
            else:
                row[key] = cell
        if any(str(value or "").strip() for key, value in row.items() if key != "number"):
            rows.append(row)
    return rows


def _normalise_text(raw: str) -> tuple[str, list[str]]:
    """Tidy extracted text and, when a PDF lost its blank lines, re-split it."""
    notes: list[str] = []
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = re.sub(r"[ \t]+\n", "\n", text)
    # Words broken across a page/line break: "consti-\ntution" → "constitution".
    joined = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    if joined != text:
        notes.append("Joined words that were hyphen-broken across lines.")
        text = joined
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    blocks = [block for block in re.split(r"\n\s*\n", text) if block.strip()]
    starts = [line for line in text.splitlines() if QUESTION_START.match(line) and not OPTION_LINE.match(line)]
    if len(blocks) < 2 and len(starts) >= 2:
        rebuilt: list[str] = []
        current: list[str] = []
        for line in text.splitlines():
            if QUESTION_START.match(line) and not OPTION_LINE.match(line) and current:
                rebuilt.append("\n".join(current))
                current = [line]
            elif line.strip():
                current.append(line)
        if current:
            rebuilt.append("\n".join(current))
        if len(rebuilt) >= 2:
            text = "\n\n".join(rebuilt)
            notes.append(f"No blank lines in the file — split it into {len(rebuilt)} questions by their numbering.")
    return text, notes


def _read_pdf(data: bytes) -> tuple[str, list[str]]:
    try:
        from pypdf import PdfReader  # imported lazily: PDFs are optional to support
    except ImportError as error:  # pragma: no cover - dependency is in requirements
        raise UploadError("PDF import is unavailable on this server (pypdf is not installed).", 415) from error

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages]
    except Exception as error:  # noqa: BLE001 - any malformed PDF lands here
        raise UploadError(f"That PDF could not be opened: {error}", 415) from error

    text = "\n\n".join(pages)
    notes = [f"Read {len(pages)} page{'' if len(pages) == 1 else 's'} from the PDF."]
    if len(text.strip()) < 40:
        raise UploadError(
            "This PDF has no selectable text — it is probably a scan or photos of pages. "
            "Upload a text-based PDF, or paste the questions instead.",
            415,
        )
    return text, notes


def read_upload(filename: str, data: bytes, *, content_type: str = "") -> dict[str, Any]:
    """Read an uploaded paper into ``text`` (for the parser) or ``payload`` (for rows)."""
    if not data:
        raise UploadError("That file is empty.")
    if len(data) > MAX_BYTES:
        raise UploadError(f"That file is larger than {MAX_BYTES // (1024 * 1024)} MB.", 413)

    suffix = _suffix(filename)
    is_pdf = data[:5] == b"%PDF-" or suffix in PDF_SUFFIXES or "pdf" in (content_type or "").lower()
    if suffix and suffix not in SUPPORTED_SUFFIXES and not is_pdf:
        raise UploadError("Unsupported file type. Upload a .txt, .csv, .pdf or .json file.", 415)

    meta: dict[str, Any] = {
        "filename": filename or "upload",
        "bytes": len(data),
        "kind": "",
        "pages": None,
        "notes": [],
    }

    if is_pdf:
        text, notes = _read_pdf(data)
        meta.update(kind="pdf", notes=notes)
        text, extra = _normalise_text(text)
        meta["notes"].extend(extra)
        meta["characters"] = len(text)
        return {**meta, "text": text, "payload": None}

    decoded = _decode(data)

    if suffix in JSON_SUFFIXES or decoded.lstrip()[:1] in {"[", "{"}:
        try:
            payload = json.loads(decoded)
        except json.JSONDecodeError as error:
            raise UploadError(f"That JSON file could not be parsed: {error.msg} (line {error.lineno}).") from error
        rows = payload.get("questions") if isinstance(payload, dict) else payload
        if not isinstance(rows, list) or not rows:
            raise UploadError("That JSON file does not contain a list of questions.")
        meta.update(kind="json", rows_detected=len(rows), notes=[f"Found {len(rows)} question objects."])
        return {**meta, "text": "", "payload": payload}

    if suffix in CSV_SUFFIXES or _looks_like_csv(decoded):
        rows = _split_csv(decoded)
        if not rows:
            raise UploadError("No question rows found in that file — check the header row and try again.")
        notes = [f"Read {len(rows)} row{'' if len(rows) == 1 else 's'} with the answers exactly as written."]
        if suffix in TEXT_SUFFIXES:
            notes.append("A .txt file with comma-separated columns was read as a table.")
        meta.update(kind="csv", rows_detected=len(rows), notes=notes, delimiter=_delimiter(decoded.splitlines()[0]))
        return {**meta, "text": "", "payload": rows}

    text, notes = _normalise_text(decoded)
    if len(text.strip()) < 12:
        raise UploadError("That file has almost no text in it.")
    meta.update(kind="text", notes=notes, characters=len(text))
    return {**meta, "text": text, "payload": None}
