const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { check } = require('../../src/check');
const { fixture, PROJECT_ROOT, runCli } = require('./test-helpers');

const NOW = new Date('2026-08-03T23:45:00.000Z');

function loadLiveStack(name) {
  return JSON.parse(fs.readFileSync(fixture('live-stack', name), 'utf8'));
}

function responseFromFixture(recorded) {
  const body =
    recorded.body == null
      ? '<!doctype html><html><body>not json</body></html>'
      : JSON.stringify(recorded.body);
  return {
    url: recorded.url,
    status: recorded.status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? recorded.contentType : null;
      },
    },
    async text() {
      return body;
    },
  };
}

function fetchFromSpec(spec) {
  return async (url) => {
    const recorded = spec[url] || spec[url.replace(/\/$/, '')] || spec['*'];
    if (!recorded) {
      throw new Error(`No fixture for ${url}`);
    }
    if (recorded.unreachable) {
      throw new Error(recorded.message || `getaddrinfo ENOTFOUND ${url}`);
    }
    return responseFromFixture(recorded);
  };
}

function runCheckCli(args, responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qai-check-cli-'));
  const preload = path.join(dir, 'preload.js');
  const hitsPath = path.join(dir, 'hits.json');
  const preloadSource = [
    "const Module = require('module');",
    'const hits = [];',
    'const orig = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    '  if (',
    "    request === 'openai' ||",
    "    request === 'playwright' ||",
    "    request.includes('@anthropic-ai') ||",
    "    request.includes('@google/generative-ai') ||",
    "    request.includes('ai-cli') ||",
    '    /(^|\\/)providers(\\/|$)/.test(request)',
    '  ) {',
    '    hits.push(request);',
    '  }',
    '  return orig.apply(this, arguments);',
    '};',
    `const responses = ${JSON.stringify(responses)};`,
    'function lookup(url) {',
    "  return responses[url] || responses[String(url).replace(/\\/$/, '')] || responses['*'];",
    '}',
    'globalThis.fetch = async (url) => {',
    '  const recorded = lookup(url);',
    "  if (!recorded) throw new Error('No fixture for ' + url);",
    "  if (recorded.unreachable) throw new Error(recorded.message || 'unreachable');",
    '  let bodyText = recorded.bodyText;',
    '  if (bodyText == null && recorded.body == null) {',
    "    bodyText = '<!doctype html><html><body>not json</body></html>';",
    '  } else if (bodyText == null) {',
    "    bodyText = typeof recorded.body === 'string' ? recorded.body : JSON.stringify(recorded.body);",
    '  }',
    '  return {',
    '    url: recorded.url || url,',
    '    status: recorded.status,',
    '    headers: {',
    '      get(name) {',
    "        return name.toLowerCase() === 'content-type' ? recorded.contentType : null;",
    '      },',
    '    },',
    '    async text() { return bodyText; },',
    '  };',
    '};',
    'process.on("exit", () => {',
    '  require("fs").writeFileSync(process.env.QAI_LOAD_HITS, JSON.stringify(hits));',
    '});',
    '',
  ].join('\n');
  fs.writeFileSync(preload, preloadSource);
  const result = spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'src/index.js'), ...args],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${preload}`,
        QAI_LOAD_HITS: hitsPath,
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        OLLAMA_HOST: '',
      },
    },
  );
  result.loadedModules = fs.existsSync(hitsPath)
    ? JSON.parse(fs.readFileSync(hitsPath, 'utf8'))
    : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('check passes on canary operational_read_only JSON', async () => {
  const recorded = loadLiveStack('canary-health.json');
  const result = await check({
    url: recorded.url,
    fetchImpl: fetchFromSpec({ [recorded.url]: recorded }),
    now: NOW,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.verdict, 'pass');
  assert.equal(result.report.command, 'check');
  assert.equal(result.report.criteria[0].evidence[0].observed.healthStatus, 'operational_read_only');
});

test('check passes on ACK healthy JSON', async () => {
  const recorded = loadLiveStack('ack-health.json');
  const result = await check({
    url: recorded.url,
    fetchImpl: fetchFromSpec({ [recorded.url]: recorded }),
    now: NOW,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.verdict, 'pass');
  assert.equal(result.report.criteria[0].evidence[0].observed.healthStatus, 'healthy');
});

test('check reviews Morsel HTML catch-all', async () => {
  const recorded = loadLiveStack('morsel-html.json');
  const result = await check({
    url: recorded.url,
    fetchImpl: fetchFromSpec({ [recorded.url]: recorded }),
    now: NOW,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.verdict, 'needs_human_review');
  assert.match(result.report.criteria[0].reason, /HTML where JSON health was expected/);
});

test('check fails when JSON status is degraded', async () => {
  const recorded = loadLiveStack('canary-health-fail.json');
  const result = await check({
    url: recorded.url,
    fetchImpl: fetchFromSpec({ [recorded.url]: recorded }),
    now: NOW,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.verdict, 'fail');
  assert.match(result.report.criteria[0].reason, /degraded/);
});

test('check fails on 5xx', async () => {
  const result = await check({
    url: 'https://canary.0x402.sh/api/health',
    fetchImpl: fetchFromSpec({
      '*': {
        url: 'https://canary.0x402.sh/api/health',
        status: 503,
        contentType: 'text/plain',
        body: 'unavailable',
      },
    }),
    now: NOW,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.verdict, 'fail');
  assert.match(result.report.criteria[0].reason, /HTTP 503/);
});

test('check fails when the URL is unreachable', async () => {
  const result = await check({
    url: 'https://missing.example.test/api/health',
    fetchImpl: fetchFromSpec({
      '*': { unreachable: true, message: 'getaddrinfo ENOTFOUND missing.example.test' },
    }),
    now: NOW,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.verdict, 'fail');
  assert.match(result.report.criteria[0].reason, /Unreachable/);
});

test('bare site probes /api/health and passes if health JSON is operational', async () => {
  const canary = loadLiveStack('canary-health.json');
  const requested = [];
  const result = await check({
    url: 'https://canary.0x402.sh',
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.includes('/api/health')) return responseFromFixture(canary);
      return responseFromFixture({
        url,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: null,
      });
    },
    now: NOW,
  });
  assert.deepEqual(requested, ['https://canary.0x402.sh/', 'https://canary.0x402.sh/api/health']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.verdict, 'pass');
  assert.equal(result.report.criteria[0].evidence.length, 2);
});

test('check CLI passes recorded canary health JSON', () => {
  const recorded = loadLiveStack('canary-health.json');
  const result = runCheckCli(['check', recorded.url, '--json'], { [recorded.url]: recorded });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, 'pass');
  assert.equal(report.command, 'check');
  assert.match(result.stdout, /operational_read_only/);
});

test('bare URL CLI argument routes to check, not scan', () => {
  const recorded = loadLiveStack('ack-health.json');
  const result = runCheckCli([recorded.url, '--json'], { [recorded.url]: recorded });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verdict, 'pass');
  assert.doesNotMatch(result.stderr, /Analyzing with AI/);
});

test('check CLI reviews recorded Morsel HTML', () => {
  const recorded = loadLiveStack('morsel-html.json');
  const result = runCheckCli(['check', recorded.url], { [recorded.url]: recorded });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /^qai check — NEEDS HUMAN REVIEW/);
  assert.match(result.stdout, /HTML where JSON health was expected/);
});

test('missing check URL exits 3', () => {
  const result = runCli(['check']);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage: qai check <url>/);
});

test('help leads with check and verify, and marks AI as optional', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0);
  const checkAt = result.stdout.indexOf('qai check <url>');
  const scanAt = result.stdout.indexOf('qai scan <url>');
  const verifyAt = result.stdout.indexOf('qai verify <contract>');
  assert.ok(checkAt > 0);
  assert.ok(verifyAt > checkAt);
  assert.ok(scanAt > verifyAt);
  assert.match(result.stdout, /Optional AI/);
  assert.match(result.stdout, /no API key/);
});

test('check CLI does not load LLM SDKs or Playwright', () => {
  const recorded = loadLiveStack('ack-health.json');
  const result = runCheckCli(['check', recorded.url, '--json'], { [recorded.url]: recorded });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.loadedModules, []);
});
