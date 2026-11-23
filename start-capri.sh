#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if [ -z "${CAPRI_NODE_PATH:-}" ]; then
  if [ -x "$APP_DIR/.runtime/node/bin/node" ]; then
    export CAPRI_NODE_PATH="$APP_DIR/.runtime/node/bin/node"
  elif command -v node >/dev/null 2>&1; then
    export CAPRI_NODE_PATH="$(command -v node)"
  else
    echo "Error: Node.js not found in .runtime or PATH." >&2
    exit 1
  fi
fi

export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-x11}"
export GDK_BACKEND="${GDK_BACKEND:-x11}"

exec npm start -- --no-sandbox
