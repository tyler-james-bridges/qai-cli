const path = require('path');
const { redact } = require('./redact');

const VERDICT_LABELS = {
  pass: 'PASS',
  fail: 'FAIL',
  needs_human_review: 'NEEDS HUMAN REVIEW',
};

const STATUS_LABELS = {
  pass: 'PASS',
  fail: 'FAIL',
  needs_human_review: 'REVIEW',
};

function buildReport(input) {
  const { contract, contractHash, contractPath, claim, claimHash, claimSource, evaluation } = input;
  const report = {
    schemaVersion: '1',
    policyVersion: '1',
    command: input.command || 'verify',
    verdict: evaluation.verdict,
    summary: buildSummary(evaluation),
    task: contract.task,
    target: {
      repository: input.repoPath,
      revision: contract.revision,
    },
    inputs: {
      contract: { source: contractPath, sha256: contractHash },
      claim: { source: claimSource, sha256: claimHash, content: claim },
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    counts: evaluation.counts,
    reasonCodes: evaluation.reasonCodes,
    criteria: evaluation.criteria,
  };
  if (input.targetUrl) report.target.url = input.targetUrl;
  return redact(report);
}

function buildSummary(evaluation) {
  const { pass, fail, needsHumanReview } = evaluation.counts;
  const counts = `${fail} failed · ${needsHumanReview} need review · ${pass} passed`;
  if (evaluation.verdict === 'pass') {
    return `All ${pass} required acceptance criteria are supported by current evidence.`;
  }
  if (evaluation.verdict === 'fail') {
    const firstFailure = evaluation.criteria.find((criterion) => criterion.status === 'fail');
    return `${counts}. First contradiction: ${firstFailure.reason}`;
  }
  return `${counts}. Independent evidence is insufficient for a safe pass.`;
}

function formatHuman(report) {
  const label = VERDICT_LABELS[report.verdict];
  const command = report.command || 'verify';
  const lines = [];
  lines.push(`qai ${command} — ${label}`);
  lines.push('');
  lines.push(`Task      ${report.task}`);
  if (command === 'check') {
    lines.push(`URL       ${report.target.url || report.task}`);
  } else {
    lines.push(`Claim     UNTRUSTED · ${report.inputs.claim.source}`);
    lines.push(`           ${formatClaim(report.inputs.claim.content)}`);
    lines.push(`Claim SHA ${report.inputs.claim.sha256}`);
    lines.push(`Target    ${report.target.revision}`);
    lines.push(`Repo      ${path.resolve(report.target.repository)}`);
  }
  lines.push(
    `Evidence  ${report.criteria.reduce((sum, item) => sum + item.evidence.length, 0)} checks`,
  );
  lines.push('');
  lines.push('CRITERIA');

  for (const criterion of report.criteria) {
    lines.push(`${STATUS_LABELS[criterion.status].padEnd(6)} ${criterion.id}  ${criterion.text}`);
    for (const item of criterion.evidence) {
      const status = STATUS_LABELS[item.status].padEnd(6);
      lines.push(`       ${status} ${item.id} · ${item.collector}`);
      lines.push(`              Expected   ${formatValue(item.expected)}`);
      lines.push(`              Observed   ${formatValue(item.observed)}`);
      lines.push(`              Subject    ${formatValue(item.subject)}`);
      lines.push(`              Evidence   ${item.locator || 'none'}`);
      lines.push(
        `              Freshness  observed ${item.observedAt || 'unknown'} · until ` +
          `${item.freshUntil || 'unbounded'}`,
      );
      lines.push(`              Reason     ${item.reason}`);
      if (item.limitations.length > 0) {
        lines.push(`              Limits     ${item.limitations.join(' ')}`);
      }
    }
    lines.push(`       Criterion  ${criterion.reason}`);
    if (criterion.humanAction) lines.push(`       Human      ${criterion.humanAction}`);
    lines.push('');
  }

  lines.push(`VERDICT  ${label}`);
  lines.push(`Summary  ${report.summary}`);
  lines.push(
    `Counts   ${report.counts.pass} pass · ${report.counts.fail} fail · ` +
      `${report.counts.needsHumanReview} needs review`,
  );
  return lines.join('\n');
}

function formatClaim(value) {
  const compact = String(value).replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function formatValue(value) {
  if (value === null || value === undefined) return 'not observed';
  if (typeof value === 'string') return value;
  const compact = JSON.stringify(value);
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

module.exports = {
  VERDICT_LABELS,
  buildReport,
  formatHuman,
};
