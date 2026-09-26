'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  detectProvider,
  listConfiguredProviders,
  isFallbackProviderError,
  invokeWithFallback,
  getProvider,
} = require('../src/providers');

const CREDIT = new Error(
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
);
CREDIT.status = 400;

const AUTH = new Error(
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
);
AUTH.status = 401;

const MODEL = new Error(
  '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}',
);
MODEL.status = 404;

function names(env) {
  return listConfiguredProviders(env).map((entry) => entry.provider);
}

function stubFactory(handlers) {
  const calls = [];
  const create = (provider) => {
    calls.push(provider);
    const handler = handlers[provider];
    return {
      async reviewCode() {
        if (typeof handler === 'function') return handler();
        return handler;
      },
      async analyze() {
        if (typeof handler === 'function') return handler();
        return handler;
      },
      async generateTests() {
        if (typeof handler === 'function') return handler();
        return handler;
      },
    };
  };
  return { calls, create };
}

function captureLogger() {
  const lines = [];
  return {
    lines,
    log(message) {
      lines.push(message);
    },
    error(message) {
      lines.push(message);
    },
  };
}

test('explicit PROVIDER beats an Anthropic key', () => {
  const env = {
    PROVIDER: 'openai',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
  };
  assert.equal(detectProvider(env).provider, 'openai');
  assert.equal(detectProvider(env).apiKey, 'test-openai-key');
  assert.deepEqual(names(env), ['openai', 'anthropic']);
});

test('QAI_PROVIDER selects gemini before auto-detected keys', () => {
  const env = {
    QAI_PROVIDER: 'Gemini',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    GEMINI_API_KEY: 'test-gemini-key',
    OPENAI_API_KEY: 'test-openai-key',
  };
  assert.equal(detectProvider(env).provider, 'gemini');
  assert.deepEqual(names(env), ['gemini', 'anthropic', 'openai']);
});

test('PROVIDER wins over QAI_PROVIDER', () => {
  const env = {
    PROVIDER: 'openai',
    QAI_PROVIDER: 'gemini',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
  };
  assert.deepEqual(names(env), ['openai', 'gemini']);
});

test('PROVIDER plus API_KEY selects that provider without a provider-specific key', () => {
  const detected = detectProvider({
    PROVIDER: 'openai',
    API_KEY: 'test-generic-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  });
  assert.equal(detected.provider, 'openai');
  assert.equal(detected.apiKey, 'test-generic-key');
});

test('auto-detect still prefers anthropic, then openai, codex, and gemini', () => {
  assert.deepEqual(
    names({
      GEMINI_API_KEY: 'test-gemini-key',
      CODEX_API_KEY: 'test-codex-key',
      OPENAI_API_KEY: 'test-openai-key',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
    }),
    ['anthropic', 'openai', 'codex', 'gemini'],
  );
  const codex = listConfiguredProviders({ CODEX_API_KEY: 'test-codex-key' })[0];
  assert.equal(codex.options.model, 'codex-mini-latest');
});

test('PROVIDER=ollama is used even when an Anthropic key is set', () => {
  const env = {
    PROVIDER: 'ollama',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  };
  const detected = detectProvider(env);
  assert.equal(detected.provider, 'ollama');
  assert.equal(detected.apiKey, null);
  assert.equal(detected.options.baseUrl, 'http://127.0.0.1:11434');
  assert.deepEqual(names(env), ['ollama', 'anthropic']);
});

test('a requested provider with no key falls through to one that has a key', () => {
  const detected = detectProvider({
    QAI_PROVIDER: 'openai',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  });
  assert.equal(detected.provider, 'anthropic');
});

test('GitHub Actions INPUT_* provider and key are honored', () => {
  const detected = detectProvider({
    INPUT_PROVIDER: 'openai',
    INPUT_OPENAI_API_KEY: 'test-openai-key',
    INPUT_ANTHROPIC_API_KEY: 'test-anthropic-key',
  });
  assert.equal(detected.provider, 'openai');
  assert.equal(detected.apiKey, 'test-openai-key');
});

test('billing, auth, and model-not-found errors are fallback errors', () => {
  assert.equal(isFallbackProviderError(CREDIT), true);
  assert.equal(isFallbackProviderError(AUTH), true);
  assert.equal(isFallbackProviderError(MODEL), true);
  const quota = new Error(
    '429 You exceeded your current quota, please check your plan and billing details.',
  );
  quota.status = 429;
  assert.equal(isFallbackProviderError(quota), true);
  const geminiModel = new Error('[404 Not Found] models/gemini-1.5-flash is not found');
  geminiModel.status = 404;
  assert.equal(isFallbackProviderError(geminiModel), true);
  const geminiKey = new Error('API key not valid');
  geminiKey.status = 400;
  assert.equal(isFallbackProviderError(geminiKey), true);
});

test('timeouts and other request bugs are not fallback errors', () => {
  const timeout = new Error('socket hang up');
  timeout.status = 500;
  assert.equal(isFallbackProviderError(timeout), false);
  const badRequest = new Error('400 invalid prompt');
  badRequest.status = 400;
  assert.equal(isFallbackProviderError(badRequest), false);
  const missingModelStatusOnly = new Error('not found');
  missingModelStatusOnly.status = 404;
  assert.equal(isFallbackProviderError(missingModelStatusOnly), false);
});

test('billing failure falls back to the next stubbed provider', async () => {
  const { calls, create } = stubFactory({
    anthropic() {
      throw CREDIT;
    },
    openai: { issues: [], summary: 'ok' },
  });
  const logger = captureLogger();
  const report = await invokeWithFallback(
    [
      { provider: 'anthropic', apiKey: 'test-anthropic-key', options: {} },
      { provider: 'openai', apiKey: 'test-openai-key', options: {} },
    ],
    'reviewCode',
    ['diff', {}, {}],
    { createProvider: create, logger },
  );
  assert.deepEqual(calls, ['anthropic', 'openai']);
  assert.deepEqual(report, { issues: [], summary: 'ok' });
  assert.ok(logger.lines.includes('Trying provider: anthropic'));
  assert.ok(logger.lines.includes('Trying provider: openai'));
  assert.ok(logger.lines.includes('Using provider: openai'));
  assert.match(logger.lines.join('\n'), /Provider anthropic unavailable/);
});

test('auth and model-not-found errors also fall back', async () => {
  const { calls, create } = stubFactory({
    anthropic() {
      throw AUTH;
    },
    openai() {
      throw MODEL;
    },
    gemini: { bugs: [] },
  });
  const report = await invokeWithFallback(
    [
      { provider: 'anthropic', apiKey: 'test-anthropic-key', options: {} },
      { provider: 'openai', apiKey: 'test-openai-key', options: {} },
      { provider: 'gemini', apiKey: 'test-gemini-key', options: {} },
    ],
    'analyze',
    [{}, {}],
    { createProvider: create, logger: captureLogger() },
  );
  assert.deepEqual(calls, ['anthropic', 'openai', 'gemini']);
  assert.deepEqual(report, { bugs: [] });
});

test('a non-billing error does not try the next provider', async () => {
  const { calls, create } = stubFactory({
    anthropic() {
      throw new Error('socket hang up');
    },
    openai: { issues: [] },
  });
  await assert.rejects(
    () =>
      invokeWithFallback(
        [
          { provider: 'anthropic', apiKey: 'test-anthropic-key', options: {} },
          { provider: 'openai', apiKey: 'test-openai-key', options: {} },
        ],
        'reviewCode',
        ['diff', {}, {}],
        { createProvider: create, logger: captureLogger() },
      ),
    /socket hang up/,
  );
  assert.deepEqual(calls, ['anthropic']);
});

test('when every keyed provider fails, the error names each attempt', async () => {
  const { calls, create } = stubFactory({
    anthropic() {
      throw CREDIT;
    },
    openai() {
      throw AUTH;
    },
  });
  await assert.rejects(
    () =>
      invokeWithFallback(
        [
          { provider: 'anthropic', apiKey: 'test-anthropic-key', options: {} },
          { provider: 'openai', apiKey: 'test-openai-key', options: {} },
        ],
        'generateTests',
        ['prompt'],
        { createProvider: create, logger: captureLogger() },
      ),
    (error) => {
      assert.match(error.message, /provider error:/);
      assert.match(error.message, /anthropic:/);
      assert.match(error.message, /openai:/);
      assert.match(error.message, /credit balance/i);
      return true;
    },
  );
  assert.deepEqual(calls, ['anthropic', 'openai']);
});

test('getProvider uses the chosen provider first and falls back with stubs', async () => {
  const { calls, create } = stubFactory({
    openai() {
      throw new Error('insufficient_quota');
    },
    anthropic: { issues: [{ severity: 'low', title: 'nit' }] },
  });
  const logger = captureLogger();
  const provider = getProvider({
    env: {
      QAI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-openai-key',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
    },
    createProvider: create,
    logger,
  });
  const report = await provider.reviewCode('diff', {}, { focus: 'all' });
  assert.deepEqual(calls, ['openai', 'anthropic']);
  assert.equal(report.issues[0].title, 'nit');
  assert.ok(logger.lines.includes('Using provider: anthropic'));
  assert.equal(logger.lines.filter((line) => line === 'Using provider: openai').length, 0);
});

test('a single configured provider is returned directly', async () => {
  const { calls, create } = stubFactory({
    gemini: { issues: [] },
  });
  const logger = captureLogger();
  const provider = getProvider({
    env: { GEMINI_API_KEY: 'test-gemini-key' },
    createProvider: create,
    logger,
  });
  assert.deepEqual(logger.lines, ['Using provider: gemini']);
  const report = await provider.reviewCode('diff', {}, {});
  assert.deepEqual(calls, ['gemini']);
  assert.deepEqual(report, { issues: [] });
});

test('getProvider logs when the requested provider has no key', () => {
  const logger = captureLogger();
  const { create } = stubFactory({ anthropic: { issues: [] } });
  getProvider({
    env: { QAI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'test-anthropic-key' },
    createProvider: create,
    logger,
  });
  assert.match(logger.lines[0], /openai was requested but has no API key/);
  assert.ok(logger.lines.includes('Using provider: anthropic'));
});

test('getProvider throws the existing message when no key is configured', () => {
  assert.throws(
    () => getProvider({ env: {}, logger: captureLogger(), createProvider: () => ({}) }),
    /No API key provided\. Set one of: ANTHROPIC_API_KEY/,
  );
});
