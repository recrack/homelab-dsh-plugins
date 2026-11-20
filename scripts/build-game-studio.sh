#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root/packages/dsh-game-studio"
npm ci --ignore-scripts
npm run build
npm prune --omit=dev --ignore-scripts
