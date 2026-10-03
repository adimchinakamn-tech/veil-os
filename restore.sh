#!/usr/bin/env bash
# ============================================================================
# Veil — restore a snapshot (the panic button).
#
# Usage:
#   bash scripts/restore.sh                # list snapshots, restore newest
#   bash scripts/restore.sh <file.tar.gz>  # restore a specific snapshot
#   bash scripts/restore.sh wallpapers     # re-extract the wallpaper pack
#
# Search order: upload/veil-snapshots (revert-proof), then backups/, then
# upload/veil-latest.tar.gz.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
UP="$ROOT/upload/veil-snapshots"
IN="$ROOT/backups"

list_snapshots() {
  { ls -1t "$UP"/veil-2*.tar.gz 2>/dev/null; ls -1t "$IN"/veil-2*.tar.gz 2>/dev/null; } | sort -u
}

restore_file() {
  local f="$1"
  [ -f "$f" ] || { echo "restore: no such file: $f" >&2; exit 1; }
  echo "restore: extracting $(basename "$f") …"
  tar -xzf "$f" -C "$ROOT" || { echo "restore: extraction failed" >&2; exit 1; }
  echo "restore: files are back. Next steps:"
  echo "  1. bun run db:push        # re-sync the prisma client/schema"
  echo "  2. restart the dev server # bun run dev (or scripts/veil-start.sh)"
  echo "  3. bash scripts/backup.sh # snapshot the restored state again"
}

case "${1:-}" in
  wallpapers)
    # Re-extract the wallpaper pack from the original upload zips.
    mkdir -p "$ROOT/public" /tmp/wp-extract
    cd /tmp/wp-extract || exit 1
    for z in "$ROOT"/upload/sulfur-wallpapers-*.zip; do
      [ -f "$z" ] && unzip -oq "$z" -d . 2>/dev/null
    done
    mv public/wp-* "$ROOT/public/" 2>/dev/null
    # 720p hover previews are NOT in the zips — regenerate if missing.
    cd "$ROOT" || exit 1
    mkdir -p public/wp-prev
    for f in public/wp-*.mp4; do
      [ -f "$f" ] || continue
      name="$(basename "$f" .mp4)"
      out="public/wp-prev/$name.mp4"
      if [ ! -s "$out" ]; then
        ffmpeg -y -v error -i "$f" -vf "scale='min(1280,iw)':-2" -an \
          -c:v libx264 -preset veryfast -crf 26 -movflags +faststart -threads 2 \
          "$out" 2>/dev/null && echo "preview: $name"
      fi
    done
    echo "wallpapers: $(ls public/wp-* 2>/dev/null | grep -c 'wp-') files restored."
    ;;
  "")
    # No argument: list + restore the newest.
    BEST="$(list_snapshots | head -1)"
    if [ -z "$BEST" ]; then
      # Fall back to the panic copy.
      if [ -f "$ROOT/upload/veil-latest.tar.gz" ]; then
        restore_file "$ROOT/upload/veil-latest.tar.gz"
        exit 0
      fi
      echo "restore: no snapshots found. Locations checked:" \
           "$UP, $IN, upload/veil-latest.tar.gz" >&2
      exit 1
    fi
    echo "Available snapshots (newest first):"
    list_snapshots | head -10 | sed 's|^|  |'
    echo "→ restoring $BEST"
    restore_file "$BEST"
    ;;
  *)
    # Explicit file (accepts a bare name from any snapshot dir or a path).
    for cand in "$ROOT/$1" "$UP/$1" "$IN/$1"; do
      if [ -f "$cand" ]; then restore_file "$cand"; exit 0; fi
    done
    echo "restore: '$1' not found in ./, $UP, $IN" >&2
    exit 1
    ;;
esac
