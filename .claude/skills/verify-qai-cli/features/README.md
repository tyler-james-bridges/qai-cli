# qai CLI verification map

This directory is the maintained source for verifying the user-facing behavior of the qai CLI in this repo. Read the index before driving, then use the matching feature file.

## Baseline preconditions

- Node is `>= 20`. Keyless commands do not need `npm install`.
- Run `.claude/skills/verify-qai-cli/helpers/qai-verify launch` and require a `READY qai v…` line that matches `package.json`.
- Run `.claude/skills/verify-qai-cli/helpers/qai-verify doctor` and require `DOCTOR ok` for this repo.
- Drive `node src/index.js` from this checkout. A global `qai` on `PATH` may be a different build.
- One active run at a time. State is `/tmp/qai-cli-verify`. Evidence is `/tmp/qai-cli-verify-evidence/<run-id>`.
- Never drive a health server or tmux session that this run did not start.

## Driving conventions

- Start from a fresh `launch` unless a recipe says the current run is already healthy.
- Run `.claude/skills/verify-qai-cli/helpers/qai-verify doctor` before the first drive and before each later drive in the same run.
- Treat every command as literal, including the em dash in `qai check — PASS`.
- The harness runs each drive inside a tmux session and writes stdout, stderr, and the exit code under the evidence directory.
- Restore nothing in the checkout: `check` and `verify` must leave `git status --porcelain` unchanged. Disposable repos live under the run scratch dir.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the command, its stdout, stderr, and exit code, plus the state the command claims.
- A `--out` file is a side effect. Read it back and compare it to stdout.
- `SKIPPED` on `risk` or `flow` is exit code `0` and is not `AUTO-OK` or `DONE`. Record `gate` or `status` from the report.
- Record the feature id and the entry point with the artifact path.
- Report an unreachable path with the command that was run and the unmet precondition. Do not mark it verified through a different command.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly these H2 sections:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with the harness`
4. `Gotchas`

Keep implementation details out of the map. Name user commands, flags, required state, and observable proof.

When these files drift from the CLI, run `/maintain-verification-skill`.

## Features

- [Check a live URL](./check.md) covers `qai check`, a bare URL, JSON output, and `--out`.
- [Replay a verification contract](./verify.md) covers `qai verify` against a reviewed contract and a claim file.
- [Score a diff for merge risk](./risk.md) covers an empty diff and a keyless skip.
- [Drive a page toward a goal](./flow.md) covers the keyless skip before a browser opens.
