# qai

AI-powered QA engineer for your terminal. Scan websites, review PRs, generate tests.

[![npm version](https://img.shields.io/npm/v/qai-cli)](https://www.npmjs.com/package/qai-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/tyler-james-bridges/qai-cli/actions/workflows/lint.yml/badge.svg)](https://github.com/tyler-james-bridges/qai-cli/actions/workflows/lint.yml)

## Install

```bash
npm install -g qai-cli
```

## Commands

### `qai scan` — Visual QA Analysis

Capture screenshots, detect console/network errors, and get AI-powered bug reports.

```bash
# Scan a URL
qai scan https://mysite.com

# Multiple viewports
VIEWPORTS=desktop,mobile,tablet qai scan https://mysite.com

# Focus on accessibility
FOCUS=accessibility qai scan https://mysite.com
```

### `qai review` — PR Code Review

Deep code review with full codebase context. Not just the diff — traces through dependencies, callers, and related tests.

```bash
# Review a PR
qai review 42

# Review current branch against main
qai review --base main
```

### `qai generate` — Test Generation

Auto-generate Playwright E2E tests from URLs or unit tests from source files.

```bash
# Generate E2E tests by crawling a site
qai generate https://mysite.com

# Generate unit tests from source
qai generate src/billing.ts
```

## Playwright Integration

Use qai inside your existing Playwright test suite:

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

## GitHub Action

```yaml
- name: QAI Scan
  uses: tyler-james-bridges/qai-cli@main
  with:
    url: ${{ env.PREVIEW_URL }}
    viewports: desktop,mobile
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## AI Providers

Works with any major LLM. Set one env var:

| Provider  | Env Var             | Default Model   |
| --------- | ------------------- | --------------- |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4 |
| OpenAI    | `OPENAI_API_KEY`    | gpt-4o          |
| Google    | `GEMINI_API_KEY`    | gemini-pro      |
| Ollama    | `OLLAMA_HOST`       | llama3          |

## Features

- **Multi-viewport** — Desktop, tablet, mobile screenshots
- **Console errors** — JavaScript errors and warnings
- **Network errors** — Failed APIs, slow requests, 4xx/5xx
- **Visual regression** — Pixel-level comparison with baselines
- **Structured reports** — JSON + Markdown output
- **CI/CD ready** — GitHub Action + exit codes for pipelines

## How It Compares

| Feature                                        | **qai**                 | Paragon   | CodeRabbit  | Cursor BugBot |
| ---------------------------------------------- | ----------------------- | --------- | ----------- | ------------- |
| Open source                                    | ✅                      | ❌        | ❌          | ❌            |
| Visual QA scanning                             | ✅                      | ✅        | ❌          | ❌            |
| PR code review                                 | ✅                      | ❌        | ✅          | ✅            |
| Test generation                                | ✅                      | ❌        | ❌          | ❌            |
| Multi-provider (Claude, GPT-4, Gemini, Ollama) | ✅                      | ❌        | ❌          | ❌            |
| Local/offline mode (Ollama)                    | ✅                      | ❌        | ❌          | ❌            |
| CLI + library + GitHub Action                  | ✅                      | SaaS only | GitHub only | GitHub only   |
| Free                                           | ✅ (bring your own key) | Paid      | Freemium    | Freemium      |

## License

MIT

## `qai verify` — Agent Completion Verification

Verify an agent's completion claim against a reviewed JSON contract and independently collected,
read-only evidence:

```bash
qai verify .qai/task.json --claim completion.md
qai verify .qai/task.json --claim completion.md --json
```

`verify` evaluates every required acceptance criterion and returns `PASS` (exit `0`), `FAIL`
(exit `1`), `NEEDS HUMAN REVIEW` (exit `2`), or a verifier/input error (exit `3`). Missing,
stale, inaccessible, or ambiguous evidence never becomes a pass. Use `--out <path>` to persist a
report; by default the command does not write into the repository.

- `PASS` requires every independent check to be current and bound to the observed subject. Claim
  coverage is traceability metadata, never sole proof. Missing, stale, future-dated, inaccessible, or
  ambiguous evidence cannot pass.
- Recorded evidence must include `observedAt` plus either `freshUntil` or a contract `maxAge`;
  external observations also require immutable locators/IDs and exact URL, environment, revision,
  workflow, schedule, provider, model, or route identity where applicable.
- `git.local` requires the target full SHA and a clean worktree. `verify` disables repository
  filesystem-monitor execution while inspecting Git state.
- MVP HTTP collectors (`http.probe`, `http.revision`) evaluate independently recorded evidence
  fixtures via `check.evidence`; they do not fetch live URLs. Example pass/fail/review shapes from
  Tyler's production health endpoints (`canary.0x402.sh/api/health`, `ack-onchain.dev/api/health`,
  and Morsel's HTML catch-all at `morsel.0x402.sh/api/health`) are in
  `scripts/verify/fixtures/live-stack/`. Set `QAI_VERIFY_NOW` to an ISO-8601 timestamp when replaying
  recorded evidence against a pinned clock.
