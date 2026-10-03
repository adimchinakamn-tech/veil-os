#!/usr/bin/env bash
# Prepare the Veil offline-pack assets at FULL ORIGINAL QUALITY.
#
# The previous encode (encode-offline-assets.sh) downscaled videos to
# 960x540 and statics to ≤1920w — that was the "quality drops in file
# mode" bug. This one:
#   videos  → re-encode at NATIVE resolution (4K where the source is 4K),
#             x264 CRF 20 (visually lossless), no audio, faststart
#   statics → copied byte-for-byte from public/ (zero loss, same bytes
#             the website itself serves)
#   thumbs  → small 480w previews for the gallery grid only
#
# Output: /tmp/veil-offline-assets  (wiped + rebuilt every run)
set -u
OUT=/tmp/veil-offline-assets
SRC=/home/z/my-project/public
mkdir -p "$OUT"
# NOTE: never wipes — finished encodes are skipped so the run can be
# chunked across multiple invocations (each tool call has a 10-min cap).

encode_video() {
  local file="$1" name="$2"
  if [ -s "$OUT/$name.mp4" ]; then
    # non-empty is NOT enough — an OOM-killed encode leaves a stub.
    # A valid output must probe to (nearly) the source's duration.
    local sd od
    sd=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC/$file" 2>/dev/null)
    od=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.mp4" 2>/dev/null)
    if [ -n "$sd" ] && [ -n "$od" ] && awk -v a="$od" -v b="$sd" 'BEGIN { exit !(a > b - 0.5) }'; then
      echo "skip $name (done: $(stat -c%s "$OUT/$name.mp4") bytes)"; return
    fi
    echo "redo $name (stub/partial detected: $(stat -c%s "$OUT/$name.mp4") bytes)"
    rm -f "$OUT/$name.mp4"
  fi
  # NOTE: this box has 3.9GB RAM and NO swap — plain "preset medium"
  # 4K x264 (40-frame lookahead + 3 refs ≈ 1GB+) gets OOM-killed by the
  # kernel mid-encode, leaving 48-byte stubs. The caps below hold the
  # encoder to ~200MB. CRF 23: looping backdrop video behind a dark
  # scrim — visually lossless there, ~1/3 smaller than CRF 20 (the
  # CRF-20 build hit 194MB and strained weak machines on reload).
  ffmpeg -y -v error -i "$SRC/$file" \
    -c:v libx264 -preset veryfast -x264-params rc-lookahead=10:ref=1:bframes=1 \
    -crf 23 -pix_fmt yuv420p -an \
    -movflags +faststart "$OUT/$name.mp4" </dev/null
  echo "video $name: $(stat -c%s "$OUT/$name.mp4") bytes"
}

copy_image() {
  local file="$1" name="$2" ext="${3:-}"
  if [ -s "$OUT/$name.$ext" ]; then echo "skip $name (done)"; return; fi
  cp "$SRC/$file" "$OUT/$name.$ext"
  echo "image $name: $(stat -c%s "$OUT/$name.$ext") bytes (raw copy)"
}

encode_thumb() {
  local file="$1" name="$2"
  if [ -s "$OUT/thumb-$name.jpg" ]; then return; fi
  # -frames:v 1: image2 muxer errors ("Cannot write more than one file
  # with the same name") when a multi-frame input hits a plain filename.
  ffmpeg -y -v error -i "$SRC/$file" -vf "scale='min(480,iw)':-2" \
    -frames:v 1 -q:v 5 "$OUT/thumb-$name.jpg" </dev/null
}

# ---- videos (native resolution: 3840x2160 / 2160x3840 / 1080x1920) ----
encode_video wp-backrooms.mp4           backrooms
encode_video wp-cherry-blossom.mp4      cherry-blossom
encode_video wp-trionda-ball.mp4        trionda-ball
encode_video wp-minecraft-earth.mp4     minecraft-earth
encode_video wp-minecraft-fireplace.mp4 minecraft-fireplace
encode_video wp-spiderman-gravity.mp4   spiderman-gravity
encode_video wp-mobile-video.mp4        mobile-video
encode_video wp-mobile-video2.mp4       mobile-video2

# ---- static images: raw copies (no re-encode, no downscale) ----
copy_image wp-aluminium.jpg        aluminium   jpg
copy_image wp-apocalyptic.png      apocalyptic png
copy_image wp-cubes.jpg            cubes       jpg
copy_image wp-jellyfish.jpg        jellyfish   jpg
copy_image wp-lake.jpg             lake        jpg
copy_image wp-minecraft-bee.png    minecraft-bee png
copy_image wp-minecraft-blocks.jpg minecraft-blocks jpg
copy_image wp-spiderman.jpg        spiderman   jpg
copy_image wp-neon-aurora.png      neon-aurora png

# ---- thumbs (grid previews only — full quality lives in the srcs) ----
encode_thumb wp-backrooms.mp4           backrooms
encode_thumb wp-cherry-blossom.mp4      cherry-blossom
encode_thumb wp-trionda-ball.mp4        trionda-ball
encode_thumb wp-minecraft-earth.mp4     minecraft-earth
encode_thumb wp-minecraft-fireplace.mp4 minecraft-fireplace
encode_thumb wp-spiderman-gravity.mp4   spiderman-gravity
encode_thumb wp-mobile-video.mp4        mobile-video
encode_thumb wp-mobile-video2.mp4       mobile-video2
encode_thumb wp-neon-aurora.png         neon-aurora
encode_thumb wp-cubes.jpg               cubes
encode_thumb wp-jellyfish.jpg           jellyfish
encode_thumb wp-lake.jpg                lake
encode_thumb wp-minecraft-bee.png       minecraft-bee
encode_thumb wp-minecraft-blocks.jpg    minecraft-blocks
encode_thumb wp-spiderman.jpg           spiderman
encode_thumb wp-aluminium.jpg           aluminium
encode_thumb wp-apocalyptic.png         apocalyptic

echo "TOTAL: $(du -sb "$OUT" | cut -f1) bytes"
echo "ALL-DONE"
