"""Imported notes keep their structure: sensible section names and real numbering.

No API server needed:

    .venv/bin/python scripts/verify_import_structure.py

Checks
* headings: "Chapter One" + next line, "Part II: …", "1.1 Meaning of …", "A. Introduction",
  SHOUTED lines, short Title Case lines; shouted text becomes Title Case;
* lists keep their numbering — 1. (a) a) i. (iv) A. — with nesting level and start;
  "i" after "h" is a letter, "v" after "iv" is a numeral; initials are not lists;
  wrapped PDF lines join their item; "(a)" right after a sentence starts a list;
* section names make sense: no cover-page section, untitled chunks named after their
  first sentence, "(continued)" parts, repeated titles get their chapter;
* Word numbering (numbering.xml: format, "(%1)" pattern, levels, running counters);
* the numbering fields survive saving (sanitise_blocks).
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.material_import import _marker, _text_outline, build_sections, read_document  # noqa: E402
from app.services.materials import sanitise_blocks  # noqa: E402

PASSED = FAILED = 0


def check(name: str, condition: bool, info: object = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED += 1
        print(f"  FAIL {name} — {str(info)[:300]}")


NOTES = """FACULTY OF LAW
LAW 511

CHAPTER ONE
INTRODUCTION TO AFFIDAVITS

An affidavit is a written statement of facts made on oath before a person authorised to administer oaths.

1.1 Meaning of Affidavit
The word affidavit comes from Latin. The Evidence Act 2011 governs affidavits in Nigeria.
The essential features of an affidavit are:
(a) it must be in writing;
(b) it must be sworn before a Commissioner for Oaths, a notary public or a
person duly authorised; and
(c) it must contain facts, not arguments.

1.2 Contents of an Affidavit
The contents are regulated by Sections 115 to 120 of the Evidence Act. These include:
1. The title of the court and the suit number.
2. The facts deposed to, which must be within the deponent's knowledge. These facts may be:
(i) facts within personal knowledge;
(ii) facts from information and belief, stating the source; or
(iii) facts from documents.
3. The jurat.

CHAPTER TWO
BRIEF WRITING

A. Meaning of a Brief
A brief is a written argument filed before an appellate court.

B. Types of Briefs
The types of brief are the appellant's brief, the respondent's brief and the reply brief.
a) Appellant's brief
b) Respondent's brief
c) Reply brief
"""


def open_brief() -> str:
    return (
        "Contents of a Brief\n\n"
        "1 Name of the court: the court in which the appeal is to be argued, either the Supreme Court or the Court of Appeal.\n\n\n\n"
        "2 The appeal number.\n\n\n\n"
        "3 Title of the brief: either an appellant, respondent, or reply brief, as the case may be. (Note: parties to an appeal must have legal personalities.)\n\n\n\n"
        "4 Introduction / Preliminary statement: the genesis of the issue before the appellate court.\n\n\n\n"
        "5 Statement of Facts: facts that are relevant and necessary for the appeal.\n"
    )


def blocks_of(sections):
    return [block for section in sections for block in section["blocks"]]


def main() -> int:
    print("\nnumbering markers")
    check("(a) lower-alpha in brackets", _marker("(a) text", None)["style"] == "lower-alpha" and _marker("(a) text", None)["wrap"] == "paren")
    check("(iv) lower-roman", _marker("(iv) text", None)["style"] == "lower-roman" and _marker("(iv) text", None)["value"] == 4)
    check("i. alone is roman", _marker("i. text", None)["style"] == "lower-roman")
    h = _marker("(h) eighth", None)
    check("(i) after (h) is the letter i", _marker("(i) ninth", h)["style"] == "lower-alpha" and _marker("(i) ninth", h)["value"] == 9)
    iv = _marker("(iv) four", None)
    check("(v) after (iv) is five", _marker("(v) five", iv)["style"] == "lower-roman" and _marker("(v) five", iv)["value"] == 5)
    check("A. upper-alpha", _marker("A. Introduction", None)["style"] == "upper-alpha")
    check("II. upper-roman", _marker("II. Sources", None)["style"] == "upper-roman")
    check("3) decimal rparen", _marker("3) third", None)["wrap"] == "rparen")
    check("initials are not a list", _marker("A. B. Okafor signed it", None) is None)
    check("years are not a list", _marker("2011. The Act", None) is None)

    print("\nheadings and section names")
    title, sections = build_sections(_text_outline(NOTES, reflow=True), fallback_title="LAW 511")
    names = [section["title"] for section in sections]
    check("chapters become sections with their titles", names == ["Chapter One: Introduction to Affidavits", "Chapter Two: Brief Writing"], names)
    check("cover lines (faculty, course code) are dropped", not any("Faculty" in (b.get("text") or "") for b in blocks_of(sections)))
    subs = [b["text"] for b in blocks_of(sections) if b["type"] == "subheading"]
    check("1.1 / 1.2 / A. / B. become subheadings", subs == ["1.1 Meaning of Affidavit", "1.2 Contents of an Affidavit", "A. Meaning of a Brief", "B. Types of Briefs"], subs)

    print("\nlists keep their numbering")
    lists = [b for b in blocks_of(sections) if b["type"] == "numbers"]
    first = lists[0]
    check("(a)(b)(c) kept", first.get("style") == "lower-alpha" and first.get("wrap") == "paren" and len(first["items"]) == 3, first)
    check("wrapped PDF line joined to its item", "a person duly authorised; and" in first["items"][1], first["items"][1])
    check("1. 2. list is decimal", "style" not in lists[1] and lists[1]["items"][0].startswith("The title of the court"), lists[1])
    check("(i)(ii)(iii) nested under 2.", lists[2].get("style") == "lower-roman" and lists[2].get("level") == 1 and len(lists[2]["items"]) == 3, lists[2])
    check("list resumes at 3. after the sub-list", lists[3].get("start") == 3 and lists[3]["items"] == ["The jurat."], lists[3])
    check("a) b) c) kept", lists[4].get("style") == "lower-alpha" and lists[4].get("wrap") == "rparen", lists[4])

    print("\nmore heading shapes")
    text = (
        "PART II: SOURCES OF NIGERIAN LAW\n\nThe sources of law are many and varied in Nigeria today.\n\n"
        "Received English Law\nThis includes the common law, the doctrines of equity and statutes of general application.\n\n"
        "UNIT 3 - JUDICIAL PRECEDENT\n\nStare decisis binds lower courts to follow the decisions of higher courts.\n"
    )
    _, secs = build_sections(_text_outline(text, reflow=True), fallback_title="x")
    names = [s["title"] for s in secs]
    check("'PART II: …' and 'UNIT 3 - …' titled cleanly", names == ["Part II: Sources of Nigerian Law", "Unit 3: Judicial Precedent"], names)
    check("short Title Case line before prose is a subheading", any(b["type"] == "subheading" and b["text"] == "Received English Law" for s in secs for b in s["blocks"]))
    tail = "1. Originating Summons\n2. Writ of Summons\n3. Petition\nThese are the modes of commencing an action in the High Court of a State.\n"
    lst = [b for b in _to_blocks_all(tail) if b["type"] == "numbers"]
    check("a list of short titles stays a list (last item not a heading)", lst and lst[0]["items"] == ["Originating Summons", "Writ of Summons", "Petition"], lst)
    mid = "The court may order any of the following. (a) is not a list here\nbut (a) Stay of execution;\n(b) Injunction.\n"
    got = _to_blocks_all("The court may make these orders:\n(a) stay of execution;\n(b) injunction.\n")
    check("(a) straight after a sentence starts a list", any(b["type"] == "numbers" and b.get("style") == "lower-alpha" for b in got), got)
    check("a wrapped line starting with a number joins the sentence", all(b["type"] == "paragraph" for b in _to_blocks_all("The fee is payable within\n30 days of filing the process in court.\n")))
    del mid

    print("\nuntitled and repeated sections")
    plain = ("An affidavit must be sworn. " * 400 + "\n\n") + ("A brief must be concise and clear. " * 300 + "\n\n")
    _, secs = build_sections(_text_outline(plain, reflow=True), fallback_title="Notes")
    check("untitled chunks named after their first sentence, not 'Part n'", all(not s["title"].startswith("Part ") for s in secs) and secs[0]["title"].startswith("An affidavit must be sworn"), [s["title"] for s in secs])
    repeated = "CHAPTER ONE\nAFFIDAVITS\n\nIntroduction\nAffidavits are sworn written statements of fact made by deponents.\n\n" \
        "CHAPTER TWO\nBRIEFS\n\nIntroduction\nBriefs are written arguments used on appeal before appellate courts.\n"
    outline = _text_outline(repeated, reflow=True)
    big = []
    for el in outline:  # make chapters big enough that sections split at "Introduction"
        big.append(el if el[0] != "para" else ("para", el[1] + (" More detail about this point." * 450)))
    _, secs = build_sections(big, fallback_title="x")
    names = [s["title"] for s in secs]
    check("repeated 'Introduction' titles get their chapter", len(set(names)) == len(names) and any("Chapter One" in n for n in names), names)
    check("long parts are named '(continued)'", any(n.endswith("(continued)") for n in names), names)

    print("\nWord numbering")
    doc = read_document("affidavit.docx", make_numbered_docx())
    blocks = blocks_of(doc["sections"])
    nums = [b for b in blocks if b["type"] == "numbers"]
    check("Word (a)(b) list", nums and nums[0].get("style") == "lower-alpha" and nums[0].get("wrap") == "paren" and len(nums[0]["items"]) == 2, nums[:1])
    check("Word level-1 (i)(ii) sub-list", len(nums) > 1 and nums[1].get("style") == "lower-roman" and nums[1].get("level") == 1, nums[1:2])
    check("Word list resumes at (c)", len(nums) > 2 and nums[2].get("style") == "lower-alpha" and nums[2].get("start") == 3, nums[2:3])
    check("sub-list restarts at (i) under the next item", len(nums) > 3 and nums[3].get("style") == "lower-roman" and "start" not in nums[3], nums[3:4])

    print("\nnumbering survives saving")
    saved = sanitise_blocks([{"type": "numbers", "items": ["x"], "style": "lower-roman", "wrap": "paren", "start": 4, "level": 1}, {"type": "numbers", "items": ["y"], "style": "evil", "wrap": "<b>", "start": "9999", "level": 7}])
    check("valid fields kept", saved[0].get("style") == "lower-roman" and saved[0].get("wrap") == "paren" and saved[0].get("start") == 4 and saved[0].get("level") == 1, saved[0])
    check("bad fields dropped", all(key not in saved[1] for key in ("style", "wrap", "start", "level")), saved[1])

    # A plain .txt with a hard-wrapped, unindented item line keeps it inside the item.
    wrapped = "Features\n\nThe features are:\n(a) it must be in writing;\n(b) it must be sworn before a notary public or a\nperson duly authorised; and\n(c) it must contain facts.\n"
    _, secs = build_sections(_text_outline(wrapped), fallback_title="x")
    lists = [b for b in blocks_of(secs) if b["type"] == "numbers"]
    items = lists[0]["items"] if lists else []
    check("wrapped .txt item line joins its item", len(items) == 3 and items[1].endswith("person duly authorised; and"), items)
    # A bare number opening a line is a point: "5 A boy" -> "5. A boy".
    bare = "Grounds\n\nThe grounds are these.\n4 A boy may sue through a next friend.\n5 A girl may do the same.\n6 The court may appoint a guardian.\n"
    _, secs = build_sections(_text_outline(bare), fallback_title="x")
    nums = [b for b in blocks_of(secs) if b["type"] == "numbers"]
    check("bare '4 A boy' lines become a numbered list starting at 4",
          len(nums) == 1 and nums[0]["items"][0] == "A boy may sue through a next friend." and nums[0].get("start") == 4 and nums[0].get("wrap", "dot") == "dot", nums)
    alone = "Notes\n\nSome facts here.\n\n5 A boy\n"
    _, secs = build_sections(_text_outline(alone), fallback_title="x")
    text = " ".join(b.get("text", "") + " ".join(b.get("items", [])) for b in blocks_of(secs))
    check("a single '5 A boy' reads as point 5", any(b["type"] == "numbers" and b.get("start") == 5 for b in blocks_of(secs)) or "5. A boy" in text, blocks_of(secs))
    not_points = "Notes\n\nThe Evidence Act came into force in\n2011 Evidence Act rules apply here and the deponent must swear within\n14 Days of the order.\n5 boys came to court.\n"
    _, secs = build_sections(_text_outline(not_points, reflow=True), fallback_title="x")
    check("years, mid-sentence wraps and '5 boys…' stay prose", not any(b["type"] == "numbers" for b in blocks_of(secs)), blocks_of(secs))
    from app.services.material_import import point_number
    check("Word/ODT paragraph '5 A boy' shows as '5. A boy'", point_number("5 A boy") == "5. A boy" and point_number("2011 Act") == "2011 Act" and point_number("5 boys") == "5 boys")
    # Saved materials: paragraphs carrying their own numbering become real points.
    brief = [
        "Contents of a Brief\n1 Name of the court: the court in which the appeal is to be argued, either the Supreme Court or the Court of Appeal.",
        "2 The appeal number.",
        "3 Title of the brief: either an appellant, respondent, or reply brief, as the case may be. (Note: parties to an appeal must have legal personalities.)",
        "4 Introduction / Preliminary statement: the genesis of the issue before the appellate court.",
        "5 Statement of Facts: facts that are relevant and necessary for the appeal.",
    ]
    saved = sanitise_blocks([{"type": "paragraph", "text": text} for text in brief])
    check("saved '1 Name of the court…' paragraphs regroup into points 1-5 under a subheading",
          [b["type"] for b in saved] == ["subheading", "numbers"] and len(saved[1]["items"]) == 5 and saved[1]["items"][1] == "The appeal number." and "start" not in saved[1], saved)
    pasted = sanitise_blocks([{"type": "paragraph", "text": "The contents include:\n1 Name of the court.\n2 The appeal number.\n3 Title of the brief: either an appellant\nor respondent brief."}])
    check("one pasted paragraph with 1/2/3 lines splits into a list (wrapped line joined)",
          [b["type"] for b in pasted] == ["paragraph", "numbers"] and pasted[1]["items"][2] == "Title of the brief: either an appellant or respondent brief.", pasted)
    nested = sanitise_blocks([{"type": "paragraph", "text": t} for t in ["1. Facts may be:", "(i) facts within knowledge;", "(ii) facts from belief;", "2. The jurat."]])
    check("(i)/(ii) under point 1 nest, then point 2 resumes",
          [(b.get("style", "decimal"), b.get("level", 0), b.get("start", 1)) for b in nested] == [("decimal", 0, 1), ("lower-roman", 1, 1), ("decimal", 0, 2)], nested)
    prose = sanitise_blocks([{"type": "paragraph", "text": t} for t in ["The deponent must swear within\n14 Days of the order and\n2 Copies must be filed.", "2011 Evidence Act applies.", "5 boys came.", "A. Meaning of a Brief", "A. B. Okafor said so."]])
    check("mid-sentence numbers, years, '5 boys', lettered headings and initials stay as they are",
          all(b["type"] == "paragraph" for b in prose) and len(prose) == 5, prose)
    _, secs = build_sections(_text_outline(open_brief()), fallback_title="x")
    kinds = [b["type"] for b in blocks_of(secs)]
    check("imported brief: 'Contents of a Brief' heads the list of 5", len(secs) == 1 and secs[0]["title"] == "Contents of a Brief" and kinds == ["numbers"] and len(blocks_of(secs)[0]["items"]) == 5, (secs[0]["title"], kinds))
    # Bare letters "a When…", "b Vagueness…" are numbering too — inside a real run only.
    grounds = [
        "a When it is an obiter dictum, or does not disclose a reasonable ground (see Udoete v. Heil). b Vagueness: once a ground of appeal is vague or general in terms, it will not be permitted (Order 8 Rule 2(4), Supreme Court Rules).",
        "c It is argumentative and narrative.",
        "d The ground is not one mentioned in the notice of appeal.",
    ]
    lettered = sanitise_blocks([{"type": "paragraph", "text": t} for t in grounds])
    check("bare a/b/c/d become an a. b. c. d. list, splitting 'b' out of paragraph a",
          len(lettered) == 1 and lettered[0].get("style") == "lower-alpha" and len(lettered[0]["items"]) == 4
          and lettered[0]["items"][0].endswith("(see Udoete v. Heil).") and lettered[0]["items"][1].startswith("Vagueness:"), lettered)
    pasted = sanitise_blocks([{"type": "paragraph", "text": "\n".join(grounds)}])
    check("the same grounds pasted as one block give the same list", pasted == lettered, pasted)
    headed = sanitise_blocks([{"type": "paragraph", "text": "Grounds of Appeal That Are Incompetent"}] + [{"type": "paragraph", "text": t} for t in grounds])
    check("a short title line above the list becomes its subheading", [b["type"] for b in headed] == ["subheading", "numbers"], headed)
    words = sanitise_blocks([{"type": "paragraph", "text": t} for t in ["a Commissioner for Oaths must sign it.", "It must be sworn before\na Commissioner for Oaths.", "i Think so.", "b Vagueness alone."]])
    check("the word 'a', a lone 'b' and 'i Think' stay prose", all(b["type"] == "paragraph" for b in words) and len(words) == 4, words)
    romans = sanitise_blocks([{"type": "paragraph", "text": t} for t in ["The facts may be:", "i Facts within knowledge;", "ii Facts from belief;", "iii Facts from documents."]])
    check("bare i/ii/iii become a roman list", [b["type"] for b in romans] == ["paragraph", "numbers"] and romans[1].get("style") == "lower-roman" and len(romans[1]["items"]) == 3, romans)
    numbered_inline = sanitise_blocks([{"type": "paragraph", "text": "1 The notice must be filed. 2 It must be served. The rest is prose with 3 parts."}])
    check("inline '. 2 It…' splits; '3 parts' mid-sentence does not",
          len(numbered_inline) == 1 and numbered_inline[0]["items"] == ["The notice must be filed.", "It must be served. The rest is prose with 3 parts."], numbered_inline)
    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


def _to_blocks_all(text: str) -> list[dict]:
    _, secs = build_sections(_text_outline(text, reflow=True), fallback_title="x")
    return blocks_of(secs)


W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _para(text: str, style: str = "", num: int | None = None, ilvl: int = 0) -> str:
    ppr = ""
    if style or num is not None:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "")
        if num is not None:
            ppr += f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr>'
        ppr += "</w:pPr>"
    return f"<w:p>{ppr}<w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"


def make_numbered_docx() -> bytes:
    body = [
        _para("Affidavit Practice", "Title"),
        _para("Essentials", "Heading1"),
        _para("An affidavit must satisfy the following requirements:"),
        _para("it must be in writing;", num=5),
        _para("it must be sworn, and the oath may be taken:", num=5),
        _para("before a Commissioner for Oaths;", num=5, ilvl=1),
        _para("before a notary public;", num=5, ilvl=1),
        _para("it must contain facts only, including:", num=5),
        _para("facts within knowledge;", num=5, ilvl=1),
        _para("Defects", "Heading1"),
        _para("A defective affidavit may be struck out by the court."),
    ]
    styles = (
        f"<w:styles {W_NS}>"
        '<w:style w:styleId="Title"><w:name w:val="Title"/></w:style>'
        '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'
    )
    numbering = (
        f"<w:numbering {W_NS}>"
        '<w:abstractNum w:abstractNumId="30">'
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%2)"/></w:lvl>'
        "</w:abstractNum>"
        '<w:num w:numId="5"><w:abstractNumId w:val="30"/></w:num>'
        "</w:numbering>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f"<w:document {W_NS}><w:body>{''.join(body)}</w:body></w:document>")
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/numbering.xml", numbering)
    return buffer.getvalue()


if __name__ == "__main__":
    sys.exit(main())
