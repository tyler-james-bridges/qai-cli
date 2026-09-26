#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const ISSUE_TITLE = 'QAI review: AI providers unavailable';
const FALLBACK_LABEL = 'AI review unavailable, change-risk fallback';
const NOT_A_FINDING =
  'This is not an AI review finding and does not fail the check.';

const FAILURE_LINE_RE = new RegExp(
  [
    'credit balance',
    'insufficient credits?',
    'invalid api key',
    'invalid x-api-key',
    'authentication_error',
    'not_found_error',
    'no api key provided',
    'provider error',
    '\\b404\\b',
  ].join('|'),
  'i',
);

function clipTail(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const hidden = value.length - max;
  return `… truncated ${hidden} characters\n${value.slice(value.length - max)}`;
}

function annotation(text) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, 400);
}

function parseRiskReport(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const candidates = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {
    const marker = text.lastIndexOf('\n{');
    const slice = marker >= 0 ? text.slice(marker + 1) : '';
    if (slice) {
      try {
        candidates.push(JSON.parse(slice));
      } catch {
        return null;
      }
    }
  }
  return candidates.find((item) => item && item.command === 'risk') || null;
}

function failureDetail(result) {
  return clipTail([result.stderr, result.stdout].filter(Boolean).join('\n'), 500);
}

function interpretRisk(result) {
  const outcome = result || { stdout: '', stderr: '', status: null, error: '' };
  if (outcome.error) {
    return {
      kind: 'unavailable',
      honest: `qai risk could not run (${outcome.error}).`,
    };
  }

  const report = parseRiskReport(outcome.stdout);
  if (report && report.gate === 'skipped') {
    const summary = report.summary || 'No TypeSafe judgment ran.';
    return {
      kind: 'unavailable',
      honest: `qai risk could not score this diff. ${summary}`,
    };
  }
  if (report && (report.gate === 'auto-ok' || report.gate === 'needs-eyes')) {
    return { kind: 'scored', report };
  }
  if (report) {
    return {
      kind: 'unavailable',
      honest: `qai risk could not score this diff. Unexpected gate: ${report.gate}.`,
    };
  }

  const blob = `${outcome.stdout || ''}\n${outcome.stderr || ''}`;
  if (/TYPESAFE_API_KEY is not set/i.test(blob)) {
    return {
      kind: 'unavailable',
      honest:
        'qai risk could not score this diff. TYPESAFE_API_KEY is not set. No TypeSafe judgment ran.',
    };
  }

  const detail = failureDetail(outcome);
  const status = outcome.status == null ? 'unknown' : outcome.status;
  const suffix = detail ? ` ${detail}` : '';
  return {
    kind: 'unavailable',
    honest: `qai risk could not run (exit ${status}).${suffix}`,
  };
}

function formatJudgment(name, answer) {
  if (!answer || typeof answer.score !== 'number') return '';
  const confidence =
    typeof answer.confidence === 'number' ? answer.confidence.toFixed(2) : 'n/a';
  return `${name}: ${answer.score.toFixed(2)} (confidence ${confidence})`;
}

function formatRiskSection(report) {
  const lines = ['### Change-risk (`qai risk`)', '', `Gate: ${report.gate}`, report.summary || ''];
  const judgments = report.judgments;
  if (judgments) {
    lines.push('');
    for (const name of ['blast_radius', 'test_gap', 'rollback_hardness']) {
      const line = formatJudgment(name, judgments[name]);
      if (line) lines.push(line);
    }
    const secrets = judgments.exposes_secrets;
    if (secrets && typeof secrets.noul === 'number') {
      lines.push(`exposes_secrets: ${secrets.noul.toFixed(3)}`);
    }
    const posture = judgments.merge_posture;
    if (posture && posture.choice) {
      const confidence =
        typeof posture.confidence === 'number' ? posture.confidence.toFixed(2) : 'n/a';
      lines.push(`merge_posture: ${posture.choice} (confidence ${confidence})`);
    }
  }
  lines.push('', NOT_A_FINDING);
  return lines.join('\n');
}

function unavailableSection(message) {
  return [
    '### Change-risk (`qai risk`)',
    '',
    message,
    '',
    `No change-risk score was produced. ${NOT_A_FINDING}`,
  ].join('\n');
}

function failureExcerpt(log) {
  const lines = String(log || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const hit = lines.find((line) => FAILURE_LINE_RE.test(line));
  return (hit || lines[lines.length - 1] || '').slice(0, 300);
}

function buildReason(note, reviewLog) {
  const base = String(note || 'skipped: provider unavailable').trim();
  const excerpt = failureExcerpt(reviewLog);
  if (!excerpt || excerpt === base) return base;
  return `${base} — ${excerpt}`;
}

function pullRequestLink(repo, pr) {
  if (!repo || !/^\d+$/.test(String(pr || ''))) return `PR #${pr || '?'}`;
  const server = String(process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  return `${server}/${repo}/pull/${pr}`;
}

function buildFallbackComment({ reason, reviewLog, riskResult }) {
  const interpreted = interpretRisk(riskResult);
  const parts = [
    `## 🤖 QAI Code Review — ${FALLBACK_LABEL}`,
    '',
    `${FALLBACK_LABEL}. Provider/auth/billing failure skipped the review. ${NOT_A_FINDING}`,
    '',
    `Review skip: ${reason}`,
    '',
    interpreted.kind === 'scored'
      ? formatRiskSection(interpreted.report)
      : unavailableSection(interpreted.honest),
  ];
  const providerLog = clipTail(reviewLog, 4000);
  if (providerLog) {
    parts.push(
      '',
      '<details>',
      '<summary>Provider failure</summary>',
      '',
      '```',
      providerLog,
      '```',
      '',
      '</details>',
    );
  }
  if (interpreted.kind === 'scored') {
    parts.push(
      '',
      '<details>',
      '<summary>qai risk JSON</summary>',
      '',
      '```json',
      clipTail(JSON.stringify(interpreted.report, null, 2), 12000),
      '```',
      '',
      '</details>',
    );
  }
  return parts.join('\n');
}

function selectTrackingIssue(issues) {
  const matches = (issues || []).filter((issue) => issue && issue.title === ISSUE_TITLE);
  matches.sort((left, right) => left.number - right.number);
  return matches[0] || null;
}

function buildIssueComment({ repo, pr, reason }) {
  return [
    `AI providers unavailable on ${pullRequestLink(repo, pr)}`,
    '',
    `Reason: ${reason}`,
  ].join('\n');
}

function buildIssueBody({ repo, pr, reason }) {
  return [
    'QAI review skipped because every AI provider failed (billing, auth, or model).',
    '',
    'This issue tracks those skips. It is not closed automatically.',
    '',
    buildIssueComment({ repo, pr, reason }),
  ].join('\n');
}

function defaultGh(args, env) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env,
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const errorText = result.error ? result.error.message : '';
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: `${result.stderr || ''}${errorText}`.trim(),
    error: errorText,
  };
}

function readIssueList(result) {
  if (!result || !result.ok) return null;
  try {
    const data = JSON.parse(result.stdout || 'null');
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function ghIssueList(repo, gh, search) {
  const args = [
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    search ? '50' : '200',
    '--json',
    'number,title',
  ];
  if (search) args.push('--search', `"${ISSUE_TITLE}" in:title`);
  return gh(args);
}

function loadTrackingIssue(repo, gh) {
  const searched = readIssueList(ghIssueList(repo, gh, true));
  const fromSearch = searched ? selectTrackingIssue(searched) : null;
  if (fromSearch) return { ok: true, issue: fromSearch };
  const listed = readIssueList(ghIssueList(repo, gh, false));
  if (!listed) {
    return { ok: false, error: 'could not list open issues to find the tracking issue' };
  }
  return { ok: true, issue: selectTrackingIssue(listed) };
}

function upsertTrackingIssue({ repo, pr, reason, gh }) {
  if (!repo) return { ok: false, error: 'GITHUB_REPOSITORY is not set' };
  const loaded = loadTrackingIssue(repo, gh);
  if (!loaded.ok) return loaded;
  if (loaded.issue) {
    return gh([
      'issue',
      'comment',
      String(loaded.issue.number),
      '--repo',
      repo,
      '--body',
      buildIssueComment({ repo, pr, reason }),
    ]);
  }
  return gh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    ISSUE_TITLE,
    '--body',
    buildIssueBody({ repo, pr, reason }),
  ]);
}

function defaultRunRisk(pr, env) {
  const result = spawnSync('qai', ['risk', String(pr), '--json'], {
    encoding: 'utf8',
    env,
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error ? result.error.message : '',
  };
}

function runFallback(options = {}) {
  const env = options.env || process.env;
  const gh = options.gh || ((args) => defaultGh(args, env));
  const pr = String(options.pr || '').trim();
  const repo = options.repo || '';
  const reason = buildReason(options.reason, options.reviewLog);
  const warnings = [];
  let riskResult;
  if (!/^\d+$/.test(pr)) {
    riskResult = { stdout: '', stderr: '', status: 1, error: 'no pull request number' };
  } else {
    riskResult = (options.runRisk || defaultRunRisk)(pr, env);
  }

  const comment = buildFallbackComment({
    reason,
    reviewLog: options.reviewLog,
    riskResult,
  });

  if (/^\d+$/.test(pr)) {
    const args = ['pr', 'comment', pr];
    if (repo) args.push('--repo', repo);
    args.push('--body', comment);
    const posted = gh(args);
    if (!posted.ok) {
      warnings.push(`PR comment failed: ${posted.stderr || posted.error || 'gh pr comment failed'}`);
    }
  } else {
    warnings.push('PR comment skipped: no pull request number');
  }

  const issue = upsertTrackingIssue({ repo, pr, reason, gh });
  if (!issue.ok) {
    warnings.push(`Tracking issue update failed: ${issue.stderr || issue.error || 'gh issue failed'}`);
  }

  return { comment, reason, riskResult, warnings, exitCode: 0 };
}

function readReviewLog(file) {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  try {
    const result = runFallback({
      pr: process.env.PR_NUMBER,
      reason: process.env.SKIP_REASON,
      reviewLog: readReviewLog(process.env.REVIEW_LOG),
      repo: process.env.GITHUB_REPOSITORY,
    });
    process.stdout.write(`${result.comment}\n`);
    for (const warning of result.warnings) {
      process.stdout.write(`::warning::${annotation(warning)}\n`);
    }
  } catch (error) {
    const message = annotation(error && error.message);
    process.stdout.write(`::warning::change-risk fallback failed: ${message}\n`);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  FALLBACK_LABEL,
  ISSUE_TITLE,
  buildFallbackComment,
  buildReason,
  runFallback,
  selectTrackingIssue,
};
