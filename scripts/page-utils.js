/**
 * Smart Page Utilities for qaie
 * Adapted from dev-browser patterns for reliable page load detection
 */

// Ad/tracking domains to ignore when waiting for network idle
const IGNORED_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'facebook.com/tr',
  'hotjar.com',
  'intercom.io',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'newrelic.com',
  'nr-data.net',
  'fullstory.com',
  'clarity.ms',
  'bing.com/bat',
  'ads.linkedin.com',
  'analytics.twitter.com',
  'px.ads.linkedin.com',
];

// Non-critical resource types that shouldn't block page ready
const NON_CRITICAL_TYPES = ['image', 'font', 'media', 'stylesheet'];

/**
 * Check if a URL should be ignored for load detection
 */
function shouldIgnoreRequest(url) {
  try {
    const parsed = new URL(url);

    // Ignore data URLs
    if (parsed.protocol === 'data:') return true;

    // Ignore very long URLs (usually tracking pixels)
    if (url.length > 2000) return true;

    // Ignore known ad/tracking domains
    return IGNORED_DOMAINS.some((domain) => parsed.hostname.includes(domain));
  } catch {
    return true; // Invalid URLs are ignored
  }
}

/**
 * Wait for page to be truly ready (not just DOM loaded)
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {number} options.timeout - Max wait time in ms (default: 30000)
 * @param {number} options.networkIdleTime - Time with no requests to consider idle (default: 500)
 * @param {number} options.nonCriticalTimeout - Extra time to wait for non-critical resources (default: 3000)
 * @returns {Promise<{ready: boolean, pendingRequests: string[], loadTime: number}>}
 */
async function waitForPageReady(page, options = {}) {
  const { timeout = 30000, networkIdleTime = 500, nonCriticalTimeout = 3000 } = options;

  const startTime = Date.now();
  const pendingRequests = new Map();

  // Track network requests
  const onRequest = (request) => {
    const url = request.url();
    if (!shouldIgnoreRequest(url)) {
      pendingRequests.set(request, {
        url,
        type: request.resourceType(),
        startTime: Date.now(),
      });
    }
  };

  const onResponse = (response) => {
    pendingRequests.delete(response.request());
  };

  const onRequestFailed = (request) => {
    pendingRequests.delete(request);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  try {
    // Wait for DOM content loaded first
    await page.waitForLoadState('domcontentloaded', { timeout });

    // Now wait for network to settle
    while (Date.now() - startTime < timeout) {
      // Filter to only critical pending requests
      const criticalPending = Array.from(pendingRequests.values()).filter((req) => {
        const elapsed = Date.now() - req.startTime;

        // Non-critical resources get extra grace period
        if (NON_CRITICAL_TYPES.includes(req.type)) {
          return elapsed < nonCriticalTimeout;
        }

        return true;
      });

      if (criticalPending.length === 0) {
        // No critical requests pending, wait for idle time
        await new Promise((r) => setTimeout(r, networkIdleTime));

        // Check again after idle time
        const stillPending = Array.from(pendingRequests.values()).filter((req) => {
          const elapsed = Date.now() - req.startTime;
          if (NON_CRITICAL_TYPES.includes(req.type)) {
            return elapsed < nonCriticalTimeout;
          }
          return true;
        });

        if (stillPending.length === 0) {
          break;
        }
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    const loadTime = Date.now() - startTime;
    const remaining = Array.from(pendingRequests.values()).map((r) => r.url);

    return {
      ready: remaining.length === 0,
      pendingRequests: remaining,
      loadTime,
    };
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}

/**
 * Network request logger for detecting failed API calls
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @returns {Object} Logger object with methods to get results
 */
function createNetworkLogger(page) {
  const requests = [];
  const failures = [];
  const slowRequests = [];
  const SLOW_THRESHOLD = 3000;

  const onRequest = (request) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
      startTime: Date.now(),
    });
  };

  const onResponse = (response) => {
    const request = response.request();
    const entry = requests.find((r) => r.url === request.url() && !r.endTime);

    if (entry) {
      entry.endTime = Date.now();
      entry.duration = entry.endTime - entry.startTime;
      entry.status = response.status();

      // Track slow requests
      if (entry.duration > SLOW_THRESHOLD) {
        slowRequests.push(entry);
      }

      // Track failed requests (4xx, 5xx)
      if (response.status() >= 400) {
        failures.push({
          ...entry,
          statusText: response.statusText(),
        });
      }
    }
  };

  const onRequestFailed = (request) => {
    const entry = requests.find((r) => r.url === request.url() && !r.endTime);
    if (entry) {
      entry.endTime = Date.now();
      entry.duration = entry.endTime - entry.startTime;
      entry.failed = true;
      entry.error = request.failure()?.errorText || 'Unknown error';
      failures.push(entry);
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    /**
     * Get summary of network activity
     */
    getSummary() {
      return {
        totalRequests: requests.length,
        failedRequests: failures.length,
        slowRequests: slowRequests.length,
        failures: failures.map((f) => ({
          url: f.url,
          method: f.method,
          status: f.status,
          error: f.error,
          duration: f.duration,
        })),
        slow: slowRequests.map((s) => ({
          url: s.url,
          duration: s.duration,
        })),
      };
    },

    /**
     * Get formatted report for QA output
     */
    getReport() {
      const summary = this.getSummary();
      let report = '### Network Summary\n';
      report += `- Total requests: ${summary.totalRequests}\n`;
      report += `- Failed requests: ${summary.failedRequests}\n`;
      report += `- Slow requests (>${SLOW_THRESHOLD}ms): ${summary.slowRequests}\n\n`;

      if (summary.failures.length > 0) {
        report += '#### Failed Requests\n';
        summary.failures.forEach((f) => {
          report += `- \`${f.method} ${f.url}\`\n`;
          report += `  - Status: ${f.status || 'N/A'}\n`;
          if (f.error) report += `  - Error: ${f.error}\n`;
        });
        report += '\n';
      }

      if (summary.slow.length > 0) {
        report += '#### Slow Requests\n';
        summary.slow.forEach((s) => {
          report += `- \`${s.url}\` (${s.duration}ms)\n`;
        });
      }

      return report;
    },

    /**
     * Stop logging and clean up
     */
    stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

/**
 * Get console errors from the page
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @returns {Object} Console logger with methods to get results
 */
function createConsoleLogger(page) {
  const errors = [];
  const warnings = [];

  const onConsole = (msg) => {
    const type = msg.type();
    const entry = {
      type,
      text: msg.text(),
      location: msg.location(),
    };

    if (type === 'error') {
      errors.push(entry);
    } else if (type === 'warning') {
      warnings.push(entry);
    }
  };

  const onPageError = (error) => {
    errors.push({
      type: 'pageerror',
      text: error.message,
      stack: error.stack,
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    getErrors() {
      return errors;
    },

    getWarnings() {
      return warnings;
    },

    getReport() {
      let report = '### Console Output\n';
      report += `- Errors: ${errors.length}\n`;
      report += `- Warnings: ${warnings.length}\n\n`;

      if (errors.length > 0) {
        report += '#### Errors\n';
        errors.forEach((e, i) => {
          report += `${i + 1}. \`${e.text}\`\n`;
          if (e.location?.url) {
            report += `   - Location: ${e.location.url}:${e.location.lineNumber}\n`;
          }
        });
        report += '\n';
      }

      if (warnings.length > 0) {
        report += '#### Warnings\n';
        warnings.forEach((w, i) => {
          report += `${i + 1}. \`${w.text}\`\n`;
        });
      }

      return report;
    },

    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}

module.exports = {
  waitForPageReady,
  createNetworkLogger,
  createConsoleLogger,
  shouldIgnoreRequest,
  IGNORED_DOMAINS,
};
