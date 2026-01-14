# AI QA Engineer

AI-powered QA testing for any website. Use as a **CLI tool**, **GitHub Action**, or **integrate with your Playwright tests** for unified reporting.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://tyler-james-bridges.github.io/ai-qa-engineer/)
[![npm version](https://img.shields.io/npm/v/ai-qa-engineer)](https://www.npmjs.com/package/ai-qa-engineer)
[![Lint](https://github.com/tyler-james-bridges/ai-qa-engineer/actions/workflows/lint.yml/badge.svg)](https://github.com/tyler-james-bridges/ai-qa-engineer/actions/workflows/lint.yml)

## Features

- **Multi-provider AI** - Anthropic Claude, OpenAI GPT-4, Google Gemini, Ollama
- **Multi-viewport testing** - Mobile, tablet, desktop screenshots
- **Network monitoring** - Failed APIs, slow requests, 4xx/5xx errors
- **Console error detection** - JavaScript errors and warnings
- **Playwright integration** - Use with your existing test suite for unified Allure/HTML reports

## Usage Options

### Option 1: Playwright Test Integration (Recommended)

Add AI QA analysis to your existing Playwright tests. Results appear in your normal test reports (Allure, HTML, etc.)

```bash
npm install ai-qa-engineer
```

```typescript
// tests/ai-qa.spec.ts
import { test, expect } from '@playwright/test';
import { analyzeWithAI, attachScreenshots } from 'ai-qa-engineer';

test.describe('AI QA Analysis', () => {
  test('homepage has no critical issues', async ({ page }, testInfo) => {
    await page.goto('/');

    const report = await analyzeWithAI(page, {
      viewports: ['desktop', 'mobile'],
      focus: 'all',
    });

    // Attach screenshots to test report
    await attachScreenshots(testInfo, report);

    // Log summary
    console.log(`QA Score: ${report.score}/100`);
    console.log(`Bugs found: ${report.bugs.length}`);

    // Fail if critical bugs found
    expect(report.criticalBugs,
      `Found critical bugs: ${report.criticalBugs.map(b => b.title).join(', ')}`
    ).toHaveLength(0);
  });

  test('checkout flow analysis', async ({ page }, testInfo) => {
    await page.goto('/checkout');

    const report = await analyzeWithAI(page, {
      focus: 'forms', // Focus on form validation
    });

    await attachScreenshots(testInfo, report);
    expect(report.criticalBugs).toHaveLength(0);
  });
});
```

Set your API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY, GEMINI_API_KEY, etc.
```

Run tests:
```bash
npx playwright test
```

### Option 2: GitHub Action

Add to any repo with Vercel/Netlify preview deployments:

```yaml
# .github/workflows/ai-qa.yml
name: AI QA

on:
  pull_request:

jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Wait for Preview
        uses: patrickedqvist/wait-for-vercel-preview@v1.3.2
        id: preview
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max_timeout: 300

      - name: Run AI QA
        uses: tyler-james-bridges/ai-qa-engineer@main
        with:
          url: ${{ steps.preview.outputs.url }}
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Option 3: CLI

```bash
# Install
npm install -g ai-qa-engineer

# Run
export ANTHROPIC_API_KEY=sk-ant-...
ai-qa --url https://example.com
```

Or with environment variables:
```bash
URL=https://example.com \
VIEWPORTS=desktop,mobile \
ANTHROPIC_API_KEY=sk-ant-... \
npx ai-qa-engineer
```

## API Reference

### `analyzeWithAI(page, options?)`

Analyze a Playwright page with AI.

```typescript
const report = await analyzeWithAI(page, {
  viewports: ['desktop', 'mobile', 'tablet'], // default: ['desktop', 'mobile']
  focus: 'all',        // 'all' | 'accessibility' | 'performance' | 'forms' | 'visual'
  provider: 'anthropic', // 'anthropic' | 'openai' | 'gemini' | 'ollama'
  apiKey: 'sk-...',    // optional, uses env var if not provided
});
```

**Returns:** `AnalysisReport`

```typescript
interface AnalysisReport {
  url: string;
  title: string;
  score: number | null;        // 0-100
  summary: string;
  bugs: Bug[];
  criticalBugs: Bug[];         // Convenience: high/critical only
  recommendations: string[];
  consoleErrors: string[];
  networkErrors: NetworkError[];
  screenshots: Screenshot[];
}

interface Bug {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  viewport?: string;
  recommendation?: string;
}
```

### `attachScreenshots(testInfo, report)`

Attach all screenshots to the Playwright test report.

```typescript
test('example', async ({ page }, testInfo) => {
  const report = await analyzeWithAI(page);
  await attachScreenshots(testInfo, report);
});
```

### `createAnalyzer(defaultOptions)`

Create a pre-configured analyzer.

```typescript
const analyze = createAnalyzer({
  viewports: ['desktop', 'mobile', 'tablet'],
  focus: 'accessibility',
});

// Use in tests
const report = await analyze(page);
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `OLLAMA_BASE_URL` | Ollama server URL (default: http://localhost:11434) |
| `OLLAMA_MODEL` | Ollama model to use (default: llava) |

## Using with Allure Reports

If you're using Allure with Playwright, AI QA results automatically integrate:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['allure-playwright'],
  ],
});
```

Run tests and generate report:
```bash
npx playwright test
npx allure generate allure-results -o allure-report
npx allure open allure-report
```

Screenshots and bug details will appear in the Allure report alongside your other tests.

## Demo

**[Live demo site](https://tyler-james-bridges.github.io/ai-qa-engineer/)** with intentional bugs for testing.

## Credits

Based on the concept by [@alexanderOpalic](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/). Inspired by [@SawyerHood's dev-browser](https://github.com/sawyerhood/dev-browser).

## License

MIT
