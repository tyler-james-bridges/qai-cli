/**
 * Base provider class - defines the interface for all LLM providers
 */
class BaseProvider {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.options = options;
  }

  /**
   * Analyze page capture data and return QA findings
   * @param {Object} captureData - Page capture data
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} QA report
   */
  // eslint-disable-next-line no-unused-vars
  async analyze(captureData, options = {}) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Review code changes (PR diff + context)
   * @param {string} diff - Unified diff
   * @param {Object} context - Codebase context (files, deps, dependents)
   * @param {Object} options - Review options
   * @returns {Promise<Object>} Review report
   */
  // eslint-disable-next-line no-unused-vars
  async reviewCode(diff, context, options = {}) {
    throw new Error('reviewCode() must be implemented by subclass');
  }

  /**
   * Generate tests from a prompt
   * @param {string} prompt - The generation prompt
   * @returns {Promise<string>} Raw LLM response (JSON array of files)
   */
  // eslint-disable-next-line no-unused-vars
  async generateTests(prompt) {
    throw new Error('generateTests() must be implemented by subclass');
  }

  /**
   * Build the analysis prompt with focus-specific guidance
   */
  buildPrompt(captureData, options) {
    const { focus = 'all' } = options;

    const focusGuidance = FOCUS_PROMPTS[focus] || FOCUS_PROMPTS.all;

    const ariaSection = captureData.ariaSnapshot
      ? `\n## ARIA / Accessibility Tree\n\`\`\`\n${captureData.ariaSnapshot}\n\`\`\``
      : '';

    const domSection = captureData.domSummary ? `\n## DOM Summary\n${captureData.domSummary}` : '';

    return `You are an expert QA engineer analyzing a webpage. Be concise and actionable. Report real issues only — do not invent problems.

## Page Information
- URL: ${captureData.pageUrl}
- Title: ${captureData.pageTitle}

## Console Errors (${captureData.consoleErrors.length})
${
  captureData.consoleErrors.length > 0
    ? captureData.consoleErrors.map((e) => `- ${e}`).join('\n')
    : 'None detected'
}

## Network Errors (${captureData.networkErrors.length})
${
  captureData.networkErrors.length > 0
    ? captureData.networkErrors.map((e) => `- ${e.url}: ${e.status} ${e.statusText}`).join('\n')
    : 'None detected'
}

## Screenshots Provided
${captureData.screenshots.map((s) => `- ${s.viewport}: ${s.width}x${s.height}`).join('\n')}

${ariaSection}${domSection}

## Focus Area: ${focus}
${focusGuidance}

Report issues in this JSON format:
{
  "summary": "Brief overall assessment",
  "bugs": [
    {
      "severity": "critical|high|medium|low",
      "category": "visual|functional|accessibility|performance|console|network|responsive",
      "title": "Short description",
      "description": "Detailed explanation with specific element references",
      "viewport": "which viewport (if applicable)",
      "recommendation": "How to fix"
    }
  ],
  "score": 0-100,
  "recommendations": ["List of general improvements"]
}

Only report actual issues. If the page looks good, say so with an empty bugs array and a high score.
Respond with ONLY the JSON, no markdown code blocks.`;
  }

  /**
   * Parse LLM response into structured report
   */
  parseResponse(response) {
    try {
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      return {
        summary: 'Failed to parse LLM response',
        bugs: [],
        score: null,
        recommendations: [],
        raw_response: response,
        parse_error: error.message,
      };
    }
  }

  /**
   * Build the code review prompt
   */
  buildReviewPrompt(diff, context, options = {}) {
    const { focus = 'all' } = options;

    const focusGuidance = REVIEW_FOCUS[focus] || REVIEW_FOCUS.all;

    // Build context section
    let contextSection = '';
    if (context.summary) {
      contextSection += `\n## Change Summary\n${context.summary}\n`;
    }

    // Include dependency info
    if (Object.keys(context.dependencies || {}).length > 0) {
      contextSection += '\n## Dependencies\n';
      for (const [file, deps] of Object.entries(context.dependencies || {})) {
        contextSection += `- \`${file}\` imports: ${deps.map((d) => `\`${d}\``).join(', ')}\n`;
      }
    }

    if (Object.keys(context.dependents || {}).length > 0) {
      contextSection += '\n## Dependents (files affected by these changes)\n';
      for (const [file, deps] of Object.entries(context.dependents || {})) {
        contextSection += `- \`${file}\` is used by: ${deps
          .slice(0, 5)
          .map((d) => `\`${d}\``)
          .join(', ')}${deps.length > 5 ? ` (+${deps.length - 5} more)` : ''}\n`;
      }
    }

    if (Object.keys(context.tests || {}).length > 0) {
      contextSection += '\n## Related Tests\n';
      for (const [file, test] of Object.entries(context.tests || {})) {
        contextSection += `- \`${file}\` has test: \`${test}\`\n`;
      }
    }

    // Include relevant file contents (trimmed)
    let fileContents = '';
    const contextFiles = Object.entries(context.files || {});
    if (contextFiles.length > 0) {
      fileContents = '\n## Full File Contents (for context)\n';
      for (const [filePath, content] of contextFiles) {
        fileContents += `\n### \`${filePath}\`\n\`\`\`\n${content}\n\`\`\`\n`;
      }
    }

    return `You are a senior software engineer doing a thorough code review. You have deep expertise in finding real bugs, security issues, and breaking changes. You are NOT a linter. Skip style nits.

## Focus: ${focus}
${focusGuidance}

${contextSection}
${fileContents}

## Diff to Review
\`\`\`diff
${diff}
\`\`\`

## Instructions
- Focus on **real bugs**, security holes, breaking changes, edge cases, and logic errors
- Reference specific files and line numbers
- Skip style/formatting issues (that's what linters are for)
- If code looks good, say so. Don't invent problems.
- Be direct and specific. No filler.

Respond with ONLY this JSON (no code blocks):
{
  "summary": "2-3 sentence overview of the changes and their quality",
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "category": "bug|security|breaking-change|performance|error-handling|logic|race-condition|type-safety",
      "title": "Short description",
      "description": "What's wrong and why it matters",
      "file": "path/to/file.js",
      "line": 42,
      "suggestion": "Code or explanation of how to fix"
    }
  ],
  "score": 0-100,
  "recommendations": ["General suggestions for improvement"]
}`;
  }
}

/**
 * Review focus areas
 */
const REVIEW_FOCUS = {
  all: 'Review for bugs, security issues, breaking changes, performance problems, error handling gaps, and logic errors.',
  security:
    'Focus on security vulnerabilities: injection, auth bypass, data exposure, SSRF, path traversal, ' +
    'insecure crypto, missing input validation, secrets in code.',
  performance:
    'Focus on performance: N+1 queries, unnecessary re-renders, missing memoization, ' +
    'blocking operations, memory leaks, large bundle impact.',
  bugs:
    'Focus on correctness: logic errors, off-by-one, null/undefined access, race conditions, ' +
    'unhandled promise rejections, incorrect error handling.',
};

/**
 * Focus-specific prompt guidance
 */
const FOCUS_PROMPTS = {
  all:
    'Check everything: visual consistency, responsiveness across viewports, ' +
    'accessibility, console/network errors, interactive element states, ' +
    'text readability, contrast, layout issues, and broken functionality.',

  accessibility: `Focus on accessibility issues:
- Missing or incorrect ARIA labels/roles
- Color contrast failures (WCAG AA minimum 4.5:1 for text)
- Missing alt text on images
- Keyboard navigation issues (tab order, focus indicators)
- Screen reader compatibility (heading hierarchy, landmark regions)
- Form labels and error messages
- Touch target sizes (minimum 44x44px)`,

  visual: `Focus on visual and design issues:
- Layout breaks or misalignment across viewports
- Overlapping elements
- Inconsistent spacing, padding, margins
- Text truncation or overflow
- Dark mode / light mode rendering problems
- Font rendering issues
- Image quality and sizing
- Z-index stacking issues`,

  responsive: `Focus on responsive design:
- Layout differences between mobile, tablet, and desktop
- Elements that overflow or get cut off on smaller screens
- Touch targets too small on mobile
- Text that's too small to read on mobile
- Navigation usability on mobile (hamburger menu, etc.)
- Horizontal scrolling on mobile (usually a bug)
- Images not scaling properly`,

  forms: `Focus on form usability:
- Input field labels and placeholders
- Validation feedback (inline errors, success states)
- Required field indicators
- Tab order between fields
- Submit button states (disabled, loading, success, error)
- Auto-fill compatibility
- Mobile keyboard types (email, number, tel)`,

  performance: `Focus on performance indicators visible in the page:
- Lazy loading implementation
- Image optimization (large uncompressed images)
- Render-blocking resources
- Layout shifts (elements moving after load)
- Loading states and skeletons
- Excessive DOM elements
- Console warnings about performance`,
};

module.exports = BaseProvider;
