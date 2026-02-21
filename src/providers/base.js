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
}

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
