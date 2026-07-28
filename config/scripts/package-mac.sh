#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
ARCHITECTURE=x64
DRY_RUN=${MAM_PACKAGE_DRY_RUN:-0}

if [ "$#" -ne 0 ]; then
  echo "package-mac.sh does not accept arguments; x64 packaging is built in" >&2
  exit 2
fi

if [ "$DRY_RUN" != 1 ] && [ "$(uname -s)" != Darwin ]; then
  echo "macOS packages must be built on macOS" >&2
  exit 1
fi

run_step() {
  printf '> '
  printf '%s ' "$@"
  printf '\n'
  if [ "$DRY_RUN" != 1 ]; then
    "$@"
  fi
}

cd "$PROJECT_DIRECTORY"
run_step pnpm build
run_step pnpm exec electron-builder --mac zip "--$ARCHITECTURE" --publish never
run_step node config/scripts/create-mac-dmg.mjs --arch "$ARCHITECTURE"
