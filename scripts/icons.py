#!/usr/bin/env python3
"""Draw the PWA icons into web/icons (KP_2_v3 look: graphite, orange HUD corners, bold «КП»).

Usage: python3 scripts/icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "icons"
BG = (23, 27, 33)
PANEL = (30, 34, 40)
GRID = (36, 41, 48)
ORANGE = (242, 83, 10)
WHITE = (242, 244, 247)
FONTS = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
SCALE = 4


def font(px: int) -> ImageFont.FreeTypeFont:
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, px)
    raise SystemExit("no bold TTF font found (Liberation Sans or DejaVu Sans)")


def draw(size: int, maskable: bool) -> Image.Image:
    s = size * SCALE
    im = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(im)
    step = s // 8
    for i in range(1, 8):
        d.line([(i * step, 0), (i * step, s)], fill=GRID, width=max(1, s // 512))
        d.line([(0, i * step), (s, i * step)], fill=GRID, width=max(1, s // 512))
    # maskable icons keep everything inside the 80 % safe circle
    inset = int(s * (0.22 if maskable else 0.10))
    arm = int(s * (0.13 if maskable else 0.16))
    w = max(2, int(s * 0.03))
    box = (inset, inset, s - inset, s - inset)
    d.rectangle(box, fill=PANEL)
    def bar(x0: int, y0: int, x1: int, y1: int) -> None:
        d.rectangle([min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)], fill=ORANGE)

    for x, y, dx, dy in [(box[0], box[1], 1, 1), (box[2], box[1], -1, 1), (box[0], box[3], 1, -1), (box[2], box[3], -1, -1)]:
        bar(x, y, x + dx * arm, y + dy * w)
        bar(x, y, x + dx * w, y + dy * arm)
    inner = box[2] - box[0]
    f = font(int(inner * 0.46))
    text = "КП"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    tw, th = r - l, b - t
    cx = s // 2
    ty = box[1] + int(inner * 0.24) - t
    d.text((cx - tw // 2 - l, ty), text, font=f, fill=WHITE)
    bar_y = ty + t + th + int(inner * 0.08)
    bar_h = max(2, int(inner * 0.07))
    d.rectangle([cx - tw // 2, bar_y, cx + tw // 2, bar_y + bar_h], fill=ORANGE)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False), ("icon-512.png", 512, False),
        ("maskable-192.png", 192, True), ("maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, True),
    ]
    for name, size, maskable in jobs:
        draw(size, maskable).save(OUT / name, optimize=True)
        print(f"icons: {OUT / name}")


if __name__ == "__main__":
    main()
