#!/bin/zsh
# Usage: tools/gen.sh <out.png> "<prompt>" [reference.png]
# Generates one image with the Codex CLI image generator and copies it to <out.png>.
OUT="$1"; PROMPT="$2"; REF="$3"
CODEX="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex}"
DIR="$(cd "$(dirname "$OUT")" && pwd)"; ABS="$DIR/$(basename "$OUT")"
ARGS=(exec --skip-git-repo-check -s workspace-write -c model_reasoning_effort="low" -C "$DIR")
[[ -n "$REF" ]] && ARGS+=(-i "$REF")
"$CODEX" "${ARGS[@]}" -- "Use your image generation tool to create exactly ONE image. Do not write any code. ${PROMPT}
After the image is generated, copy the resulting png file to exactly this path: ${ABS} and print the path." > "$ABS.log" 2>&1
[[ -f "$ABS" ]] && echo "OK $ABS" || echo "FAIL $ABS (see $ABS.log)"
