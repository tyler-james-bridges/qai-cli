# Score a diff for merge risk

`qai risk` scores a local `git` diff, or a pull request diff via `gh`. An empty diff is `AUTO-OK` without calling TypeSafe. A non-empty diff with no `TYPESAFE_API_KEY` prints `SKIPPED` and exits `0`. A skip is not an approval.

## Sub-features

- `risk-empty` reports `AUTO-OK` when `git diff <base>...HEAD` is empty.
- `risk-skip` reports `SKIPPED` when the diff is non-empty and `TYPESAFE_API_KEY` is unset.
- `risk-json-out` writes the skip report with `--json --out`.

## How to get to it (user POV)

- Run `qai risk --base main` in a git repo. `main` is the default base.
- Run `qai risk <pr-number>` to score `gh pr diff`.
- Add `--repo <path>` to score a repo that is not the current directory.
- Add `--json` and `--out <path>` for one JSON document and a new report file.
- From this repo, the same command is `node src/index.js risk --base main --repo <path>`.

## Driving it with the harness

Preconditions:

- `qai-verify launch` printed `READY` and `qai-verify doctor` printed `DOCTOR ok`.
- The harness builds two disposable repos under the run scratch dir. It unsets `TYPESAFE_API_KEY` for both commands so an ambient key cannot turn the skip into a live judgment.
- The empty repo has one commit on `main`. The skip repo has a second commit on branch `change`.

- **Empty diff.** Run `.claude/skills/verify-qai-cli/helpers/qai-verify drive risk`. The harness runs `env -u TYPESAFE_API_KEY node src/index.js risk --base main --repo <empty-repo>`. Exit code `0`. Stdout begins `qai risk — AUTO-OK`, contains `No changes in the diff. No TypeSafe judgment needed.`, and contains `VERDICT  AUTO-OK`. Stderr contains `qai risk: collecting diff...`.
- **Keyless skip.** The same drive runs `env -u TYPESAFE_API_KEY node src/index.js risk --base main --repo <skip-repo> --json --out <evidence>/risk/skip-report.json`. Exit code `0`. Stderr is empty. Stdout and `skip-report.json` have `command` `risk`, `gate` `skipped`, `judgments` `null`, and `reasons` containing `TYPESAFE_API_KEY is not set`.
- **Proof.** Keep `empty.stdout`, `empty.exit`, `skip.stdout`, `skip.exit`, and `skip-report.json` under `/tmp/qai-cli-verify-evidence/<run-id>/risk/`.

## Gotchas

- `SKIPPED` exits `0`, same as `AUTO-OK`. Read the verdict line. Do not treat a skip as safe to merge.
- On a clean `main` checkout, `qai risk --base main` is an empty diff and prints `AUTO-OK` without a TypeSafe call, even when the key is missing. Use a branch that actually differs from the base to observe `SKIPPED`.
- Human output prints `qai risk: collecting diff...` on stderr. `--json` does not.
- `--out` refuses to overwrite an existing file (exit `3`).
- `qai risk <pr-number>` needs `gh` and network access to the pull request. The harness does not drive that entry. A failure there is a missing `gh` auth or repo precondition, not a keyless skip.
- A live `needs-eyes` or `auto-ok` judgment needs `TYPESAFE_API_KEY` and is not what this drive proves. Exit `2` is `NEEDS EYES` when a live judgment escalates.
