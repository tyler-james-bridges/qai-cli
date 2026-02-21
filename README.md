# qai

AI-powered QA engineer for your terminal. Scan websites, review PRs, generate tests.

[![npm version](https://img.shields.io/npm/v/qai-cli)](https://www.npmjs.com/package/qai-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lint](https://github.com/tyler-james-bridges/qaie/actions/workflows/lint.yml/badge.svg)](https://github.com/tyler-james-bridges/qaie/actions/workflows/lint.yml)

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
  uses: tyler-james-bridges/qaie@main
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
