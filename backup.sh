#!/usr/bin/env bash
# ============================================================================
# Veil — snapshot backup system (v2, post-revert redesign).
#
# WHY THIS DESIGN: the sandbox reverts the project folder to older snapshots
# WITHOUT WARNING (observed twice). Empirically, /home/z/my-project/upload/
# is root-owned user-content storage that SURVIVES every revert (the Sep-7
# recovery tarball itself is the proof), while in-project folders
# (including ./backups) are wiped with everything else.
#
# So every snapshot is written to BOTH:
#   1. upload/veil-snapshots/   ← the revert-proof location (primary)
#   2. backups/                 ← in-project convenience copy (secondary)
# plus a fixed-name panic copy:
#   3. upload/veil-latest.tar.gz  (always the most recent snapshot)
#
# Usage:
#   bash scripts/backup.sh            manual snapshot
#   bash scripts/backup.sh auto       loop mode — skips when nothing changed
#   bash scripts/restore.sh           list + restore (interactive)
#
# NOTE: the old "git commit" layer was REMOVED (2026-09-22): it had grown
# .git to 5.3G by committing wallpaper binaries every manual snapshot and
# provided no real protection (a platform revert wipes .git with everything
# else — observed twice). The tar snapshots above ARE the backup.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
MODE="${1:-manual}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# ---- destinations ----------------------------------------------------------
UPDIR="$ROOT/upload/veil-snapshots"    # survives reverts (root-owned tree)
INDIR="$ROOT/backups"                  # in-project copy
mkdir -p "$UPDIR" "$INDIR" 2>/dev/null

# ---- what gets snapshotted -------------------------------------------------
# Source, config, database, services, docs. Wallpaper MEDIA is excluded on
# purpose (193 MB, byte-identical copies of upload/sulfur-wallpapers-*.zip
# — recoverable via scripts/restore-wallpapers.sh).
SNAPSHOT_DIRS=(
  src
  prisma
  db
  mini-services
  scripts
  public
  tests
  examples
)
SNAPSHOT_FILES=(
  worklog.md
  package.json
  next.config.ts
  tsconfig.json
  tailwind.config.ts
  postcss.config.mjs
  eslint.config.mjs
  components.json
  Caddyfile
  .env
)

EXCLUDES=(
  --exclude='node_modules'
  --exclude='.next'
  --exclude='tool-results'
  --exclude='.mbgs-cache'
  --exclude='public/wp-*.mp4'
  --exclude='public/wp-*.jpg'
  --exclude='public/wp-*.png'
  --exclude='public/wp-prev'
  --exclude='public/gifs'
  --exclude='download'
  --exclude='upload/veil-chat-files'
  --exclude='*.log'
  --exclude='.DS_Store'
)

# ---- change detection (auto mode) ------------------------------------------
content_hash() {
  tar -cf - "${EXCLUDES[@]}" --sort=name --mtime="@0" \
    "${SNAPSHOT_DIRS[@]}" "${SNAPSHOT_FILES[@]}" 2>/dev/null | md5sum | cut -d' ' -f1
}

LATEST_UP="$(ls -1t "$UPDIR"/veil-2*.tar.gz 2>/dev/null | head -1 || true)"
if [ "$MODE" = "auto" ] && [ -n "$LATEST_UP" ]; then
  NEW_HASH="$(content_hash)"
  OLD_HASH="$(cat "${LATEST_UP}.hash" 2>/dev/null || echo none)"
  if [ "$NEW_HASH" = "$OLD_HASH" ]; then
    exit 0
  fi
fi

# ---- build the snapshot ----------------------------------------------------
FILE="veil-$STAMP.tar.gz"
ARGS=()
for d in "${SNAPSHOT_DIRS[@]}"; do   [ -e "$d" ] && ARGS+=("$d"); done
for f in "${SNAPSHOT_FILES[@]}"; do  [ -f "$f" ] && ARGS+=("$f"); done

[ ${#ARGS[@]} -eq 0 ] && { echo "backup: nothing to snapshot?" >&2; exit 1; }

tar -czf "$UPDIR/$FILE" "${EXCLUDES[@]}" "${ARGS[@]}" || {
  echo "backup: tar failed" >&2; exit 1; }
cp -f "$UPDIR/$FILE" "$INDIR/$FILE" 2>/dev/null || true
cp -f "$UPDIR/$FILE" "$ROOT/upload/veil-latest.tar.gz" 2>/dev/null || true
content_hash > "$UPDIR/$FILE.hash" 2>/dev/null || true

# Plain-text worklog copy next to the snapshots (grep-able without tar).
cp -f "$ROOT/worklog.md" "$UPDIR/worklog.md" 2>/dev/null || true

# ---- recovery kit (the revert-proof toolbox) --------------------------------
# The scripts that REBUILD this project, stored INSIDE the revert-proof
# upload tree: even if scripts/ is wiped wholesale, veil-kit + the
# snapshots can resurrect everything (auto-restore uses them).
KIT="$ROOT/upload/veil-kit"
if mkdir -p "$KIT" 2>/dev/null; then
  for f in backup.sh backup-loop.sh restore.sh veil-start.sh veil-keeper.sh \
           prepare-offline-assets.sh build-veil.mjs veil-shell.html \
           veil-shell.js veil-shell.css veil-ext-packs.json; do
    [ -f "$ROOT/scripts/$f" ] && cp -f "$ROOT/scripts/$f" "$KIT/$f" 2>/dev/null || true
  done
  # the app sources that build packs: sulfur packets + gn-math games
  for d in sulfur-apps gnmath-apps; do
    if [ -d "$ROOT/scripts/$d" ]; then
      mkdir -p "$KIT/$d" 2>/dev/null
      cp -f "$ROOT/scripts/$d"/*.html "$KIT/$d/" 2>/dev/null || true
    fi
  done
  # the canonical keeper + auto-restore live at upload/ root already;
  # keep kit copies fresh too
  [ -f "$ROOT/upload/veil-keeper.sh" ] && cp -f "$ROOT/upload/veil-keeper.sh" "$KIT/veil-keeper.sh" 2>/dev/null || true
  [ -f "$ROOT/upload/veil-auto-restore.sh" ] && cp -f "$ROOT/upload/veil-auto-restore.sh" "$KIT/veil-auto-restore.sh" 2>/dev/null || true
fi

# ---- rotation ---------------------------------------------------------------
keep_n() { # $1 dir, $2 keep count
  ls -1t "$1"/veil-2*.tar.gz 2>/dev/null | tail -n +$(( $2 + 1 )) | while read -r old; do
    rm -f "$old" "$old.hash" "$1/.hash-$(basename "$old")" 2>/dev/null
  done
}
keep_n "$UPDIR" 2    # disk-aware: ~230MB each
keep_n "$INDIR" 1


echo "backup: $FILE ($(du -h "$UPDIR/$FILE" | cut -f1)) → upload/veil-snapshots + backups/ + veil-latest"
