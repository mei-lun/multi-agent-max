# Baseline reproduction — 2026-11-07

All six failures reported in the current full suite reproduce from committed baseline `51091d8` without current creative implementation changes. This does not make the full suite green; it identifies these failures as pre-existing under this Windows/Node24 environment.

Isolated snapshot: `.mam-local/baseline-check`, produced using `git archive 51091d8` and tar extraction, without a nested `.git`; its node_modules junction points to the current installed dependencies. Windows tar reported an extraction failure for one unrelated Unicode documentation filename. All 407 committed files under src/main/mam plus vitest.config.ts/tsconfig.json were independently verified with git hash-object against committed blobs before accepting the result. No original repository source or test was altered. Test-created temporary Git fixtures use their normal temporary directories.

Executed Node24 Vitest with the four requested test paths, JSON reporter and output `.mam-local/baseline-regressions-results.json`. Result: **4 test files, 25 tests, 19 passed, 6 failed, 0 skipped**.

| File | Reproduced failure |
| --- | --- |
| executors/pi-rpc-adapter.test.ts | “runs the official RPC client with isolated config and retains an optional standard result”: EBUSY resource busy or locked during rmdir cleanup of temporary mam-pi-rpc-adapter directory. |
| application/mam-design-draft-store.test.ts | “persists the local draft as a private unencrypted JSON file” (line 25) and “archives malformed JSON and starts a fresh local draft” (line 46): expected POSIX permission value 384 (0600), received Windows value 438 (0666). |
| application/conflict-resolution-worktree-manager.real-git.test.ts | “updates the local target ref when no remote is configured” (line 41) and “reproduces the pinned conflict and pushes a validated two-parent resolution” (line 69): actual status failed, expected merged. |
| application/integration-worktree-merge-executor.real-git.test.ts | “does not push when a post-merge validation fails” (line 126): actual status merged, expected failed. |

`git diff 51091d8 --` for all four test files and the two real-Git implementation files produced no differences. No unrelated fixes were attempted. Exact assertion messages/stacks are retained in the local JSON result; temp directory suffixes are nondeterministic. Current full-suite result supplied by root remains 183 files, 595 passed / 6 failed / 1 skipped; the targeted baseline reproduction does not rerun or replace that full-suite measurement.
