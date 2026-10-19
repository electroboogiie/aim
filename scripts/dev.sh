#!/usr/bin/env bash
# Local run: build, then start the server with data in ./data (PORT, KP_ADMIN_TOKEN etc. from the environment).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
bash scripts/build.sh
export KP_DATA_DIR="${KP_DATA_DIR:-$root/data}"
export KP_ADMIN_TOKEN="${KP_ADMIN_TOKEN:-dev-admin}"
mkdir -p "$KP_DATA_DIR"
exec node build/server/src/main.js
