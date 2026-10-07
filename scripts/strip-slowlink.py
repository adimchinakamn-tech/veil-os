#!/usr/bin/env python3
"""Strip the slow-connect box's 'Open direct' ghost link from every front door.

The user asked for the direct-open affordance to be gone entirely — the
veil-cdn pill was removed first (strip-pill.py), this finishes the job by
removing, in every matching file:
  1. the <a class="btn ghost" id="slowLink" ...>Open direct</a> HTML line
  2. the .btn.ghost CSS rule (only used by the slowLink anchor)
  3. the armLinks ids array + call (nothing left to arm) — replaced with a
     no-op so the surrounding script stays syntactically intact.

The slow-connect box itself (message + Retry button) stays.
"""
import re
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")

# front-door files: root index.*, cdn/, site/, m1..m10/ (html + xhtml)
targets = []
for pat in ("index.html", "index.xhtml"):
    p = ROOT / pat
    if p.exists():
        targets.append(p)
for sub in ("cdn", "site", *[f"m{i}" for i in range(1, 11)]):
    d = ROOT / sub
    if not d.is_dir():
        continue
    for f in sorted(d.iterdir()):
        if f.is_file() and f.suffix in (".html", ".xhtml"):
            targets.append(f)

RE_HTML = re.compile(
    r'\n  <a class="btn ghost" id="slowLink"[^>]*>Open direct</a>',
)
RE_CSS = re.compile(
    r"\n  \.btn\.ghost\{[^}]*\}\n  \.btn\.ghost:hover\{[^}]*\}",
)
# armLinks body: replace the whole function with a no-op keeping the name
RE_ARMLINKS = re.compile(
    r"function armLinks\(U\) \{.*?\n  \}",
    re.DOTALL,
)

changed, skipped = [], []
for p in targets:
    try:
        text = p.read_text(encoding="utf-8")
    except Exception as e:
        skipped.append((p, f"read error: {e}"))
        continue
    orig = text
    text = RE_HTML.sub("", text)
    text = RE_CSS.sub("", text)
    text = RE_ARMLINKS.sub("function armLinks(U) { /* open-direct removed */ }", text)
    if text != orig:
        p.write_text(text, encoding="utf-8")
        changed.append(p)

# any file anywhere (repo, non-src) still carrying the anchor?
leftovers = []
for p in ROOT.rglob("*"):
    s = str(p)
    if any(
        x in s
        for x in (
            "/node_modules/", "/.git/", "/src/", "/.next/", "/mini-services/",
            "/backups/", "worklog", "strip-slowlink", "/db/", "/agent-ctx",
        )
    ):
        continue
    if p.is_file() and p.suffix in (".html", ".xhtml"):
        try:
            if 'id="slowLink"' in p.read_text(encoding="utf-8", errors="ignore"):
                leftovers.append(p)
        except Exception:
            pass

print(f"files scanned : {len(targets)}")
print(f"files changed : {len(changed)}")
print(f"read errors   : {len(skipped)}")
for p, why in skipped[:10]:
    print(f"  ! {p}: {why}")
print(f"slowLink leftovers: {len(leftovers)}")
for p in leftovers[:10]:
    print(f"  - {p}")
if leftovers:
    sys.exit(1)
print("OK")
