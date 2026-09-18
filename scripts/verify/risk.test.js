const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  QUESTIONS,
  THRESHOLDS,
  collectDiff,
  decideGate,
  formatHuman,
  looksLikeTest,
  parseChangedFiles,
  parseRiskArgs,
  risk,
  truncateDiff,
} = require('../../src/risk');
const { cleanupRepo, createRepo, PROJECT_ROOT, runCli } = require('./test-helpers');

function answers(overrides = {}) {
  return {
    blast_radius: { type: 'score', score: 0.2, confidence: 0.9, legend: { 0: 'isolated' } },
    test_gap: { type: 'score', score: 0.1, confidence: 0.85, legend: { 0: 'covered' } },
    exposes_secrets: { type: 'noul', noul: 0.02 },
    rollback_hardness: { type: 'score', score: 0.1, confidence: 0.88, legend: { 0: 'trivial' } },
    merge_posture: {
      type: 'choice',
      choice: 'auto_ok',
      confidence: 0.86,
      probabilities: { auto_ok: 0.9, needs_eyes: 0.1 },
    },
    ...overrides,
  };
}

function commitFile(repo, filePath, contents, message) {
  fs.writeFileSync(path.join(repo, filePath), contents);
  execFileSync('git', ['add', filePath], { cwd: repo });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-02T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z',
      GIT_AUTHOR_NAME: 'QAI Test',
      GIT_AUTHOR_EMAIL: 'qai-test@example.test',
      GIT_COMMITTER_NAME: 'QAI Test',
      GIT_COMMITTER_EMAIL: 'qai-test@example.test',
    },
  });
}

function mockClient(handler) {
  return {
    async systemOne(request) {
      return handler(request);
    },
  };
}

test('questions mix score, noul, and choice', () => {
  const types = Object.fromEntries(
    Object.entries(QUESTIONS).map(([id, question]) => [id, question.type]),
  );
  assert.deepEqual(types, {
    blast_radius: 'score',
    test_gap: 'score',
    exposes_secrets: 'noul',
    rollback_hardness: 'score',
    merge_posture: 'choice',
  });
});

test('decideGate auto-ok when every signal is low-risk and confident', () => {
  const decided = decideGate(answers());
  assert.equal(decided.gate, 'auto-ok');
  assert.deepEqual(decided.reasons, []);
});

test('decideGate needs-eyes when secrets look present', () => {
  const decided = decideGate(answers({ exposes_secrets: { type: 'noul', noul: 0.91 } }));
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /secrets/);
});

test('decideGate needs-eyes when secret noul is in the uncertain band', () => {
  const decided = decideGate(answers({ exposes_secrets: { type: 'noul', noul: 0.5 } }));
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /uncertain/);
});

test('decideGate needs-eyes on high blast radius even if merge_posture is auto_ok', () => {
  const decided = decideGate(
    answers({
      blast_radius: { type: 'score', score: THRESHOLDS.highScore, confidence: 0.95 },
    }),
  );
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /blast radius/);
});

test('decideGate needs-eyes on high test gap', () => {
  const decided = decideGate(
    answers({ test_gap: { type: 'score', score: 1.8, confidence: 0.8 } }),
  );
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /test gap/);
});

test('decideGate needs-eyes on hard rollback', () => {
  const decided = decideGate(
    answers({ rollback_hardness: { type: 'score', score: 1.7, confidence: 0.8 } }),
  );
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /rollback/);
});

test('decideGate needs-eyes when merge_posture is needs_eyes', () => {
  const decided = decideGate(
    answers({
      merge_posture: {
        type: 'choice',
        choice: 'needs_eyes',
        confidence: 0.9,
        probabilities: { auto_ok: 0.1, needs_eyes: 0.9 },
      },
    }),
  );
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /needs_eyes/);
});

test('decideGate needs-eyes when confidence is below the auto-ok floor', () => {
  const decided = decideGate(
    answers({
      merge_posture: {
        type: 'choice',
        choice: 'auto_ok',
        confidence: 0.4,
        probabilities: { auto_ok: 0.55, needs_eyes: 0.45 },
      },
    }),
  );
  assert.equal(decided.gate, 'needs-eyes');
  assert.match(decided.reasons.join(' '), /confidence/);
});

test('truncateDiff keeps small text and caps large text', () => {
  const small = truncateDiff('hello', 100);
  assert.equal(small.truncated, false);
  assert.equal(small.text, 'hello');

  const large = truncateDiff('x'.repeat(50), 20);
  assert.equal(large.truncated, true);
  assert.equal(large.originalChars, 50);
  assert.ok(large.text.length <= 20);
  assert.match(large.text, /truncated/);
});

test('parseChangedFiles and looksLikeTest read a unified diff', () => {
  const diff = [
    'diff --git a/src/app.js b/src/app.js',
    'index 111..222 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,2 @@',
    ' keep',
    '+added',
    'diff --git a/src/app.test.js b/src/app.test.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/app.test.js',
    '@@ -0,0 +1,1 @@',
    '+test',
  ].join('\n');
  const files = parseChangedFiles(diff);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'src/app.js');
  assert.equal(files[0].additions, 1);
  assert.equal(files[1].isNew, true);
  assert.equal(looksLikeTest('src/app.js'), false);
  assert.equal(looksLikeTest('src/app.test.js'), true);
});

test('parseRiskArgs reads PR, base, repo, and json', () => {
  const options = parseRiskArgs([
    'node',
    'qai',
    'risk',
    '42',
    '--base',
    'develop',
    '--repo',
    '/tmp/repo',
    '--json',
  ]);
  assert.equal(options.pr, 42);
  assert.equal(options.base, 'develop');
  assert.equal(options.repoPath, '/tmp/repo');
  assert.equal(options.json, true);
});

test('empty diff is auto-ok without a TypeSafe client or key', async () => {
  const { repo, sha } = createRepo();
  try {
    const result = await risk({ repoPath: repo, base: sha });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.gate, 'auto-ok');
    assert.match(result.report.summary, /No changes/);
    assert.equal(result.report.judgments, null);
  } finally {
    cleanupRepo(repo);
  }
});

test('missing TYPESAFE_API_KEY skips live judgment when a diff exists', async () => {
  const { repo, sha } = createRepo();
  try {
    commitFile(repo, 'app.js', 'console.log(1);\n', 'add app');
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const result = await risk({ repoPath: repo, base: sha });
      assert.equal(result.exitCode, 0);
      assert.equal(result.report.gate, 'skipped');
      assert.match(result.report.summary, /TYPESAFE_API_KEY/);
      assert.equal(result.report.stats.filesChanged, 1);
    } finally {
      if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previous;
    }
  } finally {
    cleanupRepo(repo);
  }
});

test('risk scores a collected diff through one mocked systemOne call', async () => {
  const { repo, sha } = createRepo();
  try {
    commitFile(repo, 'src/app.js', 'module.exports = 1;\n', 'add app');
    let captured;
    const result = await risk({
      repoPath: repo,
      base: sha,
      client: mockClient((request) => {
        captured = request;
        return {
          model: 'jev-latest',
          answers: answers(),
          usage: { input_tokens: 12, output_tokens: 4 },
        };
      }),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.gate, 'auto-ok');
    assert.equal(captured.model, 'jev-latest');
    assert.equal(captured.questions, QUESTIONS);
    assert.match(captured.state.diff_text, /src\/app\.js/);
    assert.equal(captured.state.stats.filesChanged, 1);
    assert.equal(result.report.judgments.merge_posture.choice, 'auto_ok');
    assert.match(formatHuman(result.report), /qai risk — AUTO-OK/);
  } finally {
    cleanupRepo(repo);
  }
});

test('collectDiff records test-file metadata', () => {
  const { repo, sha } = createRepo();
  try {
    commitFile(repo, 'src/app.test.js', "test('ok', () => {});\n", 'add test');
    const state = collectDiff({ base: sha, repoPath: repo });
    assert.equal(state.files[0].looksLikeTest, true);
    assert.equal(state.stats.testFiles, 1);
  } finally {
    cleanupRepo(repo);
  }
});

test('CLI skips without TYPESAFE_API_KEY and documents the key in help', () => {
  const { repo, sha } = createRepo();
  try {
    commitFile(repo, 'app.js', 'console.log(1);\n', 'add app');
    const result = runCli(['risk', '--base', sha, '--repo', repo, '--json'], {
      env: { TYPESAFE_API_KEY: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.gate, 'skipped');
    assert.match(report.summary, /TYPESAFE_API_KEY/);
  } finally {
    cleanupRepo(repo);
  }

  const help = runCli(['help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /qai risk \[pr\]/);
  assert.match(help.stdout, /TYPESAFE_API_KEY/);
  assert.match(help.stdout, /no API key/);
});

test('CLI unknown risk option exits 3', () => {
  const result = runCli(['risk', '--bogus']);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unknown risk option/);
});

test('CLI mocked TypeSafe client gates needs-eyes without a live key', () => {
  const { repo, sha } = createRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-risk-cli-'));
  const preload = path.join(dir, 'preload.js');
  fs.writeFileSync(
    preload,
    [
      "const Module = require('module');",
      'const orig = Module._load;',
      'Module._load = function (request, parent, isMain) {',
      "  if (request === '@typesafe-ai/sdk') {",
      '    return {',
      '      TypeSafeClient: class TypeSafeClient {',
      '        async systemOne() {',
      '          return {',
      "            model: 'jev-latest',",
      '            answers: {',
      '              blast_radius: { type: "score", score: 0.2, confidence: 0.9 },',
      '              test_gap: { type: "score", score: 0.1, confidence: 0.9 },',
      '              exposes_secrets: { type: "noul", noul: 0.95 },',
      '              rollback_hardness: { type: "score", score: 0.1, confidence: 0.9 },',
      '              merge_posture: { type: "choice", choice: "needs_eyes", confidence: 0.9, probabilities: { auto_ok: 0.05, needs_eyes: 0.95 } },',
      '            },',
      '            usage: { input_tokens: 1, output_tokens: 1 },',
      '          };',
      '        }',
      '      },',
      '    };',
      '  }',
      '  return orig.apply(this, arguments);',
      '};',
      '',
    ].join('\n'),
  );
  try {
    commitFile(repo, 'app.js', "const key = 'sk-live-not-real';\n", 'add secretish');
    const result = spawnSync(
      process.execPath,
      [path.join(PROJECT_ROOT, 'src/index.js'), 'risk', '--base', sha, '--repo', repo, '--json'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${preload}`,
          TYPESAFE_API_KEY: 'test-not-a-live-key',
        },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.gate, 'needs-eyes');
    assert.match(report.reasons.join(' '), /secrets/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
