#!/usr/bin/env bash
# Air cloud startup: install dependencies for Skill Atlas (Node >= 24 CLI, TypeScript run natively
# by Node) and, on the snapshot-baking warmup run, prove the environment the way CI does.
set -euo pipefail

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

cd "$(dirname "$0")/../.."

# The same checks CI runs: typecheck, tests, and the real CLI on the fixture repository.
healthcheck() {
  echo "[healthcheck] typecheck"
  npm run typecheck
  echo "[healthcheck] tests"
  npm test
  echo "[healthcheck] CLI smoke on ./fixture"
  ./skill-atlas help >/dev/null
  ./skill-atlas scan ./fixture
  echo "[healthcheck] OK"
}

node_major="$(node -p 'process.versions.node.split(".")[0]')"
echo "[startup] node $(node -v), npm $(npm -v)"
if [ "$node_major" -lt 24 ]; then
  echo "[startup] package.json requires node >= 24, found $(node -v)" >&2
  exit 1
fi

echo "[startup] npm ci"
npm ci --no-audit --no-fund
echo "[startup] dependencies installed"

if [ -n "$WARMUP" ]; then healthcheck; fi
echo "[startup] done"
