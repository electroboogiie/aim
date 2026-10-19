#!/usr/bin/env bash
# Build: core + server -> build/, core + web -> web/dist/ (CONTRACTS §1).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -e node_modules/@types/node/package.json ]; then
  bash scripts/setup-local.sh
fi
if [ -x node_modules/.bin/tsc ]; then tsc=node_modules/.bin/tsc; else tsc=tsc; fi

rm -rf build web/dist
"$tsc" -p tsconfig.core.json        # core must not use Node or DOM APIs
"$tsc" -p tsconfig.server.json
"$tsc" -p tsconfig.web.json

mkdir -p web/dist
for f in index.html styles.css manifest.webmanifest sw.js; do
  if [ -f "web/$f" ]; then cp "web/$f" "web/dist/$f"; fi
done
for d in icons media; do
  if [ -d "web/$d" ]; then cp -R "web/$d" "web/dist/$d"; fi
done
echo "build: ok"
