#!/bin/zsh
# Waits for the Codex usage limit to reset, then generates only the assets the 3D renderer uses.
cd "$(dirname "$0")/.."
ONLY=tex_grass,tex_dirt,tex_forest,tex_sand,tex_cursed,tex_water,sheet_icons
for i in {1..30}; do
  node tools/gen-assets.mjs --only $ONLY --concurrency 4 >> art/gen.log 2>&1
  missing=0; for n in ${(s:,:)ONLY}; do [[ -f art/raw/$n.png ]] || missing=$((missing+1)); done
  echo "3d pass $i missing=$missing $(date)" >> art/gen.log
  [[ $missing == 0 ]] && break
  sleep 600
done
node tools/process-assets.mjs >> art/gen.log 2>&1
echo TEXDONE >> art/gen.log
