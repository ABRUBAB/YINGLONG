"""Builds the self-hosted woff2 fonts in public/fonts from the upstream variable TTFs.

Sources (SIL OFL 1.1, unmodified upstream files):
  Hubot Sans  github.com/github/hubot-sans      HubotSans[wdth,wght].ttf
  Geist       github.com/vercel/geist-font      Geist[wght].ttf
  Geist Mono  github.com/vercel/geist-font      GeistMono[wght].ttf
The subsets are Latin only (no CJK code point can enter a file). Run with:
  python -I scripts/build-fonts.py <dir-with-ttf-files>
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / "public" / "fonts"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../../../brand/source/fonts")

LATIN = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,"
    "U+2002-2014,U+2018-201E,U+2020-2022,U+2026,U+2030,U+2032-2033,U+2039-203A,U+2044,"
    "U+20AC,U+2190-2193,U+2212,U+2215,U+2248,U+2260,U+2264-2265"
)

FORBIDDEN = [(0x3000, 0x303F), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xFF00, 0xFFEF)]


def build(src_name: str, out_name: str, limits: dict | None = None) -> None:
    font = TTFont(SRC / src_name)
    if limits:
        font = instancer.instantiateVariableFont(font, limits)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    sub = subset.Subsetter(opts)
    unicodes = []
    for part in LATIN.split(","):
        part = part.strip()[2:]
        if "-" in part:
            a, b = part.split("-")
            unicodes.extend(range(int(a, 16), int(b, 16) + 1))
        else:
            unicodes.append(int(part, 16))
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    cmap = font.getBestCmap()
    for cp in cmap:
        for lo, hi in FORBIDDEN:
            if lo <= cp <= hi:
                raise SystemExit(f"{out_name}: forbidden code point U+{cp:04X}")
    OUT.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT / out_name)
    print(f"{out_name}: {(OUT / out_name).stat().st_size} bytes, {len(cmap)} code points")


build("HubotSans[wdth,wght].ttf", "HubotSans-Latin.woff2", {"wdth": (100, 125), "wght": (400, 700)})
build("Geist[wght].ttf", "Geist-Latin.woff2", {"wght": (300, 700)})
build("GeistMono[wght].ttf", "GeistMono-Latin.woff2")
