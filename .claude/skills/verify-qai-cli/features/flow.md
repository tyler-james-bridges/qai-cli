# Drive a page toward a goal

`qai flow` opens a URL in Playwright and asks Jev for the next action. Without `TYPESAFE_API_KEY` it prints `SKIPPED` and exits `0` before launching a browser. A skip means the goal was not run.

## Sub-features

- `flow-skip` parses a URL and a goal, then skips when `TYPESAFE_API_KEY` is unset.
- `flow-json` prints that skip as one JSON document.

## How to get to it (user POV)

- Run `qai flow <url> "<goal>"` in a terminal.
- Add `--data <key=value>` when a field's accessible name matches the key. Repeat the flag for more fields.
- Add `--max-steps <n>` to stop after n actions. The default is 15 and the max is 100.
- Add `--json` to print one JSON document.
- From this repo, the same command is `node src/index.js flow <url> "<goal>"`.

## Driving it with the harness

Preconditions:

- `qai-verify launch` printed `READY` and `qai-verify doctor` printed `DOCTOR ok`.
- `playwright` resolves from this repo. If it does not, the harness runs `npm ci --ignore-scripts` once before the command. Browser binaries are not required for the skip.
- The harness unsets `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `CODEX_API_KEY`, `API_KEY`, `PROVIDER`, and `QAI_PROVIDER`.

- **Keyless skip.** Run `.claude/skills/verify-qai-cli/helpers/qai-verify drive flow`. The harness runs `node src/index.js flow http://127.0.0.1:9/ "Open the pricing page"` with those variables unset. Exit code `0`. Stdout begins `qai flow — SKIPPED`, contains `SKIPPED: TYPESAFE_API_KEY is not set. No TypeSafe judgment ran.`, and contains `VERDICT  SKIPPED`. Stderr is `qai flow: running goal...`.
- **JSON skip.** The same drive runs that command with `--json`. Exit code `0`. Stderr is empty. The document has `command` `flow`, `status` `skipped`, `goal` `Open the pricing page`, `steps` `[]`, `step_count` `0`, and `wall_ms` `null`. `wall_ms` stays null because the command returns before a browser launch.
- **Proof.** Keep `human.stdout`, `human.stderr`, `human.exit`, `json.stdout`, and `json.exit` under `/tmp/qai-cli-verify-evidence/<run-id>/flow/`.

## Gotchas

- Exit code `0` is also what `DONE` uses. Read `VERDICT  SKIPPED`. A skip did not open the page and did not choose `done`.
- `src/flow.js` loads `playwright` before the key check. A missing `node_modules/playwright` fails the process at startup with `Cannot find module 'playwright'`, which is not the skip report. `npm ci --ignore-scripts` installs the package. `npm run install:browsers` is a separate step and is only needed when the command will launch Chromium.
- The skip URL `http://127.0.0.1:9/` is closed on purpose. The skip path must not connect to it. A report that fails with a browser or navigation error means the key check did not return first.
- Human output prints `qai flow: running goal...` on stderr. `--json` does not.
- A live goal needs `TYPESAFE_API_KEY` and browser binaries. The harness does not drive that path. Exit `0` with `DONE` means Jev chose `done`. Exit `1` means a step failed or `--max-steps` was hit.
- `--data` values are matched to accessible names. A fill is not offered for a key that does not match the field. The skip drive passes no `--data`.
