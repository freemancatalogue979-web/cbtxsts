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


def _text_outline(text: str, *, markdown: bool = False, reflow: bool = False) -> list[Element]:
    """Plain / markdown text. ``reflow`` joins hard-wrapped lines (PDF output)."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # words hyphen-broken across lines
    lines = text.split("\n")
    lengths = sorted(len(line.strip()) for line in lines if len(line.strip()) > 20)
    wrap = lengths[int(len(lengths) * 0.6)] if lengths else 80

    out: list[Element] = []
    para: list[str] = []
    items: list[str] = []
    ordered = False

    def flush_para() -> None:
        if para:
            joined = _tidy(" ".join(para))
            if joined:
                out.append(("para", joined))
            para.clear()

    def flush_list() -> None:
        nonlocal ordered
        if items:
            out.append(("list", ordered, list(items)))
            items.clear()

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            flush_para()
            flush_list()
            continue
        if markdown:
            match = _MD_HEADING.match(line)
            if match:
                flush_para(); flush_list()
                out.append(("heading", len(match.group(1)), _tidy(re.sub(r"[*_`]", "", match.group(2)))))
                continue
            stripped = re.sub(r"(\*\*|__|`)", "", stripped)
        bullet = _BULLET.match(stripped)
        number = None if bullet else _NUMBERED.match(stripped)
        if bullet or (number and (items or not para)):
            flush_para()
            kind_ordered = bool(number)
            if items and kind_ordered != ordered:
                flush_list()
            ordered = kind_ordered
            items.append(_tidy((bullet or number).group(1)))
            continue
        if items and raw[:1] in (" ", "\t") and not reflow:
            items[-1] = _tidy(items[-1] + " " + stripped)  # wrapped list item
            continue
        flush_list()
        if not markdown and _is_caps_heading(stripped):
            flush_para()
            out.append(("heading", 1, _caps_to_title(stripped) if len(stripped) > 4 else stripped))
            continue
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

    ordered_nums: set[str] = set()
    try:
        numbering = ET.fromstring(archive.read("word/numbering.xml"))
        abstract_fmt: dict[str, str] = {}
        for abstract in numbering.iter(f"{W}abstractNum"):
            lvl = abstract.find(f"{W}lvl")
            fmt = lvl.find(f"{W}numFmt") if lvl is not None else None
            abstract_fmt[abstract.get(f"{W}abstractNumId") or ""] = (fmt.get(f"{W}val") if fmt is not None else "bullet") or "bullet"
        for num in numbering.iter(f"{W}num"):
            ref = num.find(f"{W}abstractNumId")
            if ref is not None and abstract_fmt.get(ref.get(f"{W}val") or "", "bullet") not in {"bullet", "none"}:
                ordered_nums.add(num.get(f"{W}numId") or "")
    except (KeyError, ET.ParseError):
        pass

    body = document.find(f"{W}body")
    if body is None:
        return []
    out: list[Element] = []
    items: list[str] = []
    list_ordered = False

    def flush_list() -> None:
        if items:
            out.append(("list", list_ordered, list(items)))
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
            if numpr is not None:
                nid = numpr.find(f"{W}numId")
                num_id = (nid.get(f"{W}val") if nid is not None else "") or ""
        name = (style_names.get(style_id or "", style_id or "") or "").lower().replace(" ", "")
        if name in {"title"}:
            level = 0
        elif match := re.match(r"(?:heading|überschrift|titre|titolo|encabezado|kop)(\d)", name):
            level = int(match.group(1))
        elif name in {"subtitle"}:
            level = 2
        if not text:
            flush_list()
            continue
        if level is not None and len(text) <= 200:
            flush_list()
            out.append(("heading", min(level, 6), text))
        elif num_id and num_id != "0" or "listparagraph" in name or name.startswith("listbullet") or name.startswith("listnumber"):
            is_ordered = num_id in ordered_nums or name.startswith("listnumber")
            if items and is_ordered != list_ordered:
                flush_list()
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
    text = "\n\n".join(pages)
    if len(text.strip()) < 40:
        raise DocumentError(
            "This PDF has no selectable text — it is probably a scan or photos of pages. "
            "Upload a text-based PDF or the original Word file instead.",
            415,
        )
    return text, len(pages)


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
        return [
            {"type": "numbers" if ordered else "list", "items": items[i : i + LIST_ITEMS]}
            for i in range(0, len(items), LIST_ITEMS)
        ]
    if kind == "table":
        rows = [[cell[:195] for cell in row[:TABLE_COLS]] for row in element[1]]
        head, body = (rows[0], rows[1:]) if len(rows) > 1 else ([], rows)
        return [{"type": "table", "head": head, "rows": body[i : i + TABLE_ROWS]} for i in range(0, max(1, len(body)), TABLE_ROWS)]
    return []


def _block_words(block: dict[str, Any]) -> int:
    text = block.get("text") or " ".join(block.get("items") or []) or " ".join(" ".join(r) for r in block.get("rows") or [])
    return len(str(text).split())


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

    split_level = heading_levels[0] if heading_levels else None
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def start(title: str) -> dict[str, Any]:
        section = {"title": title[:200], "blocks": [], "words": 0}
        sections.append(section)
        return section

    for element in outline:
        if element[0] == "heading" and split_level is not None and element[1] <= split_level:
            current = start(element[2])
            continue
        if current is None:
            current = start("Introduction" if split_level is not None else "")
        for block in _to_blocks(element, sub_level=(split_level or 1) + 1 if split_level else 1):
            words = _block_words(block)
            if current["blocks"] and (len(current["blocks"]) >= SECTION_BLOCKS or current["words"] + words > SECTION_WORDS):
                base = re.sub(r" \(cont\. ?\d*\)$", "", current["title"]) or ""
                current = start(f"{base} (cont.)" if base else "")
            current["blocks"].append(block)
            current["words"] += words

    sections = [section for section in sections if section["blocks"]]
    # Untitled chunks (no headings in the document) are named "Part n".
    untitled = [section for section in sections if not section["title"]]
    for index, section in enumerate(untitled, start=1):
        section["title"] = f"Part {index}" if len(untitled) > 1 else (doc_title or fallback_title)
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
