#!/usr/bin/env python3
"""Turn the generated character sheets into transparent, web-sized sprites.

The art arrives as flat PNGs on a pure white background. What we need is a
sprite the UI can drop over a meadow, a card or a night sky without a white box
around it — so this script:

  1. flood-fills the background from the four edges with a tolerance, which
     keeps the character's *interior* whites (eye highlights, shoes) intact,
     unlike a global "remove all white" pass;
  2. trims the empty margin so every mood shares the same optical scale;
  3. writes a retina (512px tall) and a UI (256px tall) webp per mood, with
     alpha, into src/assets/character/.

Run it after regenerating art:  backend/.venv/bin/python frontend/scripts/prep-character.py
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

SRC_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "character"
MOODS = ("idle", "cheer", "sad", "celebrate")
SIZES = {"": 512, "@256": 256}
TOLERANCE = 26  # how far from pure white still counts as background


def strip_background(image: Image.Image) -> Image.Image:
    """Flood-fill the white backdrop to transparent, from the edges inwards."""
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b, _a = pixels[x, y]
        return r >= 255 - TOLERANCE and g >= 255 - TOLERANCE and b >= 255 - TOLERANCE

    def push(x: int, y: int) -> None:
        if 0 <= x < width and 0 <= y < height and not seen[y * width + x] and is_background(x, y):
            seen[y * width + x] = 1
            queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (255, 255, 255, 0)
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    # Feather the cut so the cartoon outline is not a hard aliased edge.
    return image.filter(lambda: None) if False else image


def trim(image: Image.Image) -> Image.Image:
    box = image.getbbox()
    return image.crop(box) if box else image


def main() -> int:
    written = 0
    for mood in MOODS:
        source = SRC_DIR / f"hero-{mood}.png"
        if not source.exists():
            print(f"missing {source.name} — skipping")
            continue
        cleaned = trim(strip_background(Image.open(source)))
        for suffix, height in SIZES.items():
            scale = height / cleaned.height
            resized = cleaned.resize((max(1, round(cleaned.width * scale)), height), Image.LANCZOS)
            target = SRC_DIR / f"hero-{mood}{suffix}.webp"
            resized.save(target, "WEBP", quality=88, method=6)
            written += 1
            print(f"  {target.name:24s} {resized.size[0]}x{resized.size[1]}  {target.stat().st_size // 1024}kB")
        # The source PNG is only a working file; the webp pair is what ships.
        source.unlink()
    print(f"wrote {written} sprites")
    return 0


if __name__ == "__main__":
    sys.exit(main())
