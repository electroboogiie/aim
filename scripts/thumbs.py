#!/usr/bin/env python3
"""Small UI thumbnails for every photo the catalog uses.

Reads each photo path of catalog/catalog.json (items, accessories, accessory variants) from generator/assets
or, when a file is not there, from the kp-configurator assets folder, and writes
web/media/<same path>.jpg: at most 640 px on the long side, JPEG quality 80. Transparent cut-outs are put on
the card colour of the UI (#1E2228). Existing thumbnails newer than their source are kept.

Usage: python3 -I scripts/thumbs.py [--force] [--assets DIR ...]
"""
import argparse
import json
import sys
from pathlib import PurePosixPath, Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog" / "catalog.json"
OUT = ROOT / "web" / "media"
SOURCES = [ROOT / "generator" / "assets", Path("/mnt/project-files/kp-configurator/src/assets")]
MAX_PX = 640
QUALITY = 80
CARD_BG = (30, 34, 40)


def catalog_photos(catalog: dict) -> list[str]:
    paths: set[str] = set()
    for it in catalog.get("items", []):
        if it.get("photo"):
            paths.add(it["photo"])
    for acc in catalog.get("accessories", []):
        if acc.get("photo"):
            paths.add(acc["photo"])
        for v in acc.get("variants", []) or []:
            if v.get("photo"):
                paths.add(v["photo"])
    return sorted(paths)


def safe_rel(p: str) -> PurePosixPath:
    rel = PurePosixPath(p)
    if rel.is_absolute() or ".." in rel.parts or "\\" in p or not rel.parts:
        raise ValueError(f"unsafe photo path: {p!r}")
    return rel


def find_source(rel: PurePosixPath, sources: list[Path]) -> Path | None:
    for base in sources:
        f = base.joinpath(*rel.parts)
        if f.is_file():
            return f
    return None


def make_thumb(src: Path, dst: Path) -> tuple[int, int]:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, CARD_BG)
            bg.paste(rgba, mask=rgba.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        return im.size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="rebuild every thumbnail")
    ap.add_argument("--assets", action="append", type=Path, help="extra asset folder to search first")
    args = ap.parse_args()
    sources = [*(args.assets or []), *SOURCES]
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    missing: list[str] = []
    written = kept = 0
    for p in catalog_photos(catalog):
        rel = safe_rel(p)
        dst = OUT.joinpath(*rel.with_suffix(".jpg").parts)
        src = find_source(rel, sources)
        if src is None:
            missing.append(p)
            continue
        if not args.force and dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            kept += 1
            continue
        w, h = make_thumb(src, dst)
        written += 1
        print(f"thumbs: {p} -> web/media/{rel.with_suffix('.jpg')} ({w}×{h}, {dst.stat().st_size // 1024} KB)")
    print(f"thumbs: written {written}, up to date {kept}, missing {len(missing)}")
    for p in missing:
        print(f"thumbs: немає файлу для {p}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
