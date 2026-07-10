#!/usr/bin/env bash
# Syncs the backend folder + a portable Node binary into src-tauri/resources/,
# where Tauri picks them up as bundled resources. Run before `cargo tauri build`
# (and any time backend code or node_modules change).
#
# Why a copy: Tauri's bundle.resources cannot easily reach sibling folders or
# strip subdirectories. Keeping a synced mirror under src-tauri/resources/ is
# simpler than fighting bundle path semantics. The mirror is gitignored.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$ROOT/src-tauri/resources"

echo "→ Syncing backend → $RESOURCES/backend"
mkdir -p "$RESOURCES/backend"
rsync -a --delete \
  --exclude tests \
  --exclude '*.db' \
  --exclude '*.db-*' \
  --exclude jest.config.js \
  --exclude '.env*' \
  "$ROOT/backend/" "$RESOURCES/backend/"

echo "→ Copying node binary → $RESOURCES/node/node"
mkdir -p "$RESOURCES/node"
# Use the currently-installed Node so the bundled binary matches the version
# better-sqlite3 was compiled against.
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found in PATH. Install Node first." >&2
  exit 1
fi
cp "$NODE_BIN" "$RESOURCES/node/node"
chmod +x "$RESOURCES/node/node"

echo "✓ Done. Resources ready at: $RESOURCES"
du -sh "$RESOURCES/backend" "$RESOURCES/node"
