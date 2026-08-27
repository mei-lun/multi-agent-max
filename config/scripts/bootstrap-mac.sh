#!/bin/sh
set -eu

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
start_dev=0
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--dev" ]; }; then
  echo "Usage: ./config/scripts/bootstrap-mac.sh [--dev]" >&2
  exit 2
fi
[ "$#" -eq 1 ] && start_dev=1

fail() { echo "bootstrap failed: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || fail "Git 2.25+ is required."
git_version=$(git --version | sed -E 's/[^0-9]*([0-9]+)\.([0-9]+).*/\1 \2/')
set -- $git_version
[ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && [ "$2" -ge 25 ]; } || fail "Git 2.25+ is required; found $(git --version)."
command -v node >/dev/null 2>&1 || node_missing=1
node_missing=${node_missing:-0}

if [ "$node_missing" -eq 1 ] || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 22) ? 0 : 1)'; then
  command -v brew >/dev/null 2>&1 || fail "Node.js 22.22+ is required. Install Homebrew from https://brew.sh/ and rerun."
  if brew list --versions node@22 >/dev/null 2>&1; then
    brew upgrade node@22
  else
    brew install node@22
  fi
  node_prefix=$(brew --prefix node@22)
  PATH="$node_prefix/bin:$PATH"
  export PATH
fi

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (!(a > 22 || (a === 22 && b >= 22))) process.exit(1)' || fail "Node.js 22.22+ is required; restart the terminal after Homebrew updates PATH and rerun."
if ! command -v corepack >/dev/null 2>&1; then
  npm install --global corepack@0.34.1
  npm_prefix=$(npm prefix --global)
  PATH="$npm_prefix/bin:$PATH"
  export PATH
fi
command -v corepack >/dev/null 2>&1 || fail "Corepack was installed but is not visible in this terminal. Restart the terminal and rerun."
cd "$project_directory"
corepack pnpm --version | grep -qx '10\.24\.0' || fail "Corepack did not resolve pnpm 10.24.0."
corepack pnpm install --frozen-lockfile
set +e
corepack pnpm exec node config/scripts/verify-environment.mjs
verify_status=$?
set -e
if [ "$verify_status" -eq 2 ]; then
  echo "Repairing native Electron, esbuild, and SWC artifacts..."
  corepack pnpm exec node node_modules/electron/install.js
  corepack pnpm rebuild @swc/core esbuild
  corepack pnpm exec node config/scripts/verify-environment.mjs || fail "Native dependency repair did not complete."
elif [ "$verify_status" -ne 0 ]; then
  fail "Environment verification failed; no native repair was attempted."
fi

if [ "$start_dev" -eq 1 ]; then
  exec corepack pnpm dev
fi
echo "Environment ready. Run: corepack pnpm dev"
