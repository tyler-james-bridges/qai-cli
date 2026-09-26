# qai

Evidence-based QA checks from your terminal. The default path fetches a URL, records what came back, and grades it. No API key.

[![npm version](https://img.shields.io/npm/v/qai-cli)](https://www.npmjs.com/package/qai-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/tyler-james-bridges/qai-cli/actions/workflows/lint.yml/badge.svg)](https://github.com/tyler-james-bridges/qai-cli/actions/workflows/lint.yml)

## Install

```bash
npm install -g qai-cli
```

3.4.1 is on `main` (`feat: live qai check without LLM`). npm publish of `qai-cli@3.4.1` is forthcoming.

```bash
npx qai-cli@3.4.1 check https://canary.0x402.sh/api/health
```

## Check a live URL

`qai check` GETs the URL. If you pass a site root, it also GETs `/api/health`. It records status, content-type, and a body snippet, then applies a built-in health contract.

```bash
npx qai-cli@3.4.1 check https://canary.0x402.sh/api/health
qai check https://canary.0x402.sh
qai check https://canary.0x402.sh/api/health
qai check https://ack-onchain.dev/api/health
qai https://canary.0x402.sh/api/health
```

A bare URL is the same as `check`. JSON health with `status` matching `healthy` or `operational*` is a pass. HTML where JSON health was expected needs review. HTTP 5xx or an unreachable host fails.

`https://morsel.0x402.sh/api/health` currently returns HTML from a catch-all route, so `qai check` exits 2 (`NEEDS HUMAN REVIEW`). That is the intended result until that path serves JSON.

```bash
qai check https://example.com/api/health --json
qai check https://example.com/api/health --out report.txt
```

## Replay a verification contract

`qai verify` is the advanced path. It scores an agent's completion claim against a reviewed JSON contract and independently collected, read-only evidence. HTTP collectors in this path still use recorded fixtures (`check.evidence`). They do not fetch live URLs. Use `qai check` for a live GET.

```bash
qai verify .qai/task.json --claim completion.md
qai verify .qai/task.json --claim completion.md --json
```

Pass `--out <path>` to persist a report. By default neither command writes into the repository.

### Score a diff for merge risk

`qai risk` scores a local `git` diff (or a PR diff via `gh`) with TypeSafe System One. It asks several atomic questions in one `systemOne` call, then confidence-gates to `auto-ok` or `needs-eyes`. `qai check` stays keyless and never loads this path.

```bash
qai risk --base main
qai risk 42
qai risk --base main --json
```

Live judgments read `TYPESAFE_API_KEY` from the environment. If the key is missing, the command skips TypeSafe, prints `SKIPPED`, and exits `0` so CI without TypeSafe still works. Do not treat a skip as `auto-ok`. An empty diff is `auto-ok` without calling TypeSafe.

Defaults (conservative; change them in `src/risk.js`):

| Signal | `needs-eyes` when |
| --- | --- |
| Choice/Score confidence | below `0.60` |
| `exposes_secrets` noul | `≥ 0.70` yes, or `0.40–0.70` uncertain |
| blast radius, test gap, or rollback hardness | score `≥ 1.50` on a 0–2 rubric |
| `merge_posture` | choice is `needs_eyes` |

Exit `0` for `auto-ok` or skip, `2` for `needs-eyes`.

### Drive a page toward a goal

`qai flow` opens a URL in Playwright and asks Jev for one next action. The choice set is closed: named controls from that step's accessibility snapshot, plus `done`. A fill is offered only when a `--data` key matches the field's accessible name (`board` matches "Board name", not "List name"). Jev does not invent text. Submitting a form that still contains a textbox with no matching key fails the run and names that field, so an empty submit cannot end as `done`. After each action the command waits, up to a few seconds, until that snapshot changes and the network is idle, so a client-side route is not judged from the previous page.

```bash
qai flow http://127.0.0.1:3000 "Create a board, list, and card" \
  --data board=Trip --data list=Todo --data card=Pack
qai flow https://example.com "Open the pricing page" --max-steps 8 --json
```

Each step records the chosen action, Jev's latency, and token or cost fields when the response includes them. Jev currently returns `input_tokens` and `output_tokens` only, with no cost field. The command prints a summary with total wall time. `--json` prints that report as one JSON document.

Exit `0` when Jev chooses `done`. Exit `1` when a step fails or `--max-steps` is hit (default 15). If `TYPESAFE_API_KEY` is missing, the command prints `SKIPPED` and exits `0` without opening a browser.

Recorded pass, fail, and review shapes from canary, ACK, and Morsel live in `scripts/verify/fixtures/live-stack/`. Set `QAI_VERIFY_NOW` to an ISO-8601 timestamp when you replay recorded evidence against a pinned clock.

### Verdicts

- `PASS` (exit `0`) requires current, bound evidence. For `check`, that means JSON health with `status` matching `healthy` or `operational*`. For `verify`, every independent check must pass. A claim is traceability metadata, never sole proof.
- `FAIL` (exit `1`) is a contradiction. For `check`, that is HTTP 5xx, an unreachable host, or JSON `status` such as `degraded`.
- `NEEDS HUMAN REVIEW` (exit `2`) is missing, stale, inaccessible, or ambiguous evidence. HTML on a health path is review, not a pass.
- Verifier or input errors exit `3`.

`git.local` in `verify` requires the target full SHA and a clean worktree. `verify` disables repository filesystem-monitor execution while it inspects Git state.

## Optional AI commands

`scan`, `review`, and `generate` stay available and need a provider key. `qai risk` and `qai flow` need `TYPESAFE_API_KEY`. `check` and `verify` never import those providers, Playwright, or the TypeSafe SDK.

```bash
qai scan https://mysite.com
VIEWPORTS=desktop,mobile,tablet qai scan https://mysite.com
FOCUS=accessibility qai scan https://mysite.com

qai review 42
qai review --base main

qai generate https://mysite.com
qai generate src/billing.ts

qai risk --base main

qai flow http://127.0.0.1:3000 "Create a board, list, and card" \
  --data board=Trip --data list=Todo --data card=Pack
```

Set one env var for AI commands:

| Provider  | Env var             | Default model   |
| --------- | ------------------- | --------------- |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4 |
| OpenAI    | `OPENAI_API_KEY`    | gpt-4o          |
| Google    | `GEMINI_API_KEY`    | gemini-pro      |
| Ollama    | `OLLAMA_BASE_URL`   | llava           |

Ollama reads `OLLAMA_BASE_URL` (default `http://localhost:11434`) and `OLLAMA_MODEL` (default `llava`).

### Switching provider

Set `PROVIDER` or `QAI_PROVIDER` to `anthropic`, `openai`, `gemini`, `codex`, or `ollama`. `PROVIDER` wins when both are set. Pair it with that provider's key, or with a generic `API_KEY`. Without an explicit provider, qai uses the first key it finds in this order: Anthropic, OpenAI, Codex, Gemini.

```bash
PROVIDER=openai OPENAI_API_KEY=... qai review 42
QAI_PROVIDER=gemini GEMINI_API_KEY=... qai scan https://example.com
```

If the chosen or auto-detected provider fails with a billing, auth, or model-not-found error, qai tries the next provider that has a key. The log shows `Trying provider: …` and `Using provider: …` for the one that succeeded. When none of them work, CI keeps the soft-skip `skipped: provider unavailable`.

In CI, set the repository variable `QAI_PROVIDER` to the same name. No workflow edit. The QAI Code Review and qa-test jobs read that variable and pass `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` when those secrets exist. Leave the variable empty to keep auto-detect. qa-test runs Claude Code when the provider is `anthropic` or unset, and `qai scan` for `openai`, `gemini`, `codex`, or `ollama`. If Claude Code fails with a billing, auth, or model error and another provider key is set, qa-test runs `qai scan` so that key is tried. A qa-test run that still produces no report is `skipped: provider unavailable`. Critical and high findings in a real report still fail the check.

### Playwright helper

```typescript
import { test, expect } from '@playwright/test';
import { analyzeWithAI, attachScreenshots } from 'qai-cli';

test('homepage has no critical issues', async ({ page }, testInfo) => {
  await page.goto('/');

  const report = await analyzeWithAI(page, {
    viewports: ['desktop', 'mobile'],
    focus: 'all',
  });

  await attachScreenshots(testInfo, report);
  expect(report.criticalBugs).toHaveLength(0);
});
```

### GitHub Action

The published action still runs `scan` and needs a provider key.

```yaml
- name: QAI Scan
  uses: tyler-james-bridges/qai-cli@main
  with:
    url: ${{ env.PREVIEW_URL }}
    viewports: desktop,mobile
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Releasing

Version is already bumped on `main` (`npm version`). To publish:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing a `v*` tag runs [publish.yml](.github/workflows/publish.yml): it checks that `package.json` matches the tag (leading `v` stripped), runs `npm test`, then `npm publish --access public`. Requires repo secret `NPM_TOKEN` (npm Automation token with publish rights for `qai-cli`).

## License

MIT
