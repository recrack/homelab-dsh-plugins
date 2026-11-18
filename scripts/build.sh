#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

node "$root/scripts/install-open-artifacts.mjs"

node "$root/packages/dsh-family-account/scripts/build-client.mjs"
pnpm --dir "$root/packages/dsh-browser" install --frozen-lockfile
pnpm --dir "$root/packages/dsh-browser" run build
pnpm --dir "$root/packages/dsh-crew" install --prod --frozen-lockfile
npm install --prefix "$root/packages/dsh-context" --omit=dev --ignore-scripts --legacy-peer-deps --no-package-lock
