const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { verify } = require('../../src/verify');
const { cleanupRepo, createRepo, fixture, materializeContract } = require('./test-helpers');

const NOW = new Date('2026-08-03T23:45:00.000Z');

const CASES = [
  [
    'stale deploy passes when tested, deployed, and live identities match',
    'stale-deploy',
    'pass',
    'pass',
    0,
  ],
  ['stale deploy fails when production serves an old SHA', 'stale-deploy', 'fail', 'fail', 1],
  [
    'stale deploy needs review when the live revision marker is missing',
    'stale-deploy',
    'review',
    'needs_human_review',
    2,
  ],
  ['cron passes after a due successful run and postcondition', 'silent-cron', 'pass', 'pass', 0],
  ['silent cron fails when a due invocation is absent', 'silent-cron', 'fail', 'fail', 1],
  [
    'cron needs review when scheduler evidence is inaccessible',
    'silent-cron',
    'review',
    'needs_human_review',
    2,
  ],
  [
    'incomplete report needs review for omitted criterion IDs',
    'incomplete-report',
    'review',
    'needs_human_review',
    2,
    'incomplete.md',
  ],
  [
    'completion report coverage passes when every ID is named',
    'incomplete-report',
    'pass',
    'pass',
    0,
    'complete.md',
  ],
  ['model route passes after provider visibility and actual smoke', 'bad-model', 'pass', 'pass', 0],
  ['bad model ID fails after provider rejection', 'bad-model', 'fail', 'fail', 1],
  [
    'catalog-only model evidence needs review without route smoke',
    'bad-model',
    'review',
    'needs_human_review',
    2,
  ],
  ['production data passes deterministic provenance checks', 'placeholder', 'pass', 'pass', 0],
  ['known placeholder sentinel in production fails', 'placeholder', 'fail', 'fail', 1],
  [
    'realistic-looking suspicious data needs review without ground truth',
    'placeholder',
    'review',
    'needs_human_review',
    2,
  ],
  [
    'live stack passes when canary and ACK health JSON match the operational shape',
    'live-stack',
    'pass',
    'pass',
    0,
  ],
  [
    'live stack fails when canary health status contradicts operational_read_only',
    'live-stack',
    'fail',
    'fail',
    1,
  ],
  [
    'live stack needs review when Morsel /api/health is an HTML catch-all',
    'live-stack',
    'review',
    'needs_human_review',
    2,
  ],
];

for (const [name, family, variant, verdict, exitCode, claimName = 'claim.md'] of CASES) {
  test(name, async () => {
    const { repo, sha } = createRepo();
    const materialized = materializeContract(fixture(family, `${variant}.contract.json`), sha);
    try {
      const result = await verify({
        contractPath: materialized.contractPath,
        claimPath: path.join(materialized.dir, claimName),
        repoPath: repo,
        now: NOW,
      });
      assert.equal(result.report.verdict, verdict);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.report.criteria.length, 1);
      assert.equal(result.report.criteria[0].status, verdict);
      assert.ok(result.report.criteria[0].evidence.length > 0);
    } finally {
      cleanupRepo(repo);
      fs.rmSync(materialized.dir, { recursive: true, force: true });
    }
  });
}

test('zero executed tests cannot produce a pass from exit/conclusion alone', async () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('stale-deploy', 'pass.contract.json'), sha);
  const workflowPath = path.join(materialized.dir, 'workflow.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  workflow.testsExecuted = 0;
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
  try {
    const result = await verify({
      contractPath: materialized.contractPath,
      claimPath: path.join(materialized.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(result.report.verdict, 'fail');
    assert.match(result.report.criteria[0].reason, /0 tests executed/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('expired or internally inconsistent evidence needs human review and cannot pass', async () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
  const evidencePath = path.join(materialized.dir, 'pass.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  evidence.freshUntil = '2026-08-03T22:00:00.000Z';
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  try {
    const result = await verify({
      contractPath: materialized.contractPath,
      claimPath: path.join(materialized.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(result.report.verdict, 'needs_human_review');
    assert.match(result.report.criteria[0].reason, /expired|precedes observedAt/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('recorded evidence without a freshness bound cannot pass', async () => {
  const { repo, sha } = createRepo();
  const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
  const evidencePath = path.join(materialized.dir, 'pass.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  delete evidence.freshUntil;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  try {
    const result = await verify({
      contractPath: materialized.contractPath,
      claimPath: path.join(materialized.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(result.report.verdict, 'needs_human_review');
    assert.match(result.report.criteria[0].reason, /no freshness bound/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});

test('malformed and future evidence timestamps cannot pass', async (t) => {
  for (const [name, mutate, reason] of [
    ['malformed freshness', (item) => (item.freshUntil = 'not-a-date'), /invalid freshUntil/],
    [
      'future observation',
      (item) => {
        item.observedAt = '2099-01-01T00:00:00.000Z';
        item.freshUntil = '2099-01-02T00:00:00.000Z';
      },
      /in the future/,
    ],
  ]) {
    await t.test(name, async () => {
      const { repo, sha } = createRepo();
      const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
      const evidencePath = path.join(materialized.dir, 'pass.json');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      mutate(evidence);
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      try {
        const result = await verify({
          contractPath: materialized.contractPath,
          claimPath: path.join(materialized.dir, 'claim.md'),
          repoPath: repo,
          now: NOW,
        });
        assert.equal(result.report.verdict, 'needs_human_review');
        assert.match(result.report.criteria[0].reason, reason);
      } finally {
        cleanupRepo(repo);
        fs.rmSync(materialized.dir, { recursive: true, force: true });
      }
    });
  }
});

test('recorded evidence is bound to the declared subject', async (t) => {
  const cases = [
    [
      'wrong probe URL',
      'stale-deploy',
      'pass.contract.json',
      'probe.json',
      (item) => {
        item.url = 'https://other.test/api/feature';
      },
      'fail',
    ],
    [
      'missing model identity',
      'bad-model',
      'pass.contract.json',
      'pass.json',
      (item) => {
        delete item.provider;
        delete item.model;
        delete item.route;
      },
      'needs_human_review',
    ],
    [
      'wrong scheduler invocation',
      'silent-cron',
      'pass.contract.json',
      'success.json',
      (item) => {
        item.dueAt = '1999-01-01T00:00:00.000Z';
        item.revision = 'b'.repeat(40);
        item.environment = 'staging';
      },
      'fail',
    ],
    [
      'missing placeholder scan subject',
      'placeholder',
      'pass.contract.json',
      'pass.json',
      (item) => {
        delete item.environment;
        delete item.matchedSentinels;
      },
      'needs_human_review',
    ],
  ];
  for (const [name, family, contractName, evidenceName, mutate, verdict] of cases) {
    await t.test(name, async () => {
      const { repo, sha } = createRepo();
      const materialized = materializeContract(fixture(family, contractName), sha);
      const evidencePath = path.join(materialized.dir, evidenceName);
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      mutate(evidence);
      fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      try {
        const result = await verify({
          contractPath: materialized.contractPath,
          claimPath: path.join(materialized.dir, 'claim.md'),
          repoPath: repo,
          now: NOW,
        });
        assert.equal(result.report.verdict, verdict);
      } finally {
        cleanupRepo(repo);
        fs.rmSync(materialized.dir, { recursive: true, force: true });
      }
    });
  }
});

test('live-stack fail and review reasons stay bound to HTTP probe shapes', async () => {
  const { repo, sha } = createRepo();
  const failCase = materializeContract(fixture('live-stack', 'fail.contract.json'), sha);
  const reviewCase = materializeContract(fixture('live-stack', 'review.contract.json'), sha);
  try {
    const failed = await verify({
      contractPath: failCase.contractPath,
      claimPath: path.join(failCase.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(failed.report.verdict, 'fail');
    assert.match(
      failed.report.criteria[0].reason,
      /probe value at \$\.status does not match expected value/,
    );

    const reviewed = await verify({
      contractPath: reviewCase.contractPath,
      claimPath: path.join(reviewCase.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(reviewed.report.verdict, 'needs_human_review');
    assert.match(reviewed.report.criteria[0].reason, /No value found at \$\.status/);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(failCase.dir, { recursive: true, force: true });
    fs.rmSync(reviewCase.dir, { recursive: true, force: true });
  }
});

test('a dirty worktree fails exact local revision verification', async () => {
  const { repo, sha } = createRepo({ dirty: true });
  const materialized = materializeContract(fixture('placeholder', 'pass.contract.json'), sha);
  try {
    const result = await verify({
      contractPath: materialized.contractPath,
      claimPath: path.join(materialized.dir, 'claim.md'),
      repoPath: repo,
      now: NOW,
    });
    assert.equal(result.report.verdict, 'fail');
    const gitEvidence = result.report.criteria[0].evidence.find(
      (item) => item.collector === 'git.local',
    );
    assert.equal(gitEvidence.facts.dirty, true);
  } finally {
    cleanupRepo(repo);
    fs.rmSync(materialized.dir, { recursive: true, force: true });
  }
});
