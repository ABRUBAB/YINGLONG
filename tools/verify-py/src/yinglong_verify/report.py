"""Check results and plain-text tables (ASCII only, so any terminal can print them)."""

from __future__ import annotations

import os
import shutil
import sys
import textwrap
from dataclasses import asdict, dataclass, field

PASS, FAIL, SKIP, INFO = "PASS", "FAIL", "SKIP", "INFO"


@dataclass
class Check:
    name: str
    status: str
    detail: str = ""

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class Report:
    title: str
    checks: list[Check] = field(default_factory=list)
    offline: bool = False

    def add(self, name: str, status: str, detail: str = "") -> Check:
        c = Check(name, status, detail)
        self.checks.append(c)
        return c

    def ok(self, name: str, cond: bool, detail_ok: str = "", detail_fail: str = "") -> bool:
        self.add(name, PASS if cond else FAIL, detail_ok if cond else (detail_fail or detail_ok))
        return cond

    @property
    def failed(self) -> list[Check]:
        return [c for c in self.checks if c.status == FAIL]

    @property
    def passed(self) -> bool:
        return not self.failed

    def verdict(self) -> str:
        n_pass = sum(1 for c in self.checks if c.status == PASS)
        n_skip = sum(1 for c in self.checks if c.status == SKIP)
        if self.failed:
            return f"RESULT: FAIL ({len(self.failed)} failed, {n_pass} passed, {n_skip} skipped)"
        if self.offline:
            return f"RESULT: PASS OFFLINE ({n_pass} passed, {n_skip} skipped; the ledger was not read)"
        if n_skip:
            return f"RESULT: PASS ({n_pass} passed, {n_skip} skipped)"
        return f"RESULT: PASS (all {n_pass} checks passed)"

    def to_json(self) -> dict:
        return {"title": self.title, "offline": self.offline, "passed": self.passed, "verdict": self.verdict(), "checks": [c.to_json() for c in self.checks]}


def term_width() -> int:
    if os.environ.get("COLUMNS", "").isdigit():
        return max(80, min(int(os.environ["COLUMNS"]), 200))
    if not sys.stdout.isatty():
        return 120
    return max(80, min(shutil.get_terminal_size((120, 24)).columns, 160))


def table(rows: list[list[str]], headers: list[str], wrap_last: bool = True) -> str:
    width = term_width()
    cols = len(headers)
    widths = [len(h) for h in headers]
    for r in rows:
        for i in range(cols - 1 if wrap_last else cols):
            widths[i] = max(widths[i], len(r[i]))
    if wrap_last:
        used = sum(widths[:-1]) + 3 * (cols - 1)
        widths[-1] = max(20, width - used - 1)
    sep = "+".join("-" * (w + 2) for w in widths)
    out = [" " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)), "-" + sep]
    for r in rows:
        last = textwrap.wrap(r[-1], widths[-1]) or [""] if wrap_last else [r[-1]]
        first = [r[i].ljust(widths[i]) for i in range(cols - 1)]
        out.append(" " + " | ".join(first + [last[0]]))
        for extra in last[1:]:
            out.append(" " + " | ".join([" " * widths[i] for i in range(cols - 1)] + [extra]))
    return "\n".join(out)


def checks_table(report: Report) -> str:
    """One row per check; long check names wrap inside their own column."""
    width = term_width()
    name_w = min(max((len(c.name) for c in report.checks), default=10), max(30, width // 2 - 12))
    detail_w = max(20, width - name_w - 4 - 6 - 10)
    sep = "-" * 4 + "+" + "-" * 8 + "+" + "-" * (name_w + 2) + "+" + "-" * (detail_w + 2)
    out = [f" {'#':<2} | {'STATUS':<6} | {'CHECK':<{name_w}} | DETAIL", "-" + sep]
    for i, c in enumerate(report.checks, 1):
        names = textwrap.wrap(c.name, name_w) or [""]
        details = textwrap.wrap(c.detail, detail_w, break_long_words=True) or [""]
        for j in range(max(len(names), len(details))):
            n = names[j] if j < len(names) else ""
            dd = details[j] if j < len(details) else ""
            if j == 0:
                out.append(f" {i:<2} | {c.status:<6} | {n:<{name_w}} | {dd}")
            else:
                out.append(f" {'':<2} | {'':<6} | {n:<{name_w}} | {dd}")
    return "\n".join(out)


def heading(s: str) -> str:
    return f"\n{s}\n{'=' * len(s)}"
