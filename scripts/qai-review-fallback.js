#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const ISSUE_TITLE = 'QAI review: AI providers unavailable';
const LABEL = 'AI review unavailable, change-risk fallback';
const NOT_A_FINDING = 'This is not an AI review finding and does not fail the check.';

function gh(args, env) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env,
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const errorText = result.error ? result.error.message : '';
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout || '',
    stderr: `${result.stderr || ''}${errorText}`.trim(),
  };
}

function runRisk(pr, env) {
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

function parseRisk(stdout) {
  try {
    const report = JSON.parse(String(stdout || '').trim());
    if (report && report.command === 'risk') return report;
  } catch {
    // qai wrote a non-JSON failure.
  }
  return null;
}

function buildReason(note, reviewLog) {
  const base = String(note || 'skipped: provider unavailable').trim();
  const failure = new RegExp(
    [
      'credit balance',
      'invalid api key',
      'invalid x-api-key',
      'authentication_error',
      'not_found_error',
      'no api key',
      'provider error',
      '\\b404\\b',
    ].join('|'),
    'i',
  );
  const line = String(reviewLog || '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => failure.test(item));
  if (!line) return base;
  return `${base} — ${line.slice(0, 300)}`;
}

function pullLink(repo, pr) {
  if (!repo || !/^\d+$/.test(String(pr || ''))) return `PR #${pr || '?'}`;
  const server = String(process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  return `${server}/${repo}/pull/${pr}`;
}

function buildComment(reason, risk) {
  const lines = [
    `## 🤖 QAI Code Review — ${LABEL}`,
    '',
    `${LABEL}. ${NOT_A_FINDING}`,
    '',
    `Review skip: ${reason}`,
    '',
  ];
  const report = parseRisk(risk && risk.stdout);
  if (risk && risk.error) {
    lines.push(`qai risk could not run (${risk.error}).`);
  } else if (report && report.gate === 'skipped') {
    const summary = report.summary || 'No TypeSafe judgment ran.';
    lines.push(`qai risk could not score this diff. ${summary}`);
    lines.push('No change-risk score was produced.');
  } else if (report) {
    lines.push(`Gate: ${report.gate}`, report.summary || '', '', '```json');
    lines.push(JSON.stringify(report, null, 2).slice(0, 12000), '```');
  } else {
    const detail = String((risk && (risk.stderr || risk.stdout)) || '').trim().slice(0, 500);
    const status = risk && risk.status != null ? risk.status : 'unknown';
    lines.push(`qai risk could not run (exit ${status}).${detail ? ` ${detail}` : ''}`);
  }
  lines.push('', NOT_A_FINDING);
  return lines.join('\n');
}

function selectTrackingIssue(issues) {
  const matches = (issues || []).filter((issue) => issue && issue.title === ISSUE_TITLE);
  matches.sort((left, right) => left.number - right.number);
  return matches[0] || null;
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

function upsertIssue({ repo, pr, reason, ghRun }) {
  if (!repo) return { ok: false, stderr: 'GITHUB_REPOSITORY is not set' };
  const listed = readIssueList(ghRun([
    'issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title',
  ]));
  if (!listed) return { ok: false, stderr: 'could not list open issues' };
  const existing = selectTrackingIssue(listed);
  const note = [
    `AI providers unavailable on ${pullLink(repo, pr)}`,
    '',
    `Reason: ${reason}`,
  ].join('\n');
  if (existing) {
    return ghRun(['issue', 'comment', String(existing.number), '--repo', repo, '--body', note]);
  }
  const body = [
    'QAI review skipped because every AI provider failed.',
    'This issue is not closed automatically.',
    '',
    note,
  ].join('\n');
  return ghRun(['issue', 'create', '--repo', repo, '--title', ISSUE_TITLE, '--body', body]);
}

function runFallback(options) {
  const pr = String(options.pr || '').trim();
  const reason = buildReason(options.reason, options.reviewLog);
  const risk = /^\d+$/.test(pr)
    ? options.runRisk(pr)
    : { stdout: '', stderr: '', status: 1, error: 'no pull request number' };
  const comment = buildComment(reason, risk);
  const warnings = [];
  const ghRun = options.gh;

  if (/^\d+$/.test(pr)) {
    const args = ['pr', 'comment', pr];
    if (options.repo) args.push('--repo', options.repo);
    args.push('--body', comment);
    const posted = ghRun(args);
    if (!posted.ok) warnings.push(posted.stderr || 'gh pr comment failed');
  } else {
    warnings.push('no pull request number');
  }

  const issue = upsertIssue({ repo: options.repo, pr, reason, ghRun });
  if (!issue.ok) warnings.push(issue.stderr || 'gh issue failed');
  return { comment, warnings, exitCode: 0 };
}

function readLog(file) {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  try {
    const env = process.env;
    const result = runFallback({
      pr: env.PR_NUMBER,
      repo: env.GITHUB_REPOSITORY,
      reason: env.SKIP_REASON,
      reviewLog: readLog(env.REVIEW_LOG),
      runRisk: (pr) => runRisk(pr, env),
      gh: (args) => gh(args, env),
    });
    process.stdout.write(`${result.comment}\n`);
    for (const warning of result.warnings) {
      process.stdout.write(`::warning::${String(warning).replace(/\s+/g, ' ').slice(0, 400)}\n`);
    }
  } catch (error) {
    const message = String(error && error.message).replace(/\s+/g, ' ').slice(0, 400);
    process.stdout.write(`::warning::change-risk fallback failed: ${message}\n`);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  ISSUE_TITLE,
  LABEL,
  buildComment,
  buildReason,
  runFallback,
  selectTrackingIssue,
};
