"""Material import: documents in, course materials out.

Builds small real documents in memory (Word .docx, PDF, PowerPoint .pptx,
OpenDocument .odt, RTF, HTML, Markdown, text) — no extra libraries — and checks:

* the reader keeps headings, lists, numbered lists and tables, takes the title
  from the document, and splits long documents without losing a word;
* preview saves nothing; import creates the material under the chosen course
  only, with the staff-chosen name / topic / kind / visibility;
* the original file is stored and downloadable, players can read the material;
* old .doc, unsupported types, empty files, unknown courses and non-staff
  callers are refused with a clear reason.

    cd backend && .venv/bin/python scripts/verify_material_import.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.material_import import DocumentError, read_document  # noqa: E402
from app.services.materials import sanitise_blocks  # noqa: E402

API = os.getenv("ARENA_API", "http://127.0.0.1:3000/api")
PASSED = FAILED = 0


def check(name: str, condition: bool, info: object = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(info)[:220]}")


# ----------------------------------------------------------- document builders
W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _w_para(text: str, style: str = "", num: int = 0) -> str:
    ppr = ""
    if style or num:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "")
        ppr += (f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr>' if num else "") + "</w:pPr>"
    return f"<w:p>{ppr}<w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"


def make_docx(paragraphs: list[str] | None = None) -> bytes:
    body = paragraphs or [
        _w_para("Use of English I — Concord", "Title"),
        _w_para("Introduction", "Heading1"),
        _w_para("Concord is the agreement between a subject and its verb in number and person. " * 4),
        _w_para("Rules of concord", "Heading1"),
        _w_para("The main rules are:"),
        _w_para("Proximity concord", num=1),
        _w_para("Notional concord", num=1),
        _w_para("Worked examples", "Heading2"),
        _w_para("Neither the lecturer nor the students were present", num=2),
        _w_para("Every one of the contestants has been paid", num=2),
        "<w:tbl><w:tr><w:tc>" + _w_para("Rule") + "</w:tc><w:tc>" + _w_para("Example") + "</w:tc></w:tr>"
        "<w:tr><w:tc>" + _w_para("Proximity") + "</w:tc><w:tc>" + _w_para("Neither he nor they were") + "</w:tc></w:tr></w:tbl>",
        _w_para("Body text with outline level nine", "") .replace("<w:p>", '<w:p><w:pPr><w:outlineLvl w:val="9"/></w:pPr>', 1),
        _w_para("Conclusion", "Heading1"),
        _w_para("Concord keeps formal writing accurate and easy to follow."),
    ]
    styles = (
        f'<w:styles {W_NS}>'
        '<w:style w:styleId="Title"><w:name w:val="Title"/></w:style>'
        '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
        '<w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>'
    )
    numbering = (
        f'<w:numbering {W_NS}>'
        '<w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>'
        '<w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>'
        "</w:numbering>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f"<w:document {W_NS}><w:body>{''.join(body)}</w:body></w:document>")
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/numbering.xml", numbering)
    return buffer.getvalue()


def make_pdf(pages: list[list[str]]) -> bytes:
    """A minimal text PDF (Helvetica), one list of lines per page."""
    objects: list[bytes] = []
    kids = []
    font_id = 3 + 2 * len(pages)
    for index, lines in enumerate(pages):
        page_id, content_id = 3 + 2 * index, 4 + 2 * index
        kids.append(f"{page_id} 0 R")
        ops = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td"]
        for line in lines:
            safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({safe}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        objects.append(
            f"{page_id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >> endobj\n".encode()
        )
        objects.append(f"{content_id} 0 obj << /Length {len(stream)} >> stream\n".encode() + stream + b"\nendstream endobj\n")
    head = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        f"2 0 obj << /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >> endobj\n".encode(),
    ]
    tail = [f"{font_id} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n".encode()]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for obj in head + objects + tail:
        offsets.append(out.tell())
        out.write(obj)
    xref = out.tell()
    out.write(f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def make_pptx() -> bytes:
    a = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    p = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

    def slide(title: str, bullets: list[str]) -> str:
        paras = "".join(f"<a:p><a:r><a:t>{b}</a:t></a:r></a:p>" for b in bullets)
        return (
            f"<p:sld {a} {p}><p:cSld><p:spTree>"
            f'<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>'
            f"<p:sp><p:nvSpPr><p:nvPr><p:ph idx=\"1\"/></p:nvPr></p:nvSpPr><p:txBody>{paras}</p:txBody></p:sp>"
            "</p:spTree></p:cSld></p:sld>"
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        # slide10 before slide2 in the archive: order must be numeric, not alphabetical
        archive.writestr("ppt/slides/slide10.xml", slide("Applications", ["Angles of elevation", "Bearings"]))
        archive.writestr("ppt/slides/slide1.xml", slide("Trigonometry overview", ["Sine", "Cosine", "Tangent"]))
        archive.writestr("ppt/slides/slide2.xml", slide("Right-angled triangles", ["SOH", "CAH", "TOA"]))
    return buffer.getvalue()


def make_odt() -> bytes:
    content = (
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
        '<text:h text:outline-level="1">Set notation</text:h><text:p>A set is a well-defined collection of distinct objects.</text:p>'
        "<text:list><text:list-item><text:p>Union joins every member of both sets</text:p></text:list-item>"
        "<text:list-item><text:p>Intersection keeps only the shared members</text:p></text:list-item></text:list>"
        '<text:h text:outline-level="1">Venn diagrams</text:h><text:p>A Venn diagram shows how sets overlap inside a universal set.</text:p>'
        "</office:text></office:body></office:document-content>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("content.xml", content)
    return buffer.getvalue()


PDF = make_pdf([
    ["INDICES AND LOGARITHMS", "", "An index shows how many times a base is multiplied by itself.", "Logarithms are the inverse of indices.",
     "LAWS OF INDICES", "When multiplying powers with the same base, add the indices."],
    ["STANDARD FORM", "Standard form writes a number as A x 10^n, where 1 <= A < 10."],
])
FILES: dict[str, bytes] = {
    "concord_notes.docx": make_docx(),
    "indices-logarithms.pdf": PDF,
    "trigonometry_slides.pptx": make_pptx(),
    "set-notation.odt": make_odt(),
    "number_bases.txt": b"NUMBER BASES\n\nA number base counts in groups\nof that size.\n\nBINARY\n\nBinary uses only the digits 0 and 1.\n- 1101 in base two is 13\n- Base ten converts by repeated division\n",
    "statistics.md": b"# Statistics\n\n## Measures of central tendency\n\nThe mean is the **average** of a data set.\n\n1. Add every value\n2. Divide by how many values there are\n\n## Dispersion\n\nRange, variance and standard deviation spread the data out.\n",
    "probability.html": b"<html><head><script>alert(1)</script></head><body><h1>Probability</h1><p>Probability measures how likely an outcome is.</p>"
    b"<h2>Sample space</h2><ul><li>Equally likely outcomes</li><li>Mutually exclusive events</li></ul>"
    b"<table><tr><th>Throw</th><th>Outcomes</th></tr><tr><td>One die</td><td>Six</td></tr></table></body></html>",
    "study_skills.rtf": rb"{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 STUDY SKILLS\par\par A student owes a duty to the timetable and to the syllabus.\par}",
}


# ---------------------------------------------------------------- reader tests
def reader_tests() -> None:
    print("== reader ==")
    doc = read_document("concord_notes.docx", FILES["concord_notes.docx"])
    types = [block["type"] for section in doc["sections"] for block in section["blocks"]]
    check("Word: title comes from the Title style", doc["title"] == "Use of English I — Concord", doc["title"])
    check("Word: Heading 1 becomes sections", [s["title"] for s in doc["sections"]] == ["Introduction", "Rules of concord", "Conclusion"], [s["title"] for s in doc["sections"]])
    check("Word: bullets, numbered list, table and sub-heading kept", {"list", "numbers", "table", "heading"} <= set(types), types)
    check("Word: outline level 9 stays body text", any(b.get("text") == "Body text with outline level nine" and b["type"] == "paragraph" for s in doc["sections"] for b in s["blocks"]))

    pdf = read_document("indices-logarithms.pdf", FILES["indices-logarithms.pdf"])
    check("PDF: pages read and ALL-CAPS headings become sections", pdf["pages"] == 2 and [s["title"] for s in pdf["sections"]] == ["Indices and Logarithms", "Laws of Indices", "Standard Form"], [s["title"] for s in pdf["sections"]])

    slides = read_document("trigonometry_slides.pptx", FILES["trigonometry_slides.pptx"])
    check("PowerPoint: one section per slide, in numeric order", [s["title"] for s in slides["sections"]] == ["Trigonometry overview", "Right-angled triangles", "Applications"], [s["title"] for s in slides["sections"]])

    for name, sections in {"set-notation.odt": ["Set notation", "Venn diagrams"], "number_bases.txt": ["Number Bases", "Binary"], "statistics.md": ["Measures of central tendency", "Dispersion"]}.items():
        got = [s["title"] for s in read_document(name, FILES[name])["sections"]]
        check(f"{name}: sections {sections}", got == sections, got)
    html = read_document("probability.html", FILES["probability.html"])
    html_text = json.dumps(html["sections"])
    check("HTML: scripts dropped, list + table kept", "alert" not in html_text and '"list"' in html_text and '"table"' in html_text, html_text[:200])
    rtf = read_document("study_skills.rtf", FILES["study_skills.rtf"])
    check("RTF: control words stripped", "duty to the timetable" in json.dumps(rtf["sections"]) and "fonttbl" not in json.dumps(rtf["sections"]))

    big_body = [_w_para(f"Paragraph {i}. " + "The rule applies to every sentence in the passage. " * 6) for i in range(700)]
    big_body.append(_w_para("Giant " + "word " * 3000))
    big_body += [_w_para(f"Item {i}", num=1) for i in range(95)]
    big = read_document("big.docx", make_docx(big_body))
    sentence = "The rule applies to every sentence in the passage. "
    words_in = 700 * (2 + 6 * len(sentence.split())) + 3001 + 95 * 2  # "Paragraph N." + sentences, giant, items
    altered = sum(1 for s in big["sections"] for a, b in zip(s["blocks"], sanitise_blocks(s["blocks"])) if a != b)
    check(f"long document split into {len(big['sections'])} sections without losing words", big["words"] == words_in and len(big["sections"]) > 10, (big["words"], words_in))
    check("every block fits the reader limits unchanged", altered == 0, altered)
    check("all 95 list items kept", sum(len(b.get("items", [])) for s in big["sections"] for b in s["blocks"]) == 95)

    for name, data, expect in [
        ("old.doc", b"\xd0\xcf\x11\xe0 not really", "docx"),
        ("virus.exe", b"MZ", "Unsupported"),
        ("empty.txt", b"", "empty"),
        ("scan.pdf", make_pdf([[""]]), "no selectable text"),
    ]:
        try:
            read_document(name, data)
            check(f"{name} refused", False, "was accepted")
        except DocumentError as error:
            check(f"{name} refused with a reason", expect in error.message, error.message)


# ------------------------------------------------------------------- API tests
def call(method: str, path: str, body: dict | None = None, token: str | None = None, file: tuple[str, bytes] | None = None, raw: bool = False):
    headers: dict[str, str] = {}
    data = None
    if file:
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in (body or {}).items()]
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file[0]}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode() + file[1] + b"\r\n"
        )
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            content = response.read()
            return response.status, content if raw else json.loads(content or b"null")
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            return error.code, json.loads(payload or b"null")
        except json.JSONDecodeError:
            return error.code, payload.decode(errors="replace")


def api_tests() -> None:
    print("== API ==")
    status, auth = call("POST", "/auth/admin", {"email": "admin@quizarena.ng", "password": "arena2026"})
    if status != 200:
        check("admin login", False, auth)
        return
    token = auth["token"]
    courses = call("GET", "/admin/courses", token=token)[1]
    c1, c2 = courses[0]["id"], courses[1]["id"]
    total = lambda cid, kind="": call("GET", f"/admin/materials?course_id={cid}&limit=1" + (f"&kind={kind}" if kind else ""), token=token)[1]["total"]  # noqa: E731

    before = total(c1)
    status, preview = call("POST", "/admin/materials/import/preview", token=token, file=("concord_notes.docx", FILES["concord_notes.docx"]))
    check("preview reads the Word file", status == 200 and preview["title"] == "Use of English I — Concord" and len(preview["sections"]) == 3, preview)
    check("preview saves nothing", total(c1) == before)

    created = {}
    for name, data in FILES.items():
        status, material = call("POST", "/admin/materials/import", {"course_id": c1, "topic": "Imported", "status": "published"}, token=token, file=(name, data))
        good = status == 201 and material.get("course_id") == c1 and material.get("status") == "published" and material.get("topic") == "Imported"
        check(f"import {name}", good and str(material.get("link_url", "")).startswith("/api/material-files/"), (status, str(material)[:160]))
        if status == 201:
            created[name] = material
    check("course total grew by every import", total(c1) == before + len(created), (total(c1), before, len(created)))

    word = created.get("concord_notes.docx")
    if word:
        status, original = call("GET", word["link_url"].removeprefix("/api"), raw=True)
        check("original file downloadable byte-for-byte", status == 200 and original == FILES["concord_notes.docx"], status)

    status, note = call(
        "POST", "/admin/materials/import",
        {"course_id": c2, "title": "My custom name", "kind": "note", "status": "draft", "keep_file": "false"},
        token=token, file=("statistics.md", FILES["statistics.md"]),
    )
    check("custom name, note, draft, no stored file", status == 201 and note["title"] == "My custom name" and note["kind"] == "note" and note["status"] == "draft" and not note["link_url"], note)
    c1_ids = {row["id"] for row in call("GET", f"/admin/materials?course_id={c1}&limit=200", token=token)[1]["items"]}
    c2_notes = {row["id"] for row in call("GET", f"/admin/materials?course_id={c2}&kind=note&limit=200", token=token)[1]["items"]}
    check("imports land under the chosen course only", all(m["id"] in c1_ids for m in created.values()) and note["id"] in c2_notes and note["id"] not in c1_ids)

    suffix = uuid.uuid4().hex[:6]
    status, reg = call("POST", "/auth/register", {"username": f"imp{suffix}", "password": "secret123", "phone": f"080{uuid.uuid4().int % 10**8:08d}", "full_name": "Import Tester"})
    student = reg.get("token") if isinstance(reg, dict) else None
    if student and "indices-logarithms.pdf" in created:
        status, read = call("GET", f"/materials/{created['indices-logarithms.pdf']['id']}", token=student)
        check("player reads the imported PDF with its original link", status == 200 and len(read.get("sections", [])) == 3 and read.get("link_url"), (status, str(read)[:160]))
        status, _ = call("POST", "/admin/materials/import/preview", token=student, file=("a.txt", b"Some real words here."))
        check("players cannot import", status in (401, 403), status)
    else:
        check("player account for read check", False, reg)

    for label, body, file, expected in [
        ("old .doc refused with guidance", {"course_id": c1}, ("old.doc", b"\xd0\xcf\x11\xe0"), 415),
        ("unknown course refused", {"course_id": 999999}, ("a.txt", b"Some real words here for the test."), 404),
        ("course is required", {}, ("a.txt", b"Some real words here for the test."), 422),
    ]:
        status, detail = call("POST", "/admin/materials/import", body, token=token, file=file)
        check(label, status == expected, (status, detail))
    status, _ = call("POST", "/admin/materials/import/preview", file=("a.txt", b"Some real words here."))
    check("anonymous callers refused", status in (401, 403), status)
    status, _ = call("GET", "/material-files/..%2F..%2Farena.db")
    check("file route refuses path tricks", status == 404, status)

    # tidy up: this script's imports are test data
    for material in [*created.values(), note]:
        call("DELETE", f"/admin/materials/{material['id']}", token=token)


if __name__ == "__main__":
    reader_tests()
    api_tests()
    print(f"\nverify_material_import: {PASSED} passed, {FAILED} failed")
    sys.exit(1 if FAILED else 0)
