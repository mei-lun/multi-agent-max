#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
ARCHITECTURE=x64
DRY_RUN=${MAM_PACKAGE_DRY_RUN:-0}
MAX_BUILDER_ATTEMPTS=3

if [ -n "${MAM_ELECTRON_MIRROR:-}" ]; then
  ELECTRON_MIRROR=$MAM_ELECTRON_MIRROR
  export ELECTRON_MIRROR
fi

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

run_builder_with_retry() {
  if [ "$DRY_RUN" = 1 ]; then
    run_step "$@"
    return
  fi
  retry_attempt=1
  while [ "$retry_attempt" -le "$MAX_BUILDER_ATTEMPTS" ]; do
    printf '> '
    printf '%s ' "$@"
    printf '(attempt %s/%s)\n' "$retry_attempt" "$MAX_BUILDER_ATTEMPTS"
    if "$@"; then
      return
    fi
    if [ "$retry_attempt" -eq "$MAX_BUILDER_ATTEMPTS" ]; then
      echo 'Electron packaging failed after three attempts.' >&2
      echo 'Set MAM_ELECTRON_MIRROR to a trusted Electron mirror and retry if GitHub is unreachable.' >&2
      return 1
    fi
    sleep "$retry_attempt"
    retry_attempt=$((retry_attempt + 1))
  done
}

cd "$PROJECT_DIRECTORY"
run_step pnpm build
run_builder_with_retry pnpm exec electron-builder --mac zip "--$ARCHITECTURE" --publish never
run_step node config/scripts/create-mac-dmg.mjs --arch "$ARCHITECTURE"
