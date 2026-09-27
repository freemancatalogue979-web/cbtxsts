"""Spelling and typo fixer for course materials (no AI, runs offline).

How a word is judged:

1. A list of well-known misspellings (``recieve`` → ``receive``, ``wich`` →
   ``which``) is checked first: these are always "sure" fixes.
2. Words are skipped when they are probably right or deliberate: very short
   words, anything with digits, ACRONYMS, Capitalised words in mid-sentence
   (names, cases, places), words in the course's own titles/topics, words the
   material repeats (domain terms like "thylakoid"), and anything the English
   dictionary knows. British / Nigerian spellings (colour, organisation,
   programme, centre, defence, judgement…) count as correct — the dictionary
   is American, so we never "fix" them into US spelling.
3. Otherwise the closest dictionary word is suggested. One letter off in a
   longer word (or two letters swapped) is a "sure" fix; short words and
   two-letters-off guesses are a "maybe" that staff must tick themselves.

Latin and other foreign phrases (audi alteram partem, ratio decidendi…) are
left alone: common ones are in a word list, and any run of two or more
unknown words close together is treated as a foreign phrase, not typos.

Plus small typo rules: a doubled word ("the the"), a space before
punctuation, a missing space after a full stop, a lone lowercase "i",
and repeated spaces.

Staff always review: :func:`find_changes` lists every change with context and
an id, and :func:`apply_changes` applies only the ids staff accepted. Both walk
the document the same way, so ids are stable for the same input.
"""
from __future__ import annotations

import copy
import re
from functools import lru_cache
from typing import Any, Iterator

WORD_RE = re.compile(r"[A-Za-z](?:[A-Za-z'’]*[A-Za-z])?")

# Always-wrong spellings (lowercase). Kept small and unambiguous.
COMMON: dict[str, str] = {
    "teh": "the", "adn": "and", "wich": "which", "whcih": "which", "taht": "that", "thier": "their",
    "recieve": "receive", "recieved": "received", "beleive": "believe", "beleived": "believed",
    "acheive": "achieve", "acheived": "achieved", "wierd": "weird", "freind": "friend", "freinds": "friends",
    "seperate": "separate", "seperately": "separately", "definately": "definitely", "definatly": "definitely",
    "occured": "occurred", "occuring": "occurring", "occurence": "occurrence", "untill": "until",
    "accomodate": "accommodate", "acommodate": "accommodate", "neccessary": "necessary", "necesary": "necessary",
    "goverment": "government", "govenment": "government", "enviroment": "environment", "enviromental": "environmental",
    "arguement": "argument", "independant": "independent", "existance": "existence", "publically": "publicly",
    "tommorow": "tomorrow", "tommorrow": "tomorrow", "becuase": "because", "beacuse": "because", "comittee": "committee",
    "posession": "possession", "succesful": "successful", "sucessful": "successful", "begining": "beginning",
    "calender": "calendar", "concious": "conscious", "embarass": "embarrass", "foriegn": "foreign",
    "grammer": "grammar", "gaurd": "guard", "happend": "happened", "immediatly": "immediately", "knowlege": "knowledge",
    "liason": "liaison", "millenium": "millennium", "noticable": "noticeable", "persue": "pursue", "posible": "possible",
    "prefered": "preferred", "privelege": "privilege", "recomend": "recommend", "refered": "referred",
    "relevent": "relevant", "rember": "remember", "sieze": "seize", "tounge": "tongue", "truely": "truly",
    "wether": "whether", "writting": "writing", "alot": "a lot", "infact": "in fact", "atleast": "at least",
    "eventhough": "even though", "incase": "in case", "aswell": "as well", "untill.": "until.",
    "chlorophyl": "chlorophyll", "photosynthsis": "photosynthesis", "enviroments": "environments",
    "responsibilty": "responsibility", "similiar": "similar", "sucess": "success", "occassion": "occasion",
    "adress": "address", "agressive": "aggressive", "apparantly": "apparently", "basicly": "basically",
    "buisness": "business", "catagory": "category", "cemetary": "cemetery", "collegue": "colleague",
    "commited": "committed", "completly": "completely", "decison": "decision", "diffrent": "different",
    "dissapear": "disappear", "dissapoint": "disappoint", "exercice": "exercise", "familar": "familiar",
    "finaly": "finally", "futher": "further", "gaurantee": "guarantee", "hieght": "height", "humourous": "humorous",
    "intresting": "interesting", "judical": "judicial", "juridiction": "jurisdiction", "lenght": "length",
    "maintainance": "maintenance", "mispell": "misspell", "neighbor": "neighbour", "oppurtunity": "opportunity",
    "paralell": "parallel", "parliment": "parliament", "peice": "piece", "percieve": "perceive", "reciept": "receipt",
    "religous": "religious", "rythm": "rhythm", "shedule": "schedule", "speach": "speech", "strenght": "strength",
    "supercede": "supersede", "suprise": "surprise", "temperture": "temperature", "therefor": "therefore",
    "threshhold": "threshold", "tomatos": "tomatoes", "truelly": "truly", "unforseen": "unforeseen",
    "vaccum": "vacuum", "wiht": "with", "wih": "with", "yeild": "yield",
}

# Words the dictionary lacks but which are right (British/Nigerian usage, school subjects).
EXTRA_WORDS = {
    "whilst", "learnt", "spelt", "burnt", "dreamt", "amongst", "judgement", "judgements", "naira", "kobo",
    "jamb", "waec", "neco", "utme", "unilag", "ui", "oau", "unn", "abu", "lasu", "ekiti", "ogun", "oyo", "kano",
    "kaduna", "enugu", "anambra", "rivers", "benue", "delta", "edo", "imo", "abia", "ondo", "osun", "kwara",
    "plateau", "borno", "sokoto", "zamfara", "yobe", "gombe", "bauchi", "taraba", "adamawa", "nasarawa", "kogi",
    "niger", "kebbi", "jigawa", "katsina", "bayelsa", "ebonyi", "akwa", "ibom", "cross", "fct", "abuja",
    "thylakoid", "thylakoids", "stroma", "nadph", "rubisco", "okada", "danfo", "jollof", "ogbono", "egusi",
}

# Latin and other foreign terms common in law, science and medicine — never "fixed".
LATIN_WORDS = set(
    """
    audi alteram partem nemo judex iudex causa sua ratio decidendi obiter dictum dicta stare decisis res judicata
    ipsa loquitur mens rea actus reus habeas corpus certiorari mandamus prohibito prima facie bona fide fides mala
    ultra vires intra locus standi inter alia alios incuriam sine qua non initio facto jure novo parte ante quantum
    meruit volenti injuria caveat emptor venditor judice rata hoc ibid viz mutatis mutandis nolle prosequi nisi
    autrefois acquit convict amicus curiae lex loci fori situs domicilii cestui que trust nexus pari passu delicto
    contra proferentem ejusdem generis noscitur sociis expressio unius exclusio alterius generalia specialibus
    derogant ubi remedium doli incapax sui generis juris gratia persona grata non grata forum conveniens
    stricto sensu lato sensu pendente lite lis pendens functus officio suo motu proprio mero deo volente vis major
    ignorantia legis excusat neminem quorum seriatim per curiam pro forma tempore quo vice versa verbatim
    opus magnum circa etc et seq supra infra passim vide homo sapiens erectus genus species corpus luteum
    in vitro vivo situ utero vacuo cum laude summa magna alumni alumnus alma mater curriculum vitae status quo
    """.split()
)

# US → UK patterns: if the American form of an unknown word is a dictionary word,
# the word is a correct British spelling.
_UK_TO_US: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"our(s|ed|ing|ite|ites|able|ful|less|ism)?$"), r"or\1"),
    (re.compile(r"isation(s)?$"), r"ization\1"),
    (re.compile(r"is(e|es|ed|ing|er|ers)$"), r"iz\1"),
    (re.compile(r"ys(e|es|ed|ing)$"), r"yz\1"),
    (re.compile(r"tre(s)?$"), r"ter\1"),
    (re.compile(r"bre(s)?$"), r"ber\1"),
    (re.compile(r"ence(s)?$"), r"ense\1"),
    (re.compile(r"ogue(s)?$"), r"og\1"),
    (re.compile(r"mme(s)?$"), r"m\1"),
    (re.compile(r"ll(ed|ing|er|ers|ery)$"), r"l\1"),
    (re.compile(r"gement(s)?$"), r"gment\1"),
    (re.compile(r"aemia$|aemic$"), r"emia"),
    (re.compile(r"oe(s)?(?=[a-z])"), r"e"),
]


@lru_cache(maxsize=1)
def _checker():
    from spellchecker import SpellChecker  # lazy: the dictionary takes ~0.5 s to load

    checker = SpellChecker(distance=2)
    checker.word_frequency.load_words(EXTRA_WORDS | LATIN_WORDS)
    return checker


def _known(word: str) -> bool:
    checker = _checker()
    if word in checker:
        return True
    for pattern, replacement in _UK_TO_US:
        us = pattern.sub(replacement, word)
        if us != word and us in checker:
            return True
    return False


def _distance(a: str, b: str) -> int:
    """Damerau–Levenshtein (optimal string alignment) distance."""
    rows = [list(range(len(b) + 1))]
    for i in range(1, len(a) + 1):
        row = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            row[j] = min(row[j - 1] + 1, rows[i - 1][j] + 1, rows[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                row[j] = min(row[j], rows[i - 2][j - 2] + 1)
        rows.append(row)
    return rows[-1][-1]


@lru_cache(maxsize=20000)
def _suggest(lower: str) -> tuple[str, str] | None:
    """(suggestion, confidence) for one lowercase word, or None."""
    if lower in COMMON:
        return COMMON[lower], "sure"
    if _known(lower):
        return None
    candidate = _checker().correction(lower)
    if not candidate or candidate == lower or not candidate.isalpha():
        return None
    gap = _distance(lower, candidate)
    swapped = sorted(lower) == sorted(candidate)  # "ligth" → "light": letters just swapped
    if gap == 1 and (len(lower) >= 6 or swapped):
        return candidate, "sure"
    if gap == 1 and len(lower) >= 4:
        return candidate, "maybe"  # short words have many neighbours ("grana" is not "grand")
    if gap == 2 and len(lower) >= 7:
        return candidate, "maybe"
    return None


def _match_case(original: str, fixed: str) -> str:
    if original.isupper() and len(original) > 1:
        return fixed.upper()
    if original[0].isupper():
        return fixed[0].upper() + fixed[1:]
    return fixed


def _sentence_start(text: str, index: int) -> bool:
    before = text[:index].rstrip()
    return not before or before[-1] in ".!?:;\n•-–—(\"“'‘"


# Typo rules: (pattern, replacement builder, reason, confidence)
_DOUBLED = re.compile(r"\b([A-Za-z]+)\s+(\1)\b", re.IGNORECASE)
_DOUBLED_OK = {"had", "that", "is", "do", "very", "bye", "so", "no", "ha", "go"}
_SPACE_BEFORE_PUNCT = re.compile(r"(?<=\w) +([,.;:!?])(?=\s|$)")
_NO_SPACE_AFTER_STOP = re.compile(r"(?<=[a-z]{2})([.!?])(?=[A-Z][a-z])")
_LONE_I = re.compile(r"(?<![\w'’])i(?![\w'’.])")
_MULTI_SPACE = re.compile(r"(?<=\S)  +(?=\S)")


def _text_changes(text: str, known_words: set[str]) -> list[dict]:
    """Changes inside one string: {start, end, from, to, reason, confidence}."""
    if not text or not text.strip():
        return []
    found: list[dict] = []
    taken: list[tuple[int, int]] = []

    def add(start: int, end: int, replacement: str, reason: str, confidence: str) -> None:
        if any(start < b and end > a for a, b in taken):
            return
        taken.append((start, end))
        found.append({"start": start, "end": end, "from": text[start:end], "to": replacement, "reason": reason, "confidence": confidence})

    for match in _DOUBLED.finditer(text):
        if match.group(1).lower() in _DOUBLED_OK:
            continue
        add(match.start(), match.end(), match.group(1), "Repeated word", "sure")
    for match in _SPACE_BEFORE_PUNCT.finditer(text):
        add(match.start() - 0, match.end(), match.group(1), "Space before punctuation", "sure")
    for match in _NO_SPACE_AFTER_STOP.finditer(text):
        if re.search(r"(https?://|www\.|@)\S*$", text[: match.start()]):
            continue  # inside a link or e-mail
        add(match.start(), match.end(), match.group(1) + " ", "Missing space after full stop", "sure")
    for match in _LONE_I.finditer(text):
        add(match.start(), match.end(), "I", "“I” is always a capital", "sure")
    for match in _MULTI_SPACE.finditer(text):
        add(match.start(), match.end(), " ", "Extra spaces", "sure")

    # A run of unknown words ("audi alteram partem", "ubi jus ibi remedium") is a
    # foreign phrase, not a cluster of typos: leave every word in it alone.
    words = list(WORD_RE.finditer(text))
    unknown = [
        index
        for index, match in enumerate(words)
        if len(match.group(0)) >= 3 and match.group(0).lower() not in COMMON and match.group(0).lower() not in known_words and not _known(match.group(0).lower().replace("’", "'"))
    ]
    def swapped_typo(index: int) -> bool:  # "ligth": two letters swapped is a typo, never Latin
        lower = words[index].group(0).lower()
        guess = _suggest(lower)
        return bool(guess) and sorted(guess[0]) == sorted(lower)

    unknown = [index for index in unknown if not swapped_typo(index)]
    clustered = {index for index in unknown if any(other != index and abs(other - index) <= 2 for other in unknown)}

    for position, match in enumerate(words):
        if position in clustered:
            continue
        word = match.group(0).replace("’", "'")
        core = re.sub(r"'s$", "", word)
        lower = core.lower()
        if len(core) < 3 or "'" in core:
            continue
        if core.isupper():
            continue  # acronym: ATP, NADPH, JAMB
        if core[0].isupper() and not _sentence_start(text, match.start()) and lower not in COMMON:
            continue  # a name, case or place in mid-sentence
        if lower in known_words:
            continue
        # skip words glued to links / emails / file names
        around = text[max(0, match.start() - 1) : match.end() + 1]
        if re.search(r"[/@_\\]|\.\w", around.strip(" ,;:!?)")) and not around.endswith((". ", ".")):
            continue
        suggestion = _suggest(lower)
        if not suggestion:
            continue
        fixed, confidence = suggestion
        fixed = _match_case(core, fixed)
        end = match.start() + len(core)
        reason = "Common misspelling" if lower in COMMON else ("Spelling" if confidence == "sure" else "Possible spelling")
        add(match.start(), end, fixed, reason, confidence)

    found.sort(key=lambda row: row["start"])
    return found


# ------------------------------------------------------------ document walk
def _fields(doc: dict) -> Iterator[tuple[str, Any, Any, str]]:
    """Yield (path, container, key, text) for every editable string, in a fixed order."""
    for key in ("title", "description"):
        if isinstance(doc.get(key), str):
            yield key, doc, key, doc[key]
    for index, line in enumerate(doc.get("summary") or []):
        if isinstance(line, str):
            yield f"summary.{index}", doc["summary"], index, line
    for s_index, section in enumerate(doc.get("sections") or []):
        if not isinstance(section, dict):
            continue
        if isinstance(section.get("title"), str):
            yield f"sections.{s_index}.title", section, "title", section["title"]
        for b_index, block in enumerate(section.get("blocks") or []):
            if not isinstance(block, dict):
                continue
            base = f"sections.{s_index}.blocks.{b_index}"
            for key in ("title", "text", "term", "meaning", "caption"):
                if isinstance(block.get(key), str) and key != "url":
                    yield f"{base}.{key}", block, key, block[key]
            for i_index, item in enumerate(block.get("items") or []):
                if isinstance(item, str):
                    yield f"{base}.items.{i_index}", block["items"], i_index, item
            for h_index, cell in enumerate(block.get("head") or []):
                if isinstance(cell, str):
                    yield f"{base}.head.{h_index}", block["head"], h_index, cell
            for r_index, row in enumerate(block.get("rows") or []):
                if isinstance(row, list):
                    for c_index, cell in enumerate(row):
                        if isinstance(cell, str):
                            yield f"{base}.rows.{r_index}.{c_index}", row, c_index, cell


def _domain_words(doc: dict, extra: list[str]) -> set[str]:
    """Words the material repeats, plus words from the course's titles/topics."""
    counts: dict[str, int] = {}
    for _path, _container, _key, text in _fields(doc):
        for match in WORD_RE.finditer(text):
            lower = match.group(0).lower()
            counts[lower] = counts.get(lower, 0) + 1
    words = {word for word, count in counts.items() if count >= 2 and word not in COMMON}
    for text in extra:
        words.update(match.group(0).lower() for match in WORD_RE.finditer(text or ""))
    return words


def find_changes(doc: dict, extra_words: list[str] | None = None) -> list[dict]:
    known = _domain_words(doc, extra_words or [])
    changes: list[dict] = []
    for path, _container, _key, text in _fields(doc):
        for row in _text_changes(text, known):
            start, end = row["start"], row["end"]
            context_start = max(0, start - 40)
            context_end = min(len(text), end + 40)
            changes.append(
                {
                    "id": len(changes) + 1,
                    "path": path,
                    "from": row["from"],
                    "to": row["to"],
                    "reason": row["reason"],
                    "confidence": row["confidence"],
                    "before": ("…" if context_start > 0 else "") + text[context_start:start],
                    "after": text[end:context_end] + ("…" if context_end < len(text) else ""),
                    "_start": start,
                    "_end": end,
                }
            )
    return changes


def apply_changes(doc: dict, accept: list[int], extra_words: list[str] | None = None) -> tuple[dict, int]:
    """Return (a corrected copy of doc, number of changes applied)."""
    fixed = copy.deepcopy(doc)
    wanted = set(accept)
    by_path: dict[str, list[dict]] = {}
    for change in find_changes(fixed, extra_words):
        if change["id"] in wanted:
            by_path.setdefault(change["path"], []).append(change)
    applied = 0
    for path, container, key, text in list(_fields(fixed)):
        rows = by_path.get(path)
        if not rows:
            continue
        for row in sorted(rows, key=lambda item: item["_start"], reverse=True):
            text = text[: row["_start"]] + row["to"] + text[row["_end"] :]
            applied += 1
        container[key] = text
    return fixed, applied


def public(changes: list[dict]) -> list[dict]:
    return [{key: value for key, value in row.items() if not key.startswith("_")} for row in changes]
