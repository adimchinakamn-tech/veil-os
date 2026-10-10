#!/usr/bin/env python3
"""Strip the '#pill' (veil-cdn · open direct) element from every front door.

Removes, in every matching file:
  1. the <a id="pill" ...> ... </a> HTML block (plus trailing blank line)
  2. the #pill{...} / #pill:hover{...} / #pill .v{...} CSS rules
  3. the "pill" entry from the armLinks ids array (slowLink fallback stays)
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
    r'\n?\n?<a id="pill"[^>]*>.*?</a>\n',
    re.DOTALL,
)
RE_CSS = re.compile(
    r"\n  #pill\{.*?\}\n  #pill:hover\{[^}]*\}\n  #pill \.v\{[^}]*\}",
    re.DOTALL,
)
RE_IDS = re.compile(r'var ids = \["pill", "slowLink"\];')

changed, skipped = [], []
for p in targets:
    try:
        text = p.read_text(encoding="utf-8")
    except Exception as e:
        skipped.append((p, f"read error: {e}"))
        continue
    orig = text
    text = RE_HTML.sub("\n", text)
    text = RE_CSS.sub("", text)
    text = RE_IDS.sub('var ids = ["slowLink"];', text)
    if text != orig:
        p.write_text(text, encoding="utf-8")
        changed.append(p)

# any file anywhere (repo, non-src) still mentioning the pill?
leftovers = []
for p in ROOT.rglob("*"):
    s = str(p)
    if any(
        x in s
        for x in (
            "/node_modules/", "/.git/", "/src/", "/.next/", "/mini-services/",
            "/backups/", "worklog", "strip-pill", "/db/", "/agent-ctx",
        )
    ):
        continue
    if p.is_file() and p.suffix in (".html", ".xhtml"):
        try:
            if 'id="pill"' in p.read_text(encoding="utf-8", errors="ignore"):
                leftovers.append(p)
        except Exception:
            pass

print(f"files scanned : {len(targets)}")
print(f"files changed : {len(changed)}")
print(f"read errors   : {len(skipped)}")
for p, why in skipped[:10]:
    print(f"  ! {p}: {why}")
print(f"pill leftovers: {len(leftovers)}")
for p in leftovers[:10]:
    print(f"  - {p}")
if leftovers or not changed:
    sys.exit(1)
print("OK")
