'use strict';

const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { cleanupRepo, createRepo, PROJECT_ROOT } = require('./verify/test-helpers');
const {
  ISSUE_TITLE,
  buildComment,
  buildReason,
  runFallback,
  selectTrackingIssue,
} = require('./qai-review-fallback');

const SKIPPED = {
  command: 'risk',
  gate: 'skipped',
  summary: 'TYPESAFE_API_KEY is not set. No TypeSafe judgment ran. qai check stays keyless.',
  judgments: null,
};

function ok(stdout) {
  return { ok: true, stdout: stdout || '', stderr: '' };
}

test('exact title picks the oldest open issue', () => {
  const issue = selectTrackingIssue([
    { number: 9, title: 'QAI review: AI providers unavailable today' },
    { number: 4, title: ISSUE_TITLE },
    { number: 2, title: ISSUE_TITLE },
  ]);
  assert.equal(issue.number, 2);
  assert.equal(selectTrackingIssue([{ number: 1, title: 'other' }]), null);
});

test('missing TypeSafe key is an honest fallback and does not fail', () => {
  const calls = [];
  const result = runFallback({
    pr: '15',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    reviewLog: 'Error: No API key provided. Set one of: ANTHROPIC_API_KEY',
    runRisk() {
      return { stdout: JSON.stringify(SKIPPED), stderr: '', status: 0, error: '' };
    },
    gh(args) {
      calls.push(args);
      if (args[1] === 'list') return ok('[]');
      return ok('');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.comment, /AI review unavailable, change-risk fallback/);
  assert.match(result.comment, /TYPESAFE_API_KEY is not set/);
  assert.match(result.comment, /No change-risk score was produced/);
  assert.match(result.comment, /not an AI review finding/);
  assert.doesNotMatch(result.comment, /critical findings/);
  assert.doesNotMatch(result.comment, /Gate: /);
  const created = calls.find((args) => args[0] === 'issue' && args[1] === 'create');
  assert.equal(created[created.indexOf('--title') + 1], ISSUE_TITLE);
  assert.match(created[created.indexOf('--body') + 1], /https:\/\/github.com\/acme\/qai\/pull\/15/);
  assert.match(buildReason('skipped: provider unavailable', result.comment), /skipped: provider unavailable/);
});

test('needs-eyes risk comments the existing issue and exits 0', () => {
  const calls = [];
  const result = runFallback({
    pr: '41',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    reviewLog: 'Error: 400 credit balance is too low',
    runRisk() {
      return {
        stdout: JSON.stringify({
          command: 'risk',
          gate: 'needs-eyes',
          summary: 'Needs eyes: blast radius is high.',
        }),
        stderr: '',
        status: 2,
        error: '',
      };
    },
    gh(args) {
      calls.push(args);
      if (args[1] === 'list') return ok(JSON.stringify([{ number: 7, title: ISSUE_TITLE }]));
      return ok('');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.comment, /Gate: needs-eyes/);
  assert.doesNotMatch(result.comment, /critical findings/);
  const comment = calls.find((args) => args[0] === 'issue' && args[1] === 'comment');
  assert.equal(comment[2], '7');
  assert.match(comment[comment.indexOf('--body') + 1], /credit balance is too low/);
  assert.equal(calls.some((args) => args[1] === 'create'), false);
});

test('a failed issue search does not create another issue', () => {
  const calls = [];
  runFallback({
    pr: '8',
    repo: 'acme/qai',
    reason: 'skipped: provider unavailable',
    runRisk() {
      return { stdout: '', stderr: 'boom', status: 1, error: '' };
    },
    gh(args) {
      calls.push(args);
      if (args[1] === 'list') return { ok: false, stdout: '', stderr: 'denied' };
      return ok('');
    },
  });
  assert.equal(calls.some((args) => args[1] === 'create'), false);
  assert.match(buildComment('skipped', { stdout: '', stderr: 'boom', status: 1, error: '' }), /could not run/);
});

test('real qai risk without a key is not posted as a score', () => {
  const { repo, sha } = createRepo();
  const env = { ...process.env };
  for (const key of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'API_KEY', 'PROVIDER', 'QAI_PROVIDER']) {
    delete env[key];
  }
  try {
    fs.writeFileSync(path.join(repo, 'app.js'), 'console.log(1);\n');
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
    const risk = spawnSync(process.execPath, [
      path.join(PROJECT_ROOT, 'src/index.js'), 'risk', '--base', sha, '--repo', repo, '--json',
    ], { encoding: 'utf8', env, cwd: PROJECT_ROOT });
    assert.equal(risk.status, 0, risk.stderr);
    const comment = buildComment('skipped: provider unavailable', {
      stdout: risk.stdout,
      stderr: risk.stderr,
      status: risk.status,
      error: '',
    });
    assert.match(comment, /AI review unavailable, change-risk fallback/);
    assert.match(comment, /TYPESAFE_API_KEY is not set/);
    assert.match(comment, /No change-risk score was produced/);
    assert.doesNotMatch(comment, /Gate: /);
  } finally {
    cleanupRepo(repo);
  }
});

test('review workflows run the fallback from the main install, not the checkout', () => {
  const root = path.join(__dirname, '..', '.github', 'workflows');
  for (const name of ['qai-review.yml', 'qai-review-reusable.yml']) {
    const yaml = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(yaml, /npm install -g github:tyler-james-bridges\/qai-cli#main/);
    assert.match(yaml, /issues: write/);
    assert.match(yaml, /npm root -g/);
    assert.match(yaml, /qai-cli\/scripts\/qai-review-fallback\.js/);
    assert.doesNotMatch(yaml, /node scripts\/qai-review-fallback\.js/);
  }
  const engineer = fs.readFileSync(path.join(root, 'qa-engineer.yml'), 'utf8');
  assert.doesNotMatch(engineer, /qai-review-fallback/);
});
