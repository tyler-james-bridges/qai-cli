/**
 * AI QA Engineer - Library Export
 *
 * Use this in your Playwright tests to add AI-powered QA analysis.
 *
 * @example
 * import { test, expect } from '@playwright/test';
 * import { analyzeWithAI } from 'ai-qa-engineer';
 *
 * test('AI QA: homepage', async ({ page }) => {
 *   await page.goto('/');
 *   const report = await analyzeWithAI(page);
 *
 *   // Attach screenshots to test report
 *   for (const screenshot of report.screenshots) {
 *     await test.info().attach(screenshot.name, {
 *       body: screenshot.buffer,
 *       contentType: 'image/png'
 *     });
 *   }
 *
 *   expect(report.criticalBugs).toHaveLength(0);
 * });
 */

const { getProvider, createProvider } = require('./providers');

/**
 * Viewport configurations
 */
const VIEWPORT_CONFIGS = {
  mobile: { width: 375, height: 667, name: 'mobile' },
  tablet: { width: 768, height: 1024, name: 'tablet' },
  desktop: { width: 1920, height: 1080, name: 'desktop' },
};

/**
 * Analyze a page with AI
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {Object} options - Analysis options
 * @param {string[]} [options.viewports=['desktop', 'mobile']] - Viewports to test
 * @param {string} [options.focus='all'] - Focus area (all, accessibility, performance, forms, visual)
 * @param {string} [options.provider] - LLM provider (anthropic, openai, gemini, ollama)
 * @param {string} [options.apiKey] - API key (uses env var if not provided)
 * @returns {Promise<AnalysisReport>} Analysis report with bugs, screenshots, and recommendations
 */
async function analyzeWithAI(page, options = {}) {
  const {
    viewports = ['desktop', 'mobile'],
    focus = 'all',
    provider: providerName,
    apiKey,
  } = options;

  const startTime = Date.now();

  // Get or create provider
  let provider;
  if (providerName && apiKey) {
    provider = createProvider(providerName, apiKey);
  } else {
    provider = getProvider();
  }

  // Capture page data
  const captureData = await capturePageData(page, viewports);

  // Analyze with AI
  const analysis = await provider.analyze(captureData, { focus });

  // Build report
  const report = {
    url: page.url(),
    title: await page.title(),
    timestamp: new Date().toISOString(),
    duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    score: analysis.score,
    summary: analysis.summary,
    bugs: analysis.bugs || [],
    criticalBugs: (analysis.bugs || []).filter(b =>
      b.severity === 'critical' || b.severity === 'high',
    ),
    recommendations: analysis.recommendations || [],
    consoleErrors: captureData.consoleErrors,
    networkErrors: captureData.networkErrors,
    screenshots: captureData.screenshots,
    viewports,
    focus,
  };

  return report;
}

/**
 * Capture page data including screenshots, console errors, and network errors
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string[]} viewports - Viewports to capture
 * @returns {Promise<CaptureData>}
 */
async function capturePageData(page, viewports) {
  const consoleErrors = [];
  const networkErrors = [];
  const screenshots = [];

  // Set up console listener
  const consoleHandler = (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  page.on('console', consoleHandler);

  // Set up network error listener
  const requestFailedHandler = (request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'Unknown error',
    });
  };
  page.on('requestfailed', requestFailedHandler);

  // Set up response listener for HTTP errors
  const responseHandler = (response) => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
      });
    }
  };
  page.on('response', responseHandler);

  // Store original viewport
  const originalViewport = page.viewportSize();

  // Capture screenshots at each viewport
  for (const viewportName of viewports) {
    const config = VIEWPORT_CONFIGS[viewportName.toLowerCase()];
    if (!config) {
      console.warn(`Unknown viewport: ${viewportName}, skipping`);
      continue;
    }

    // Set viewport
    await page.setViewportSize({ width: config.width, height: config.height });

    // Wait for any layout shifts
    await page.waitForTimeout(500);

    // Capture screenshot
    const buffer = await page.screenshot({ fullPage: true });

    screenshots.push({
      name: `${config.name}-${config.width}x${config.height}`,
      viewport: config.name,
      width: config.width,
      height: config.height,
      buffer,
      base64: buffer.toString('base64'),
    });
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  // Clean up listeners
  page.off('console', consoleHandler);
  page.off('requestfailed', requestFailedHandler);
  page.off('response', responseHandler);

  return {
    pageUrl: page.url(),
    pageTitle: await page.title(),
    timestamp: new Date().toISOString(),
    consoleErrors,
    networkErrors,
    screenshots,
  };
}

/**
 * Create a Playwright test helper that runs AI analysis
 * Use this to create reusable test fixtures
 *
 * @param {Object} defaultOptions - Default options for all analyses
 * @returns {Function} Configured analyzeWithAI function
 *
 * @example
 * // In your playwright fixtures
 * import { createAnalyzer } from 'ai-qa-engineer';
 *
 * const analyzeWithAI = createAnalyzer({
 *   viewports: ['desktop', 'mobile', 'tablet'],
 *   focus: 'accessibility',
 * });
 *
 * // In your tests
 * test('homepage', async ({ page }) => {
 *   await page.goto('/');
 *   const report = await analyzeWithAI(page);
 * });
 */
function createAnalyzer(defaultOptions = {}) {
  return (page, options = {}) => {
    return analyzeWithAI(page, { ...defaultOptions, ...options });
  };
}

/**
 * Attach all screenshots from a report to the Playwright test
 * Convenience helper for test files
 *
 * @param {Object} testInfo - Playwright test.info() object
 * @param {AnalysisReport} report - The AI analysis report
 *
 * @example
 * test('AI QA', async ({ page }, testInfo) => {
 *   await page.goto('/');
 *   const report = await analyzeWithAI(page);
 *   await attachScreenshots(testInfo, report);
 *   expect(report.criticalBugs).toHaveLength(0);
 * });
 */
async function attachScreenshots(testInfo, report) {
  for (const screenshot of report.screenshots) {
    await testInfo.attach(screenshot.name, {
      body: screenshot.buffer,
      contentType: 'image/png',
    });
  }
}

/**
 * Attach bug details as a test attachment
 *
 * @param {Object} testInfo - Playwright test.info() object
 * @param {AnalysisReport} report - The AI analysis report
 */
async function attachBugReport(testInfo, report) {
  const bugReport = {
    score: report.score,
    summary: report.summary,
    bugs: report.bugs,
    recommendations: report.recommendations,
    consoleErrors: report.consoleErrors,
    networkErrors: report.networkErrors,
  };

  await testInfo.attach('ai-qa-report', {
    body: JSON.stringify(bugReport, null, 2),
    contentType: 'application/json',
  });
}

module.exports = {
  analyzeWithAI,
  createAnalyzer,
  attachScreenshots,
  attachBugReport,
  capturePageData,
  VIEWPORT_CONFIGS,
};

/**
 * @typedef {Object} AnalysisReport
 * @property {string} url - Page URL
 * @property {string} title - Page title
 * @property {string} timestamp - ISO timestamp
 * @property {string} duration - Analysis duration
 * @property {number|null} score - QA score (0-100)
 * @property {string} summary - AI-generated summary
 * @property {Bug[]} bugs - All bugs found
 * @property {Bug[]} criticalBugs - Only critical/high severity bugs
 * @property {string[]} recommendations - AI recommendations
 * @property {string[]} consoleErrors - Console errors captured
 * @property {NetworkError[]} networkErrors - Network errors captured
 * @property {Screenshot[]} screenshots - Screenshots taken
 * @property {string[]} viewports - Viewports tested
 * @property {string} focus - Focus area used
 */

/**
 * @typedef {Object} Bug
 * @property {string} title - Bug title
 * @property {string} description - Bug description
 * @property {'critical'|'high'|'medium'|'low'} severity - Bug severity
 * @property {string} category - Bug category
 * @property {string} [viewport] - Viewport where bug was found
 * @property {string} [recommendation] - How to fix
 */

/**
 * @typedef {Object} Screenshot
 * @property {string} name - Screenshot name
 * @property {string} viewport - Viewport name
 * @property {number} width - Viewport width
 * @property {number} height - Viewport height
 * @property {Buffer} buffer - Screenshot buffer
 * @property {string} base64 - Base64 encoded screenshot
 */

/**
 * @typedef {Object} NetworkError
 * @property {string} url - Request URL
 * @property {string} method - HTTP method
 * @property {number} [status] - HTTP status code
 * @property {string} [failure] - Failure reason
 */

/**
 * @typedef {Object} CaptureData
 * @property {string} pageUrl - Page URL
 * @property {string} pageTitle - Page title
 * @property {string} timestamp - ISO timestamp
 * @property {string[]} consoleErrors - Console errors
 * @property {NetworkError[]} networkErrors - Network errors
 * @property {Screenshot[]} screenshots - Screenshots
 */
