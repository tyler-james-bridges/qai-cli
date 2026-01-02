# AI QA Engineer

Automated, human-like testing for your Pull Requests using Claude Code + Playwright MCP.

> **Credit:** This project builds on the concept demonstrated by [@alexanderOpalic](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/), who pioneered the idea of combining Claude Code with Playwright MCP for AI-driven QA testing. This implementation uses the Claude Code CLI directly with a standalone MCP configuration.

## Features

- **Network Health Monitoring** - Catches failed API calls, slow requests, and missing resources before they become user-visible bugs
- **Multi-Viewport Testing** - Mobile (375x667), Tablet (768x1024), Desktop (1920x1080)
- **Console Error Detection** - Monitors for JavaScript errors and warnings
- **Smart Page Load Detection** - Waits for true page readiness, not just DOM loaded
- **ARIA-Aware Element References** - Reports bugs using accessible names and roles for precise identification
- **Focused Testing Modes** - Run targeted tests for accessibility, performance, forms, or mobile

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
                             │  - Monitors network & console health        │
                             │  - Tests across viewports                   │
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
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐    │
│  │ Network Health│ │ Desktop Test  │ │ Mobile Test   │ │ Edge Cases    │    │
│  │ (API/Console) │ │ (1920x1080)   │ │ (375x667)     │ │ (Break it!)   │    │
│  └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
                             ┌─────────────────────────────────────────────┐
                             │  Output:                                     │
                             │  - Screenshots as artifacts                  │
                             │  - Network health report                     │
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
├── .claude/
│   ├── mcp-config.json
│   └── qa-engineer-prompt.md
└── scripts/                    # Optional utilities
    ├── page-utils.js
    └── aria-snapshot.js
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
2. Monitor network requests and console output
3. Test your site on mobile, tablet, and desktop viewports
4. Look for bugs, broken layouts, and edge cases
5. Post a detailed report as a PR comment
6. Upload screenshots as workflow artifacts

## Manual Testing

You can also trigger the workflow manually:

1. Go to Actions → AI QA Engineer
2. Click "Run workflow"
3. Enter a URL to test
4. Optionally select a focus area (accessibility, performance, forms, mobile, all)
5. View the results

## Utilities

### Smart Page Load Detection (`scripts/page-utils.js`)

Waits for true page readiness by monitoring network activity and filtering out non-critical resources like ads and tracking scripts:

```javascript
const { waitForPageReady, createNetworkLogger } = require('./scripts/page-utils');

// Wait for page to be truly ready
const result = await waitForPageReady(page, { timeout: 30000 });
console.log(`Page ready: ${result.ready}, Load time: ${result.loadTime}ms`);

// Monitor network for issues
const logger = createNetworkLogger(page);
// ... run tests ...
console.log(logger.getReport()); // Get formatted report of failures
```

### ARIA Snapshot (`scripts/aria-snapshot.js`)

Generate AI-friendly DOM snapshots with element references:

```javascript
const { getAriaSnapshot, clickByRef } = require('./scripts/aria-snapshot');

// Get snapshot
const snapshot = await getAriaSnapshot(page);
// Returns:
// - button "Submit" [ref=e5] [disabled]
// - textbox [ref=e3]
//   - /placeholder: "Email address"

// Interact by ref
await clickByRef(page, 'e5');
```

## Customization

### Modify the QA Persona

Edit `.claude/qa-engineer-prompt.md` to:
- Add specific test cases for your app
- Change testing priorities
- Add custom severity definitions
- Include app-specific edge cases

### Focus Areas

When triggering manually, you can focus on specific areas:
- `accessibility` - Tab navigation, focus states, ARIA, alt text
- `performance` - Load times, slow requests, janky interactions
- `forms` - Validation, edge cases, error handling
- `mobile` - Responsive design, touch targets, viewport issues
- `all` - Comprehensive testing (default)

### Add More Viewports

Edit the workflow to test additional screen sizes:
- Wide: 2560x1440 (QHD)
- Small mobile: 320x568 (iPhone SE 1st gen)

## Report Format

QA reports include:

```markdown
## Summary
3 bugs found (1 high, 2 medium)

## Network Health
- Total requests: 47
- Failed requests: 1
- Slow requests (>3s): 2

## Console Output
- Errors: 2
- Warnings: 5

## Bugs Found

### [BUG-001] Form submission fails silently
- **Severity**: High
- **Category**: Functional
- **Viewport**: Desktop (1920x1080)
- **Steps to Reproduce**:
  1. Navigate to /contact
  2. Fill form with valid data
  3. Click submit button [ref=e12]
- **Expected**: Success message appears
- **Actual**: Nothing happens, console shows 500 error
- **Screenshot**: form-submit-failure.png
```

## Requirements

- GitHub Actions enabled on your repository
- Anthropic API key with Claude access
- A deployed preview environment (Vercel, Netlify, GitHub Pages, etc.)

## Cost Considerations

Each QA run uses Claude API credits. Estimated cost per run:
- Simple pages: ~$0.10-0.30
- Complex apps: ~$0.50-1.00

Consider limiting runs to specific file changes by adding path filters to the workflow:

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - 'public/**'
      - '*.html'
```

## License

MIT
