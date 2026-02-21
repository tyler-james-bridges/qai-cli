/**
 * Visual Regression Testing Utility
 * Compares screenshots between runs to detect visual changes
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

/**
 * Compare two images and generate a diff
 *
 * @param {string} baselinePath - Path to baseline image
 * @param {string} currentPath - Path to current image
 * @param {string} diffPath - Path to save diff image
 * @param {Object} options - Comparison options
 * @returns {Promise<{match: boolean, diffPixels: number, diffPercent: number, dimensions: Object}>}
 */
async function compareImages(baselinePath, currentPath, diffPath, options = {}) {
  const { threshold = 0.1, includeAA = false } = options;

  // Read images
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));

  // Check dimensions match
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      match: false,
      error: 'dimension_mismatch',
      baseline: { width: baseline.width, height: baseline.height },
      current: { width: current.width, height: current.height },
      diffPixels: -1,
      diffPercent: 100,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });

  // Compare pixels
  const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold,
    includeAA,
    alpha: 0.1,
    diffColor: [255, 0, 0], // Red for differences
    diffColorAlt: [0, 255, 0], // Green for anti-aliasing
  });

  // Calculate percentage
  const totalPixels = width * height;
  const diffPercent = (diffPixels / totalPixels) * 100;

  // Save diff image
  if (diffPath) {
    fs.mkdirSync(path.dirname(diffPath), { recursive: true });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    match: diffPixels === 0,
    diffPixels,
    diffPercent: parseFloat(diffPercent.toFixed(2)),
    dimensions: { width, height },
  };
}

/**
 * Compare all screenshots in two directories
 *
 * @param {string} baselineDir - Directory with baseline screenshots
 * @param {string} currentDir - Directory with current screenshots
 * @param {string} diffDir - Directory to save diff images
 * @param {Object} options - Comparison options
 * @returns {Promise<{summary: Object, results: Array}>}
 */
async function compareDirectories(baselineDir, currentDir, diffDir, options = {}) {
  const { threshold = 0.1, failThreshold = 0.5 } = options;

  const results = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;
  let newImages = 0;

  // Get all PNG files from both directories
  const baselineFiles = fs.existsSync(baselineDir)
    ? fs.readdirSync(baselineDir).filter((f) => f.endsWith('.png'))
    : [];
  const currentFiles = fs.existsSync(currentDir)
    ? fs.readdirSync(currentDir).filter((f) => f.endsWith('.png'))
    : [];

  const allFiles = new Set([...baselineFiles, ...currentFiles]);

  for (const file of allFiles) {
    const baselinePath = path.join(baselineDir, file);
    const currentPath = path.join(currentDir, file);
    const diffPath = path.join(diffDir, `diff-${file}`);

    const result = { file };

    if (!fs.existsSync(baselinePath)) {
      // New screenshot (no baseline)
      result.status = 'new';
      result.message = 'New screenshot - no baseline to compare';
      newImages++;
    } else if (!fs.existsSync(currentPath)) {
      // Missing screenshot (was in baseline)
      result.status = 'missing';
      result.message = 'Screenshot missing from current run';
      missing++;
    } else {
      // Compare images
      const comparison = await compareImages(baselinePath, currentPath, diffPath, { threshold });

      if (comparison.error === 'dimension_mismatch') {
        result.status = 'failed';
        result.message = `Dimension mismatch: baseline ${comparison.baseline.width}x${comparison.baseline.height} vs current ${comparison.current.width}x${comparison.current.height}`;
        result.diffPath = null;
        failed++;
      } else if (comparison.diffPercent > failThreshold) {
        result.status = 'failed';
        result.message = `${comparison.diffPercent}% pixels differ (threshold: ${failThreshold}%)`;
        result.diffPixels = comparison.diffPixels;
        result.diffPercent = comparison.diffPercent;
        result.diffPath = diffPath;
        failed++;
      } else if (comparison.diffPixels > 0) {
        result.status = 'warning';
        result.message = `Minor differences: ${comparison.diffPercent}% pixels differ`;
        result.diffPixels = comparison.diffPixels;
        result.diffPercent = comparison.diffPercent;
        result.diffPath = diffPath;
        passed++;
      } else {
        result.status = 'passed';
        result.message = 'Images match exactly';
        result.diffPercent = 0;
        passed++;
      }
    }

    results.push(result);
  }

  return {
    summary: {
      total: allFiles.size,
      passed,
      failed,
      missing,
      new: newImages,
      passRate: allFiles.size > 0 ? parseFloat(((passed / allFiles.size) * 100).toFixed(1)) : 100,
    },
    results,
  };
}

/**
 * Generate markdown report for visual regression results
 *
 * @param {Object} comparison - Result from compareDirectories
 * @returns {string} Markdown formatted report
 */
function generateReport(comparison) {
  const { summary, results } = comparison;

  let report = `## Visual Regression Report\n\n`;

  // Summary
  report += `### Summary\n`;
  report += `- **Total Screenshots**: ${summary.total}\n`;
  report += `- **Passed**: ${summary.passed} ✅\n`;
  report += `- **Failed**: ${summary.failed} ❌\n`;
  report += `- **New**: ${summary.new} 🆕\n`;
  report += `- **Missing**: ${summary.missing} ⚠️\n`;
  report += `- **Pass Rate**: ${summary.passRate}%\n\n`;

  // Failed comparisons
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    report += `### Failed Comparisons ❌\n\n`;
    failed.forEach((r) => {
      report += `#### ${r.file}\n`;
      report += `- **Status**: Failed\n`;
      report += `- **Reason**: ${r.message}\n`;
      if (r.diffPath) {
        report += `- **Diff Image**: ${path.basename(r.diffPath)}\n`;
      }
      report += `\n`;
    });
  }

  // Warnings (minor differences)
  const warnings = results.filter((r) => r.status === 'warning');
  if (warnings.length > 0) {
    report += `### Minor Differences ⚠️\n\n`;
    warnings.forEach((r) => {
      report += `- **${r.file}**: ${r.diffPercent}% difference\n`;
    });
    report += `\n`;
  }

  // New screenshots
  const newScreenshots = results.filter((r) => r.status === 'new');
  if (newScreenshots.length > 0) {
    report += `### New Screenshots 🆕\n\n`;
    report += `These screenshots have no baseline yet:\n`;
    newScreenshots.forEach((r) => {
      report += `- ${r.file}\n`;
    });
    report += `\n`;
  }

  // Missing screenshots
  const missingScreenshots = results.filter((r) => r.status === 'missing');
  if (missingScreenshots.length > 0) {
    report += `### Missing Screenshots ⚠️\n\n`;
    report += `These screenshots existed in baseline but not in current run:\n`;
    missingScreenshots.forEach((r) => {
      report += `- ${r.file}\n`;
    });
    report += `\n`;
  }

  return report;
}

/**
 * Update baseline screenshots from current run
 *
 * @param {string} currentDir - Directory with current screenshots
 * @param {string} baselineDir - Directory to save as baseline
 * @param {Object} options - Options
 * @returns {Object} Update summary
 */
function updateBaseline(currentDir, baselineDir, options = {}) {
  const { overwrite = true } = options;

  fs.mkdirSync(baselineDir, { recursive: true });

  const currentFiles = fs.readdirSync(currentDir).filter((f) => f.endsWith('.png'));
  let copied = 0;
  let skipped = 0;

  currentFiles.forEach((file) => {
    const src = path.join(currentDir, file);
    const dest = path.join(baselineDir, file);

    if (!overwrite && fs.existsSync(dest)) {
      skipped++;
    } else {
      fs.copyFileSync(src, dest);
      copied++;
    }
  });

  return {
    copied,
    skipped,
    total: currentFiles.length,
  };
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'compare') {
    const baselineDir = args[1] || './screenshots/baseline';
    const currentDir = args[2] || './screenshots';
    const diffDir = args[3] || './screenshots/diff';

    console.log(`Comparing screenshots...`);
    console.log(`  Baseline: ${baselineDir}`);
    console.log(`  Current: ${currentDir}`);
    console.log(`  Diff output: ${diffDir}`);

    const result = await compareDirectories(baselineDir, currentDir, diffDir);
    const report = generateReport(result);

    console.log('\n' + report);

    // Save report
    fs.writeFileSync('visual-regression-report.md', report);
    console.log('Report saved to visual-regression-report.md');

    // Exit with error if any failed
    if (result.summary.failed > 0) {
      process.exit(1);
    }
  } else if (command === 'update-baseline') {
    const currentDir = args[1] || './screenshots';
    const baselineDir = args[2] || './screenshots/baseline';

    console.log(`Updating baseline screenshots...`);
    console.log(`  Source: ${currentDir}`);
    console.log(`  Baseline: ${baselineDir}`);

    const result = updateBaseline(currentDir, baselineDir);
    console.log(`\nBaseline updated:`);
    console.log(`  Copied: ${result.copied}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Total: ${result.total}`);
  } else {
    console.log(`
Visual Regression Testing Utility

Usage:
  node visual-regression.js compare [baselineDir] [currentDir] [diffDir]
    Compare screenshots and generate diff images

  node visual-regression.js update-baseline [currentDir] [baselineDir]
    Update baseline screenshots from current run

Examples:
  node visual-regression.js compare ./baseline ./screenshots ./diff
  node visual-regression.js update-baseline ./screenshots ./baseline
    `);
  }
}

// Export functions for programmatic use
module.exports = {
  compareImages,
  compareDirectories,
  generateReport,
  updateBaseline,
};

// Run CLI if executed directly
if (require.main === module) {
  main().catch(console.error);
}
