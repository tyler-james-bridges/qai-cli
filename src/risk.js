const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { VerificationInputError, VerificationRuntimeError } = require('./verify/errors');

const DEFAULT_BASE = 'main';
const MAX_DIFF_CHARS = 80000;
const MODEL = 'jev-latest';

const EXIT_CODES = {
  'auto-ok': 0,
  skipped: 0,
  'needs-eyes': 2,
};

const GATE_LABELS = {
  'auto-ok': 'AUTO-OK',
  skipped: 'SKIPPED',
  'needs-eyes': 'NEEDS EYES',
};

/** Conservative defaults. Uncertain or high-risk answers escalate to needs-eyes. */
const THRESHOLDS = {
  minConfidence: 0.6,
  secretYes: 0.7,
  secretUncertain: 0.4,
  highScore: 1.5,
};

const QUESTIONS = {
  blast_radius: {
    type: 'score',
    instructions:
      'How widely does this change affect the rest of the repository, given `files`, `stats`, and `diff_text`?',
    criteria: [
      'Isolated: one module, docs, or tests, with little shared surface.',
      'Contained: a few related files in one area.',
      'Cross-cutting: shared core, CLI entry, auth, money, deploy, or many files.',
    ],
  },
  test_gap: {
    type: 'score',
    instructions:
      'How large is the test gap for production behavior changed in `diff_text` and `files`?',
    criteria: [
      'Tests in this diff clearly cover the changed behavior.',
      'Some related tests exist, but coverage of the change is incomplete.',
      'Production behavior changed with little or no test evidence.',
    ],
  },
  exposes_secrets: {
    type: 'noul',
    instructions:
      'Does `diff_text` add or expose credentials, API keys, tokens, private keys, or similar secrets?',
    criteria: {
      true: 'Literal secrets or high-confidence credential material appear in added lines.',
      false: 'No secrets, or only placeholders, redaction, docs, or env var names.',
    },
  },
  rollback_hardness: {
    type: 'score',
    instructions:
      'How hard would it be to revert this change after merge, given `diff_text` and `files`?',
    criteria: [
      'Trivial revert: code or docs only, no data or protocol change.',
      'Coordinated revert: config, public API, or workflow coupling.',
      'Hard or irreversible: migrations, data rewrites, secret rotation, or deploy coupling.',
    ],
  },
  merge_posture: {
    type: 'choice',
    instructions:
      'Should this change merge without extra human review, based on `diff_text`, `files`, and `stats`?',
    criteria: {
      auto_ok: 'Routine, well-tested, isolated, no secrets, and easy to revert.',
      needs_eyes: 'A careful reviewer should look before merge.',
    },
  },
};

function parseRiskArgs(argv) {
  const rest = argv.slice(3);
  const options = { repoPath: process.cwd(), base: DEFAULT_BASE };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--base' && rest[i + 1]) {
      options.base = rest[++i];
    } else if (arg === '--repo' && rest[i + 1]) {
      options.repoPath = rest[++i];
    } else if (arg === '--out' && rest[i + 1]) {
      options.outPath = rest[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--')) {
      throw new VerificationInputError(`Unknown risk option: ${arg}.`);
    } else if (/^\d+$/.test(arg)) {
      if (options.pr) {
        throw new VerificationInputError('Only one PR number is allowed.');
      }
      options.pr = parseInt(arg, 10);
    } else {
      throw new VerificationInputError(`Unexpected risk argument: ${arg}.`);
    }
  }

  return options;
}

function gitEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    env: gitEnv(),
  });
}

function looksLikeTest(filePath) {
  return /\.(test|spec)\.[^.]+$/.test(filePath) || /(^|\/)(__tests__|tests?)\//.test(filePath);
}

function truncateDiff(text, maxChars = MAX_DIFF_CHARS) {
  const originalChars = text.length;
  if (originalChars <= maxChars) {
    return { text, truncated: false, originalChars };
  }
  const notice = `\n\n[truncated ${originalChars - maxChars} of ${originalChars} chars]\n`;
  if (notice.length >= maxChars) {
    return { text: notice.slice(0, maxChars), truncated: true, originalChars };
  }
  return {
    text: text.slice(0, maxChars - notice.length) + notice,
    truncated: true,
    originalChars,
  };
}

function parseChangedFiles(diff) {
  const files = [];
  const fileDiffs = diff.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const headerMatch = fileDiff.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];
    const lines = fileDiff.split('\n');
    files.push({
      path: filePath,
      isNew: fileDiff.includes('new file mode'),
      isDeleted: fileDiff.includes('deleted file mode'),
      additions: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
      deletions: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
    });
  }

  return files;
}

function readApiKey() {
  return String(process.env.TYPESAFE_API_KEY || '').trim();
}

function collectDiff({ pr, base, repoPath }) {
  let raw;
  try {
    if (pr) {
      raw = execFileSync('gh', ['pr', 'diff', String(pr), '--color=never'], {
        cwd: repoPath,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } else {
      raw = git(['diff', `${base}...HEAD`], repoPath);
    }
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new VerificationRuntimeError(
      pr
        ? `Failed to read PR #${pr} diff: ${detail}`
        : `Failed to read git diff against ${base}: ${detail}`,
      error,
    );
  }

  const files = parseChangedFiles(raw).map((file) => ({
    ...file,
    looksLikeTest: looksLikeTest(file.path),
  }));
  const truncated = truncateDiff(raw);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return {
    source: pr
      ? { kind: 'pr', pr, repository: repoPath }
      : { kind: 'branch', base, repository: repoPath },
    stats: {
      filesChanged: files.length,
      additions,
      deletions,
      testFiles: files.filter((file) => file.looksLikeTest).length,
      diffChars: truncated.originalChars,
      truncated: truncated.truncated,
    },
    files,
    diff_text: truncated.text,
    truncated: truncated.truncated,
  };
}

function decideGate(answers) {
  const reasons = [];

  const secret = answers.exposes_secrets.noul;
  if (secret >= THRESHOLDS.secretYes) {
    reasons.push('diff appears to expose secrets or credentials');
  } else if (secret >= THRESHOLDS.secretUncertain) {
    reasons.push('secret/credential risk is uncertain');
  }

  addScoreReason(reasons, answers.blast_radius, 'blast radius');
  addScoreReason(reasons, answers.test_gap, 'test gap');
  addScoreReason(reasons, answers.rollback_hardness, 'rollback hardness');

  const posture = answers.merge_posture;
  if (posture.confidence < THRESHOLDS.minConfidence) {
    reasons.push('merge posture confidence is below the auto-ok threshold');
  }
  if (posture.choice === 'needs_eyes') {
    reasons.push('merge posture is needs_eyes');
  }

  return {
    gate: reasons.length ? 'needs-eyes' : 'auto-ok',
    reasons,
  };
}

function addScoreReason(reasons, answer, label) {
  if (answer.confidence < THRESHOLDS.minConfidence) {
    reasons.push(`${label} confidence is below the auto-ok threshold`);
  }
  if (answer.score >= THRESHOLDS.highScore) {
    reasons.push(`${label} is high`);
  }
}

function publicJudgments(answers) {
  return {
    blast_radius: pickScore(answers.blast_radius),
    test_gap: pickScore(answers.test_gap),
    exposes_secrets: { type: 'noul', noul: answers.exposes_secrets.noul },
    rollback_hardness: pickScore(answers.rollback_hardness),
    merge_posture: {
      type: 'choice',
      choice: answers.merge_posture.choice,
      probabilities: answers.merge_posture.probabilities,
      confidence: answers.merge_posture.confidence,
    },
  };
}

function pickScore(answer) {
  return {
    type: 'score',
    score: answer.score,
    confidence: answer.confidence,
    legend: answer.legend,
  };
}

function loadTypeSafeSdk() {
  try {
    // Lazy-load so `qai check` / `qai verify` never import the TypeSafe SDK.
    return require('@typesafe-ai/sdk');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new VerificationRuntimeError(
        'qai risk requires @typesafe-ai/sdk. Install it with npm install @typesafe-ai/sdk.',
        error,
      );
    }
    throw error;
  }
}

function createClient() {
  const { TypeSafeClient } = loadTypeSafeSdk();
  return new TypeSafeClient({ defaultModel: MODEL });
}

function emptyDiffReport(state) {
  return {
    command: 'risk',
    gate: 'auto-ok',
    summary: 'No changes in the diff. No TypeSafe judgment needed.',
    source: state.source,
    stats: state.stats,
    files: state.files,
    truncated: state.truncated,
    judgments: null,
    reasons: [],
    thresholds: THRESHOLDS,
    model: null,
    usage: null,
  };
}

function skippedReport(state) {
  return {
    command: 'risk',
    gate: 'skipped',
    summary:
      'TYPESAFE_API_KEY is not set. No TypeSafe judgment ran. qai check stays keyless.',
    source: state.source,
    stats: state.stats,
    files: state.files,
    truncated: state.truncated,
    judgments: null,
    reasons: ['TYPESAFE_API_KEY is not set'],
    thresholds: THRESHOLDS,
    model: null,
    usage: null,
  };
}

async function risk(options = {}) {
  const repoPath = path.resolve(options.repoPath || process.cwd());
  assertRepoPath(repoPath);

  const state = collectDiff({
    pr: options.pr,
    base: options.base || DEFAULT_BASE,
    repoPath,
  });

  if (!state.diff_text.trim()) {
    const report = emptyDiffReport(state);
    writeReportIfRequested(options, report);
    return { report, exitCode: EXIT_CODES['auto-ok'] };
  }

  if (!options.client && !readApiKey()) {
    const report = skippedReport(state);
    writeReportIfRequested(options, report);
    return { report, exitCode: EXIT_CODES.skipped };
  }

  const client = options.client || createClient();
  let response;
  try {
    response = await client.systemOne({
      model: MODEL,
      state: {
        source: state.source,
        stats: state.stats,
        files: state.files,
        diff_text: state.diff_text,
      },
      questions: QUESTIONS,
    });
  } catch (error) {
    throw new VerificationRuntimeError(`TypeSafe systemOne failed: ${error.message}`, error);
  }

  const decided = decideGate(response.answers);
  const report = {
    command: 'risk',
    gate: decided.gate,
    summary:
      decided.gate === 'auto-ok'
        ? 'Change looks routine enough to merge without extra review.'
        : `Needs eyes: ${decided.reasons.join('; ')}.`,
    source: state.source,
    stats: state.stats,
    files: state.files,
    truncated: state.truncated,
    judgments: publicJudgments(response.answers),
    reasons: decided.reasons,
    thresholds: THRESHOLDS,
    model: response.model || MODEL,
    usage: response.usage || null,
  };

  writeReportIfRequested(options, report);
  return { report, exitCode: EXIT_CODES[report.gate] };
}

function assertRepoPath(repoPath) {
  let stat;
  try {
    stat = fs.statSync(repoPath);
  } catch {
    throw new VerificationInputError(`Repository path is inaccessible: ${repoPath}.`);
  }
  if (!stat.isDirectory()) {
    throw new VerificationInputError(`Repository path is not a directory: ${repoPath}.`);
  }
}

function writeReportIfRequested(options, report) {
  if (!options.outPath) return;
  const absolutePath = path.resolve(options.outPath);
  const content = options.json ? JSON.stringify(report, null, 2) : formatHuman(report);
  try {
    fs.writeFileSync(absolutePath, content + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new VerificationInputError(`Refusing to overwrite existing report: ${absolutePath}.`);
    }
    throw new VerificationRuntimeError(
      `Could not write report to ${absolutePath}: ${error.message}`,
      error,
    );
  }
}

function formatNumber(value, digits) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function formatScoreLine(id, answer) {
  const padded = id.padEnd(18);
  return `  ${padded} ${formatNumber(answer.score, 2)}  conf ${formatNumber(answer.confidence, 2)}`;
}

function formatHuman(report) {
  const lines = [];
  lines.push(`qai risk — ${GATE_LABELS[report.gate]}`);
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  if (report.source.kind === 'pr') {
    lines.push(`Source    PR #${report.source.pr}`);
  } else {
    lines.push(`Source    HEAD vs ${report.source.base}`);
  }
  const { filesChanged, additions, deletions, diffChars } = report.stats;
  lines.push(`Files     ${filesChanged} changed  +${additions} / -${deletions}`);
  lines.push(`Diff      ${diffChars} chars${report.truncated ? ' (truncated)' : ''}`);

  if (report.judgments) {
    const { blast_radius, test_gap, exposes_secrets, rollback_hardness, merge_posture } =
      report.judgments;
    lines.push('');
    lines.push('JUDGMENTS');
    lines.push(formatScoreLine('blast_radius', blast_radius));
    lines.push(formatScoreLine('test_gap', test_gap));
    lines.push(`  ${'exposes_secrets'.padEnd(18)} ${formatNumber(exposes_secrets.noul, 3)}`);
    lines.push(formatScoreLine('rollback_hardness', rollback_hardness));
    const postureConf = formatNumber(merge_posture.confidence, 2);
    lines.push(`  ${'merge_posture'.padEnd(18)} ${merge_posture.choice}  conf ${postureConf}`);
  }

  lines.push('');
  lines.push(`GATE      ${GATE_LABELS[report.gate]}`);
  if (report.reasons.length) {
    lines.push(`Reasons   ${report.reasons.join('; ')}`);
  }
  if (report.gate === 'skipped') {
    lines.push('Set TYPESAFE_API_KEY for live change-risk scoring.');
  }
  lines.push('');
  lines.push(`VERDICT  ${GATE_LABELS[report.gate]}`);
  return lines.join('\n');
}

async function runRisk() {
  const options = parseRiskArgs(process.argv);
  if (!options.json) console.error('qai risk: collecting diff...');
  const result = await risk(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(result.report) + '\n');
  }
  process.exitCode = result.exitCode;
}

module.exports = {
  DEFAULT_BASE,
  EXIT_CODES,
  MAX_DIFF_CHARS,
  MODEL,
  QUESTIONS,
  THRESHOLDS,
  collectDiff,
  decideGate,
  formatHuman,
  looksLikeTest,
  parseChangedFiles,
  parseRiskArgs,
  risk,
  runRisk,
  truncateDiff,
};
