"""Turn an uploaded document into course-material sections.

Staff upload a Word / PDF / text / slide file and only fill in the basics
(course, title, topic). This module reads the file into a neutral outline —
headings, paragraphs, lists and tables — and packs it into the reader's
section/block format. It never invents content: whatever cannot be read
faithfully is reported instead of guessed at.

Supported: .docx .odt .pdf .txt .md .rtf .html/.htm .pptx
Only the standard library is used for the zip/XML formats; PDFs use pypdf.
"""
from __future__ import annotations

import io
import re
import zipfile
from html.parser import HTMLParser
from typing import Any
from xml.etree import ElementTree as ET

MAX_BYTES = 20 * 1024 * 1024
SUPPORTED = {".docx", ".odt", ".pdf", ".txt", ".text", ".md", ".markdown", ".rtf", ".html", ".htm", ".pptx"}
ACCEPT_HINT = "Word (.docx), PDF, text (.txt / .md), OpenDocument (.odt), RTF, HTML or PowerPoint (.pptx)"

# Reader limits (mirrors services.materials.sanitise_blocks) — we split rather
# than let the sanitiser silently truncate anything.
BLOCK_CHARS = 5500
LIST_ITEMS = 40
TABLE_ROWS = 40
TABLE_COLS = 8
SECTION_BLOCKS = 120
SECTION_WORDS = 1800
MAX_SECTIONS = 80


class DocumentError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------- outline
# Every reader yields a flat list of elements:
#   ("heading", level:int, text)   ("para", text)
#   ("list", ordered:bool, [items]) ("table", [[cells]])

Element = tuple


def _tidy(text: str) -> str:
    text = (text or "").replace("\u00a0", " ").replace("\u200b", "")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    return text.strip()


def _suffix(filename: str) -> str:
    name = (filename or "").strip().lower()
    return f".{name.rsplit('.', 1)[-1]}" if "." in name else ""


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "utf-8", "cp1252", "latin-1"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if encoding == "utf-16" and not data[:2] in (b"\xff\xfe", b"\xfe\xff"):
            continue
        return text
    raise DocumentError("That file is not readable text (unknown encoding).")


def title_from_filename(filename: str) -> str:
    stem = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = stem.rsplit(".", 1)[0] if "." in stem else stem
    stem = re.sub(r"[_]+", " ", stem)
    stem = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", stem, flags=re.I)
    stem = re.sub(r"\s+", " ", stem).strip(" -")
    if stem and stem == stem.lower():
        stem = stem[:1].upper() + stem[1:]
    return stem[:200] or "Imported material"


# ------------------------------------------------------------ plain text
_BULLET = re.compile(r"^\s*(?:[-*•▪◦●■–]|\u2022)\s+(.*\S)")
_NUMBERED = re.compile(r"^\s*(?:\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,5}[.)])\s+(.*\S)", re.I)
_MD_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_SENTENCE_END = re.compile(r"[.!?:;\"')\]]$")


_SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "v", "vs", "via", "with"}


def _caps_to_title(text: str) -> str:
    words = text.lower().split()
    out = []
    for index, word in enumerate(words):
        if index and word in _SMALL_WORDS:
            out.append(word)
        elif re.fullmatch(r"[ivxlcdm]+", word) and len(word) <= 4:
            out.append(word.upper())  # roman numerals: "LAW I" stays "Law I"
        else:
            out.append(word[:1].upper() + word[1:])
    return " ".join(out)


def _is_caps_heading(line: str) -> bool:
    stripped = line.strip()
    letters = re.sub(r"[^A-Za-z]", "", stripped)
    return 3 <= len(letters) and len(stripped) <= 80 and stripped == stripped.upper() and not stripped.endswith((".", ",", ";"))


# ------------------------------------------------------- numbering + headings
# List markers: 1.  1)  (1)  a.  a)  (a)  A.  i.  (iv)  I.  — style + wrap are kept so
# the reader shows exactly the numbering the notes use, with nesting levels.
_MARKER = re.compile(r"^\s*(\()?(\d{1,3}|[A-Za-z]|[ivxlcIVXLC]{2,6})([.)])\s+(\S.*)$")
_MULTI_NUM = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\S.*)$")
_LABEL_WORDS = r"chapter|part|unit|lecture|topic|module|week|lesson|section|rule|article|order|book|title|division"
_LABEL = re.compile(
    rf"^\s*({_LABEL_WORDS})\s+(\d{{1,3}}[A-Za-z]?|[ivxlcIVXLC]{{1,6}}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[A-Za-z])\b\s*[:.\-–—]?\s*(.*)$",
    re.I,
)
_ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}


def _roman_value(token: str) -> int:
    total, prev = 0, 0
    for ch in reversed(token.lower()):
        value = _ROMAN.get(ch, 0)
        total = total - value if value < prev else total + value
        prev = max(prev, value)
    return total


def _marker(line: str, prev: dict | None) -> dict | None:
    """Parse a list marker at the start of ``line`` (``prev`` = last marker in this list run)."""
    match = _MARKER.match(line)
    if not match:
        return None
    opened, token, close, rest = match.groups()
    if opened and close != ")":
        return None
    if re.match(r"^[A-Z]\.\s", rest) and not token.isdigit():
        return None  # initials: "A. B. Okafor"
    wrap = "paren" if opened else ("rparen" if close == ")" else "dot")
    if token.isdigit():
        return {"style": "decimal", "wrap": wrap, "value": int(token), "text": rest}
    if not (token.islower() or token.isupper()):
        return None
    lower = token.islower()
    alpha = f"{'lower' if lower else 'upper'}-alpha"
    roman = f"{'lower' if lower else 'upper'}-roman"
    same_wrap = bool(prev and prev["wrap"] == wrap)
    if len(token) == 1:
        letter = ord(token.lower()) - 96
        # "i" after "h" is a letter; "v" after "iv" is a numeral
        if same_wrap and prev["style"] == alpha and letter == prev["value"] + 1:
            return {"style": alpha, "wrap": wrap, "value": letter, "text": rest}
        if token.lower() in _ROMAN and (
            (same_wrap and prev["style"] == roman and _roman_value(token) == prev["value"] + 1) or token.lower() == "i"
        ):
            return {"style": roman, "wrap": wrap, "value": _roman_value(token), "text": rest}
        return {"style": alpha, "wrap": wrap, "value": letter, "text": rest}
    if re.fullmatch(r"[ivxlc]+", token.lower()) and _roman_value(token) > 0:
        return {"style": roman, "wrap": wrap, "value": _roman_value(token), "text": rest}
    return None


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][\w'’-]*", text)


def _is_titleish(text: str) -> bool:
    """Short, mostly Capitalised Words, no sentence ending — reads like a heading."""
    stripped = text.strip()
    if not stripped or len(stripped) > 90 or re.search(r"[.;,]$", stripped):
        return False
    words = _words(stripped)
    if not 1 <= len(words) <= 12:
        return False
    if stripped == stripped.upper() and len(re.sub(r"[^A-Za-z]", "", stripped)) >= 3:
        return True
    significant = [word for word in words if word.lower() not in _SMALL_WORDS]
    if not significant:
        return False
    capital = sum(1 for word in significant if word[:1].isupper())
    return capital / len(significant) >= 0.75


def clean_heading(text: str) -> str:
    """Readable heading text: SHOUTED words in Title Case (numbering kept), no trailing colon."""
    text = _tidy(text).strip(" :-–—.")
    head = re.match(r"^((?:\(?[\dA-Za-z]{1,6}[.)]|\d{1,2}(?:\.\d{1,2})+\.?)\s+)(.*)$", text)
    prefix, body = (head.group(1), head.group(2)) if head else ("", text)
    letters = re.sub(r"[^A-Za-z]", "", body)
    if letters and body == body.upper() and len(letters) > 3:
        body = _caps_to_title(body)
    return f"{prefix}{body}".strip()[:200]


_WORD_NUMBERS = {w: i for i, w in enumerate("one two three four five six seven eight nine ten eleven twelve".split(), start=1)}


def _text_outline(text: str, *, markdown: bool = False, reflow: bool = False) -> list[Element]:
    """Plain / markdown text. ``reflow`` joins hard-wrapped lines (PDF output).

    Headings are recognised from: markdown #, SHOUTED lines, "Chapter 1 / Part II /
    Unit 3: …" labels, "1.1 Meaning of …" numbering, lettered/numbered short title
    lines ("A. Introduction", "1. Types of Affidavit") and short Title Case lines
    that stand alone. Lists keep their numbering style — 1. (a) a) i. (iv) A. I. —
    and nesting level; wrapped list lines are joined back to their item.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # words hyphen-broken across lines
    lines = text.split("\n")
    lengths = sorted(len(line.strip()) for line in lines if len(line.strip()) > 20)
    wrap = lengths[int(len(lengths) * 0.6)] if lengths else 80

    out: list[Element] = []
    para: list[str] = []
    current: dict | None = None  # open list: {"key", "level", "items", "meta"}
    stack: list[tuple] = []  # nesting of list styles in this run
    last_marker: dict[tuple, dict] = {}  # per (style family, wrap): last marker seen in this run
    prev_list_item = False  # the previous non-blank line was a list item

    def flush_para() -> None:
        if para:
            joined = _tidy(" ".join(para))
            if joined:
                out.append(("para", joined))
            para.clear()

    def flush_list() -> None:
        nonlocal current
        if current and current["items"]:
            out.append(("list", current["meta"]["style"] != "bullet", list(current["items"]), dict(current["meta"])))
        current = None

    def end_run() -> None:
        nonlocal prev_list_item
        flush_list()
        stack.clear()
        last_marker.clear()
        prev_list_item = False

    def heading(level: int, value: str) -> None:
        flush_para()
        end_run()
        cleaned = clean_heading(value)
        if cleaned:
            out.append(("heading", level, cleaned))

    def next_nonblank(i: int) -> str:
        for later in lines[i + 1 : i + 4]:
            if later.strip():
                return later.strip()
        return ""

    def previous_ended(i: int) -> bool:
        """Blank line before, or the previous line finished a sentence."""
        for earlier in reversed(lines[max(0, i - 2) : i]):
            if not earlier.strip():
                return True
            return bool(_SENTENCE_END.search(earlier.strip()))
        return True

    def add_item(meta: dict, value: str) -> None:
        nonlocal current, prev_list_item
        key = (meta["style"], meta["wrap"])
        if not stack or stack[-1] != key:
            if key in stack:
                while stack[-1] != key:
                    stack.pop()
            else:
                stack.append(key)
        level = min(len(stack) - 1, 2)
        if not current or current["key"] != key or current["level"] != level:
            flush_list()
            current = {
                "key": key,
                "level": level,
                "items": [],
                "meta": {"style": meta["style"], "wrap": meta["wrap"], "start": meta.get("value", 1), "level": level},
            }
        current["items"].append(_tidy(value))
        if meta["style"] != "bullet":
            last_marker[(meta["style"].split("-")[-1], meta["wrap"])] = meta
            last_marker["last"] = meta
        prev_list_item = True

    for i, raw in enumerate(lines):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            flush_para()
            continue
        if markdown:
            match = _MD_HEADING.match(line)
            if match:
                heading(len(match.group(1)), re.sub(r"[*_`]", "", match.group(2)))
                continue
            stripped = re.sub(r"(\*\*|__|`)", "", stripped)

        after = next_nonblank(i)

        # "Chapter One" / "Part II: Sources of Law" / "Unit 3 – Affidavits"
        label = None if markdown else _LABEL.match(stripped)
        if label and len(stripped) <= 90 and not re.search(r"[.;,]$", stripped):
            word, number, title = label.group(1), label.group(2), label.group(3)
            is_structural = word.lower() not in {"section", "rule", "article", "order"}
            if is_structural or not title or _is_titleish(title):
                if not title and after and _is_titleish(after) and not _LABEL.match(after) and not _marker(after, None):
                    title = after
                    lines[i + 1 : i + 4] = [("" if l.strip() == after else l) for l in lines[i + 1 : i + 4]]
                name = f"{word.capitalize()} {number.capitalize() if number.lower() in _WORD_NUMBERS else number.upper() if re.fullmatch(r'[ivxlc]+', number, re.I) else number}"
                heading(1 if is_structural else 3, f"{name}: {clean_heading(title)}" if title else name)
                continue

        # "1.1 Meaning of Affidavit" / "2.3.1 Contents"
        multi = None if markdown else _MULTI_NUM.match(stripped)
        if multi and _is_titleish(multi.group(2)) and not re.search(r"[.;,:]$", stripped):
            depth = multi.group(1).count(".") + 1
            heading(min(4 + depth, 6), f"{multi.group(1)} {multi.group(2)}")
            continue

        bullet = _BULLET.match(stripped)
        marker = None if bullet else _marker(stripped, last_marker.get("last"))
        if marker:
            family = (marker["style"].split("-")[-1], marker["wrap"])
            prev = last_marker.get(family)
            continues = bool(prev and prev["style"] == marker["style"] and marker["value"] == prev["value"] + 1)
            # A short title line with a marker, followed by prose, is a heading ("A. Introduction").
            titled = _is_titleish(marker["text"]) and not re.search(r"[:;,.]$", marker["text"])
            nxt = _marker(after, marker) if after else None
            followed_by_sibling = bool(nxt and nxt["style"] == marker["style"] and nxt["wrap"] == marker["wrap"])
            if titled and not continues and not followed_by_sibling and not prev_list_item and previous_ended(i) and after and not _BULLET.match(after):
                rank = {"upper-roman": 2, "upper-alpha": 3, "decimal": 5}.get(marker["style"], 6)
                heading(rank, stripped)
                continue
            # After running text, only accept a marker that clearly starts an item.
            if para and not (marker["wrap"] != "dot" or _SENTENCE_END.search(para[-1]) or continues or marker["value"] == 1):
                para.append(stripped)
                continue
            flush_para()
            add_item(marker, marker["text"])
            continue
        if bullet:
            flush_para()
            add_item({"style": "bullet", "wrap": ""}, bullet.group(1))
            continue

        # a wrapped list line: join it back to its item
        if current and current["items"] and prev_list_item:
            last = current["items"][-1]
            indented = raw[:1] in (" ", "\t")
            prev_line = next((l.strip() for l in reversed(lines[:i]) if l.strip()), "")
            ran_to_margin = len(prev_line) >= wrap * 0.7  # the item's last line was wrapped, not finished
            if (indented and not reflow) or (reflow and (stripped[:1].islower() or (ran_to_margin and not re.search(r"[.;:!?]$", last)))):
                current["items"][-1] = _tidy(f"{last} {stripped}")
                continue

        if not markdown and _is_caps_heading(stripped) and not _marker(stripped, None):
            heading(4, stripped)
            continue

        # A short Title Case line standing alone before a paragraph: a subheading.
        if (
            not markdown
            and not para
            and _is_titleish(stripped)
            and len(_words(stripped)) >= 2
            and previous_ended(i)
            and after
            and len(after) > len(stripped)
            and after[:1].isupper()
            and not _marker(after, None)
        ):
            heading(6, stripped)
            continue

        end_run()
        if reflow and para:
            previous = para[-1]
            # A short line that ends a sentence closes the paragraph.
            if _SENTENCE_END.search(previous) and len(previous) < wrap * 0.8:
                flush_para()
        para.append(stripped)
    flush_para()
    flush_list()
    return out


# ------------------------------------------------------------------ DOCX
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx_text(node: ET.Element) -> str:
    parts: list[str] = []
    for el in node.iter():
        tag = el.tag
        if tag == f"{W}t" and el.text:
            parts.append(el.text)
        elif tag in (f"{W}tab",):
            parts.append(" ")
        elif tag in (f"{W}br", f"{W}cr"):
            parts.append("\n")
    return "".join(parts)


def _docx_outline(data: bytes) -> list[Element]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        document = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        raise DocumentError("That Word file could not be opened — is it a real .docx?", 415) from error

    style_names: dict[str, str] = {}
    try:
        styles = ET.fromstring(archive.read("word/styles.xml"))
        for style in styles.iter(f"{W}style"):
            sid = style.get(f"{W}styleId") or ""
            name = style.find(f"{W}name")
            style_names[sid] = (name.get(f"{W}val") if name is not None else sid) or sid
    except (KeyError, ET.ParseError):
        pass

    # numId → level → {style, wrap, start}: Word's own numbering (1. / (a) / i. / A. …)
    num_levels: dict[str, dict[int, dict]] = {}
    fmt_style = {"decimal": "decimal", "decimalZero": "decimal", "lowerLetter": "lower-alpha", "upperLetter": "upper-alpha", "lowerRoman": "lower-roman", "upperRoman": "upper-roman"}
    try:
        numbering = ET.fromstring(archive.read("word/numbering.xml"))
        abstract_levels: dict[str, dict[int, dict]] = {}
        for abstract in numbering.iter(f"{W}abstractNum"):
            levels: dict[int, dict] = {}
            for lvl in abstract.findall(f"{W}lvl"):
                ilvl = int(lvl.get(f"{W}ilvl") or 0)
                fmt = lvl.find(f"{W}numFmt")
                text_el = lvl.find(f"{W}lvlText")
                start_el = lvl.find(f"{W}start")
                fmt_val = (fmt.get(f"{W}val") if fmt is not None else "bullet") or "bullet"
                pattern = (text_el.get(f"{W}val") if text_el is not None else "") or ""
                wrap = "paren" if pattern.startswith("(") else ("rparen" if pattern.endswith(")") else "dot")
                start_val = start_el.get(f"{W}val") if start_el is not None else "1"
                levels[ilvl] = {
                    "style": fmt_style.get(fmt_val, "bullet" if fmt_val in {"bullet", "none"} else "decimal"),
                    "wrap": wrap,
                    "start": int(start_val) if str(start_val).isdigit() else 1,
                }
            abstract_levels[abstract.get(f"{W}abstractNumId") or ""] = levels
        for num in numbering.iter(f"{W}num"):
            ref = num.find(f"{W}abstractNumId")
            if ref is not None:
                num_levels[num.get(f"{W}numId") or ""] = abstract_levels.get(ref.get(f"{W}val") or "", {})
    except (KeyError, ET.ParseError):
        pass
    ordered_nums = {nid for nid, levels in num_levels.items() if levels.get(0, {}).get("style", "bullet") != "bullet"}
    counters: dict[str, dict[int, int]] = {}

    body = document.find(f"{W}body")
    if body is None:
        return []
    out: list[Element] = []
    items: list[str] = []
    list_ordered = False
    list_meta: dict = {}
    list_key: tuple = ()

    def flush_list() -> None:
        if items:
            out.append(("list", list_ordered, list(items), dict(list_meta)))
            items.clear()

    for child in body:
        if child.tag == f"{W}tbl":
            flush_list()
            rows: list[list[str]] = []
            for tr in child.iter(f"{W}tr"):
                cells = [_tidy(_docx_text(tc).replace("\n", " ")) for tc in tr.findall(f"{W}tc")]
                if any(cells):
                    rows.append(cells)
            if rows:
                out.append(("table", rows))
            continue
        if child.tag != f"{W}p":
            continue
        text = _tidy(_docx_text(child))
        ppr = child.find(f"{W}pPr")
        style_id = ""
        level: int | None = None
        num_id = ""
        if ppr is not None:
            pstyle = ppr.find(f"{W}pStyle")
            style_id = pstyle.get(f"{W}val") if pstyle is not None else ""
            outline = ppr.find(f"{W}outlineLvl")
            if outline is not None and (outline.get(f"{W}val") or "").isdigit() and int(outline.get(f"{W}val")) < 9:
                level = int(outline.get(f"{W}val")) + 1  # 9 means "body text"
            numpr = ppr.find(f"{W}numPr")
            ilvl = 0
            if numpr is not None:
                nid = numpr.find(f"{W}numId")
                num_id = (nid.get(f"{W}val") if nid is not None else "") or ""
                lvl_el = numpr.find(f"{W}ilvl")
                ilvl = int(lvl_el.get(f"{W}val") or 0) if lvl_el is not None and str(lvl_el.get(f"{W}val") or "0").isdigit() else 0
        name = (style_names.get(style_id or "", style_id or "") or "").lower().replace(" ", "")
        if name in {"title"}:
            level = 0
        elif match := re.match(r"(?:heading|überschrift|titre|titolo|encabezado|kop)(\d)", name):
            level = int(match.group(1))
        elif name in {"subtitle"}:
            level = 2
        if not text:
            continue  # empty paragraphs between items don't end a list
        if level is not None and len(text) <= 200:
            flush_list()
            out.append(("heading", min(level, 6), text))
        elif num_id and num_id != "0" or "listparagraph" in name or name.startswith("listbullet") or name.startswith("listnumber"):
            level_info = num_levels.get(num_id, {}).get(ilvl) if num_id else None
            if level_info:
                is_ordered = level_info["style"] != "bullet"
            else:
                is_ordered = num_id in ordered_nums or name.startswith("listnumber")
            # Word's running counters: deeper levels restart when a shallower item appears.
            count = counters.setdefault(num_id, {})
            for deeper in [k for k in count if k > ilvl]:
                count.pop(deeper)
            count[ilvl] = count.get(ilvl, (level_info or {}).get("start", 1) - 1) + 1
            key = (num_id, ilvl)
            if items and (key != list_key or is_ordered != list_ordered):
                flush_list()
            if not items:
                list_meta = {
                    "style": (level_info or {}).get("style", "decimal") if is_ordered else "bullet",
                    "wrap": (level_info or {}).get("wrap", "dot"),
                    "start": count[ilvl],
                    "level": min(ilvl, 2),
                }
            list_key = key
            list_ordered = is_ordered
            items.append(text.replace("\n", " "))
        else:
            flush_list()
            for piece in text.split("\n"):
                if piece.strip():
                    out.append(("para", _tidy(piece)))
    flush_list()
    return out


# ------------------------------------------------------------------- ODT
ODF_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
ODF_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"


def _odf_text(node: ET.Element) -> str:
    parts: list[str] = []

    def walk(el: ET.Element) -> None:
        if el.text:
            parts.append(el.text)
        for sub in el:
            if sub.tag == f"{ODF_TEXT}s":
                parts.append(" " * int(sub.get(f"{ODF_TEXT}c") or 1))
            elif sub.tag == f"{ODF_TEXT}tab":
                parts.append(" ")
            elif sub.tag == f"{ODF_TEXT}line-break":
                parts.append("\n")
            else:
                walk(sub)
            if sub.tail:
                parts.append(sub.tail)

    walk(node)
    return "".join(parts)


def _odt_outline(data: bytes) -> list[Element]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        root = ET.fromstring(archive.read("content.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        raise DocumentError("That OpenDocument file could not be opened.", 415) from error
    out: list[Element] = []

    def visit(el: ET.Element) -> None:
        for child in el:
            if child.tag == f"{ODF_TEXT}h":
                text = _tidy(_odf_text(child))
                if text:
                    out.append(("heading", int(child.get(f"{ODF_TEXT}outline-level") or 1), text))
            elif child.tag == f"{ODF_TEXT}p":
                text = _tidy(_odf_text(child))
                if text:
                    out.append(("para", text))
            elif child.tag == f"{ODF_TEXT}list":
                items = [_tidy(" ".join(_odf_text(p) for p in item.iter(f"{ODF_TEXT}p"))) for item in child.findall(f"{ODF_TEXT}list-item")]
                items = [item for item in items if item]
                if items:
                    out.append(("list", False, items))
            elif child.tag == f"{ODF_TABLE}table":
                rows = []
                for row in child.iter(f"{ODF_TABLE}table-row"):
                    cells = [_tidy(_odf_text(cell)) for cell in row.findall(f"{ODF_TABLE}table-cell")]
                    if any(cells):
                        rows.append(cells)
                if rows:
                    out.append(("table", rows))
            else:
                visit(child)

    body = root.find(".//{urn:oasis:names:tc:opendocument:xmlns:office:1.0}text")
    visit(body if body is not None else root)
    return out


# ------------------------------------------------------------------ PPTX
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def _pptx_outline(data: bytes) -> list[Element]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise DocumentError("That PowerPoint file could not be opened — is it a real .pptx?", 415) from error
    slides = sorted(
        (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
        key=lambda name: int(re.search(r"(\d+)", name.rsplit("/", 1)[-1]).group(1)),
    )
    out: list[Element] = []
    for number, name in enumerate(slides, start=1):
        root = ET.fromstring(archive.read(name))
        title = ""
        bullets: list[str] = []
        for shape in root.iter(f"{P}sp"):
            ph = shape.find(f".//{P}ph")
            is_title = ph is not None and (ph.get("type") or "") in {"title", "ctrTitle"}
            for para in shape.iter(f"{A}p"):
                text = _tidy("".join(t.text or "" for t in para.iter(f"{A}t")))
                if not text:
                    continue
                if is_title and not title:
                    title = text
                else:
                    bullets.append(text)
        out.append(("heading", 1, title or f"Slide {number}"))
        if bullets:
            out.append(("list", False, bullets))
    return out


# ------------------------------------------------------------------ HTML
class _HtmlOutline(HTMLParser):
    SKIP = {"script", "style", "noscript", "head", "svg", "nav", "footer"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[Element] = []
        self.buffer: list[str] = []
        self.skip = 0
        self.heading = 0
        self.lists: list[tuple[bool, list[str]]] = []
        self.in_li = False
        self.table: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.in_cell = False

    def _take(self) -> str:
        text = _tidy(" ".join(self.buffer))
        self.buffer = []
        return text

    def _flush_para(self) -> None:
        text = self._take()
        if text and self.table is None:
            self.out.append(("para", text))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._flush_para()
            self.heading = int(tag[1])
        elif tag in {"p", "div", "section", "article", "blockquote", "pre"} and not self.in_li and not self.in_cell:
            self._flush_para()
        elif tag in {"ul", "ol"}:
            self._flush_para()
            self.lists.append((tag == "ol", []))
        elif tag == "li":
            self.buffer = []
            self.in_li = True
        elif tag == "br":
            self.buffer.append("\n")
        elif tag == "table":
            self._flush_para()
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in {"td", "th"} and self.row is not None:
            self.buffer = []
            self.in_cell = True

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"} and self.heading:
            text = self._take()
            if text:
                self.out.append(("heading", self.heading, text))
            self.heading = 0
        elif tag == "li" and self.lists:
            text = self._take()
            if text:
                self.lists[-1][1].append(text)
            self.in_li = False
        elif tag in {"ul", "ol"} and self.lists:
            ordered, items = self.lists.pop()
            if items:
                self.out.append(("list", ordered, items))
        elif tag in {"td", "th"} and self.row is not None:
            self.row.append(self._take())
            self.in_cell = False
        elif tag == "tr" and self.table is not None and self.row is not None:
            if any(self.row):
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            if self.table:
                self.out.append(("table", self.table))
            self.table = None
        elif tag in {"p", "div", "section", "article", "blockquote", "pre"} and not self.in_li and not self.in_cell:
            self._flush_para()

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.buffer.append(data)

    def close(self) -> None:
        super().close()
        self._flush_para()


def _html_outline(text: str) -> list[Element]:
    parser = _HtmlOutline()
    parser.feed(text)
    parser.close()
    return parser.out


# ------------------------------------------------------------------- RTF
def _rtf_to_text(rtf: str) -> str:
    if not rtf.lstrip().startswith("{\\rtf"):
        raise DocumentError("That RTF file is not valid.", 415)
    # Drop destination groups we never want as text (fonts, colours, pictures…).
    text = re.sub(r"\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", "", rtf)
    for group in ("fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer"):
        text = re.sub(r"\{\\" + group + r"(?:[^{}]|\{[^{}]*\})*\}", "", text)
    text = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: bytes.fromhex(m.group(1)).decode("cp1252", "replace"), text)
    text = re.sub(r"\\u(-?\d+)\??", lambda m: chr(int(m.group(1)) % 65536), text)
    text = re.sub(r"\\(par|line|sect|page)\b ?", "\n", text)
    text = re.sub(r"\\tab\b ?", " ", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    text = text.replace("\\{", "{").replace("\\}", "}").replace("\\\\", "\\")
    text = text.replace("{", "").replace("}", "")
    return re.sub(r"\n{3,}", "\n\n", text)


# -------------------------------------------------------------------- PDF
def _pdf_text(data: bytes) -> tuple[str, int]:
    try:
        from pypdf import PdfReader
    except ImportError as error:  # pragma: no cover - dependency is in requirements
        raise DocumentError("PDF import is unavailable on this server (pypdf is not installed).", 415) from error
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as error:  # noqa: BLE001
                raise DocumentError("That PDF is password-protected. Remove the password and upload it again.", 415) from error
        pages = [(page.extract_text() or "") for page in reader.pages]
    except DocumentError:
        raise
    except Exception as error:  # noqa: BLE001 - any malformed PDF lands here
        raise DocumentError(f"That PDF could not be opened: {error}", 415) from error
    text = "\n\n".join(_strip_page_furniture(pages))
    if len(text.strip()) < 40:
        raise DocumentError(
            "This PDF has no selectable text — it is probably a scan or photos of pages. "
            "Upload a text-based PDF or the original Word file instead.",
            415,
        )
    return text, len(pages)


_PAGE_NUMBER = re.compile(r"^(?:page\s*)?[-–—(\[]?\s*\d{1,4}\s*[-–—)\]]?(?:\s*(?:of|/)\s*\d{1,4})?$", re.I)
_FURNITURE_WORDS = re.compile(r"^(?:downloaded from|printed (?:on|by)|confidential|all rights reserved|copyright|©)", re.I)


def _exact_key(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip().lower())


def _furniture_key(line: str) -> str:
    """Normalise a header/footer line so "Page 3" and "Page 4" compare equal."""
    return re.sub(r"\d+", "#", _exact_key(line))


_PROTECTED = re.compile(r"^\W*(?:rule|section|article|chapter|part|order|regulation|schedule|clause|unit|lecture|topic|week|module)\s*\d", re.I)


def _has_page_number(line: str, page_no: int) -> bool:
    """A number that tracks the page, at the very start or end of the line
    ("12 | RPC Companion", "RPC Companion · 12", "Page 12 of 40")."""
    stripped = line.strip()
    if _PROTECTED.match(stripped):
        return False  # "Rule 2: Duty to the court" is a heading, never furniture
    edges = re.findall(r"^\W*(?:page\s*)?(\d{1,4})\b|\b(\d{1,4})(?:\s*(?:of|/)\s*\d{1,4})?\W*$", stripped, re.I)
    return any(abs(int(value) - page_no) <= 3 for pair in edges for value in pair if value)


def _strip_page_furniture(pages: list[str]) -> list[str]:
    """Drop running headers/footers and page numbers that PDFs repeat on every page.

    A line near the top or bottom of a page is furniture when the same text sits
    there on at least 40 % of pages (min. 3) — or the same text apart from a
    number that tracks the page number ("RPC Companion · 12") — or when it is a
    bare page number such as "12", "- 12 -" or "Page 3 of 40". Real headings
    like "Rule 1", "Rule 2" differ by more than the page count, so they stay.
    """
    split = [page.replace("\r", "").split("\n") for page in pages]
    edge = 2
    exact: dict[str, int] = {}
    numbered: dict[str, int] = {}
    for page_no, lines in enumerate(split, start=1):
        real = [line for line in lines if line.strip()]
        edges = real[:edge] + real[-edge:] if len(real) > 6 else []
        for key in {_exact_key(line) for line in edges}:
            exact[key] = exact.get(key, 0) + 1
        for key in {_furniture_key(line) for line in edges if len(line.strip()) <= 60 and re.search(r"\d", line) and _has_page_number(line, page_no)}:
            numbered[key] = numbered.get(key, 0) + 1
    threshold = max(3, int(len(split) * 0.4 + 0.999))
    enough = len(split) >= 3
    rep_exact = {k for k, n in exact.items() if enough and n >= threshold and len(k) <= 120}
    rep_numbered = {k for k, n in numbered.items() if enough and n >= threshold and len(k) <= 120}
    out: list[str] = []
    for page_no, lines in enumerate(split, start=1):
        real_index = [i for i, line in enumerate(lines) if line.strip()]
        near = set(real_index[:edge] + real_index[-edge:]) if len(real_index) > 6 else set()
        kept = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if i in near and stripped and not _PROTECTED.match(stripped) and (
                _exact_key(stripped) in rep_exact
                or (len(stripped) <= 60 and _furniture_key(stripped) in rep_numbered and _has_page_number(stripped, page_no))
                or _PAGE_NUMBER.match(stripped)
                or _FURNITURE_WORDS.match(stripped)
            ):
                continue
            kept.append(line)
        out.append("\n".join(kept))
    return out


# ------------------------------------------------------------ packaging
def _split_long(text: str) -> list[str]:
    if len(text) <= BLOCK_CHARS:
        return [text]
    pieces: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        while len(sentence) > BLOCK_CHARS:  # one enormous "sentence": break at a space
            cut = sentence.rfind(" ", 0, BLOCK_CHARS)
            cut = cut if cut > BLOCK_CHARS // 2 else BLOCK_CHARS
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if len(current) + len(sentence) + 1 > BLOCK_CHARS and current:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def _to_blocks(element: Element, *, sub_level: int) -> list[dict[str, Any]]:
    kind = element[0]
    if kind == "heading":
        level, text = element[1], element[2]
        return [{"type": "subheading" if level > sub_level else "heading", "text": text[:300]}]
    if kind == "para":
        return [{"type": "paragraph", "text": piece} for piece in _split_long(element[1])]
    if kind == "list":
        ordered, items = element[1], [item[:390] for item in element[2]]
        meta = element[3] if len(element) > 3 and isinstance(element[3], dict) else {}
        blocks = []
        for i in range(0, len(items), LIST_ITEMS):
            block: dict[str, Any] = {"type": "numbers" if ordered else "list", "items": items[i : i + LIST_ITEMS]}
            if ordered:
                style, wrap = meta.get("style") or "decimal", meta.get("wrap") or "dot"
                start = int(meta.get("start") or 1) + i
                if style != "decimal":
                    block["style"] = style
                if wrap != "dot":
                    block["wrap"] = wrap
                if start != 1:
                    block["start"] = start
            if meta.get("level"):
                block["level"] = int(meta["level"])
            blocks.append(block)
        return blocks
    if kind == "table":
        rows = [[cell[:195] for cell in row[:TABLE_COLS]] for row in element[1]]
        head, body = (rows[0], rows[1:]) if len(rows) > 1 else ([], rows)
        return [{"type": "table", "head": head, "rows": body[i : i + TABLE_ROWS]} for i in range(0, max(1, len(body)), TABLE_ROWS)]
    return []


def _block_words(block: dict[str, Any]) -> int:
    text = block.get("text") or " ".join(block.get("items") or []) or " ".join(" ".join(r) for r in block.get("rows") or [])
    return len(str(text).split())


def _base_title(text: str) -> str:
    return re.sub(r" \((?:cont\.|continued) ?\d*\)$", "", text or "").strip()


def _range_title(first: str, last: str) -> str:
    """"Rule 1: Duty…" + "Rule 2: Fees…" → "Rules 1–2"; otherwise "First – Last"."""
    base = _base_title
    if base(first) == base(last):
        return base(first)[:200]
    label = lambda text: text.split(":", 1)[0].strip() if ":" in text and len(text.split(":", 1)[0]) <= 30 else text.strip()
    a, b = label(base(first)), label(base(last))
    ma, mb = re.fullmatch(r"(\w+)\s+(\d+\w*)", a), re.fullmatch(r"(\w+)\s+(\d+\w*)", b)
    if ma and mb and ma.group(1).lower() == mb.group(1).lower():
        word = ma.group(1)
        return f"{word}{'' if word.endswith('s') else 's'} {ma.group(2)}–{mb.group(2)}"
    return f"{a} – {b}"[:200]


def _merge_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Too many sections (e.g. a rule-by-rule companion with 150 rules): merge
    neighbours into bigger sections instead of refusing the file. Each merged
    part keeps its own title as a subheading, so nothing is lost."""
    total = sum(section["words"] for section in sections)
    target = max(1, -(-total // (MAX_SECTIONS - 4)))  # words per merged section
    merged: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for section in sections:
        blocks = [{"type": "subheading", "text": section["title"][:300]}, *section["blocks"]]
        fits = current is not None and current["words"] < target and len(current["blocks"]) + len(blocks) <= SECTION_BLOCKS
        if not fits:
            current = {"title": section["title"], "first": section["title"], "last": section["title"], "blocks": [], "words": 0}
            merged.append(current)
        current["blocks"].extend(blocks)
        current["words"] += section["words"]
        current["last"] = section["title"]
    for part in merged:
        first, last = part.pop("first"), part.pop("last")
        if first != last:
            part["title"] = _range_title(first, last)
        if part["blocks"] and part["blocks"][0].get("text") == part["title"]:
            part["blocks"] = part["blocks"][1:]  # the section title already says it
    return merged


def _choose_split_level(outline: list[Element], levels: list[int]) -> int | None:
    """Which heading level starts a new section.

    The top level that actually divides the document (at least two headings at or
    above it). If those sections would be huge (a few long chapters), go one level
    deeper so each section is a readable size; the higher headings stay as
    subheadings inside.
    """
    if not levels:
        return None
    total = sum(len(str(el[-1]).split()) for el in outline if el[0] == "para") or 1
    counts = {level: sum(1 for el in outline if el[0] == "heading" and el[1] <= level) for level in levels}
    chosen = next((level for level in levels if counts[level] >= 2), levels[-1])
    for level in levels:
        if level <= chosen:
            continue
        if total / max(1, counts[chosen]) > SECTION_WORDS * 1.3 and counts[level] <= MAX_SECTIONS:
            chosen = level
    return chosen


def _first_sentence_title(section: dict[str, Any]) -> str:
    """A name for an untitled chunk: its first subheading, or the start of its first sentence."""
    for block in section["blocks"]:
        if block.get("type") == "subheading" and block.get("text"):
            return block["text"][:120]
    for block in section["blocks"]:
        text = block.get("text") or (block.get("items") or [""])[0]
        if text:
            sentence = re.split(r"(?<=[.!?:;])\s", _tidy(text), maxsplit=1)[0].strip(" .:;")
            words = sentence.split()
            return (" ".join(words[:8]) + ("…" if len(words) > 8 else ""))[:120]
    return ""


def build_sections(outline: list[Element], *, fallback_title: str) -> tuple[str | None, list[dict[str, Any]]]:
    """Pack an outline into sections. Returns (title found in the document, sections)."""
    outline = [el for el in outline if not (el[0] in {"para", "heading"} and not el[-1])]
    heading_levels = sorted({el[1] for el in outline if el[0] == "heading"})
    doc_title: str | None = None

    # A lone top-level heading at the very start is the document's title.
    if outline and outline[0][0] == "heading":
        top = outline[0][1]
        if sum(1 for el in outline if el[0] == "heading" and el[1] == top) == 1 and len(heading_levels) > 1:
            doc_title = outline[0][2]
            outline = outline[1:]
            heading_levels = sorted({el[1] for el in outline if el[0] == "heading"})

    split_level = _choose_split_level(outline, heading_levels)
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    context = ""  # the chapter / part a section sits in (headings above the split level)

    def start(title: str) -> dict[str, Any]:
        section = {"title": title[:200], "blocks": [], "words": 0, "context": context}
        sections.append(section)
        return section

    for element in outline:
        if element[0] == "heading" and split_level is not None and element[1] <= split_level:
            if element[1] < split_level:
                context = element[2]
            current = start(element[2])
            continue
        if current is None:
            current = start("Introduction" if split_level is not None else "")
            current["lead"] = True  # text before the first heading, not a real "Introduction" heading
        for block in _to_blocks(element, sub_level=(split_level or 1) + 1 if split_level else 1):
            words = _block_words(block)
            if current["blocks"] and (len(current["blocks"]) >= SECTION_BLOCKS or current["words"] + words > SECTION_WORDS):
                base = _base_title(current["title"])
                current = start(f"{base} (continued)" if base else "")
            current["blocks"].append(block)
            current["words"] += words

    sections = [section for section in sections if section["blocks"]]
    # A short blurb before the first heading (cover lines, author, course code) is
    # not worth its own "Introduction" section: it joins the first real section.
    if len(sections) > 1 and sections[0].get("lead") and sections[0]["words"] < 60:
        first = sections.pop(0)
        if any(block["type"] not in {"heading", "subheading"} for block in first["blocks"]):  # headings only = cover page: drop
            sections[0]["blocks"] = first["blocks"] + sections[0]["blocks"]
            sections[0]["words"] += first["words"]
    # Untitled chunks (no headings in the document) are named after what they say.
    untitled = [section for section in sections if not section["title"]]
    for index, section in enumerate(untitled, start=1):
        if len(untitled) == 1 and len(sections) == 1:
            section["title"] = doc_title or fallback_title
        else:
            section["title"] = _first_sentence_title(section) or f"Part {index}"
    # The same title twice ("Introduction" in every chapter): add the chapter.
    seen: dict[str, int] = {}
    for section in sections:
        key = _base_title(section["title"]).lower()
        seen[key] = seen.get(key, 0) + 1
    for section in sections:
        if seen[_base_title(section["title"]).lower()] > 1 and section.get("context") and section["context"] != section["title"]:
            label = section["context"].split(":", 1)[0] if ":" in section["context"] and len(section["context"].split(":", 1)[0]) <= 20 else section["context"]
            section["title"] = f"{section['title']} — {label}"[:200]
    for section in sections:
        section.pop("context", None)
        section.pop("lead", None)
    if len(sections) > MAX_SECTIONS:
        sections = _merge_sections(sections)
    if len(sections) > MAX_SECTIONS:
        raise DocumentError(
            f"That document is very long ({len(sections)} sections). Split it into smaller files of under {MAX_SECTIONS} sections.",
            413,
        )
    for section in sections:
        section["estimated_minutes"] = max(1, min(120, round(section["words"] / 200) or 1))
    return doc_title, sections


def read_document(filename: str, data: bytes) -> dict[str, Any]:
    """Read an uploaded document into a material draft (nothing is saved here)."""
    if not data:
        raise DocumentError("That file is empty.")
    if len(data) > MAX_BYTES:
        raise DocumentError(f"That file is larger than {MAX_BYTES // (1024 * 1024)} MB.", 413)
    suffix = _suffix(filename)
    if suffix == ".doc":
        raise DocumentError(
            "Old Word .doc files can't be read. In Word choose File → Save As → Word Document (.docx) "
            "or PDF, then upload that.",
            415,
        )
    if suffix == ".ppt":
        raise DocumentError("Old PowerPoint .ppt files can't be read. Save it as .pptx or PDF and upload that.", 415)
    if suffix not in SUPPORTED:
        raise DocumentError(f"Unsupported file type “{suffix or filename}”. Upload {ACCEPT_HINT}.", 415)

    pages: int | None = None
    notes: list[str] = []
    if suffix == ".docx":
        outline, fmt = _docx_outline(data), "Word document"
    elif suffix == ".odt":
        outline, fmt = _odt_outline(data), "OpenDocument text"
    elif suffix == ".pptx":
        outline, fmt = _pptx_outline(data), "PowerPoint slides"
        notes.append("Each slide became its own section.")
    elif suffix == ".pdf":
        text, pages = _pdf_text(data)
        outline, fmt = _text_outline(text, reflow=True), "PDF"
        notes.append(f"Read {pages} page{'' if pages == 1 else 's'}. PDF layout is approximate — check headings after import.")
    elif suffix in {".html", ".htm"}:
        outline, fmt = _html_outline(_decode(data)), "Web page"
    elif suffix == ".rtf":
        outline, fmt = _text_outline(_rtf_to_text(_decode(data))), "Rich text"
    elif suffix in {".md", ".markdown"}:
        outline, fmt = _text_outline(_decode(data), markdown=True), "Markdown"
    else:
        outline, fmt = _text_outline(_decode(data)), "Text"

    fallback = title_from_filename(filename)
    doc_title, sections = build_sections(outline, fallback_title=fallback)
    words = sum(section["words"] for section in sections)
    if words < 5:
        raise DocumentError("No readable text was found in that file.", 422)

    first_para = next(
        (block["text"] for section in sections for block in section["blocks"] if block.get("type") == "paragraph" and len(block.get("text", "")) > 40),
        "",
    )
    return {
        "filename": filename,
        "format": fmt,
        "bytes": len(data),
        "pages": pages,
        "title": (doc_title or fallback)[:200],
        "description": first_para[:280],
        "words": words,
        "estimated_minutes": max(1, min(600, round(words / 200) or 1)),
        "sections": sections,
        "notes": notes,
    }
