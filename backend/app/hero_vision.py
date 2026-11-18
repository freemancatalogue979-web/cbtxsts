"""Find hero portraits in a screenshot by matching them against our own official head art.

Scoreboards show heroes as tiny round portraits (often ~30 px with a level badge on top), which
a general vision model mostly guesses. Here every portrait is compared pixel-for-pixel with the
133 official heads in ``frontend/public/heroes/head-<slug>.webp``:

1. scan — the screenshot is scaled so a portrait of each plausible size becomes ``T`` px, every
   window (stride 2) is compared with every hero in colour (normalised correlation inside a round
   mask that skips the badge corners), one matrix product per scale;
2. verify — the best spots are re-checked in colour at full resolution, nudging position and
   size, against the few best heroes for that spot;
3. keep — confident, unambiguous matches only, without overlaps.

The matches are written onto the picture sent to the reader ("tagging") and listed in the
prompt, so the model reads hero names instead of guessing faces. Custom skins look different
from the default art, so those portraits simply aren't matched and the reader falls back to
the draft and its own eyes.
"""
from __future__ import annotations

import io
import threading
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    import numpy as np
except ImportError:  # pragma: no cover - without numpy the matcher is off and reading works as before
    np = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parents[2]
HERO_DIRS = (ROOT / "frontend" / "public" / "heroes", ROOT / "frontend" / "dist" / "heroes")

T = 16                       # template side at scan scale
VERIFY = 40                  # template side when verifying in colour
WORK_H = 420                 # the screenshot is scanned at this height
SIZES = np.geomspace(0.06, 0.26, 9)     # portrait diameter as a share of the screenshot height
SCAN_MIN = 0.50              # colour score for a spot to be checked further
SCAN_STAND = 3.0             # ... and how far above that hero's usual score in this picture
ACCEPT_STAND = 4.0           # standing needed to accept a hero
CANDIDATES = 6               # heroes re-checked per spot
FLAT_STD = 14.0              # windows flatter than this are skipped
ACCEPT = 0.72                # colour score to accept a hero
ACCEPT_LOW = 0.62            # ... or this, when it stands out very clearly (STRONG_STAND)
STRONG_STAND = 8.0
MARGIN = 0.06                # it must beat the next hero by this much
KNOWN_STAND = 2.0            # scan standing when only the drafted heroes are considered
KNOWN = (0.60, 0.52, 0.03, 2.5)   # accept / accept-low / margin / standing with a known draft
SURE = 0.80                  # matches below this are tagged "Name?" (likely — worth a second look)
MAYBE = 0.55                 # a rejected spot this close still suggests look-alikes
MAX_MAYBES = 18
MAX_SPOTS = 160
MAX_WINDOWS = 6000           # strongest windows looked at when grouping them into spots
MASK_R = 0.42                # round mask radius (share of the side)

_lock = threading.Lock()
_bank: "_Bank | None" = None


@dataclass
class Match:
    hero: str
    score: float
    margin: float
    x: float      # centre, share of the width
    y: float      # centre, share of the height
    size: float   # diameter, share of the height
    box: tuple[int, int, int, int]  # left, top, right, bottom in pixels

    def out(self) -> dict:
        return {"hero": self.hero, "confidence": round(self.score, 2), "x": round(self.x, 3), "y": round(self.y, 3),
                "size": round(self.size, 3)}


def _mask(side: int) -> np.ndarray:
    yy, xx = np.mgrid[:side, :side]
    c = (side - 1) / 2
    return ((xx - c) ** 2 + (yy - c) ** 2) <= (MASK_R * side) ** 2


def _unit(rows: np.ndarray) -> np.ndarray:
    """Zero-mean, unit-length rows (flat rows stay zero)."""
    rows = rows - rows.mean(axis=1, keepdims=True)
    norm = np.linalg.norm(rows, axis=1, keepdims=True)
    return np.divide(rows, norm, out=np.zeros_like(rows), where=norm > 1e-6)


class _Bank:
    def __init__(self, heads: dict[str, Image.Image]):
        self.names = sorted(heads)
        self.mask_t = _mask(T)
        self.mask_v = _mask(VERIFY)
        scan = [np.asarray(heads[n].convert("RGB").resize((T, T), Image.LANCZOS), np.float32)[self.mask_t].reshape(-1)
                for n in self.names]
        self.scan = _unit(np.stack(scan)).astype(np.float32)                    # heroes × 3m
        color = [np.asarray(heads[n].convert("RGB").resize((VERIFY, VERIFY), Image.LANCZOS), np.float32)[self.mask_v].reshape(-1)
                 for n in self.names]
        self.color = _unit(np.stack(color)).astype(np.float32)                  # heroes × 3m


def hero_heads(names: dict[str, str] | None = None) -> dict[str, Image.Image]:
    """slug-named head files → {hero name: image}. ``names`` maps slug → display name."""
    out: dict[str, Image.Image] = {}
    for folder in HERO_DIRS:
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("head-*.webp")):
            slug = path.stem[len("head-"):]
            name = (names or {}).get(slug) or slug.replace("-", " ").title()
            if name not in out:
                try:
                    out[name] = Image.open(path).convert("RGB")
                except OSError:
                    continue
        if out:
            break
    return out


def slug(name: str) -> str:
    return "-".join(name.lower().replace("'", " ").replace("’", " ").split())


def bank(names: list[str] | None = None) -> "_Bank | None":
    """The prepared hero art (built once). ``names`` gives the exact hero spellings."""
    global _bank
    if np is None:
        return None
    with _lock:
        if _bank is None:
            heads = hero_heads({slug(n): n for n in (names or [])})
            _bank = _Bank(heads) if heads else None
        return _bank


def reset() -> None:
    global _bank
    with _lock:
        _bank = None


def _windows(rgb: np.ndarray, side: int, stride: int, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Every side×side window (masked, flattened colour) with its top-left corner."""
    view = np.lib.stride_tricks.sliding_window_view(rgb, (side, side, 3))[::stride, ::stride, 0]
    ny, nx = view.shape[:2]
    ys, xs = np.mgrid[:ny, :nx]
    flat = view.reshape(ny * nx, side, side, 3)[:, mask].reshape(ny * nx, -1)
    return flat, ys.reshape(-1) * stride, xs.reshape(-1) * stride


def _scan(img: Image.Image, b: _Bank, only: np.ndarray | None = None) -> list[tuple[float, float, float, float, dict[int, float]]]:
    """Candidate spots in full-size pixels: (rank, cx, cy, d, {hero index: standing}).

    "Standing" is how far a window's score for a hero sits above that hero's usual score across
    the whole screenshot. Some heroes look a little like everything (a pink badge, a gradient);
    standing removes that bias, so only a window that really looks like the hero stands out.
    """
    scale = WORK_H / img.height
    work = img.resize((max(T, round(img.width * scale)), WORK_H), Image.BILINEAR)
    scores, where = [], []
    for share in SIZES:
        d = share * WORK_H
        f = T / d
        w, h = round(work.width * f), round(work.height * f)
        if w < T or h < T:
            continue
        g = np.asarray(work.resize((w, h), Image.BILINEAR), np.float32)
        flat, ys, xs = _windows(g, T, 2, b.mask_t)
        busy = flat.std(axis=1) >= FLAT_STD          # flat colour (a panel, a gradient) is never a portrait
        flat, ys, xs = flat[busy], ys[busy], xs[busy]
        if not len(flat):
            continue
        scores.append(_unit(flat) @ b.scan.T)         # windows × heroes
        where.append(np.stack([(xs + T / 2) / f, (ys + T / 2) / f, np.full(len(xs), d)], axis=1))
    if not scores:
        return []
    S = np.concatenate(scores)
    W = np.concatenate(where)
    stand = (S - S.mean(axis=0)) / (S.std(axis=0) + 1e-6)
    if only is not None:                              # the draft is known: only those heroes can be here
        stand[:, ~only] = -1e9
    scan_stand = SCAN_STAND if only is None else KNOWN_STAND
    hero = stand.argmax(axis=1)
    rows = np.arange(len(S))
    top = stand[rows, hero]
    ok = np.nonzero((S[rows, hero] >= SCAN_MIN) & (top >= scan_stand))[0]
    ok = ok[np.argsort(-top[ok])][:MAX_WINDOWS]
    picked: list[tuple[float, float, float, float, dict[int, float]]] = []
    for i in ok:
        cx, cy, d = W[i]
        best = np.argpartition(-stand[i], CANDIDATES)[:CANDIDATES] if stand.shape[1] > CANDIDATES else range(stand.shape[1])
        heroes = {int(k): float(stand[i, k]) for k in best if stand[i, k] >= scan_stand}
        # same size and nearly the same place = the same spot: pool its heroes into the kept one
        same = next((p for p in picked if (cx - p[1]) ** 2 + (cy - p[2]) ** 2 <= (0.3 * min(d, p[3])) ** 2
                     and abs(d - p[3]) <= 0.15 * p[3]), None)
        if same is not None:
            for k, v in heroes.items():
                if v > same[4].get(k, -1e9):
                    same[4][k] = v
        elif len(picked) < MAX_SPOTS:
            picked.append((float(top[i]), float(cx), float(cy), float(d), heroes))
    return [(r, cx / scale, cy / scale, d / scale, c) for r, cx, cy, d, c in picked]


def _verify(rgb: Image.Image, b: _Bank, cx: float, cy: float, d: float, heroes: list[int],
            only: np.ndarray | None = None) -> tuple[int, float, float, tuple]:
    """Best (hero, score, runner-up score, box) around a spot at full resolution, in colour.

    The runner-up is the best of every other hero, so a look-alike is caught even if the scan
    didn't list it."""
    best = (-1, -1.0, -1.0, (0, 0, 0, 0))
    cand = b.color
    for ds in (0.9, 1.0, 1.1):
        size = d * ds
        for dx in (-0.08, 0.0, 0.08):
            for dy in (-0.08, 0.0, 0.08):
                left, top = cx + dx * size - size / 2, cy + dy * size - size / 2
                box = (round(left), round(top), round(left + size), round(top + size))
                if box[0] < 0 or box[1] < 0 or box[2] > rgb.width or box[3] > rgb.height or size < 8:
                    continue
                patch = np.asarray(rgb.crop(box).resize((VERIFY, VERIFY), Image.BILINEAR), np.float32)[b.mask_v].reshape(1, -1)
                s = (_unit(patch) @ cand.T)[0]
                if only is not None:
                    s = np.where(only, s, -1.0)
                pick = max(heroes, key=lambda k: s[k])
                if s[pick] > best[1]:
                    others = np.delete(s, pick)
                    best = (int(pick), float(s[pick]), float(others.max()) if len(others) else -1.0, box)
    return best


def find_heroes(raw: bytes, hero_names: list[str] | None = None, limit: int = 30,
                candidates: list[str] | None = None) -> list[Match]:
    """Confident hero portraits in the picture, top-left first. Never raises on a bad picture.

    ``candidates`` — heroes known to be in this game (the recorded draft). With 3+ of them only
    those are considered, which makes small or blurry portraits far easier to tell apart."""
    return analyse(raw, hero_names, limit, candidates)[0]


def analyse(raw: bytes, hero_names: list[str] | None = None, limit: int = 30,
            candidates: list[str] | None = None) -> tuple[list[Match], list[str]]:
    """(confident matches, look-alikes): look-alikes are the closest heroes for portraits that
    weren't matched confidently (a skin, a blurry corner) — a short list worth comparing with."""
    b = bank(hero_names)
    if b is None:
        return [], []
    only = None
    wanted = {slug(c) for c in (candidates or []) if c}
    if len(wanted) >= 3:
        only = np.array([slug(n) in wanted for n in b.names])
        if only.sum() < 3:
            only = None
    accept, accept_low, margin, accept_stand = (ACCEPT, ACCEPT_LOW, MARGIN, ACCEPT_STAND) if only is None else KNOWN
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    except Exception:  # noqa: BLE001 - unreadable picture: nothing found
        return [], []
    if img.height < 60 or img.width < 60:
        return [], []
    cands: list[Match] = []
    near: list[tuple[float, float, float, list[int]]] = []    # score, x, y, heroes — not accepted
    for _, cx, cy, d, stand in _scan(img, b, only):
        if not stand:
            continue
        idx, score, second, box = _verify(img, b, cx, cy, d, list(stand), only)
        rejected = idx < 0 or score - second < margin or stand[idx] < accept_stand \
            or score < (accept_low if stand[idx] >= STRONG_STAND else accept)
        if rejected:
            if idx >= 0 and score >= MAYBE:
                near.append((score, cx / img.width, cy / img.height, [idx] + sorted(stand, key=lambda k: -stand[k])[:2]))
            continue
        cands.append(Match(hero=b.names[idx], score=score, margin=score - second,
                           x=(box[0] + box[2]) / 2 / img.width, y=(box[1] + box[3]) / 2 / img.height,
                           size=(box[3] - box[1]) / img.height, box=box))
    # Overlaps: a real portrait beats a piece of one. Bigger wins when nearly as good.
    cands.sort(key=lambda m: -(m.score + 0.04 * min(m.size / 0.1, 2)))
    found: list[Match] = []
    for m in cands:
        w = m.box[2] - m.box[0]
        if any(abs(f.x - m.x) * img.width < 0.7 * max(w, f.box[2] - f.box[0])
               and abs(f.y - m.y) * img.height < 0.7 * max(w, f.box[3] - f.box[1]) for f in found):
            continue
        found.append(m)
    # one portrait per hero (keep the strongest) — a hero is picked once per game
    best: dict[str, Match] = {}
    for m in found:
        if m.hero not in best or m.score > best[m.hero].score:
            best[m.hero] = m
    out = sorted(best.values(), key=lambda m: (round(m.y, 2), m.x))[:limit]
    taken = {m.hero for m in out}
    maybes: list[str] = []
    for score, x, y, heroes in sorted(near, key=lambda n: -n[0]):
        if any(abs(m.x - x) < m.size * img.height / img.width * 0.6 and abs(m.y - y) < m.size * 0.6 for m in out):
            continue                                   # part of a portrait already matched
        for k in heroes:
            name = b.names[k]
            if name not in taken and name not in maybes:
                maybes.append(name)
        if len(maybes) >= MAX_MAYBES:
            break
    return out, maybes[:MAX_MAYBES]


def _font(px: int):
    try:
        return ImageFont.load_default(size=max(10, px))
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def tag_image(img: Image.Image, matches: list[Match]) -> Image.Image:
    """A copy with each matched portrait's hero name in a yellow tag just under it (face left clear)."""
    img = img.copy()
    draw = ImageDraw.Draw(img)
    for m in matches:
        left, top, right, bottom = m.box
        side = right - left
        font = _font(round(max(side * 0.3, img.height * 0.02)))
        th = getattr(font, "size", 11)
        text = m.hero if m.score >= SURE else m.hero + "?"
        tw = draw.textlength(text, font=font)
        cx = (left + right) / 2
        x0 = max(0, min(img.width - tw - 6, cx - tw / 2 - 3))
        y0 = bottom + 1 if bottom + th + 7 <= img.height else max(0, top - th - 7)
        draw.rectangle((x0, y0, x0 + tw + 6, y0 + th + 5), fill=(255, 214, 0), outline=(0, 0, 0))
        draw.text((x0 + 3, y0 + 2), text, fill=(0, 0, 0), font=font)
    return img


def hero_sheet(names: list[str], hero_names: list[str] | None = None, cols: int = 6, tile: int = 112) -> bytes | None:
    """Official portraits with names under them (PNG) — a reference card for the reader."""
    heads = hero_heads({slug(n): n for n in (hero_names or [])})
    by_slug = {slug(n): (n, im) for n, im in heads.items()}
    items = [by_slug[slug(n)] for n in names if slug(n) in by_slug]
    if not items:
        return None
    cols = min(cols, len(items))
    rows = (len(items) + cols - 1) // cols
    label = 24
    sheet = Image.new("RGB", (cols * tile, rows * (tile + label)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    font = _font(15)
    for i, (name, im) in enumerate(items):
        x, y = (i % cols) * tile, (i // cols) * (tile + label)
        sheet.paste(im.resize((tile - 8, tile - 8), Image.LANCZOS), (x + 4, y + 4))
        tw = draw.textlength(name, font=font)
        draw.text((x + max(2, (tile - tw) / 2), y + tile + 2), name, fill=(0, 0, 0), font=font)
    out = io.BytesIO()
    sheet.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _where(m: Match) -> str:
    side = "left" if m.x < 0.4 else "right" if m.x > 0.6 else "middle"
    return f"{side} side, {round(m.y * 100)}% down"


@dataclass
class PortraitHelp:
    image: bytes | None              # the screenshot with matched heroes tagged (JPEG), None = send the original
    sheet: bytes | None              # reference portraits (PNG)
    matches: list[Match]
    maybes: list[str]

    def hints(self) -> dict:
        """What the reader is told about the portraits (goes into the prompt)."""
        return {
            "portrait_matches": [{"hero": m.hero, "where": _where(m), "confidence": round(m.score, 2)} for m in self.matches],
            "reference_sheet": bool(self.sheet),
        }


def portrait_help(raw: bytes, hero_names: list[str] | None = None, candidates: list[str] | None = None) -> PortraitHelp:
    """Match the portraits and prepare what the reader gets. Never raises — no help on failure."""
    try:
        matches, maybes = analyse(raw, hero_names, candidates=candidates)
        tagged = None
        if matches:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
            img = tag_image(img, matches)
            if max(img.size) > 2600:
                img.thumbnail((2600, 2600))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=92)
            tagged = buf.getvalue()
        known = [c for c in (candidates or []) if c]
        sheet_names = known if len({slug(c) for c in known}) >= 3 else [m.hero for m in matches] + maybes
        sheet = hero_sheet(list(dict.fromkeys(sheet_names))[:24], hero_names)
        return PortraitHelp(image=tagged, sheet=sheet, matches=matches, maybes=maybes)
    except Exception:  # noqa: BLE001 - the matcher only helps; reading must still work without it
        return PortraitHelp(image=None, sheet=None, matches=[], maybes=[])


HINT_RULE = """- Heroes — work in this order and never guess from a vague look:
  1. A yellow tag with a hero name directly under a portrait was added by our portrait matcher, which compared that portrait pixel-by-pixel with the official hero art. Use that hero for that row ("portrait_matches" lists them with where they are and a confidence; 0.8+ is certain). A tag ending in "?" is a likely match: keep it unless the reference sheet clearly shows another hero.
  2. A hero name printed as text on the screen.
  3. The recorded picks ("known_picks"/"candidate_heroes"): every hero in this game is one of them when they are given.
  4. The reference sheet (the second picture, official portraits with names under them): compare face, hair, helmet, weapon and colours. Skins change outfits and colours but usually keep the face shape and silhouette.
  Use the exact spelling from hero_names. If a portrait is still unclear, give your best match and say which row in "notes"."""
