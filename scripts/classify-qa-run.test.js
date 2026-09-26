'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { classifyQaRun } = require('./classify-qa-run');

const CREDIT_LOG = [
  'Using provider: anthropic',
  'Error: 400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}',
].join('\n');

test('a provider failure with no report is an honest skip', () => {
  const result = classifyQaRun(CREDIT_LOG, false);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.note, 'skipped: provider unavailable');
});

test('a provider failure that still wrote a report is a real result', () => {
  const result = classifyQaRun(CREDIT_LOG, true);
  assert.equal(result.outcome, 'report');
  assert.equal(result.note, 'QA report generated');
});

test('missing report without a provider error keeps the existing note', () => {
  const result = classifyQaRun('QA testing timed out after 5 minutes', false);
  assert.equal(result.outcome, 'missing');
  assert.equal(result.note, 'No QA report generated');
});

test('auth and model-not-found logs with no report are skipped', () => {
  assert.equal(
    classifyQaRun(
      'Error: 401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      false,
    ).outcome,
    'skipped',
  );
  assert.equal(
    classifyQaRun(
      'Error: 404 {"error":{"type":"not_found_error","message":"model: claude"}}',
      false,
    ).outcome,
    'skipped',
  );
});

test('CLI writes skipped outcome when the log is a credit failure and no report exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-qa-classify-'));
  const logFile = path.join(dir, 'qa-run.log');
  const ghOutput = path.join(dir, 'github-output');
  fs.writeFileSync(logFile, CREDIT_LOG);
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'classify-qa-run.js'), logFile],
      {
        cwd: dir,
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

test('CLI reports a generated report even if the log mentions a provider error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-qa-classify-'));
  const logFile = path.join(dir, 'qa-run.log');
  const ghOutput = path.join(dir, 'github-output');
  fs.writeFileSync(logFile, CREDIT_LOG);
  fs.writeFileSync(path.join(dir, 'qa-report.md'), '## Bugs Found\n\nNo issues found\n');
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'classify-qa-run.js'), logFile],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: ghOutput },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(ghOutput, 'utf8'), /^outcome=report$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
