# Replay a verification contract

`qai verify` scores a completion claim against a reviewed JSON contract and the read-only evidence that contract names. HTTP checks in this command read fixture files. They do not GET a live URL. Use `qai check` for a live GET.

## Sub-features

- `verify-replay` runs a contract whose `git.local` revision matches a clean repo and whose recorded evidence is still fresh.
- `verify-json-out` prints one JSON document and writes it with `--out`.

## How to get to it (user POV)

- Run `qai verify <contract> --claim <file>` in a terminal.
- Add `--repo <path>` when the git repo is not the current directory. The default is the current directory.
- Add `--json` to print one JSON document. Add `--out <path>` to write a new report file.
- Pass `--claim -` to read the claim from stdin.
- From this repo, the same command is `node src/index.js verify <contract> --claim <file> --repo <path>`.

## Driving it with the harness

Preconditions:

- `qai-verify launch` printed `READY` and `qai-verify doctor` printed `DOCTOR ok`.
- The harness copies `scripts/verify/fixtures/placeholder/pass.contract.json`, `pass.json`, and `claim.md` into the run scratch dir. It sets `revision` to the HEAD of a new clean git repo. It does not modify the fixture files in the checkout.
- `pass.json` is fresh only through `2026-08-04T23:40:00.000Z`. The harness exports `QAI_VERIFY_NOW=2026-08-03T23:45:00.000Z` for this fixture.

- **Replay.** Run `.claude/skills/verify-qai-cli/helpers/qai-verify drive verify`. The harness runs `node src/index.js verify <scratch>/pass.contract.json --claim <scratch>/claim.md --repo <scratch-repo>`. Exit code `0`. Stdout begins `qai verify — PASS` and contains `VERDICT  PASS`. Stderr is `qai verify: collecting declared read-only evidence...`.
- **JSON and saved report.** The same drive runs that command again with `--json --out <evidence>/verify/report.json`. Exit code `0`. Stderr is empty. Stdout and `report.json` both have `command` `verify` and `verdict` `pass`.
- **Proof.** Keep `human.stdout`, `human.stderr`, `human.exit`, `json.stdout`, `report.json`, and `meta.txt` under `/tmp/qai-cli-verify-evidence/<run-id>/verify/`. `meta.txt` records the disposable repo, its HEAD, and `QAI_VERIFY_NOW`.

## Gotchas

- `git.local` passes only when HEAD equals `contract.revision` and `git status --porcelain` is empty. A dirty checkout, including this skill's own uncommitted edits, fails that check. Point `--repo` at a clean worktree. The harness builds one under the run scratch dir.
- Replaying `scripts/verify/fixtures/placeholder/` on today's clock, without `QAI_VERIFY_NOW`, expires `pass.json` and the verdict is `NEEDS HUMAN REVIEW` / exit `2`. That is the verifier's freshness rule. The pin `2026-08-03T23:45:00.000Z` sits after `observedAt` and before `freshUntil`.
- An invalid `QAI_VERIFY_NOW` exits `3` with `Input error` and no JSON report.
- `--out` refuses to overwrite an existing file (exit `3`).
- The claim is traceability text. This placeholder contract does not treat the claim wording as the only proof. Do not infer a live HTTP result from a `verify` pass. `verify` did not fetch a URL.
- A malformed contract exits `3` and writes no stdout report.
