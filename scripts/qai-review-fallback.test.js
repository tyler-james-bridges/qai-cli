'use strict';

const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { cleanupRepo, createRepo, PROJECT_ROOT } = require('./verify/test-helpers');
const {
  FALLBACK_LABEL,
  ISSUE_TITLE,
  buildFallbackComment,
  buildReason,
  runFallback,
  selectTrackingIssue,
} = require('./qai-review-fallback');

const PROVIDER_KEYS = [
  'TYPESAFE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_KEY',
  'PROVIDER',
  'QAI_PROVIDER',
];

const SKIPPED_RISK = {
  command: 'risk',
  gate: 'skipped',
  summary: 'TYPESAFE_API_KEY is not set. No TypeSafe judgment ran. qai check stays keyless.',
  reasons: ['TYPESAFE_API_KEY is not set'],
  judgments: null,
};

const NEEDS_EYES_RISK = {
  command: 'risk',
  gate: 'needs-eyes',
  summary: 'Needs eyes: blast radius is high.',
  reasons: ['blast radius is high'],
  judgments: {
    blast_radius: { type: 'score', score: 1.8, confidence: 0.91 },
    test_gap: { type: 'score', score: 0.4, confidence: 0.8 },
    exposes_secrets: { type: 'noul', noul: 0.1 },
    rollback_hardness: { type: 'score', score: 0.2, confidence: 0.88 },
    merge_posture: { type: 'choice', choice: 'needs_eyes', confidence: 0.9 },
  },
};

function riskResult(report, status) {
  return {
    stdout: JSON.stringify(report),
    stderr: '',
    status,
    error: '',
  };
}

function ghResult(stdout) {
  return { ok: true, status: 0, stdout: stdout || '', stderr: '', error: '' };
}

function commentBody(calls) {
  const call = calls.find((args) => args[0] === 'pr' && args[1] === 'comment');
  assert.ok(call, 'expected a pull request comment');
  return call[call.indexOf('--body') + 1];
}

test('selectTrackingIssue matches the exact title only', () => {
  const issue = selectTrackingIssue([
    { number: 9, title: 'QAI review: AI providers unavailable today' },
    { number: 4, title: ISSUE_TITLE },
    { number: 2, title: ISSUE_TITLE },
  ]);
  assert.equal(issue.number, 2);
  assert.equal(selectTrackingIssue([{ number: 1, title: 'something else' }]), null);
});

test('missing TypeSafe key is an honest fallback, not a review finding', () => {
  const comment = buildFallbackComment({
    reason: buildReason(
      'skipped: provider unavailable',
      'Error: No API key provided. Set one of: ANTHROPIC_API_KEY',
    ),
    reviewLog: 'Error: No API key provided. Set one of: ANTHROPIC_API_KEY',
    riskResult: riskResult(SKIPPED_RISK, 0),
  });
  assert.match(comment, new RegExp(FALLBACK_LABEL));
  assert.match(comment, /TYPESAFE_API_KEY is not set/);
  assert.match(comment, /No change-risk score was produced/);
  assert.match(comment, /not an AI review finding/);
  assert.match(comment, /does not fail the check/);
  assert.doesNotMatch(comment, /critical findings/);
  assert.doesNotMatch(comment, /Gate: /);
});

test('needs-eyes risk stays a fallback and does not fail the run', () => {
  const calls = [];
  const result = runFallback({
    pr: '41',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    reviewLog: 'Error: 400 credit balance is too low',
    env: {},
    runRisk() {
      return riskResult(NEEDS_EYES_RISK, 2);
    },
    gh(args) {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list' && args.includes('--search')) {
        return ghResult('[]');
      }
      if (args[0] === 'issue' && args[1] === 'list') {
        return ghResult(JSON.stringify([{ number: 7, title: ISSUE_TITLE }]));
      }
      return ghResult('');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.riskResult.status, 2);
  const comment = commentBody(calls);
  assert.match(comment, /AI review unavailable, change-risk fallback/);
  assert.match(comment, /Gate: needs-eyes/);
  assert.match(comment, /blast_radius: 1\.80/);
  assert.match(comment, /not an AI review finding/);
  assert.doesNotMatch(comment, /critical findings/);
  const issueComment = calls.find((args) => args[0] === 'issue' && args[1] === 'comment');
  assert.ok(issueComment);
  assert.equal(issueComment[2], '7');
  const issueBody = issueComment[issueComment.indexOf('--body') + 1];
  assert.match(issueBody, /https:\/\/github.com\/acme\/qai\/pull\/41/);
  assert.match(issueBody, /credit balance is too low/);
  assert.equal(
    calls.some((args) => args[0] === 'issue' && args[1] === 'create'),
    false,
  );
});

test('creates the tracking issue when no open issue has the exact title', () => {
  const calls = [];
  const result = runFallback({
    pr: '8',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    reviewLog: '',
    runRisk() {
      return { stdout: '', stderr: 'ENOENT', status: null, error: 'spawn qai ENOENT' };
    },
    gh(args) {
      calls.push(args);
      if (args[1] === 'list') return ghResult('[]');
      return ghResult('');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.comment, /could not run \(spawn qai ENOENT\)/);
  const created = calls.find((args) => args[0] === 'issue' && args[1] === 'create');
  assert.equal(created[created.indexOf('--title') + 1], ISSUE_TITLE);
  const body = created[created.indexOf('--body') + 1];
  assert.match(body, /https:\/\/github.com\/acme\/qai\/pull\/8/);
  assert.match(body, /not closed automatically/);
});

test('does not open a second issue when issue search fails', () => {
  const calls = [];
  runFallback({
    pr: '8',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    runRisk() {
      return riskResult(SKIPPED_RISK, 0);
    },
    gh(args) {
      calls.push(args);
      if (args[1] === 'list') return { ok: false, status: 1, stdout: '', stderr: 'denied', error: '' };
      return ghResult('');
    },
  });
  assert.equal(
    calls.some((args) => args[1] === 'create'),
    false,
  );
});

test('CLI posts the no-key fallback and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-fallback-cli-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'review.log');
  const ghLog = path.join(dir, 'gh.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(log, 'Error: No API key provided. Set one of: ANTHROPIC_API_KEY\n');
  fs.writeFileSync(
    path.join(bin, 'qai'),
    [
      '#!/usr/bin/env node',
      'if (process.argv[2] !== "risk" || !process.argv.includes("--json")) process.exit(9);',
      `process.stdout.write(${JSON.stringify(JSON.stringify(SKIPPED_RISK))});`,
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/usr/bin/env node',
      "const fs = require('fs');",
      'const log = process.env.GH_LOG;',
      'const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8")) : [];',
      'calls.push(process.argv.slice(2));',
      'fs.writeFileSync(log, JSON.stringify(calls));',
      'if (process.argv[2] === "issue" && process.argv[3] === "list") {',
      "  process.stdout.write('[]');",
      '}',
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  fs.chmodSync(path.join(bin, 'qai'), 0o755);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: ghLog };
  env.GITHUB_SERVER_URL = 'https://github.com';
  env.GITHUB_REPOSITORY = 'acme/qai';
  env.PR_NUMBER = '15';
  env.SKIP_REASON = 'skipped: provider unavailable';
  env.REVIEW_LOG = log;
  for (const key of PROVIDER_KEYS) delete env[key];
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'qai-review-fallback.js')], {
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AI review unavailable, change-risk fallback/);
    assert.match(result.stdout, /TYPESAFE_API_KEY is not set/);
    assert.match(result.stdout, /No change-risk score was produced/);
    assert.doesNotMatch(result.stdout, /critical findings/);
    const calls = JSON.parse(fs.readFileSync(ghLog, 'utf8'));
    assert.match(commentBody(calls), /No API key provided/);
    const created = calls.find((args) => args[0] === 'issue' && args[1] === 'create');
    assert.equal(created[created.indexOf('--title') + 1], ISSUE_TITLE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('real qai risk without provider keys is posted as an honest fallback', () => {
  const { repo, sha } = createRepo();
  const env = { ...process.env };
  for (const key of PROVIDER_KEYS) delete env[key];
  try {
    const app = path.join(repo, 'app.js');
    fs.writeFileSync(app, 'console.log(1);\n');
    execFileSync('git', ['add', 'app.js'], { cwd: repo });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add app'], {
      cwd: repo,
      env: {
        ...env,
        GIT_AUTHOR_NAME: 'QAI Test',
        GIT_AUTHOR_EMAIL: 'qai-test@example.test',
        GIT_COMMITTER_NAME: 'QAI Test',
        GIT_COMMITTER_EMAIL: 'qai-test@example.test',
      },
    });
    const risk = spawnSync(
      process.execPath,
      [path.join(PROJECT_ROOT, 'src/index.js'), 'risk', '--base', sha, '--repo', repo, '--json'],
      { encoding: 'utf8', env, cwd: PROJECT_ROOT },
    );
    assert.equal(risk.status, 0, risk.stderr);
    const report = JSON.parse(risk.stdout);
    assert.equal(report.gate, 'skipped');
    assert.match(report.summary, /TYPESAFE_API_KEY is not set/);
    const comment = buildFallbackComment({
      reason: 'skipped: provider unavailable',
      reviewLog: 'Error: invalid x-api-key',
      riskResult: {
        stdout: risk.stdout,
        stderr: risk.stderr,
        status: risk.status,
        error: '',
      },
    });
    assert.match(comment, /AI review unavailable, change-risk fallback/);
    assert.match(comment, /qai risk could not score this diff/);
    assert.match(comment, /TYPESAFE_API_KEY is not set/);
    assert.match(comment, /No change-risk score was produced/);
    assert.doesNotMatch(comment, /Gate: auto-ok/);
    assert.doesNotMatch(comment, /critical findings/);
  } finally {
    cleanupRepo(repo);
  }
});

test('both review workflows install qai from main and post the fallback without failing the job', () => {
  const root = path.join(__dirname, '..', '.github', 'workflows');
  for (const name of ['qai-review.yml', 'qai-review-reusable.yml']) {
    const yaml = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(yaml, /npm install -g github:tyler-james-bridges\/qai-cli#main/);
    assert.match(yaml, /issues: write/);
    assert.match(yaml, /qai-review-fallback\.js/);
    assert.match(yaml, /change-risk fallback did not complete/);
    assert.match(yaml, /steps\.classify\.outputs\.outcome == 'skipped'/);
    assert.match(yaml, /steps\.classify\.outputs\.outcome == 'fail'/);
  }
  const engineer = fs.readFileSync(path.join(root, 'qa-engineer.yml'), 'utf8');
  assert.doesNotMatch(engineer, /qai-review-fallback/);
});
