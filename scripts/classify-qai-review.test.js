'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { classifyQaiReview, isProviderUnavailable } = require('./classify-qai-review');

const CREDIT_ERROR_JSON = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
  request_id: 'req_011Cf6a6iZSJSKdrtUDnEpuQ',
});

const MODEL_404_JSON = JSON.stringify({
  type: 'error',
  error: { type: 'not_found_error', message: 'model: claude-sonnet-4-20250514' },
});

const CREDIT_FAILURE = [
  '============================================================',
  'qai review',
  '============================================================',
  'PR: #34',
  'Focus: all',
  '============================================================',
  '[4/4] Reviewing with AI...',
  'Using provider: anthropic',
  '',
  'Error: 400 ' + CREDIT_ERROR_JSON,
  '',
].join('\n');

const MODEL_404 = [
  '',
  'Using provider: anthropic',
  '',
  'Error: 404 ' + MODEL_404_JSON,
  '',
].join('\n');

const INVALID_KEY = `
Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}
`;

function reportOutput(issues) {
  return `Using provider: anthropic
${JSON.stringify({ summary: 'reviewed', issues, score: 80, recommendations: [] }, null, 2)}
`;
}

test('Anthropic credit-balance failure is skipped, not a critical finding', () => {
  const result = classifyQaiReview(CREDIT_FAILURE, 1);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.note, 'skipped: provider unavailable');
  assert.equal(isProviderUnavailable(CREDIT_FAILURE), true);
});

test('invalid API key / x-api-key is skipped', () => {
  const result = classifyQaiReview(INVALID_KEY, 1);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.note, 'skipped: provider unavailable');
});

test('404 model / not_found_error is skipped', () => {
  const result = classifyQaiReview(MODEL_404, 1);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.note, 'skipped: provider unavailable');
});

test('missing API key is skipped', () => {
  const result = classifyQaiReview('Error: No API key provided. Set one of: ANTHROPIC_API_KEY', 1);
  assert.equal(result.outcome, 'skipped');
});

test('parsed JSON with critical severity fails the check', () => {
  const result = classifyQaiReview(
    reportOutput([{ severity: 'critical', title: 'auth bypass' }]),
    1,
  );
  assert.equal(result.outcome, 'fail');
  assert.match(result.note, /1 critical issue/);
});

test('parsed JSON without critical severity passes even if exit is 1', () => {
  const result = classifyQaiReview(
    reportOutput([{ severity: 'medium', title: 'nit' }]),
    1,
  );
  assert.equal(result.outcome, 'pass');
});

test('a real finding that mentions 404 still fails when severity is critical', () => {
  const result = classifyQaiReview(
    reportOutput([
      {
        severity: 'critical',
        title: 'handler maps 404 model errors onto merge blockers',
      },
    ]),
    1,
  );
  assert.equal(result.outcome, 'fail');
});

test('unparseable non-zero exit without a provider signature is still skipped', () => {
  const result = classifyQaiReview('gh: command failed', 1);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.note, 'skipped: provider unavailable');
});

test('clean review JSON with exit 0 passes', () => {
  const result = classifyQaiReview(reportOutput([]), 0);
  assert.equal(result.outcome, 'pass');
  assert.equal(result.note, 'QAI review found no critical issues');
});

test('CLI writes skipped outcome to GITHUB_OUTPUT for a credit-balance log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-review-classify-'));
  const outputFile = path.join(dir, 'review-output.json');
  const ghOutput = path.join(dir, 'github-output');
  fs.writeFileSync(outputFile, CREDIT_FAILURE);
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'classify-qai-review.js'), outputFile, '1'],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: ghOutput },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"outcome":"skipped"/);
    const written = fs.readFileSync(ghOutput, 'utf8');
    assert.match(written, /^outcome=skipped$/m);
    assert.match(written, /^note=skipped: provider unavailable$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
