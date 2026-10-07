# Quasar site-fix packs (v2.1.0)

Drop `*.json` files in this directory to add or override per-site fixes
without touching the engine. Each file holds one fix object or an array of
them. Changes hot-reload within 30 seconds (or force with
`POST /api/debug {"op":"reload-fixes"}`).

## Format

```json
{
  "id": "my-site",
  "match": ["example.com", "examplecdn.com"],
  "requestHeaders": { "user-agent": "..." },
  "stripRequestHeaders": ["x-forwarded-for"],
  "flags": { "noAst": false, "noStream": false, "noJsonMedia": false, "virtLoc": false },
  "clientHooks": ["fixHasFocus", "fakeNotifications", "pmOrigins"],
  "note": "why this fix exists"
}
```

## Rules

- `match` is required — hostname suffixes, longest match wins across all
  entries (pack entries beat built-ins on exact-length ties).
- `flags.noAst` drops the site back to runtime hooks (escape hatch when the
  acorn rewriter breaks a bundle).
- `flags.virtLoc` enables the virtual `location` layer (see js-ast.ts) —
  needed by webpack-era SPAs that read `location.origin` at boot; may be
  seen through by `location === window.location` identity checks.
- `clientHooks` names must exist in hooks.ts CLIENT_FIXES; unknown names are
  dropped.
- Everything is validated + length-capped; malformed files are skipped with
  a log line and can never crash the proxy.

This file is markdown, so the loader ignores it — use it as a template.
