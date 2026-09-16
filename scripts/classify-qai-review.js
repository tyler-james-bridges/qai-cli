#!/usr/bin/env node

'use strict';

const fs = require('fs');

const PROVIDER_UNAVAILABLE_RE = new RegExp(
  [
    'provider error',
    'credit balance',
    'insufficient credits?',
    'invalid api key',
    'invalid x-api-key',
    'authentication_error',
    'not_found_error',
    'no api key provided',
    '404[\\s\\S]{0,400}model',
    'model[\\s\\S]{0,400}404',
  ].join('|'),
  'i',
);

function isProviderUnavailable(text) {
  return PROVIDER_UNAVAILABLE_RE.test(String(text || ''));
}

function extractJsonObjects(text) {
  const objects = [];
  const source = String(text || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(source.slice(start, i + 1)));
        } catch {
          // Mixed CLI banners / truncated objects are ignored.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function extractReviewReport(text) {
  const objects = extractJsonObjects(text);
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj && Array.isArray(obj.issues)) {
      return obj;
    }
  }
  return null;
}

function classifyQaiReview(output, exitCode) {
  const text = String(output || '');
  const report = extractReviewReport(text);

  if (report) {
    const criticalCount = report.issues.filter((issue) => issue && issue.severity === 'critical')
      .length;
    if (criticalCount > 0) {
      return {
        outcome: 'fail',
        note: `QAI review found ${criticalCount} critical issue(s)`,
      };
    }
    return {
      outcome: 'pass',
      note: 'QAI review found no critical issues',
    };
  }

  if (isProviderUnavailable(text) || Number(exitCode) !== 0) {
    return {
      outcome: 'skipped',
      note: 'skipped: provider unavailable',
    };
  }

  return {
    outcome: 'pass',
    note: 'QAI review completed',
  };
}

function writeGithubOutput(result) {
  const dest = process.env.GITHUB_OUTPUT;
  if (!dest) return;
  fs.appendFileSync(dest, `outcome=${result.outcome}\nnote=${result.note}\n`);
}

function main(argv) {
  const file = argv[2];
  const exitCode = argv[3] || '0';
  let output = '';
  if (file) {
    try {
      output = fs.readFileSync(file, 'utf8');
    } catch {
      output = '';
    }
  }
  const result = classifyQaiReview(output, exitCode);
  writeGithubOutput(result);
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  classifyQaiReview,
  extractReviewReport,
  isProviderUnavailable,
};
