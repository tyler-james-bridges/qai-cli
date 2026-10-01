# Check a live URL

`qai check` GETs a URL, records status, content-type, and a body snippet, and grades that response with the built-in health contract. No API key. A bare http(s) URL is the same command.

## Sub-features

- `check-explicit` runs `qai check <url>` and prints a human verdict.
- `check-json` prints one JSON document and writes nothing unless `--out` is set.
- `check-out` writes that report to a new file and refuses to overwrite.
- `check-bare-url` accepts `qai <url>` as `check`.

## How to get to it (user POV)

- Run `qai check <url>` in a terminal.
- Run `qai <url>` with an absolute `http://` or `https://` URL.
- Add `--json` to print one JSON document on stdout.
- Add `--out <path>` to write the report. The file must not already exist.
- From this repo, the same commands are `node src/index.js check <url>` and `node src/index.js <url>`.

## Driving it with the harness

Preconditions:

- `qai-verify launch` printed `READY` and `qai-verify doctor` printed `DOCTOR ok`.
- The health target is a different process from `qai`. The harness starts `health-server.js` in its own tmux session. Every GET returns `{"status":"healthy"}` with HTTP 200.
- No provider key is required.

- **Explicit check.** Run `.claude/skills/verify-qai-cli/helpers/qai-verify drive check`. The harness runs `node src/index.js check http://127.0.0.1:<port>/api/health`. Exit code `0`. Stdout begins `qai check — PASS` and contains `VERDICT  PASS` and `JSON health status is healthy.` Stderr is `qai check: fetching live HTTP evidence...`.
- **JSON and saved report.** The same drive runs `node src/index.js check <url> --json --out <evidence>/check/report.json`. Exit code `0`. Stderr is empty. Stdout is one JSON document whose `verdict` is `pass` and whose first evidence `observed.healthStatus` is `healthy`, `observed.status` is `200`, and `observed.kind` is `json`. `report.json` has the same verdict when read again.
- **Bare URL.** The same drive runs `node src/index.js <url>`. Exit code `0`. Stdout begins `qai check — PASS`.
- **Worktree side effect.** `git status --porcelain` after the drive matches the status from before it. `check` does not write a report unless `--out` is set, and the harness puts that file under `/tmp/qai-cli-verify-evidence/<run-id>/check/`.
- **Proof.** Keep `explicit.stdout`, `explicit.stderr`, `explicit.exit`, `json.stdout`, `report.json`, `bare.stdout`, and `meta.txt` in that evidence directory.

## Gotchas

- The health server must be its own process. A server blocked on the same event loop as `qai check` times out after 10000ms and the verdict is `FAIL` / exit `1` with reason `Unreachable`.
- `--json` suppresses the stderr line `qai check: fetching live HTTP evidence...`. Human output keeps that line.
- `--out` uses an exclusive create. A second write to the same path exits `3` and reports `Refusing to overwrite existing report`.
- A site root (`pathname` `/`) also GETs `/api/health`. If any probe passes, the verdict is `PASS` even when another probe needs review.
- HTML, non-JSON, or JSON without a known health `status` is `NEEDS HUMAN REVIEW` / exit `2`. HTTP 5xx, an unreachable host, and JSON `status` matching `degraded`, `unhealthy`, `down`, `error`, or `fail` are `FAIL` / exit `1`.
- `PASS` requires JSON `status` matching `healthy` or `operational*` and HTTP 2xx. `operational_read_only` passes that rule.
- `check` never reads `TYPESAFE_API_KEY` or a model provider key.
