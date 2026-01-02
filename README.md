# AI QA Engineer

Automated, human-like testing for your Pull Requests using Claude Code + Playwright MCP.

> **Credit:** This project builds on the concept demonstrated by [@alexanderOpalic](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/), who pioneered the idea of combining Claude Code with Playwright MCP for AI-driven QA testing. This implementation uses the Claude Code CLI directly with a standalone MCP configuration.

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────────┐
│  Developer  │────▶│  GitHub PR  │────▶│  GitHub Actions Workflow        │
└─────────────┘     └─────────────┘     │  (Automated Trigger)            │
                                        └─────────────┬───────────────────┘
                                                      │
                                                      ▼
                             ┌─────────────────────────────────────────────┐
                             │  Claude Code (AI QA Engineer "Sage")        │
                             │  - Thinks about edge cases                  │
                             │  - Plans comprehensive tests                │
                             │  - Tries to break things                    │
                             └─────────────────────────┬───────────────────┘
                                                      │
                                                      ▼
                             ┌─────────────────────────────────────────────┐
                             │  Playwright MCP (Browser Automation)        │
                             │  - Clicks, types, scrolls                   │
                             │  - Resizes viewport                         │
                             │  - Takes screenshots                        │
                             └─────────────────────────┬───────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Tests Performed:                                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Desktop Testing │  │ Mobile Testing  │  │ Edge Cases      │              │
│  │ (1920x1080)     │  │ (375x667)       │  │ (Break things!) │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
                             ┌─────────────────────────────────────────────┐
                             │  Output:                                     │
                             │  - Screenshots as artifacts                  │
                             │  - Detailed bug report on PR                 │
                             │  - Severity ratings & repro steps            │
                             └─────────────────────────────────────────────┘
```

## Quick Start

### 1. Copy to Your Repository

Copy these files to your repository:

```
your-repo/
├── .github/
│   └── workflows/
│       └── qa-engineer.yml
└── .claude/
    ├── mcp-config.json
    └── qa-engineer-prompt.md
```

### 2. Add Your Anthropic API Key

Go to your repository Settings → Secrets and variables → Actions → New repository secret

- Name: `ANTHROPIC_API_KEY`
- Value: Your Anthropic API key

### 3. Configure Your Preview URL

Edit `.github/workflows/qa-engineer.yml` and update the preview URL logic for your deployment platform:

**For Vercel:**
```bash
PREVIEW_URL="https://${{ github.event.repository.name }}-git-${{ github.head_ref }}-${{ github.repository_owner }}.vercel.app"
```

**For Netlify:**
```bash
PREVIEW_URL="https://deploy-preview-${{ github.event.number }}--your-site.netlify.app"
```

**For GitHub Pages:**
```bash
PREVIEW_URL="https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}"
```

### 4. Create a Pull Request

The AI QA Engineer will automatically:
1. Wait for your preview deployment
2. Test your site on desktop and mobile viewports
3. Look for bugs, broken layouts, and edge cases
4. Post a detailed report as a PR comment
5. Upload screenshots as workflow artifacts

## Manual Testing

You can also trigger the workflow manually:

1. Go to Actions → AI QA Engineer
2. Click "Run workflow"
3. Enter a URL to test
4. View the results

## Customization

### Modify the QA Persona

Edit `.claude/qa-engineer-prompt.md` to:
- Add specific test cases for your app
- Change testing priorities
- Add custom severity definitions
- Include app-specific edge cases

### Add More Viewports

Edit the workflow to test additional screen sizes.

### Focus on Specific Features

Customize the prompt to test specific features like:
- User authentication flow
- Shopping cart functionality
- Form validation

## Requirements

- GitHub Actions enabled on your repository
- Anthropic API key with Claude access
- A deployed preview environment (Vercel, Netlify, GitHub Pages, etc.)

## Cost Considerations

Each QA run uses Claude API credits. Estimated cost per run:
- Simple pages: ~$0.10-0.30
- Complex apps: ~$0.50-1.00

Consider limiting runs to specific file changes by adding path filters to the workflow.

## License

MIT
