#!/usr/bin/env bash
# Regenerate the 17 local-pack wallpapers (the source zips were lost in
# the archive transfer). Statics come straight from AI image generation;
# video wallpapers are built as slow Ken-Burns zoom loops from a generated
# master frame (subtle ambient motion — the intended vibe for backdrops).
set -u
GEN=/tmp/wp-gen
SRC=/home/z/my-project/public
mkdir -p "$GEN"

gen() { # key, prompt
  local key="$1" prompt="$2"
  if [ -s "$GEN/$key.png" ]; then echo "skip $key (generated)"; return; fi
  z-ai image -p "$prompt" -o "$GEN/$key.png" -s 1344x768 >/dev/null 2>&1 && \
    echo "gen $key ok ($(stat -c%s "$GEN/$key.png") bytes)" || \
    echo "gen $key FAILED"
}

# ---- the 8 "video" wallpapers (master frames) ----
gen backrooms "Liminal backrooms hallway, endless yellow walls and moist carpet, buzzing fluorescent ceiling lights, eerie empty office maze, wide shot, cinematic, high quality, detailed"
gen cherry-blossom "Cherry blossom tree branch canopy, pink petals drifting on the wind, soft spring sunlight bokeh, serene aesthetic, wide composition, high quality, detailed"
gen trionda-ball "Abstract 3D render of a large glossy geometric sphere rolling over dark reflective surface, neon rim light, rolling geometry, minimal abstract, high quality, detailed"
gen minecraft-earth "Planet Earth built entirely of minecraft-style voxel blocks floating in space, blocky green continents and blue oceans, rotating world, game render style, high quality, detailed"
gen minecraft-fireplace "Cozy minecraft-style blocky stone fireplace with crackling orange fire and embers, warm cabin interior made of wood cubes, game render, high quality, detailed"
gen spiderman-gravity "Stylized comic superhero in red and blue suit falling through sky headfirst with arms back, dramatic clouds rushing past, city far below, dynamic pose, comic art, high quality"
gen mobile-video "Ambient abstract gradient drift, slow soft flowing pastel waves of light, dreamy aesthetic motion still, minimal, high quality"
gen mobile-video2 "Ambient abstract aurora of deep teal and violet light ribbons flowing across darkness, dreamy aesthetic motion still, minimal, high quality"

# ---- the 9 static wallpapers ----
gen neon-aurora "Vivid neon aurora borealis over snowy mountain silhouette, electric green and purple sky, starfield, long exposure, high quality, detailed"
gen cubes "Isometric 3D cube field pattern, calm pastel geometric blocks grid, soft studio lighting, abstract isometric calm, high quality, detailed"
gen jellyfish "Glowing bioluminescent jellyfish drifting in deep dark ocean water, luminous lanterns of the sea, underwater photography, high quality, detailed"
gen lake "Perfectly still mirror lake at dawn reflecting mountains and mist, glassy water surface, serene nature photography, high quality, detailed"
gen minecraft-bee "Cute minecraft-style blocky bee resting on a pixel flower, bright cheerful sky, game render, high quality, detailed"
gen minecraft-blocks "Minecraft-style blocky terrain landscape with grass cubes, dirt layers and stone, bright day, game render, high quality, detailed"
gen spiderman "Stylized comic book inked superhero portrait in red mask with web pattern, bold black ink lines, halftone shading, pop art, high quality"
gen aluminium "Liquid aluminium molten chrome metal waves macro, flowing silver metallic surface with reflections, abstract, high quality, detailed"
gen apocalyptic "Post-apocalyptic ruined city skyline at dusk, crumbling skyscrapers, dark fantasy atmosphere, dramatic orange haze, high quality, detailed"

# ---- place the statics with the exact extensions the catalog expects ----
for pair in neon-aurora:png cubes:jpg jellyfish:jpg lake:jpg minecraft-bee:png minecraft-blocks:jpg spiderman:jpg aluminium:jpg apocalyptic:png; do
  key="${pair%%:*}"; ext="${pair##*:}"
  if [ -s "$SRC/wp-$key.$ext" ]; then echo "static $key already placed"; continue; fi
  if [ -s "$GEN/$key.png" ]; then
    if [ "$ext" = "jpg" ]; then
      ffmpeg -y -v error -i "$GEN/$key.png" -q:v 3 "$SRC/wp-$key.jpg" </dev/null && echo "placed $key.jpg"
    else
      cp "$GEN/$key.png" "$SRC/wp-$key.png" && echo "placed $key.png"
    fi
  fi
done

# ---- build the 8 video wallpapers (slow zoom loop, 12s, seamless) ----
mkdir -p "$SRC/wp-prev" "$SRC/wp-thumbs"
for key in backrooms cherry-blossom trionda-ball minecraft-earth minecraft-fireplace spiderman-gravity mobile-video mobile-video2; do
  if [ ! -s "$GEN/$key.png" ]; then echo "no master frame for $key"; continue; fi
  if [ ! -s "$SRC/wp-$key.mp4" ]; then
    ffmpeg -y -v error -loop 1 -i "$GEN/$key.png" \
      -vf "scale=2880:-2,zoompan=z='min(1.0+0.0009*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=360:s=1920x960:fps=30" \
      -t 12 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an \
      -movflags +faststart "$SRC/wp-$key.mp4" </dev/null && echo "video $key: $(stat -c%s "$SRC/wp-$key.mp4") bytes"
  fi
  # 720p hover-preview sibling
  if [ -s "$SRC/wp-$key.mp4" ] && [ ! -s "$SRC/wp-prev/$key.mp4" ]; then
    ffmpeg -y -v error -i "$SRC/wp-$key.mp4" -vf "scale=1280:-2" \
      -c:v libx264 -preset veryfast -crf 26 -an -movflags +faststart \
      "$SRC/wp-prev/$key.mp4" </dev/null && echo "prev $key ok"
  fi
done

# ---- 480w thumbs for the section grid (every key) ----
for f in "$SRC"/wp-*.{png,jpg,mp4}; do
  [ -s "$f" ] || continue
  base="$(basename "$f")"; key="${base#wp-}"; key="${key%.*}"
  [ -s "$SRC/wp-thumbs/$key.jpg" ] && continue
  ffmpeg -y -v error -i "$f" -vf "scale='min(480,iw)':-2" -frames:v 1 -q:v 5 \
    "$SRC/wp-thumbs/$key.jpg" </dev/null && echo "thumb $key ok"
done

echo "DONE: $(ls "$SRC"/wp-*.mp4 2>/dev/null | wc -l) videos, $(ls "$SRC"/wp-*.{png,jpg} 2>/dev/null | wc -l) statics, $(ls "$SRC"/wp-thumbs 2>/dev/null | wc -l) thumbs"
