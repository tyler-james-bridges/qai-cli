---
name: verify-qai-cli
description: Drive the qai CLI in the qai-cli repo (node src/index.js) the way a user does. Use when proving check, verify, risk, or flow, or when a task claims a qai command's exit code, report, and side effects match the terminal.
---

# Verify qai-cli

qai is a short-lived CLI. There is no server to keep up. Launch prepares one isolated run, each drive runs in its own tmux session, and cleanup stops only the sessions that run started. Evidence stays under `/tmp/qai-cli-verify-evidence`.

Run the helpers from any working directory. They locate this repo from their own path. Drive `node src/index.js` in this checkout, not a globally installed `qai`.

The feature map is [features/README.md](features/README.md). After the app changes, run `/maintain-verification-skill` on this skill so the map stays honest. Do not treat the map as current after a command or verdict change until that pass says so.

## Launch

Keyless commands (`--version`, `help`, `check`, `verify`, and `risk` when it does not call TypeSafe) need Node `>= 20` only. They do not need `npm install`.

Ready signal: stdout is `qai v` plus the `version` in `package.json` (today that line is `qai v3.4.1`). A mismatch means this checkout is not worth driving.

```bash
.claude/skills/verify-qai-cli/helpers/qai-verify launch
```

`launch` runs `node src/index.js --version`, writes `/tmp/qai-cli-verify/runs/<run-id>/launch.json`, and points `/tmp/qai-cli-verify/current` at that run. It prints:

```text
READY qai v3.4.1
RUN <run-id>
EVIDENCE_DIR=/tmp/qai-cli-verify-evidence/<run-id>
```

`launch` refuses when `current` already exists. One run at a time. A second checkout can use the same helper only after `cleanup`, because the state directory is `/tmp/qai-cli-verify`.

`qai flow` loads `playwright` at import time, even when a missing `TYPESAFE_API_KEY` later skips the run. `drive flow` runs `npm ci --ignore-scripts` in this repo when `playwright` does not resolve. That install does not download browser binaries. A flow that actually opens a page also needs `npm run install:browsers`. The default flow drive does not open a browser.

Teardown is `cleanup` below. `launch` itself leaves no process running.

## Doctor

Doctor is read-only. It does not start a server, write a report, or install packages. Run it after launch and again before every drive. Run it again after any drive that exited non-zero, then `cleanup` if the run is stuck.

```bash
.claude/skills/verify-qai-cli/helpers/qai-verify doctor
```

It is worth driving when stdout is:

```text
DOCTOR ok
qai v3.4.1
node v22.x.x
repo <this repo>
run <run-id or none>
flow_module present|missing
```

The second line is the version command's stdout. Doctor fails when Node is older than 20, `src/index.js` is missing, `--version` disagrees with `package.json`, `help` does not list `check`, `verify`, `risk`, and `flow`, or the active launch record disagrees with `--version`. `flow_module missing` still passes: `check`, `verify`, and the keyless `risk` paths do not load Playwright.

## Drive

Prefer the harness. It records stdout, stderr, and the exit code from a tmux session and fails if the observable result is wrong. Map recipes live under `features/`.

```bash
.claude/skills/verify-qai-cli/helpers/qai-verify drive check
.claude/skills/verify-qai-cli/helpers/qai-verify drive verify
.claude/skills/verify-qai-cli/helpers/qai-verify drive risk
.claude/skills/verify-qai-cli/helpers/qai-verify drive flow
```

`drive check` is the live HTTP path. The harness starts `helpers/health-server.js` in a tmux session and then runs, in a second session:

```bash
node src/index.js check http://127.0.0.1:<port>/api/health
node src/index.js check http://127.0.0.1:<port>/api/health --json --out <evidence>/check/report.json
node src/index.js http://127.0.0.1:<port>/api/health
```

A pass ends with exit code `0`, stdout beginning `qai check — PASS`, and a report whose observed `healthStatus` is `healthy`.

`scan`, `review`, and `generate` are optional AI commands. They are not in this map. They need a provider key and can write `qa-report.md`, `qa-report.json`, `review-report.md`, or `./screenshots` into the working directory.

## Evidence

Proof is written only under `/tmp/qai-cli-verify-evidence/<run-id>/`. Scratch (the health port file, disposable git repos, tmux done files) stays under `/tmp/qai-cli-verify/runs/<run-id>/` and cleanup deletes that scratch.

Each drive prints `EVIDENCE_DIR=` to the feature directory. For `check` that directory contains:

- `explicit.stdout`, `explicit.stderr`, `explicit.exit` for `qai check <url>`
- `json.stdout`, `json.stderr`, `json.exit`, and `report.json` for `--json --out`
- `bare.stdout`, `bare.stderr`, `bare.exit` for a bare URL
- `meta.txt` with the URL that was fetched
- `git-status-before.txt` and `git-status-after.txt`
- `check.pane.txt`, the tmux pane

A proof shows the command, the resulting report, and the side effect. For `check`, the side effect is `report.json` on disk and an unchanged worktree (`git status --porcelain` matches before and after). The JSON file is a second view of the same verdict, not a substitute for the human stdout.

Drive the real CLI. `check` performs a live HTTP GET. The health server is the URL under test, in its own process. Do not answer the GET from inside the `qai` process: a blocked event loop makes the request time out and the verdict is `FAIL`. `verify` reads recorded fixtures because that command does not fetch live URLs. Do not mock `check` with a fixture. `risk` and `flow` drives unset `TYPESAFE_API_KEY` so a skip is observed from the report (`gate` or `status`, empty judgments or steps), not assumed from the flag name.

## Cleanup

Cleanup kills the tmux sessions recorded for the active run, then deletes that run's scratch directory. It does not kill by process name and it does not delete `/tmp/qai-cli-verify-evidence`.

```bash
.claude/skills/verify-qai-cli/helpers/qai-verify cleanup
```

Success looks like `CLEANUP done evidence=/tmp/qai-cli-verify-evidence/<run-id>`. Then confirm the proof is still there:

```bash
test -s /tmp/qai-cli-verify-evidence/<run-id>/check/report.json
```

Run cleanup after a failed drive too, so a health server or tmux session does not stay up. `CLEANUP none` means there was no active run.

## Helpers

Both scripts are executable. Invoke them as written.

```bash
.claude/skills/verify-qai-cli/helpers/qai-verify launch
.claude/skills/verify-qai-cli/helpers/qai-verify doctor
.claude/skills/verify-qai-cli/helpers/qai-verify drive check
.claude/skills/verify-qai-cli/helpers/qai-verify drive verify
.claude/skills/verify-qai-cli/helpers/qai-verify drive risk
.claude/skills/verify-qai-cli/helpers/qai-verify drive flow
.claude/skills/verify-qai-cli/helpers/qai-verify cleanup
node .claude/skills/verify-qai-cli/helpers/health-server.js <port-file>
```

`qai-verify drive check` starts the health server. Call `health-server.js` directly only to inspect that scaffolding: it listens on `127.0.0.1` port `0`, writes the port to `<port-file>`, and answers every GET with `{"status":"healthy"}`. Stop it by killing the tmux session `qai-verify` recorded, not by process name.
