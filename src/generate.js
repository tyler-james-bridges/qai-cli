/**
 * Test Generation Engine
 *
 * Two modes:
 * 1. URL crawl: Navigate a site, record interactions, generate Playwright E2E specs
 * 2. Code analysis: Read source files, generate unit/integration tests
 *
 * Usage:
 *   qai generate https://mysite.com          # E2E tests from URL
 *   qai generate src/billing.ts              # Unit tests from source
 *   qai generate src/ --pattern "*.service*" # Batch generate
 */

const fs = require('fs');
const path = require('path');
const { getProvider } = require('./providers');

/**
 * Generate tests from a URL (E2E) or source file (unit)
 *
 * @param {Object} options
 * @param {string} options.target - URL or file/directory path
 * @param {string} [options.outDir] - Output directory for generated tests (default: ./tests/generated)
 * @param {string} [options.framework] - Test framework (playwright, jest, vitest)
 * @param {string} [options.pattern] - Glob pattern for batch file mode
 * @param {string} [options.baseUrl] - Base URL for generated E2E tests
 * @param {boolean} [options.dryRun] - Print tests to stdout instead of writing files
 * @returns {Promise<GenerateResult>}
 */
async function generateTests(options = {}) {
  const {
    target,
    outDir = './tests/generated',
    framework = 'playwright',
    dryRun = false,
  } = options;

  if (!target) {
    throw new Error('Target is required (URL or file path)');
  }

  // Determine mode: URL or file
  const isUrl = target.startsWith('http://') || target.startsWith('https://');

  if (isUrl) {
    return generateE2ETests({ ...options, url: target, outDir, framework, dryRun });
  } else {
    return generateUnitTests({ ...options, filePath: target, outDir, framework, dryRun });
  }
}

/**
 * Generate E2E tests by crawling a URL
 */
async function generateE2ETests(options) {
  const { url, outDir, framework, dryRun } = options;

  console.log('[1/3] Crawling site...');
  const siteData = await crawlSite(url);

  console.log(
    `  Found ${siteData.pages.length} pages, ${siteData.interactions.length} interactive elements`,
  );

  console.log('[2/3] Generating tests with AI...');
  const provider = getProvider();
  const prompt = buildE2EPrompt(siteData, framework);
  const result = await provider.generateTests(prompt);

  console.log('[3/3] Writing test files...');
  const files = parseGeneratedFiles(result);

  if (dryRun) {
    for (const file of files) {
      console.log(`\n--- ${file.name} ---`);
      console.log(file.content);
    }
  } else {
    writeTestFiles(files, outDir);
  }

  return {
    mode: 'e2e',
    url,
    pagesFound: siteData.pages.length,
    testsGenerated: files.length,
    files: files.map((f) => f.name),
    outDir,
  };
}

/**
 * Generate unit tests from source file(s)
 */
async function generateUnitTests(options) {
  const { filePath, outDir, framework, dryRun, pattern } = options;

  console.log('[1/3] Reading source files...');
  const sources = readSourceFiles(filePath, pattern);
  console.log(`  Found ${sources.length} source files`);

  if (sources.length === 0) {
    throw new Error(`No source files found at: ${filePath}`);
  }

  const allFiles = [];

  for (const source of sources) {
    console.log(`[2/3] Generating tests for ${source.relativePath}...`);
    const provider = getProvider();
    const prompt = buildUnitTestPrompt(source, framework);
    const result = await provider.generateTests(prompt);
    const files = parseGeneratedFiles(result);

    allFiles.push(...files);
  }

  console.log('[3/3] Writing test files...');
  if (dryRun) {
    for (const file of allFiles) {
      console.log(`\n--- ${file.name} ---`);
      console.log(file.content);
    }
  } else {
    writeTestFiles(allFiles, outDir);
  }

  return {
    mode: 'unit',
    sourcesAnalyzed: sources.length,
    testsGenerated: allFiles.length,
    files: allFiles.map((f) => f.name),
    outDir,
  };
}

/**
 * Crawl a site and gather page data using Playwright
 */
async function crawlSite(url) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright is required for E2E test generation. Install it: npm install playwright',
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pages = [];
  const interactions = [];
  const visited = new Set();
  const baseUrl = new URL(url);
  const toVisit = [url];

  // Crawl up to 10 pages
  while (toVisit.length > 0 && visited.size < 10) {
    const currentUrl = toVisit.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1000);

      const title = await page.title();
      const pageUrl = page.url();

      // Gather interactive elements
      /* eslint-disable no-undef */
      const elements = await page.evaluate(() => {
        const result = [];

        // Buttons
        document.querySelectorAll('button, [role="button"]').forEach((el) => {
          result.push({
            type: 'button',
            text: el.textContent.trim().slice(0, 100),
            selector: getSelector(el),
          });
        });

        // Links
        document.querySelectorAll('a[href]').forEach((el) => {
          result.push({
            type: 'link',
            text: el.textContent.trim().slice(0, 100),
            href: el.href,
            selector: getSelector(el),
          });
        });

        // Forms
        document.querySelectorAll('form').forEach((form) => {
          const inputs = [];
          form.querySelectorAll('input, textarea, select').forEach((input) => {
            inputs.push({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name,
              placeholder: input.placeholder,
              required: input.required,
              selector: getSelector(input),
            });
          });
          result.push({
            type: 'form',
            action: form.action,
            method: form.method,
            inputs,
            selector: getSelector(form),
          });
        });

        // Navigation elements
        document.querySelectorAll('nav a, [role="navigation"] a').forEach((el) => {
          result.push({
            type: 'nav-link',
            text: el.textContent.trim().slice(0, 100),
            href: el.href,
            selector: getSelector(el),
          });
        });

        function getSelector(el) {
          if (el.id) return `#${el.id}`;
          if (el.getAttribute('data-testid')) {
            return `[data-testid="${el.getAttribute('data-testid')}"]`;
          }
          if (el.getAttribute('aria-label')) {
            return `[aria-label="${el.getAttribute('aria-label')}"]`;
          }
          const text = el.textContent.trim().slice(0, 30);
          if (text && el.tagName) {
            return `${el.tagName.toLowerCase()}:has-text("${text}")`;
          }
          return null;
        }

        return result;
      });
      /* eslint-enable no-undef */

      pages.push({ url: pageUrl, title, elementCount: elements.length });
      interactions.push(...elements.map((e) => ({ ...e, page: pageUrl })));

      // Find same-origin links to crawl
      const links = elements
        .filter((e) => e.type === 'link' || e.type === 'nav-link')
        .filter((e) => {
          try {
            const linkUrl = new URL(e.href);
            return linkUrl.origin === baseUrl.origin;
          } catch {
            return false;
          }
        })
        .map((e) => e.href);

      for (const link of links) {
        if (!visited.has(link)) {
          toVisit.push(link);
        }
      }
    } catch {
      // Skip pages that fail to load
    }
  }

  await browser.close();

  return { url, pages, interactions };
}

/**
 * Read source file(s) for unit test generation
 */
function readSourceFiles(filePath, pattern) {
  const sources = [];
  const absPath = path.resolve(filePath);

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    // Single file
    sources.push({
      relativePath: filePath,
      content: fs.readFileSync(absPath, 'utf-8'),
      ext: path.extname(filePath),
    });
  } else if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
    // Directory - find source files
    const exts = ['.js', '.ts', '.jsx', '.tsx', '.mjs'];
    const skipDirs = ['node_modules', '.next', 'dist', '.git', '__tests__', 'test', 'tests'];

    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name)) walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!exts.includes(ext)) continue;
          // Skip test files
          if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
          // Apply pattern filter if specified
          if (pattern && !entry.name.match(new RegExp(pattern.replace(/\*/g, '.*')))) continue;

          const content = fs.readFileSync(fullPath, 'utf-8');
          // Skip very large or very small files
          if (content.length > 30000 || content.length < 50) continue;

          sources.push({
            relativePath: path.relative(process.cwd(), fullPath),
            content,
            ext,
          });
        }
      }
    };

    walk(absPath);
    // Cap at 10 files
    sources.splice(10);
  }

  return sources;
}

/**
 * Build prompt for E2E test generation
 */
function buildE2EPrompt(siteData, framework) {
  const frameworkGuide = E2E_FRAMEWORKS[framework] || E2E_FRAMEWORKS.playwright;

  return `You are a senior QA automation engineer. Generate comprehensive E2E tests for this website.

## Site Information
- URL: ${siteData.url}
- Pages found: ${siteData.pages.length}

## Pages
${siteData.pages.map((p) => `- ${p.url} (${p.title}) - ${p.elementCount} elements`).join('\n')}

## Interactive Elements
${JSON.stringify(siteData.interactions.slice(0, 100), null, 2)}

## Framework
${frameworkGuide}

## Instructions
Generate test files that cover:
1. Page navigation (all discovered pages load correctly)
2. Interactive elements (buttons click, forms submit)
3. Navigation flow (links work, nav elements route correctly)
4. Form validation (required fields, error states)
5. Responsive behavior (test at mobile and desktop viewports)

Output format - return ONLY a JSON array of files:
[
  {
    "name": "homepage.spec.ts",
    "content": "// full test file content here"
  }
]

Write real, runnable tests. Use descriptive test names. Add meaningful assertions.
Do NOT generate placeholder or skeleton tests.
Respond with ONLY the JSON array, no markdown code blocks.`;
}

/**
 * Build prompt for unit test generation
 */
function buildUnitTestPrompt(source, framework) {
  const frameworkGuide = UNIT_FRAMEWORKS[framework] || UNIT_FRAMEWORKS.jest;

  return `You are a senior QA automation engineer. Generate comprehensive unit tests for this source file.

## Source File: ${source.relativePath}
\`\`\`${source.ext.replace('.', '')}
${source.content}
\`\`\`

## Framework
${frameworkGuide}

## Instructions
Generate thorough unit tests that cover:
1. All exported functions/classes
2. Happy path for each function
3. Edge cases (null, undefined, empty, boundary values)
4. Error cases (invalid input, thrown errors)
5. Any async behavior (resolved/rejected promises)

Output format - return ONLY a JSON array of files:
[
  {
    "name": "${getTestFileName(source.relativePath, framework)}",
    "content": "// full test file content here"
  }
]

Write real, runnable tests with meaningful assertions.
Mock external dependencies where appropriate.
Do NOT generate placeholder or skeleton tests.
Respond with ONLY the JSON array, no markdown code blocks.`;
}

/**
 * Parse LLM response into file objects
 */
function parseGeneratedFiles(response) {
  try {
    let text = typeof response === 'string' ? response : response.raw || '';

    // Remove markdown code blocks
    if (text.startsWith('```')) {
      text = text.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
    }

    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.files) return parsed.files;
    return [parsed];
  } catch {
    // If we can't parse JSON, treat entire response as a single test file
    const text = typeof response === 'string' ? response : response.raw || '';
    return [{ name: 'generated.spec.ts', content: text }];
  }
}

/**
 * Write test files to disk
 */
function writeTestFiles(files, outDir) {
  const absOutDir = path.resolve(outDir);
  if (!fs.existsSync(absOutDir)) {
    fs.mkdirSync(absOutDir, { recursive: true });
  }

  for (const file of files) {
    const filePath = path.join(absOutDir, file.name);
    fs.writeFileSync(filePath, file.content);
    console.log(`  Written: ${filePath}`);
  }
}

/**
 * Get test file name from source file path
 */
function getTestFileName(sourcePath, _framework) {
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  const testExt = ext === '.ts' || ext === '.tsx' ? '.test.ts' : '.test.js';
  return `${base}${testExt}`;
}

const E2E_FRAMEWORKS = {
  playwright: `Use @playwright/test:
- import { test, expect } from '@playwright/test'
- Use page.goto(), page.click(), page.fill(), page.locator()
- Use expect(page).toHaveTitle(), expect(locator).toBeVisible()
- Use test.describe() for grouping
- Use page.setViewportSize() for responsive tests`,
};

const UNIT_FRAMEWORKS = {
  jest: `Use Jest:
- describe/it/expect syntax
- jest.fn() for mocks
- beforeEach/afterEach for setup
- Use .toEqual, .toBe, .toThrow, .toBeNull etc.`,
  vitest: `Use Vitest:
- import { describe, it, expect, vi } from 'vitest'
- vi.fn() for mocks
- Same assertion API as Jest`,
  playwright: `Use @playwright/test:
- import { test, expect } from '@playwright/test'
- Same assertion API but for component/integration tests`,
};

module.exports = {
  generateTests,
  generateE2ETests,
  generateUnitTests,
  crawlSite,
  readSourceFiles,
  buildE2EPrompt,
  buildUnitTestPrompt,
  parseGeneratedFiles,
  writeTestFiles,
};
