const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { cleanupRepo, createRepo, fixture, materializeContract, runCli } = require('./test-helpers');

test('--json emits exactly one JSON document on stdout and exit 1 for fail', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('stale-deploy', 'fail.contract.json'), sha);
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      path.join(materialized.dir, 'claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.verdict, 'fail');
    assert.equal(result.stdout.trimStart()[0], '{');
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('human output puts review verdict first and last and exits 2', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('stale-deploy', 'review.contract.json'), sha);
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      path.join(materialized.dir, 'claim.md'),
      '--repo',
      repo,
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /collecting declared read-only evidence/);
    assert.match(result.stdout, /^qai verify — NEEDS HUMAN REVIEW/);
    assert.match(result.stdout, /VERDICT {2}NEEDS HUMAN REVIEW/);
    assert.match(result.stdout, /Human/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('invalid contract exits 3 with details and no stdout report', () => {
  const { repo } = createRepo();
  try {
    const result = runCli([
      'verify',
      fixture('malformed.contract.json'),
      '--claim',
      fixture('secret-claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 3);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Input error: Invalid verification contract/);
    assert.match(result.stderr, /unknown field/);
  } finally {
    cleanupRepo(repo);
  }
});

test('reads a completion claim from stdin', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('incomplete-report', 'pass.contract.json'), sha);
  try {
    const result = runCli(
      ['verify', materialized.contractPath, '--claim', '-', '--repo', repo, '--json'],
      { input: 'AC-REPO done. AC-DEPLOY done. AC-AUTOMATION done.\n' },
    );
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).verdict, 'pass');
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('--out persists only when requested and refuses overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-out-'));
  const output = path.join(dir, 'report.json');
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('incomplete-report', 'pass.contract.json'), sha);
  const args = [
    'verify',
    materialized.contractPath,
    '--claim',
    path.join(materialized.dir, 'complete.md'),
    '--repo',
    repo,
    '--json',
    '--out',
    output,
  ];
  try {
    const first = runCli(args);
    assert.equal(first.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).verdict, 'pass');
    const second = runCli(args);
    assert.equal(second.status, 3);
    assert.match(second.stderr, /Refusing to overwrite/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('report output redacts claim secrets', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(
    fixture('incomplete-report', 'review.contract.json'),
    sha,
  );
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      fixture('secret-claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /super-secret-token|abcdefghijklmnop/);
    assert.match(result.stdout, /\[REDACTED\]/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('verify does not modify the target repository', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
  const before = fs.readdirSync(repo, { recursive: true }).sort();
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      path.join(materialized.dir, 'claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 0);
    const after = fs.readdirSync(repo, { recursive: true }).sort();
    assert.deepEqual(after, before);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('explicitly adverse claim wording cannot create a pass by naming IDs', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('incomplete-report', 'pass.contract.json'), sha);
  try {
    const result = runCli(
      ['verify', materialized.contractPath, '--claim', '-', '--repo', repo, '--json'],
      { input: 'AC-REPO failed. AC-DEPLOY is not done. AC-AUTOMATION never ran.\n' },
    );
    const report = JSON.parse(result.stdout);
    assert.notEqual(report.verdict, 'pass');
    assert.match(report.inputs.claim.content, /not done/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('Git collection disables repository-controlled fsmonitor execution', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-fsmonitor-'));
  const marker = path.join(outside, 'executed');
  const monitor = path.join(outside, 'monitor.sh');
  fs.writeFileSync(monitor, `#!/bin/sh\necho executed > '${marker}'\nexit 0\n`);
  fs.chmodSync(monitor, 0o755);
  execFileSync('git', ['config', 'core.fsmonitor', monitor], { cwd: repo });
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      path.join(materialized.dir, 'claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('live-stack pass contract exits 0 through the CLI', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('live-stack', 'pass.contract.json'), sha);
  try {
    const result = runCli([
      'verify',
      materialized.contractPath,
      '--claim',
      path.join(materialized.dir, 'claim.md'),
      '--repo',
      repo,
      '--json',
    ]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verdict, 'pass');
    assert.equal(report.criteria[0].id, 'AC-HEALTH');
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('invalid QAI_VERIFY_NOW exits 3', () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('live-stack', 'pass.contract.json'), sha);
  try {
    const result = runCli(
      [
        'verify',
        materialized.contractPath,
        '--claim',
        path.join(materialized.dir, 'claim.md'),
        '--repo',
        repo,
        '--json',
      ],
      { env: { QAI_VERIFY_NOW: 'not-a-date' } },
    );
    assert.equal(result.status, 3);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /QAI_VERIFY_NOW is not a valid timestamp/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});
