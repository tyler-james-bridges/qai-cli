# AI QA Engineer

Automated, human-like testing for your Pull Requests using Claude Code + Playwright MCP.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://tyler-james-bridges.github.io/ai-qa-engineer/)
[![Run QA](https://img.shields.io/badge/run-QA%20test-blue)](../../actions/workflows/qa-engineer.yml)
[![Lint](https://github.com/tyler-james-bridges/ai-qa-engineer/actions/workflows/lint.yml/badge.svg)](https://github.com/tyler-james-bridges/ai-qa-engineer/actions/workflows/lint.yml)

> **Credit:** Based on the concept by [@alexanderOpalic](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/).

## Demo

**[Live demo site](https://tyler-james-bridges.github.io/ai-qa-engineer/)** with intentional bugs → Run the QA workflow against it to see real results.

## Features

- Multi-viewport testing (mobile, tablet, desktop)
- Network health monitoring (failed APIs, slow requests)
- Console error detection
- Visual regression testing
- Accessibility checks

## Quick Start

### 1. Copy files to your repo

```
.github/workflows/qa-engineer.yml
.claude/mcp-config.json
.claude/qa-engineer-prompt.md
```

### 2. Add your Anthropic API key

Repository Settings → Secrets → `ANTHROPIC_API_KEY`

### 3. Run it

Go to Actions → AI QA Engineer → Run workflow → Enter a URL

## Visual Regression

```bash
npm run visual:compare           # Compare against baseline
npm run visual:update-baseline   # Set new baseline
```

Or use the Visual Regression Testing workflow in Actions.

## Customization

Edit `.claude/qa-engineer-prompt.md` to customize the QA persona and test priorities.

## License

MIT
