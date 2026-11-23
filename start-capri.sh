#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  printf 'This preview uses Linux x86-64.\n' >&2
  exit 1
fi
if [[ -z "${DISPLAY:-}" ]]; then
  printf 'Start Capri from a desktop session with X11 or XWayland.\n' >&2
  exit 1
fi

node_path="${CAPRI_NODE_PATH:-$(command -v node || true)}"
if [[ "$node_path" != /* || ! -x "$node_path" ]] ||
   ! "$node_path" -e 'const [major, minor, patch] = process.versions.node.split(".").map(Number); process.exit(major === 24 && (minor > 22 || (minor === 22 && patch >= 1)) ? 0 : 1)'; then
  printf 'Install Node.js 24.22.1 or a newer 24.x release and add node to PATH.\n' >&2
  exit 1
fi
export CAPRI_NODE_PATH="$node_path"

exec "$CAPRI_NODE_PATH" packages/runtime/bin/capri.mjs desktop --wait "$@"
