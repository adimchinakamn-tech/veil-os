#!/usr/bin/env python3
"""Patch download/veil-offline.html in place: chat message links must ride
the veil origin (veilRoute) instead of walking the viewer's browser straight
to the third-party host — same fix as scripts/veil-shell.js (chat leak).

Idempotent: skips when the new pattern is already present."""
import re
import sys

PATH = "/home/z/my-project/download/veil-offline.html"

OLD = (
    "return /^https?:\\/\\//.test(p)\n"
    "                ? '<a href=\"' + chatEsc(p) + '\" target=\"_blank\" rel=\"noopener noreferrer\">'"
)
NEW = (
    "return /^https?:\\/\\//.test(p)\n"
    "                ? '<a href=\"' + chatEsc(veilRoute(p)) + '\" target=\"_blank\" rel=\"noopener noreferrer\">'"
)


def main() -> int:
    with open(PATH, "r", encoding="utf-8", errors="surrogateescape") as f:
        src = f.read()
    if NEW in src:
        print("already patched — nothing to do")
        return 0
    n = src.count(OLD)
    if n != 1:
        print(f"FAIL: expected exactly 1 match, found {n}")
        return 1
    out = src.replace(OLD, NEW, 1)
    with open(PATH, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(out)
    print(f"patched OK ({len(src)} -> {len(out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
