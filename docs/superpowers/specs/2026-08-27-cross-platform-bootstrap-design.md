# macOS and Windows Development Bootstrap Design

## Status

- Date: 2026-08-27
- Scope: local development environment bootstrap for macOS and Windows
- Product version: 0.1.0
- Approved direction: use Homebrew on macOS and winget on Windows, then use Corepack to pin pnpm

## Problem

The repository declares Node.js `>=22.22` and pnpm `10.24.0`, but a fresh machine can still invoke an older Node.js installation or an unrelated globally installed pnpm. pnpm 11 no longer reads the repository's pnpm 10 build allowlist from `package.json`; this can leave Electron, esbuild, or SWC present in `node_modules` without their required platform binaries. The resulting `Electron uninstall` error appears only after the renderer dev server has started, which makes the actual environment failure difficult to diagnose.

Developers need one documented entry point per supported development platform that prepares the toolchain, installs dependencies with the repository's pinned package manager, repairs required platform packages, and reports actionable failures.

## Goals

- Bootstrap a fresh macOS or Windows checkout with one platform-native command.
- Require Node.js 22.22 or newer and pnpm 10.24.0.
- Prevent an unrelated `pnpm` found on `PATH` from controlling installation.
- Install dependencies from the committed lockfile.
- Ensure Electron, esbuild, and SWC platform artifacts are usable after installation.
- Detect the known missing Electron binary state before `pnpm dev` reaches electron-vite.
- Make repeated runs safe and useful as environment repair.
- Keep platform-specific installation behavior separate from shared verification logic.

## Non-goals

- Linux bootstrap or release support.
- Installing Homebrew or winget themselves.
- Maintaining repository-local Node.js downloads, archives, checksums, or a `.tools` runtime.
- Changing the application's runtime behavior, product state, schemas, or migration model.
- Promoting Windows to a formal release gate.
- Silently changing a user's shell profile or permanently rewriting `PATH`.

## User Interface

From a fresh clone, the developer runs one command for the current platform:

```bash
./config/scripts/bootstrap-mac.sh
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File config/scripts/bootstrap-windows.ps1
```

Both scripts accept an opt-in development flag:

```bash
./config/scripts/bootstrap-mac.sh --dev
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File config/scripts/bootstrap-windows.ps1 -Dev
```

Without the flag, a successful run stops after verification and prints the exact development command. With the flag, the bootstrap process replaces itself with or starts the verified development command so its exit status remains visible.

## Architecture

### Platform bootstrap scripts

`config/scripts/bootstrap-mac.sh` owns macOS-specific command discovery and Homebrew invocation. `config/scripts/bootstrap-windows.ps1` owns Windows-specific command discovery and winget invocation. Each script:

1. Resolves the repository root from its own location and changes to that directory.
2. Verifies that Git is available and is at least version 2.25.
3. Checks whether the active Node.js satisfies the minimum version.
4. If Node.js is missing or too old, uses the platform package manager to install the Node.js 22 line.
5. Refreshes command discovery for the current process and fails with a restart instruction if the package manager updated Node.js but the current process cannot see it.
6. Enables Corepack and resolves pnpm through `corepack pnpm`, never through a bare `pnpm` command.
7. Confirms Corepack resolves exactly pnpm 10.24.0.
8. Installs the committed lockfile with `corepack pnpm install --frozen-lockfile`.
9. Runs the shared verification program.
10. Prints or starts `corepack pnpm dev`.

The scripts are idempotent: a conforming toolchain skips system installation, while dependency installation and verification may safely run again.

### Shared environment verifier

`config/scripts/verify-environment.mjs` contains portable checks that run after Node.js is known to satisfy the minimum. It reads required versions from `package.json` rather than duplicating them as independent constants where practical.

It verifies:

- the current platform is `darwin` or `win32`;
- the current Node.js version satisfies `package.json#engines.node`;
- `corepack pnpm --version` exactly matches the version declared by `package.json#packageManager`;
- `node_modules` resolves the expected Electron package version;
- Electron's `path.txt` exists and points to an existing executable inside its distribution;
- the current-platform esbuild executable can run;
- `@swc/core` can be imported and reports a native target.

Checks produce a concise success list. A failure names the failed component, current state, expected state, and repair command. The verifier exits nonzero on any failure.

### Native dependency repair

The primary path is a clean pnpm 10.24.0 install using the repository build allowlist. After installation, verification determines whether platform artifacts actually exist. If Electron is missing, the bootstrap script invokes Electron's package-owned `install.js` with the pinned package manager's Node execution path, then verifies again. esbuild and SWC are repaired with `corepack pnpm rebuild <package>` and verified by execution/import.

Repair is targeted. The bootstrap process does not delete `node_modules` automatically, because a recursive deletion is disruptive and unnecessary for the known failure. If targeted repair still fails, the script reports the clean-reinstall command and exits.

## Package Manager Configuration

`packageManager` remains `pnpm@10.24.0`. Platform scripts always call `corepack pnpm`; project lifecycle scripts may continue to call `pnpm` because they execute under pnpm's prepared process environment.

The pnpm build allowlist remains compatible with pnpm 10.24.0. The bootstrap verifier guards against accidental use of pnpm 11, so this change does not migrate repository configuration to pnpm 11.

A `.node-version` file records the preferred Node.js baseline for version managers and editor integrations. `package.json#engines.node` remains the authoritative minimum.

## Installation Behavior

### macOS

- If Node.js is missing or older than 22.22, require an existing `brew` command.
- Install or upgrade the Homebrew Node.js 22 formula.
- Discover the formula prefix and prepend its `bin` directory only to the bootstrap process environment when required.
- Do not edit `.zshrc`, `.bashrc`, or other shell profiles.
- If Homebrew is unavailable, stop with the official Homebrew installation URL and the required Node.js version.

### Windows

- If Node.js is missing or older than 22.22, require an existing `winget` command.
- Install or upgrade the Node.js 22 LTS package non-interactively except for platform-managed privilege prompts and agreement handling.
- Re-resolve the standard Node.js installation directory for the current process after installation.
- Do not edit the user's permanent `PATH` directly.
- If winget is unavailable, stop with the official Node.js download URL and the required version.

## Error Handling

- Every external command is checked immediately; the scripts stop at the first failed prerequisite or install step.
- Error output distinguishes missing tools, unsupported versions, package-manager resolution conflicts, network/download failures, ignored build scripts, and missing native binaries.
- System package installation is attempted only when Node.js is absent or below the declared minimum.
- A package manager that reports success while leaving the old Node.js active results in a clear "restart the terminal and rerun" message.
- The scripts do not claim Windows release support; they only support preparing the Windows development environment.

## Documentation Changes

The Chinese and English README quick-start sections will lead with the bootstrap commands. Manual setup remains documented as a fallback, including the exact Node.js and pnpm versions. Troubleshooting will explain that `Electron uninstall` means the Electron distribution is absent and that rerunning bootstrap performs the supported repair.

`package.json` will expose explicit convenience commands for shared verification and platform bootstrap where command portability allows it. Direct platform-native invocations remain the canonical fresh-machine entry points because a package script cannot run before Node.js and pnpm exist.

## Testing

- Add Node test coverage for semantic version checks, package-manager declaration parsing, Electron path validation, and diagnostic messages.
- Add or extend script tests that inspect the macOS and Windows bootstrap contracts without running Homebrew or winget on the test host.
- Run the shared verifier against the current Windows workspace.
- Run formatting, lint, typecheck, focused script tests, and the existing build.
- Manually validate the macOS script syntax with `sh -n` and the Windows script with the PowerShell parser.
- Record that a true clean-machine macOS bootstrap still requires validation on macOS and is a known verification limit when implementation occurs on Windows.

## Security and State Impact

The only system-level mutation is the explicit Homebrew or winget Node.js install/upgrade when the required runtime is missing. Repository mutations are limited to normal dependency installation under `node_modules`; no application data, Git authority state, workflow state, or user credentials are changed. The scripts do not use remote shell pipelines, do not install Homebrew or winget, and do not modify persistent shell configuration.

## Acceptance Criteria

- On a conforming macOS or Windows machine, one bootstrap command installs dependencies and finishes with all environment checks passing.
- On a machine with missing or old Node.js and an available platform package manager, the command installs Node.js 22 and continues or gives a precise terminal-restart instruction.
- A globally installed pnpm 11 cannot be used by the bootstrap dependency installation path.
- An Electron package missing `path.txt` or its distribution is repaired or produces a component-specific failure.
- Re-running bootstrap on an already prepared checkout succeeds without destructive cleanup.
- `--dev`/`-Dev` starts the Electron development process only after verification passes.
- Documentation and the 0.1.0 version record describe the behavior and its Windows/macOS support boundary.
