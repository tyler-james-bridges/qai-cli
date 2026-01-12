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
   * @param {Buffer[]} captureData.screenshots - Screenshot buffers
   * @param {string[]} captureData.consoleErrors - Console error messages
   * @param {Object[]} captureData.networkErrors - Failed network requests
   * @param {string} captureData.pageTitle - Page title
   * @param {string} captureData.pageUrl - Page URL
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} QA report
   */
  // eslint-disable-next-line no-unused-vars
  async analyze(captureData, options = {}) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Build the analysis prompt
   */
  buildPrompt(captureData, options) {
    const { focus = 'all' } = options;

    return `You are an expert QA engineer analyzing a webpage. Be concise and actionable.

## Page Information
- URL: ${captureData.pageUrl}
- Title: ${captureData.pageTitle}

## Console Errors (${captureData.consoleErrors.length})
${captureData.consoleErrors.length > 0
    ? captureData.consoleErrors.map(e => `- ${e}`).join('\n')
    : 'None detected'}

## Network Errors (${captureData.networkErrors.length})
${captureData.networkErrors.length > 0
    ? captureData.networkErrors.map(e => `- ${e.url}: ${e.status} ${e.statusText}`).join('\n')
    : 'None detected'}

## Screenshots Provided
${captureData.screenshots.map(s => `- ${s.viewport}: ${s.width}x${s.height}`).join('\n')}

## Your Task
Analyze the screenshots and data above. Focus area: ${focus}

Report any issues you find in this JSON format:
{
  "summary": "Brief overall assessment",
  "bugs": [
    {
      "severity": "critical|high|medium|low",
      "category": "visual|functional|accessibility|performance|console|network",
      "title": "Short description",
      "description": "Detailed explanation",
      "viewport": "which viewport (if applicable)",
      "recommendation": "How to fix"
    }
  ],
  "score": 0-100,
  "recommendations": ["List of general improvements"]
}

Only report actual issues. If the page looks good, say so with an empty bugs array.
Respond with ONLY the JSON, no markdown code blocks.`;
  }

  /**
   * Parse LLM response into structured report
   */
  parseResponse(response) {
    try {
      // Try to extract JSON from response
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      // If parsing fails, return a structured error
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

module.exports = BaseProvider;
