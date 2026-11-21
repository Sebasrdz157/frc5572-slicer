#!/usr/bin/env bash
# Builds the Kiri:Moto slicing engine (https://github.com/GridSpace/grid-apps, MIT)
# and copies the browser bundles into site/engine and site/wasm.
#
# Usage: scripts/build-engine.sh [path-to-existing-grid-apps-checkout]
# Requires: git, node >= 22, npm, bash.
set -euo pipefail

# Pinned Kiri:Moto version. Bump this to pick up engine updates.
KIRI_REPO="https://github.com/GridSpace/grid-apps.git"
KIRI_COMMIT="d138275bbe9d4e4030d8cb8b2dcf66607da9295a"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/.kiri}"
OUT_ENGINE="$ROOT/site/engine"
OUT_WASM="$ROOT/site/wasm"

if [ ! -d "$SRC/.git" ]; then
  echo ">> cloning Kiri:Moto into $SRC"
  git clone --filter=blob:none "$KIRI_REPO" "$SRC"
  git -C "$SRC" checkout -q "$KIRI_COMMIT"
fi

cd "$SRC"
# npm scripts in grid-apps use POSIX shell syntax (mkdir -p, cp -R)
export npm_config_script_shell="${npm_config_script_shell:-$(command -v bash)}"

if [ ! -d node_modules ]; then
  echo ">> installing dependencies (no install scripts, skips electron download)"
  npm install --ignore-scripts --no-audit --no-fund
  # On Windows, git checks out symlinks as text files; this replaces them with copies.
  node bin/install-pre.js >/dev/null
fi

echo ">> building engine bundles"
npm run webpack-ext >/dev/null
node bin/esbuild.config.mjs prod

rm -rf "$OUT_ENGINE" "$OUT_WASM"
mkdir -p "$OUT_ENGINE" "$OUT_WASM"
cp src/pack/kiri-eng.js src/pack/kiri-work.js src/pack/kiri-pool.js "$OUT_ENGINE/"
cp src/wasm/kiri-geo.wasm src/wasm/kiri-sla.wasm src/wasm/manifold.wasm "$OUT_WASM/"
cp license.md "$OUT_ENGINE/LICENSE-kiri-moto.md"

# The engine fetches "/wasm/..." (site root) and "../wasm/..." (relative to the
# page). GitHub Pages serves this site from a sub-path (/frc5572-slicer/), so
# resolve every wasm URL against the bundle's own location instead:
# site/engine/*.js -> site/wasm/*.wasm
sed -i \
  -e 's#"/wasm/#"../wasm/#g' \
  -e 's#"\.\./wasm/\([A-Za-z0-9_-]*\.wasm\)"# (new URL("../wasm/\1",import.meta.url).href)#g' \
  "$OUT_ENGINE"/*.js
if grep -q -E '[^(]"(\.\.)?/wasm/' "$OUT_ENGINE"/*.js; then
  echo "!! unpatched wasm paths remain" >&2; exit 1
fi

echo "$KIRI_COMMIT" > "$OUT_ENGINE/VERSION"
echo ">> engine ready in site/engine ($(du -sh "$OUT_ENGINE" | cut -f1))"
