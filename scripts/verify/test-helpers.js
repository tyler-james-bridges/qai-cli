const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(__dirname, 'fixtures');
const TARGET_SHA = 'a'.repeat(40);

function fixture(...parts) {
  return path.join(FIXTURES, ...parts);
}

function createRepo(options = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-verify-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'QAI Test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'qai-test@example.test'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      GIT_AUTHOR_NAME: 'QAI Test',
      GIT_AUTHOR_EMAIL: 'qai-test@example.test',
      GIT_COMMITTER_NAME: 'QAI Test',
      GIT_COMMITTER_EMAIL: 'qai-test@example.test',
    },
  });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  if (options.dirty) fs.appendFileSync(path.join(repo, 'README.md'), 'dirty\n');
  return { repo, sha };
}

function materializeContract(contractPath, revision) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-verify-contract-'));
  const sourceDir = path.dirname(contractPath);
  fs.cpSync(sourceDir, dir, { recursive: true });
  for (const evidencePath of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const file = path.join(dir, evidencePath);
    let raw = fs.readFileSync(file, 'utf8');
    raw = raw.replaceAll('OLD_REVISION', 'b'.repeat(40)).replaceAll('REVISION', revision);
    fs.writeFileSync(file, raw);
  }
  const copied = path.join(dir, path.basename(contractPath));
  const contract = JSON.parse(fs.readFileSync(copied, 'utf8'));
  contract.revision = revision;
  fs.writeFileSync(copied, JSON.stringify(contract, null, 2) + '\n');
  return { contractPath: copied, dir };
}

function cleanupRepo(repo) {
  fs.rmSync(repo, { recursive: true, force: true });
}

function runCli(args, options = {}) {
  return require('child_process').spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'src/index.js'), ...args],
    {
      cwd: options.cwd || PROJECT_ROOT,
      encoding: 'utf8',
      input: options.input,
      env: {
        ...process.env,
        QAI_VERIFY_NOW: '2026-08-03T23:45:00.000Z',
        ...options.env,
      },
    },
  );
}

module.exports = {
  FIXTURES,
  PROJECT_ROOT,
  TARGET_SHA,
  cleanupRepo,
  createRepo,
  fixture,
  materializeContract,
  runCli,
};
