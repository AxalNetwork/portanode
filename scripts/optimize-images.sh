#!/usr/bin/env bash
# Optimize images in assets/images. Requires: cwebp, avifenc, svgo (optional).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/assets/images}"
echo "Optimizing images under: $SRC"

shopt -s nullglob globstar

for f in "$SRC"/**/*.{png,jpg,jpeg}; do
  [ -e "$f" ] || continue
  base="${f%.*}"
  if command -v cwebp >/dev/null; then
    [ -f "$base.webp" ] || cwebp -quiet -q 82 "$f" -o "$base.webp"
  fi
  if command -v avifenc >/dev/null; then
    [ -f "$base.avif" ] || avifenc --min 24 --max 32 "$f" "$base.avif" >/dev/null
  fi
done

if command -v svgo >/dev/null; then
  svgo -f "$SRC" --quiet || true
  svgo -f "$ROOT/assets/logos" --quiet || true
fi

echo "Done."
