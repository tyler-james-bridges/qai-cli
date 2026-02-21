#!/usr/bin/env node

/**
 * Benchmark runner for qai code review accuracy.
 *
 * Loads curated diffs with known bugs, runs them through each available
 * provider, and scores true-positive rate, false-positive count, and latency.
 *
 * Usage:
 *   node benchmarks/run.js [--provider <name>] [--json]
 */

const fs = require('fs');
const path = require('path');
const { getProvider } = require('../src/providers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDataset() {
  const dir = path.join(__dirname, 'dataset');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/**
 * Determine whether the review found the expected issue.
 * We do a fuzzy keyword match on severity, category, and description.
 */
function scoreResult(review, expected) {
  if (!review || !review.issues || !Array.isArray(review.issues)) {
    return { detected: false, falsePositives: 0 };
  }

  const found = expected.every((exp) => {
    return review.issues.some((issue) => {
      const descMatch = matchDescription(issue.description || issue.message || '', exp.description);
      const catMatch =
        !exp.category || (issue.category || '').toLowerCase().includes(exp.category.toLowerCase());
      const sevMatch =
        !exp.severity || (issue.severity || '').toLowerCase().includes(exp.severity.toLowerCase());
      // A match on description alone is sufficient; category/severity are bonus signals
      return descMatch || (catMatch && sevMatch);
    });
  });

  // False positives = total issues minus expected matches
  const falsePositives = Math.max(0, review.issues.length - expected.length);

  return { detected: found, falsePositives };
}

function matchDescription(actual, expected) {
  // Extract key terms from the expected description and check if most appear
  const keywords = expected
    .toLowerCase()
    .split(/[\s,/]+/)
    .filter((w) => w.length > 3);
  const normalised = actual.toLowerCase();
  const hits = keywords.filter((kw) => normalised.includes(kw));
  return hits.length >= Math.ceil(keywords.length * 0.4);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const providerIdx = args.indexOf('--provider');
  const providerName = providerIdx !== -1 ? args[providerIdx + 1] : undefined;

  const dataset = loadDataset();
  console.log(`\nLoaded ${dataset.length} benchmark cases\n`);

  let provider;
  try {
    provider = getProvider(providerName);
  } catch (err) {
    console.error(
      `Failed to initialise provider${providerName ? ` "${providerName}"` : ''}: ${err.message}`,
    );
    console.error('Set an API key (e.g. ANTHROPIC_API_KEY) or specify --provider <name>');
    process.exit(1);
  }

  const providerLabel = provider.constructor.name || 'unknown';
  console.log(`Provider: ${providerLabel}\n`);

  const results = [];
  let detected = 0;
  let totalFP = 0;
  let totalMs = 0;

  for (const testCase of dataset) {
    const label = testCase.name.padEnd(25);
    process.stdout.write(`  ${label} … `);

    const start = Date.now();
    let review;
    let error = null;
    try {
      review = await provider.reviewCode(testCase.diff, testCase.context || {}, {
        focus: 'all',
      });
    } catch (err) {
      error = err.message;
    }
    const elapsed = Date.now() - start;
    totalMs += elapsed;

    if (error) {
      console.log(`ERROR (${elapsed}ms) — ${error}`);
      results.push({
        name: testCase.name,
        detected: false,
        falsePositives: 0,
        elapsed,
        error,
      });
      continue;
    }

    const score = scoreResult(review, testCase.expectedIssues);
    if (score.detected) detected++;
    totalFP += score.falsePositives;

    const icon = score.detected ? '✅' : '❌';
    console.log(
      `${icon}  ${elapsed}ms  (FP: ${score.falsePositives}, issues: ${(review.issues || []).length})`,
    );

    results.push({
      name: testCase.name,
      detected: score.detected,
      falsePositives: score.falsePositives,
      issuesFound: (review.issues || []).length,
      elapsed,
    });
  }

  // Summary
  const tpr = ((detected / dataset.length) * 100).toFixed(1);
  const avgMs = (totalMs / dataset.length).toFixed(0);

  console.log('\n' + '═'.repeat(60));
  console.log(`  True-positive rate : ${detected}/${dataset.length} (${tpr}%)`);
  console.log(`  Total false positives: ${totalFP}`);
  console.log(`  Avg time per review : ${avgMs}ms (total ${(totalMs / 1000).toFixed(1)}s)`);
  console.log('═'.repeat(60) + '\n');

  const report = {
    provider: providerLabel,
    timestamp: new Date().toISOString(),
    cases: results,
    summary: {
      total: dataset.length,
      detected,
      truePositiveRate: parseFloat(tpr),
      totalFalsePositives: totalFP,
      avgTimeMs: parseInt(avgMs, 10),
    },
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  }

  // Always write report to disk
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `report-${providerLabel.toLowerCase()}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Report saved to ${outFile}\n`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
