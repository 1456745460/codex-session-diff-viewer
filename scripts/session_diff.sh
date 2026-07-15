#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/assets/app"
NODE_BIN="${NODE_BIN:-node}"
if [[ ! -d "$APP/node_modules" ]]; then
  (cd "$APP" && npm install --silent --no-fund --no-audit)
fi
exec "$NODE_BIN" "$APP/bin/cli.js" "$@"
