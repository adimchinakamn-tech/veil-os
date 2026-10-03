#!/usr/bin/env python3
"""Patch download/veil-offline.html in place: the offline chat's GIF drawer
predates the same-origin /api/gif-file system — thumbnails rendered as
file:///api/... (broken) and chatIsGif didn't know the gif-file shape, so
GIF messages showed as plain text. Applies the two veil-shell.js fixes:

  1. chatIsGif: add the /api/gif-file/<id> pattern
  2. drawer thumbnails: img src through chatAbs() (rides VEIL_ORIGIN)

Idempotent: re-running finds nothing to replace and exits 0.
"""
import sys

PATH = "/home/z/my-project/download/veil-offline.html"

OLD_ISGIF = """function chatIsGif(t) {
    t = String(t || "").trim();
    if (/^\\/gifs\\/[a-z0-9-]+\\.gif$/i.test(t)) return true;
    return /^https:\\/\\/media\\d*\\.giphy\\.com\\/media\\//i.test(t);
}"""
NEW_ISGIF = """function chatIsGif(t) {
    t = String(t || "").trim();
    if (/^\\/gifs\\/[a-z0-9-]+\\.gif$/i.test(t)) return true;
    if (/^\\/api\\/gif-file\\/[A-Za-z0-9_-]{4,32}(\\?|$)/.test(t)) return true;
    return /^https:\\/\\/media\\d*\\.giphy\\.com\\/media\\//i.test(t);
}"""

OLD_IMG = """cell.innerHTML = '<img src="' + chatEsc(g.preview) + '" alt="" loading="lazy" />';"""
NEW_IMG = """cell.innerHTML = '<img src="' + chatEsc(chatAbs(g.preview)) + '" alt="" loading="lazy" />';"""


def main() -> int:
    with open(PATH, "rb") as f:
        data = f.read().decode("utf-8", "surrogateescape")

    changed = 0
    for old, new, name in (
        (OLD_ISGIF, NEW_ISGIF, "chatIsGif"),
        (OLD_IMG, NEW_IMG, "drawer img src"),
    ):
        n = data.count(old)
        if n == 0:
            if new in data:
                print(f"[skip] {name}: already patched")
            else:
                print(f"[FAIL] {name}: pattern not found and patch absent")
                return 1
            continue
        data = data.replace(old, new)
        changed += n
        print(f"[ok] {name}: replaced {n} occurrence(s)")

    with open(PATH, "wb") as f:
        f.write(data.encode("utf-8", "surrogateescape"))
    print(f"done — {changed} replacement(s) written to {PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
