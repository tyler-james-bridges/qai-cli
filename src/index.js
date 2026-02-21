#!/usr/bin/env node

const fs = require('fs').promises;
const { capturePage } = require('./capture');
const { getProvider } = require('./providers');
const { reviewPR, formatReviewMarkdown } = require('./review');
const { generateTests } = require('./generate');

// Route to the right command
const command = process.argv[2];

if (command === 'review') {
  runReview().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
  });
} else if (command === 'generate') {
  runGenerate().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
  });
} else {
  main();
}

/**
 * Run PR review command
 * Usage: qai review [PR_NUMBER] [--base main] [--focus security] [--json]
 */
async function runReview() {
  const args = process.argv.slice(3);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      options.base = args[++i];
    } else if (args[i] === '--focus' && args[i + 1]) {
      options.focus = args[++i];
    } else if (args[i] === '--json') {
      options.json = true;
    } else if (/^\d+$/.test(args[i])) {
      options.pr = parseInt(args[i], 10);
    }
  }

  console.log('='.repeat(60));
  console.log('qai review');
  console.log('='.repeat(60));
  if (options.pr) {
    console.log(`PR: #${options.pr}`);
  } else {
    console.log(`Comparing: HEAD vs ${options.base || 'main'}`);
  }
  console.log(`Focus: ${options.focus || 'all'}`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  const report = await reviewPR(options);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const markdown = formatReviewMarkdown(report);
    await fs.writeFile('review-report.md', markdown);
    console.log('\nSaved: review-report.md');

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Review Summary');
    console.log('='.repeat(60));
    console.log(`Score: ${report.score !== null ? report.score + '/100' : 'N/A'}`);
    console.log(`Issues: ${report.issues?.length || 0}`);
    if (report.issues?.length > 0) {
      const critical = report.issues.filter((i) => i.severity === 'critical').length;
      const high = report.issues.filter((i) => i.severity === 'high').length;
      const medium = report.issues.filter((i) => i.severity === 'medium').length;
      const low = report.issues.filter((i) => i.severity === 'low').length;
      if (critical) console.log(`  Critical: ${critical}`);
      if (high) console.log(`  High: ${high}`);
      if (medium) console.log(`  Medium: ${medium}`);
      if (low) console.log(`  Low: ${low}`);
    }
    console.log(`Duration: ${duration}s`);
    console.log('='.repeat(60));
  }

  // Exit with error if critical issues found
  const criticals = report.issues?.filter((i) => i.severity === 'critical').length || 0;
  if (criticals > 0) {
    process.exit(1);
  }
}

/**
 * Run test generation command
 * Usage: qai generate <url|file> [--out dir] [--framework playwright|jest|vitest] [--dry-run]
 */
async function runGenerate() {
  const args = process.argv.slice(3);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      options.outDir = args[++i];
    } else if (args[i] === '--framework' && args[i + 1]) {
      options.framework = args[++i];
    } else if (args[i] === '--pattern' && args[i + 1]) {
      options.pattern = args[++i];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--json') {
      options.json = true;
    } else if (!args[i].startsWith('--')) {
      options.target = args[i];
    }
  }

  if (!options.target) {
    console.error(
      'Usage: qai generate <url|file> [--out dir] [--framework playwright|jest|vitest] [--dry-run]',
    );
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('qai generate');
  console.log('='.repeat(60));
  console.log(`Target: ${options.target}`);
  console.log(`Framework: ${options.framework || 'auto'}`);
  console.log(
    `Output: ${options.dryRun ? 'stdout (dry run)' : options.outDir || './tests/generated'}`,
  );
  console.log('='.repeat(60));

  const startTime = Date.now();
  const result = await generateTests(options);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n' + '='.repeat(60));
    console.log('Generation Summary');
    console.log('='.repeat(60));
    console.log(`Mode: ${result.mode}`);
    console.log(`Tests generated: ${result.testsGenerated}`);
    console.log(`Files: ${result.files.join(', ')}`);
    console.log(`Duration: ${duration}s`);
    console.log('='.repeat(60));
  }
}

async function main() {
  const startTime = Date.now();

  // Get configuration from environment (standard format first, then INPUT_ format for GitHub Actions)
  const url = process.env.URL || process.env.INPUT_URL;
  const viewportsRaw = process.env.VIEWPORTS || process.env.INPUT_VIEWPORTS || 'desktop,mobile';
  const focus = process.env.FOCUS || process.env.INPUT_FOCUS || 'all';
  const timeout = parseInt(process.env.TIMEOUT || process.env.INPUT_TIMEOUT || '300', 10) * 1000;
  const outputFormat = process.env.OUTPUT_FORMAT || process.env.INPUT_OUTPUT_FORMAT || 'markdown';

  if (!url) {
    console.error('Error: URL is required (set URL or INPUT_URL env var)');
    process.exit(1);
  }

  const viewports = viewportsRaw.split(',').map((v) => v.trim().toLowerCase());

  console.log('='.repeat(60));
  console.log('qai');
  console.log('='.repeat(60));
  console.log(`URL: ${url}`);
  console.log(`Viewports: ${viewports.join(', ')}`);
  console.log(`Focus: ${focus}`);
  console.log('='.repeat(60));

  try {
    // Get the provider (auto-detected from env vars)
    const provider = getProvider();

    // Step 1: Capture page data
    console.log('\n[1/3] Capturing page data...');
    const captureData = await capturePage(url, {
      viewports,
      timeout,
      screenshotDir: './screenshots',
    });

    // Step 2: Analyze with LLM
    console.log('\n[2/3] Analyzing with AI...');
    const report = await provider.analyze(captureData, { focus });

    // Step 3: Generate report
    console.log('\n[3/3] Generating report...');

    // Add metadata to report
    report.metadata = {
      url: captureData.pageUrl,
      title: captureData.pageTitle,
      timestamp: captureData.timestamp,
      viewports,
      focus,
      consoleErrorCount: captureData.consoleErrors.length,
      networkErrorCount: captureData.networkErrors.length,
      duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    };

    // Include raw errors in report
    report.consoleErrors = captureData.consoleErrors;
    report.networkErrors = captureData.networkErrors;

    // Save report
    if (outputFormat === 'json' || outputFormat === 'all') {
      await fs.writeFile('qa-report.json', JSON.stringify(report, null, 2));
      console.log('Saved: qa-report.json');
    }

    if (outputFormat === 'markdown' || outputFormat === 'all') {
      const markdown = generateMarkdownReport(report);
      await fs.writeFile('qa-report.md', markdown);
      console.log('Saved: qa-report.md');
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('QA Report Summary');
    console.log('='.repeat(60));
    console.log(`Score: ${report.score !== null ? report.score + '/100' : 'N/A'}`);
    console.log(`Bugs found: ${report.bugs?.length || 0}`);

    if (report.bugs?.length > 0) {
      const critical = report.bugs.filter((b) => b.severity === 'critical').length;
      const high = report.bugs.filter((b) => b.severity === 'high').length;
      const medium = report.bugs.filter((b) => b.severity === 'medium').length;
      const low = report.bugs.filter((b) => b.severity === 'low').length;

      console.log(`  - Critical: ${critical}`);
      console.log(`  - High: ${high}`);
      console.log(`  - Medium: ${medium}`);
      console.log(`  - Low: ${low}`);
    }

    console.log(`Duration: ${report.metadata.duration}`);
    console.log('='.repeat(60));

    // Set outputs for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const outputs = [
        `report=qa-report.${outputFormat === 'json' ? 'json' : 'md'}`,
        'screenshots=./screenshots',
        `bugs_found=${report.bugs?.length || 0}`,
        `critical_bugs=${report.bugs?.filter((b) => ['critical', 'high'].includes(b.severity)).length || 0}`,
      ];

      await fs.appendFile(process.env.GITHUB_OUTPUT, outputs.join('\n') + '\n');
    }
  } catch (error) {
    console.error('\nError:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function generateMarkdownReport(report) {
  const lines = [];

  lines.push('# QA Report');
  lines.push('');
  lines.push(`**URL:** ${report.metadata.url}`);
  lines.push(`**Title:** ${report.metadata.title}`);
  lines.push(`**Date:** ${report.metadata.timestamp}`);
  lines.push(`**Duration:** ${report.metadata.duration}`);
  lines.push(`**Score:** ${report.score !== null ? report.score + '/100' : 'N/A'}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary || 'No summary provided.');
  lines.push('');

  if (report.bugs?.length > 0) {
    lines.push('## Bugs Found');
    lines.push('');

    for (const bug of report.bugs) {
      const severityEmoji =
        {
          critical: '🔴',
          high: '🟠',
          medium: '🟡',
          low: '🟢',
        }[bug.severity] || '⚪';

      lines.push(`### ${severityEmoji} ${bug.title}`);
      lines.push('');
      lines.push(`**Severity:** ${bug.severity}`);
      lines.push(`**Category:** ${bug.category}`);
      if (bug.viewport) {
        lines.push(`**Viewport:** ${bug.viewport}`);
      }
      lines.push('');
      lines.push(bug.description);
      lines.push('');
      if (bug.recommendation) {
        lines.push(`**Recommendation:** ${bug.recommendation}`);
        lines.push('');
      }
    }
  } else {
    lines.push('## Bugs Found');
    lines.push('');
    lines.push('No bugs found.');
    lines.push('');
  }

  if (report.consoleErrors?.length > 0) {
    lines.push('## Console Errors');
    lines.push('');
    for (const error of report.consoleErrors) {
      lines.push(`- ${error}`);
    }
    lines.push('');
  }

  if (report.networkErrors?.length > 0) {
    lines.push('## Network Errors');
    lines.push('');
    for (const error of report.networkErrors) {
      lines.push(`- \`${error.method || 'GET'} ${error.url}\`: ${error.status || error.failure}`);
    }
    lines.push('');
  }

  if (report.recommendations?.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [qai](https://github.com/tyler-james-bridges/qai-cli)*');

  return lines.join('\n');
}
