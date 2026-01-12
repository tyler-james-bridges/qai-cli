#!/usr/bin/env node

const fs = require('fs').promises;
const { capturePage } = require('./capture');
const { getProvider } = require('./providers');

async function main() {
  const startTime = Date.now();

  // Get configuration from environment
  const url = process.env.INPUT_URL;
  const viewportsRaw = process.env.INPUT_VIEWPORTS || 'desktop,mobile';
  const focus = process.env.INPUT_FOCUS || 'all';
  const timeout = parseInt(process.env.INPUT_TIMEOUT || '300', 10) * 1000;
  const outputFormat = process.env.INPUT_OUTPUT_FORMAT || 'markdown';

  if (!url) {
    console.error('Error: INPUT_URL is required');
    process.exit(1);
  }

  const viewports = viewportsRaw.split(',').map(v => v.trim().toLowerCase());

  console.log('='.repeat(60));
  console.log('AI QA Engineer');
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
      const critical = report.bugs.filter(b => b.severity === 'critical').length;
      const high = report.bugs.filter(b => b.severity === 'high').length;
      const medium = report.bugs.filter(b => b.severity === 'medium').length;
      const low = report.bugs.filter(b => b.severity === 'low').length;

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
        `critical_bugs=${report.bugs?.filter(b => ['critical', 'high'].includes(b.severity)).length || 0}`,
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
      const severityEmoji = {
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
  lines.push('*Generated by [AI QA Engineer](https://github.com/tyler-james-bridges/ai-qa-engineer)*');

  return lines.join('\n');
}

main();
