#!/usr/bin/env bash
# Local setup without npm: link the globally installed @types/node into node_modules/@types.
# In CI and Docker `npm install` provides it and this script does nothing.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${KP_TYPES_NODE:-/opt/node-tools/node_modules/@types/node}"
dst="$root/node_modules/@types/node"
if [ -e "$dst/package.json" ]; then
  exit 0
fi
if [ ! -f "$src/package.json" ]; then
  echo "setup-local: @types/node не знайдено ні в node_modules, ні в $src; виконайте npm install" >&2
  exit 1
fi
mkdir -p "$root/node_modules/@types"
rm -f "$dst"
ln -s "$src" "$dst"
echo "setup-local: node_modules/@types/node -> $src"
