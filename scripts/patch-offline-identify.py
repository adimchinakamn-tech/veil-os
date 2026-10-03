#!/usr/bin/env python3
"""Patch download/veil-offline.html in place: the chat relay now REQUIRES a
signed session token on `identify` (anti-impersonation hardening, 2026-09-23)
and derives identity from the token, ignoring client-claimed fields. The
offline file's embedded socket code still sent the old client-claimed
identity block — the relay would reject it and the socket would sit mute.
Applies the same fix as scripts/veil-shell.js:

  identify emit: accountId/username/... block → { token: CHAT.token }

Also drops the dead `sockOk`-independent poll fallback line? No — untouched.
Idempotent: re-running finds nothing to replace and exits 0.
"""
import sys

PATH = "/home/z/my-project/download/veil-offline.html"

OLD = """s.emit("identify", {
                accountId: CHAT.account.id,
                username: CHAT.account.username,
                displayName: CHAT.account.displayName || CHAT.account.username,
                avatarColor: CHAT.account.avatarColor || "#f97316",
                avatarImage: CHAT.account.avatarImage || null
            });"""
NEW = """s.emit("identify", { token: CHAT.token });"""


def main() -> int:
    with open(PATH, "rb") as f:
        data = f.read().decode("utf-8", "surrogateescape")

    n = data.count(OLD)
    if n == 0:
        # Already patched (or the shape changed) — check for the new form.
        if NEW in data:
            print("already patched — nothing to do")
            return 0
        print("PATTERN NOT FOUND — offline file identify block not matched; aborting without changes")
        return 1

    data = data.replace(OLD, NEW)
    with open(PATH, "wb") as out:
        out.write(data.encode("utf-8", "surrogateescape"))
    print(f"patched {n} occurrence(s): identify emit now sends the signed token")
    return 0


if __name__ == "__main__":
    sys.exit(main())
