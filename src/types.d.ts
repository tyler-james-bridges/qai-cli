import type { Page, TestInfo } from '@playwright/test';

export interface AnalysisOptions {
  /** Viewports to test (default: ['desktop', 'mobile']) */
  viewports?: ('mobile' | 'tablet' | 'desktop')[];
  /** Focus area for analysis */
  focus?: 'all' | 'accessibility' | 'performance' | 'forms' | 'visual';
  /** LLM provider to use */
  provider?: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'codex';
  /** API key (uses env var if not provided) */
  apiKey?: string;
}

export interface Bug {
  /** Bug title */
  title: string;
  /** Detailed description */
  description: string;
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Bug category */
  category: string;
  /** Viewport where bug was found */
  viewport?: string;
  /** How to fix the bug */
  recommendation?: string;
}

export interface Screenshot {
  /** Screenshot name (e.g., "desktop-1920x1080") */
  name: string;
  /** Viewport name */
  viewport: string;
  /** Viewport width */
  width: number;
  /** Viewport height */
  height: number;
  /** Raw screenshot buffer */
  buffer: Buffer;
  /** Base64 encoded screenshot */
  base64: string;
}

export interface NetworkError {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** HTTP status code (for response errors) */
  status?: number;
  /** Failure reason (for request failures) */
  failure?: string;
}

export interface AnalysisReport {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** ISO timestamp */
  timestamp: string;
  /** Analysis duration */
  duration: string;
  /** QA score (0-100) */
  score: number | null;
  /** AI-generated summary */
  summary: string;
  /** All bugs found */
  bugs: Bug[];
  /** Only critical/high severity bugs (convenience property) */
  criticalBugs: Bug[];
  /** AI recommendations */
  recommendations: string[];
  /** Console errors captured */
  consoleErrors: string[];
  /** Network errors captured */
  networkErrors: NetworkError[];
  /** Screenshots taken */
  screenshots: Screenshot[];
  /** Viewports tested */
  viewports: string[];
  /** Focus area used */
  focus: string;
}

export interface ViewportConfig {
  width: number;
  height: number;
  name: string;
}

/**
 * Analyze a page with AI
 *
 * @example
 * ```typescript
 * import { test, expect } from '@playwright/test';
 * import { analyzeWithAI } from 'qaie';
 *
 * test('AI QA: homepage', async ({ page }) => {
 *   await page.goto('/');
 *   const report = await analyzeWithAI(page);
 *   expect(report.criticalBugs).toHaveLength(0);
 * });
 * ```
 */
export function analyzeWithAI(page: Page, options?: AnalysisOptions): Promise<AnalysisReport>;

/**
 * Create a configured analyzer with default options
 *
 * @example
 * ```typescript
 * const analyze = createAnalyzer({ viewports: ['desktop', 'mobile', 'tablet'] });
 *
 * test('homepage', async ({ page }) => {
 *   await page.goto('/');
 *   const report = await analyze(page);
 * });
 * ```
 */
export function createAnalyzer(
  defaultOptions?: AnalysisOptions,
): (page: Page, options?: AnalysisOptions) => Promise<AnalysisReport>;

/**
 * Attach all screenshots from a report to the Playwright test
 *
 * @example
 * ```typescript
 * test('AI QA', async ({ page }, testInfo) => {
 *   await page.goto('/');
 *   const report = await analyzeWithAI(page);
 *   await attachScreenshots(testInfo, report);
 * });
 * ```
 */
export function attachScreenshots(testInfo: TestInfo, report: AnalysisReport): Promise<void>;

/**
 * Attach the bug report as a JSON attachment
 */
export function attachBugReport(testInfo: TestInfo, report: AnalysisReport): Promise<void>;

/**
 * Viewport configurations
 */
export const VIEWPORT_CONFIGS: Record<string, ViewportConfig>;
