const fs = require('fs');
const path = require('path');
const { makeEvidence } = require('./verify/collectors/common');
const { VerificationInputError, VerificationRuntimeError } = require('./verify/errors');
const { EXIT_CODES } = require('./verify');
const { buildReport, formatHuman } = require('./verify/report');
const { countStatuses, sha256 } = require('./verify/utils');

const HEALTHY_STATUS = /^(healthy|operational)/i;
const UNHEALTHY_STATUS = /^(degraded|unhealthy|down|error|fail)/i;
const BODY_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;
const EXPECTED_HEALTH =
  'JSON object with status matching healthy or operational*, HTTP 2xx';

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function parseCheckArgs(argv) {
  const command = argv[2];
  const rest = isHttpUrl(command) ? argv.slice(2) : argv.slice(3);
  const options = {};

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') {
      options.json = true;
    } else if (rest[i] === '--out' && rest[i + 1]) {
      options.outPath = rest[++i];
    } else if (rest[i].startsWith('--')) {
      throw new VerificationInputError(`Unknown check option: ${rest[i]}.`);
    } else if (!options.url) {
      options.url = rest[i];
    } else {
      throw new VerificationInputError(`Unexpected check argument: ${rest[i]}.`);
    }
  }

  if (!options.url) {
    throw new VerificationInputError('Usage: qai check <url> [--json] [--out <path>]');
  }
  return options;
}

function parseCheckUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new VerificationInputError(`Check URL must be an absolute http(s) URL: ${value}.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new VerificationInputError(`Check URL must use http or https: ${value}.`);
  }
  return parsed;
}

function probeUrls(target) {
  const urls = [target.toString()];
  if (target.pathname === '/' || target.pathname === '') {
    urls.push(new URL('/api/health', target).toString());
  }
  return [...new Set(urls)];
}

function snippet(text, max = 500) {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function parseBody(contentType, text) {
  const type = (contentType || '').toLowerCase();
  if (type.includes('html') || /^\s*<(!doctype\s+html|html|head|body)\b/i.test(text)) {
    return { kind: 'html', value: snippet(text) };
  }
  if (type.includes('json') || looksLikeJson(text)) {
    try {
      return { kind: 'json', value: JSON.parse(text) };
    } catch {
      return { kind: 'invalid-json', value: snippet(text) };
    }
  }
  return { kind: 'other', value: snippet(text) };
}

function looksLikeJson(text) {
  const trimmed = String(text).trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function healthStatusOf(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return typeof body.status === 'string' ? body.status : null;
}

async function fetchLive(url, options = {}) {
  const fetchFn = options.fetchImpl || globalThis.fetch;
  const observedAt = (options.now || new Date()).toISOString();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json, text/html;q=0.8, */*;q=0.5',
        'user-agent': options.userAgent || 'qai-cli',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    const truncated = rawText.length > BODY_LIMIT;
    const text = truncated ? rawText.slice(0, BODY_LIMIT) : rawText;
    const body = parseBody(contentType, text);
    return {
      accessible: true,
      url: response.url || url,
      requestedUrl: url,
      status: response.status,
      contentType,
      body: body.value,
      bodyKind: body.kind,
      truncated,
      observedAt,
      error: null,
    };
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      accessible: false,
      url,
      requestedUrl: url,
      status: null,
      contentType: '',
      body: null,
      bodyKind: 'unreachable',
      truncated: false,
      observedAt,
      error: {
        message: timedOut ? `Request timed out after ${timeoutMs}ms` : error.message,
      },
    };
  }
}

function judgeObservation(observation) {
  if (!observation.accessible || observation.error) {
    return {
      status: 'fail',
      reason: `Unreachable: ${observation.error?.message || 'request failed'}.`,
      humanAction: 'Confirm the URL is reachable, then run qai check again.',
    };
  }
  if (observation.status >= 500) {
    return {
      status: 'fail',
      reason: `HTTP ${observation.status} from ${observation.url}.`,
      humanAction: null,
    };
  }

  if (observation.bodyKind === 'json') {
    const healthStatus = healthStatusOf(observation.body);
    if (healthStatus && HEALTHY_STATUS.test(healthStatus)) {
      if (observation.status >= 200 && observation.status < 300) {
        return {
          status: 'pass',
          reason: `JSON health status is ${healthStatus}.`,
          humanAction: null,
        };
      }
      return {
        status: 'needs_human_review',
        reason: `JSON health status is ${healthStatus} but HTTP status is ${observation.status}.`,
        humanAction: 'Inspect the endpoint. A healthy JSON body on a non-2xx status needs review.',
      };
    }
    if (healthStatus && UNHEALTHY_STATUS.test(healthStatus)) {
      return {
        status: 'fail',
        reason: `JSON health status is ${healthStatus}.`,
        humanAction: null,
      };
    }
    if (healthStatus) {
      return {
        status: 'needs_human_review',
        reason: `JSON health status ${healthStatus} is not a known healthy or unhealthy value.`,
        humanAction:
          'Inspect the JSON health payload and confirm the expected status vocabulary.',
      };
    }
    return {
      status: 'needs_human_review',
      reason: 'JSON response has no string status field.',
      humanAction:
        'Expose a JSON status field such as healthy or operational, then run qai check again.',
    };
  }

  if (observation.bodyKind === 'html') {
    return {
      status: 'needs_human_review',
      reason: `HTML where JSON health was expected (${observation.contentType || 'no content-type'}).`,
      humanAction: 'Serve JSON health at this URL or /api/health, then run qai check again.',
    };
  }

  if (observation.bodyKind === 'invalid-json' || observation.bodyKind === 'other') {
    return {
      status: 'needs_human_review',
      reason: `Non-JSON body where JSON health was expected (${observation.contentType || 'no content-type'}).`,
      humanAction: 'Serve JSON health at this URL or /api/health, then run qai check again.',
    };
  }

  return {
    status: 'needs_human_review',
    reason: 'Observation could not be classified.',
    humanAction: 'Inspect the response and run qai check again.',
  };
}

function observationEvidence(observation, index) {
  const judged = judgeObservation(observation);
  const healthStatus = healthStatusOf(observation.body);
  return makeEvidence(
    { id: `CHECK-${index + 1}`, type: 'http.live' },
    'http.live',
    {
      source: 'http',
      locator: observation.requestedUrl || observation.url,
      observedAt: observation.observedAt,
      freshUntil: observation.observedAt,
      subject: { url: observation.url },
      status: judged.status,
      expected: EXPECTED_HEALTH,
      observed: {
        status: observation.status,
        contentType: observation.contentType || null,
        kind: observation.bodyKind,
        healthStatus,
        body: observation.body,
      },
      reason: judged.reason,
      facts: {
        httpStatus: observation.status,
        contentType: observation.contentType || null,
        bodyKind: observation.bodyKind,
        truncated: observation.truncated,
      },
      error: observation.error,
      humanAction: judged.humanAction,
      limitations: observation.truncated ? ['Response body was truncated for evidence.'] : [],
    },
  );
}

function aggregateCheckStatus(evidence) {
  if (evidence.some((item) => item.status === 'pass')) return 'pass';
  if (evidence.some((item) => item.status === 'fail')) return 'fail';
  return 'needs_human_review';
}

function evaluateCheck(contract, evidence) {
  const status = aggregateCheckStatus(evidence);
  const failing = evidence.filter((item) => item.status === 'fail');
  const unresolved = evidence.filter((item) => item.status === 'needs_human_review');
  let reason;
  let humanAction = null;
  if (status === 'pass') {
    reason = 'At least one probe returned JSON health with status healthy or operational*.';
  } else if (status === 'fail') {
    reason = failing.map((item) => item.reason).join(' ');
  } else {
    reason =
      unresolved.map((item) => item.reason).join(' ') ||
      'No supported independent evidence was collected for this criterion.';
    humanAction =
      unresolved.map((item) => item.humanAction).filter(Boolean).join(' ') ||
      'Collect independent evidence for this criterion.';
  }

  const criteria = [
    {
      id: contract.criteria[0].id,
      text: contract.criteria[0].text,
      required: true,
      status,
      expected: evidence.map((item) => ({ check: item.id, value: item.expected })),
      observed: evidence.map((item) => ({ check: item.id, value: item.observed })),
      reason,
      humanAction,
      evidence,
    },
  ];
  return {
    verdict: status,
    counts: countStatuses(criteria),
    criteria,
    reasonCodes:
      status === 'pass' ? [] : [`${status.toUpperCase()}:${contract.criteria[0].id}`],
  };
}

function builtInContract(url) {
  return {
    schemaVersion: '1',
    task: `HTTP health check of ${url}`,
    revision: 'live',
    criteria: [
      {
        id: 'AC-HEALTH',
        text: 'Endpoint returns JSON health with status healthy or operational*',
        required: true,
        checks: [{ id: 'CHECK-1', type: 'http.live', url }],
      },
    ],
  };
}

function writeReport(outPath, report, json) {
  const absolutePath = path.resolve(outPath);
  const content = json ? JSON.stringify(report, null, 2) : formatHuman(report);
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

async function check(options = {}) {
  const startedAt = (options.now || new Date()).toISOString();
  const target = parseCheckUrl(options.url);
  const urls = probeUrls(target);
  const observations = [];
  for (const url of urls) {
    observations.push(await fetchLive(url, options));
  }
  const evidence = observations.map((observation, index) =>
    observationEvidence(observation, index),
  );
  const contract = builtInContract(target.toString());
  const evaluation = evaluateCheck(contract, evidence);
  const completedAt = (options.now || new Date()).toISOString();
  const report = buildReport({
    command: 'check',
    contract,
    contractHash: sha256(target.toString()),
    contractPath: 'qai check auto-contract',
    claim: `Live HTTP health check of ${target.toString()}`,
    claimHash: sha256(target.toString()),
    claimSource: 'qai check',
    completedAt,
    evaluation,
    repoPath: options.repoPath || process.cwd(),
    startedAt,
    targetUrl: target.toString(),
  });

  if (options.outPath) writeReport(options.outPath, report, options.json);
  return { report, exitCode: EXIT_CODES[report.verdict] };
}

module.exports = {
  EXIT_CODES,
  check,
  fetchLive,
  isHttpUrl,
  parseCheckArgs,
  probeUrls,
};
