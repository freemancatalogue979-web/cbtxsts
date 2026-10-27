"""Generate 9 CLOVER brand assets from the official mark (frontend/public/brand/logo-source.jpg).

Splits the white-on-black emblem into a clean alpha channel, then composes:
  - logo.png             transparent white mark (sidebar / compact UI)
  - logo-full.png        dark-tile hero emblem (login screen)
  - favicon-16/32.png    small dark rounded tiles (browser tabs)
  - favicon.ico          multi-res 16/32/48
  - apple-touch-icon.png 180px solid dark tile (iOS)

Run with the backend venv (needs Pillow):  ../backend/.venv/bin/python scripts/make-brand.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent  # frontend/
SRC = ROOT / "public" / "brand" / "logo-source.jpg"
OUT = ROOT / "public" / "brand"

INK = (10, 10, 13)  # --color-ink, matches app background


def load_alpha_mark() -> Image.Image:
    """White emblem with transparency recovered from the black-background JPEG.

    Alpha = luminance, pushed through a soft threshold to suppress JPEG noise
    while keeping antialiased edges.
    """
    src = Image.open(SRC).convert("L")
    # soft threshold: <12 -> 0, >200 -> 255, linear between (kills JPEG halo)
    alpha = src.point(lambda v: 0 if v < 12 else min(255, round((v - 12) * 255 / 188)))
    # tight crop to the artwork + 4% padding
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    pad = round(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.04)
    box = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(alpha.width, bbox[2] + pad),
        min(alpha.height, bbox[3] + pad),
    )
    alpha = alpha.crop(box)
    mark = Image.new("RGBA", alpha.size, (255, 255, 255, 255))
    mark.putalpha(alpha)
    return mark


def square(im: Image.Image) -> Image.Image:
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return canvas


def on_tile(mark: Image.Image, size: int, inset: float, radius: float = 0.22) -> Image.Image:
    """Emblem centered on an app-ink tile (rounded if radius > 0)."""
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    if radius:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * radius), fill=255)
        tile.paste(Image.new("RGBA", (size, size), (*INK, 255)), (0, 0), mask)
    else:
        tile = Image.new("RGBA", (size, size), (*INK, 255))
    inner = round(size * (1 - inset * 2))
    m = ImageOps.contain(square(mark), (inner, inner), Image.LANCZOS)
    tile.paste(m, ((size - m.width) // 2, (size - m.height) // 2), m)
    return tile


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mark = square(load_alpha_mark())

    # transparent UI mark
    mark.resize((512, 512), Image.LANCZOS).save(OUT / "logo.png", optimize=True)

    # hero emblem: dark tile, generous breathing room
    on_tile(mark, 1024, inset=0.14, radius=0.16).save(OUT / "logo-full.png", optimize=True)

    # favicons: keep mark chunky at tiny sizes (smaller inset)
    on_tile(mark, 32, inset=0.10).save(OUT / "favicon-32.png", optimize=True)
    on_tile(mark, 16, inset=0.06).save(OUT / "favicon-16.png", optimize=True)
    on_tile(mark, 48, inset=0.10).save(OUT / "favicon-48.png", optimize=True)
    on_tile(mark, 48, inset=0.10).save(
        OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )

    # iOS home screen — solid tile, no alpha
    on_tile(mark, 180, inset=0.18, radius=0).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)

    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
