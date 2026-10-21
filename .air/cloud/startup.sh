#!/usr/bin/env bash
# Air cloud startup: install dependencies for Skill Atlas (Node >= 24 CLI, TypeScript run natively
# by Node) and, on the snapshot-baking warmup run, prove the environment the way CI does.
set -euo pipefail

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

cd "$(dirname "$0")/../.."

# The environment, not the code (CI tests that): the toolchain typechecks, the real CLI runs on the
# fixture repository, Chromium launches, ffmpeg runs.
healthcheck() {
  echo "[healthcheck] typecheck"
  npm run typecheck
  echo "[healthcheck] CLI smoke on ./fixture"
  ./skill-atlas help >/dev/null
  ./skill-atlas scan ./fixture
  echo "[healthcheck] chromium launches"
  node -e "const { chromium } = await import('@playwright/test'); await (await chromium.launch()).close()"
  echo "[healthcheck] ffmpeg runs"
  ffmpeg -version >/dev/null
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

# Chromium for the browser tests (npm run test:web), as CI installs it: the browser into the
# user's cache, its system libraries through apt, which needs root
echo "[startup] playwright chromium"
npx playwright install chromium
if [ "$(id -u)" -eq 0 ]; then
  npx playwright install-deps chromium
else
  sudo -n env PATH="$PATH" npx playwright install-deps chromium
fi
echo "[startup] chromium installed"

# ffmpeg for the demos (npm run demo): the waits a demo plays faster (faster() in demos/demo.ts)
if ! command -v ffmpeg >/dev/null; then
  echo "[startup] ffmpeg"
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update && apt-get install --yes --no-install-recommends ffmpeg
  else
    sudo -n apt-get update && sudo -n apt-get install --yes --no-install-recommends ffmpeg
  fi
  echo "[startup] ffmpeg installed"
fi

if [ -n "$WARMUP" ]; then healthcheck; fi
echo "[startup] done"
