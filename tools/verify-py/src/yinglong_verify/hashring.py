"""Hash Ring geometry, spec v1 (twin of packages/mandate/src/hashring.ts).

Input H: the 32-byte EIP-712 delegation hash the DelegationManager accepts (getDelegationHash).
 - 64 ticks; tick i at angle -90 + i * 5.625 degrees (i = 0 at 12 o'clock, clockwise).
 - nibble n_i = high nibble of H[i >> 1] when i is even, low nibble when i is odd.
 - tick from radius 0.80R outward, length (0.04 + 0.01 * n_i) * R.
 - nine arcs from K = keccak256(H): for j in 0..8, start = -90 + K[j] * 360 / 256 degrees,
   sweep = 8 + (K[j + 9] mod 32) degrees, radius = (0.70 - 0.025 * j) * R.
 - revoked: ticks i in {62, 63, 0, 1} omitted (gap at 12 o'clock), all ticks ash.
Numbers are rounded to 6 decimals with JavaScript Math.round semantics (half up), so the geometry is
identical to the TypeScript output. The ring proves hash identity, not mandate correctness.
"""

from __future__ import annotations

import math
from html import escape

from .hexutil import hex_to_bytes, keccak

GLYPHS = " .:-=+*#%@ABCDEF"
GAP = {62, 63, 0, 1}
CAPTION = "The ring proves hash identity, not mandate correctness."


def js_round(x: float) -> float:
    """Math.round(x * 1e6) / 1e6 with JavaScript rounding (ties toward +infinity)."""
    y = x * 1e6
    f = math.floor(y)
    r = f + 1 if y - f >= 0.5 else f
    return r / 1e6


def geometry(h: str, revoked: bool = False, radius: float = 1) -> dict:
    R = radius
    b = hex_to_bytes(h)
    if len(b) != 32:
        raise ValueError("Hash Ring input must be 32 bytes")
    k = keccak(b)
    ticks = []
    for i in range(64):
        if revoked and i in GAP:
            continue
        byte = b[i >> 1]
        nibble = byte >> 4 if i % 2 == 0 else byte & 0x0F
        ticks.append(
            {
                "i": i,
                "nibble": nibble,
                "angleDeg": js_round(-90 + i * 5.625),
                "r0": js_round(0.8 * R),
                "r1": js_round((0.8 + 0.04 + 0.01 * nibble) * R),
            }
        )
    arcs = []
    for j in range(9):
        arcs.append(
            {
                "j": j,
                "startDeg": js_round(-90 + (k[j] * 360) / 256),
                "sweepDeg": 8 + (k[j + 9] % 32),
                "r": js_round((0.7 - 0.025 * j) * R),
            }
        )
    return {"hash": h, "revoked": bool(revoked), "ticks": ticks, "arcs": arcs}


def ascii_strip(h: str) -> str:
    return "".join(GLYPHS[t["nibble"]] for t in geometry(h)["ticks"])


def tick_difference(a: str, b: str) -> int:
    ta, tb = geometry(a)["ticks"], geometry(b)["ticks"]
    return sum(1 for i in range(64) if ta[i]["nibble"] != tb[i]["nibble"])


def _pt(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    rad = math.radians(deg)
    return cx + r * math.cos(rad), cy + r * math.sin(rad)


def svg(h: str, revoked: bool = False, size: int = 360, title: str | None = None) -> str:
    """Render the ring as a standalone SVG (chrome on obsidian; ash with a 12 o'clock gap when revoked)."""
    g = geometry(h, revoked=revoked)
    cx = cy = size / 2
    scale = size * 0.42
    chrome, ash, arc_col, bg, text = "#D8DEE6", "#5B6169", "#9AA6B2", "#0B0D10", "#C9D1DA"
    tick_col = ash if revoked else chrome
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size + 44}" '
        f'viewBox="0 0 {size} {size + 44}" role="img" aria-labelledby="t d">',
        f'<title id="t">{escape(title or "YINGLONG Hash Ring")}</title>',
        f'<desc id="d">Hash Ring v1 of {escape(h)}{" (revoked)" if revoked else ""}. {escape(CAPTION)}</desc>',
        f'<rect width="100%" height="100%" fill="{bg}"/>',
    ]
    for t in g["ticks"]:
        x0, y0 = _pt(cx, cy, t["r0"] * scale, t["angleDeg"])
        x1, y1 = _pt(cx, cy, t["r1"] * scale, t["angleDeg"])
        out.append(
            f'<line x1="{x0:.3f}" y1="{y0:.3f}" x2="{x1:.3f}" y2="{y1:.3f}" stroke="{tick_col}" '
            f'stroke-width="{size / 160:.3f}" stroke-linecap="round"/>'
        )
    for a in g["arcs"]:
        r = a["r"] * scale
        x0, y0 = _pt(cx, cy, r, a["startDeg"])
        x1, y1 = _pt(cx, cy, r, a["startDeg"] + a["sweepDeg"])
        large = 1 if a["sweepDeg"] > 180 else 0
        out.append(
            f'<path d="M {x0:.3f} {y0:.3f} A {r:.3f} {r:.3f} 0 {large} 1 {x1:.3f} {y1:.3f}" fill="none" '
            f'stroke="{ash if revoked else arc_col}" stroke-width="{size / 120:.3f}" stroke-linecap="round"/>'
        )
    label = f"{h[:10]}...{h[-8:]}" + ("  REVOKED" if revoked else "")
    out.append(
        f'<text x="{cx}" y="{size + 16}" fill="{text}" font-family="ui-monospace, Menlo, Consolas, monospace" '
        f'font-size="12" text-anchor="middle">{escape(label)}</text>'
    )
    out.append(
        f'<text x="{cx}" y="{size + 34}" fill="{ash}" font-family="system-ui, sans-serif" font-size="10" '
        f'text-anchor="middle">{escape(CAPTION)}</text>'
    )
    out.append("</svg>")
    return "\n".join(out) + "\n"
