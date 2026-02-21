const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

/**
 * Capture page data for QA analysis
 * @param {string} url - URL to test
 * @param {Object} options - Capture options
 * @returns {Promise<Object>} Capture data
 */
async function capturePage(url, options = {}) {
  const {
    viewports = ['desktop', 'mobile'],
    timeout = 30000,
    screenshotDir = './screenshots',
  } = options;

  // Ensure screenshot directory exists
  await fs.mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const captureData = {
    pageUrl: url,
    pageTitle: '',
    screenshots: [],
    consoleErrors: [],
    consoleWarnings: [],
    networkErrors: [],
    networkRequests: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Collect console messages
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();

      if (type === 'error') {
        captureData.consoleErrors.push(text);
      } else if (type === 'warning') {
        captureData.consoleWarnings.push(text);
      }
    });

    // Collect network errors
    page.on('requestfailed', (request) => {
      captureData.networkErrors.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || 'Unknown error',
      });
    });

    // Collect all network requests for analysis
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400) {
        captureData.networkErrors.push({
          url: response.url(),
          status,
          statusText: response.statusText(),
          method: response.request().method(),
        });
      }
    });

    // Navigate to the page
    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    // Get page title
    captureData.pageTitle = await page.title();
    console.log(`Page title: ${captureData.pageTitle}`);

    // Wait a bit for any lazy-loaded content
    await page.waitForTimeout(1000);

    // Capture screenshots at each viewport
    for (const viewportName of viewports) {
      const viewport = VIEWPORTS[viewportName];
      if (!viewport) {
        console.warn(`Unknown viewport: ${viewportName}, skipping`);
        continue;
      }

      console.log(`Capturing ${viewportName} (${viewport.width}x${viewport.height})...`);

      await page.setViewportSize(viewport);
      await page.waitForTimeout(500); // Let layout settle

      const screenshotPath = path.join(screenshotDir, `${viewportName}.png`);
      const buffer = await page.screenshot({
        path: screenshotPath,
        fullPage: false,
      });

      captureData.screenshots.push({
        viewport: viewportName,
        width: viewport.width,
        height: viewport.height,
        path: screenshotPath,
        buffer,
      });
    }

    console.log(`Captured ${captureData.screenshots.length} screenshots`);
    console.log(`Console errors: ${captureData.consoleErrors.length}`);
    console.log(`Network errors: ${captureData.networkErrors.length}`);
  } finally {
    await browser.close();
  }

  return captureData;
}

module.exports = { capturePage, VIEWPORTS };
