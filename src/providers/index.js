const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const GeminiProvider = require('./gemini');
const OllamaProvider = require('./ollama');

const PROVIDERS = {
  anthropic: AnthropicProvider,
  openai: OpenAIProvider,
  codex: OpenAIProvider, // Codex uses OpenAI API
  gemini: GeminiProvider,
  ollama: OllamaProvider,
};

const PROVIDER_KEYS = {
  anthropic: ['ANTHROPIC_API_KEY', 'INPUT_ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY', 'INPUT_OPENAI_API_KEY'],
  codex: ['CODEX_API_KEY', 'INPUT_CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'INPUT_GEMINI_API_KEY'],
};

const KEYED_PROVIDERS = new Set(Object.keys(PROVIDER_KEYS));
const AUTO_ORDER = ['anthropic', 'openai', 'codex', 'gemini'];

const BILLING_RE = new RegExp(
  [
    'credit balance',
    'insufficient[_ -]?quota',
    'insufficient credits?',
    'plans & billing',
    'payment required',
    'exceeded your current quota',
    'quota exceeded',
    'billing',
  ].join('|'),
  'i',
);

const AUTH_RE = new RegExp(
  [
    'invalid[_ -]?(?:x-)?api[_ -]?key',
    'authentication_error',
    'incorrect api key',
    'api key not valid',
    'api_key_invalid',
    'permission_error',
    'unauthenticated',
    'unauthorized',
  ].join('|'),
  'i',
);

const MODEL_RE = new RegExp(
  [
    'not_found_error',
    'model_not_found',
    'model not found',
    'models/\\S+ is not found',
    'no such model',
    'model[^\\n]{0,120}does not exist',
    'does not exist[^\\n]{0,40}model',
  ].join('|'),
  'i',
);

function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function explicitProviderName(env) {
  return String(env.PROVIDER || env.QAI_PROVIDER || env.INPUT_PROVIDER || '')
    .trim()
    .toLowerCase();
}

function ollamaConfig(env) {
  return {
    provider: 'ollama',
    apiKey: null,
    options: {
      baseUrl:
        firstEnv(env, ['OLLAMA_BASE_URL', 'INPUT_OLLAMA_BASE_URL']) || 'http://localhost:11434',
      model: firstEnv(env, ['OLLAMA_MODEL', 'INPUT_OLLAMA_MODEL']) || 'llava',
    },
  };
}

function keyedConfig(name, env, genericKey) {
  const apiKey = firstEnv(env, PROVIDER_KEYS[name] || []) || genericKey;
  if (!apiKey) return null;
  const options = {};
  if (name === 'codex') options.model = 'codex-mini-latest';
  return { provider: name, apiKey, options };
}

/**
 * Providers that have credentials, preferred provider first.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ provider: string, apiKey: string | null, options: Object }[]}
 */
function listConfiguredProviders(env = process.env) {
  const explicit = explicitProviderName(env);
  const genericKey = firstEnv(env, ['API_KEY', 'INPUT_API_KEY']);
  const configured = [];
  const seen = new Set();

  const add = (entry) => {
    if (!entry || seen.has(entry.provider)) return;
    seen.add(entry.provider);
    configured.push(entry);
  };

  if (explicit === 'ollama') {
    add(ollamaConfig(env));
  } else if (KEYED_PROVIDERS.has(explicit)) {
    add(keyedConfig(explicit, env, genericKey));
  }

  for (const name of AUTO_ORDER) {
    add(keyedConfig(name, env, ''));
  }

  return configured;
}

/**
 * Auto-detect provider from environment variables.
 * An explicit PROVIDER / QAI_PROVIDER / INPUT_PROVIDER is tried before Anthropic,
 * even when ANTHROPIC_API_KEY is also set.
 * Supports standard env vars and GitHub Actions INPUT_* vars.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ provider: string, apiKey: string | null, options: Object } | null}
 */
function detectProvider(env = process.env) {
  return listConfiguredProviders(env)[0] || null;
}

function errorText(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.message) parts.push(String(error.message));
  if (error.code) parts.push(String(error.code));
  if (error.type) parts.push(String(error.type));
  const nested = error.error;
  if (nested && typeof nested === 'object') {
    if (nested.type) parts.push(String(nested.type));
    if (nested.message) parts.push(String(nested.message));
    if (nested.code) parts.push(String(nested.code));
  }
  return parts.join('\n');
}

function summarizeError(error) {
  const text = errorText(error).replace(/\s+/g, ' ').trim();
  if (!text) return 'unknown error';
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

/**
 * Billing, auth, and model-not-found failures are safe to retry on another provider.
 * Other errors (bugs, timeouts, 5xx) are not.
 * @param {unknown} error
 * @returns {boolean}
 */
function isFallbackProviderError(error) {
  const status = Number(error && (error.status || error.statusCode)) || 0;
  const text = errorText(error);
  if (BILLING_RE.test(text) || AUTH_RE.test(text) || MODEL_RE.test(text)) return true;
  if (status === 401 || status === 402 || status === 403) return true;
  if (status === 404 && /model/i.test(text)) return true;
  return false;
}

function noKeyError() {
  return new Error(
    'No API key provided. Set one of: ' +
      'ANTHROPIC_API_KEY, OPENAI_API_KEY, CODEX_API_KEY, GEMINI_API_KEY, ' +
      'or PROVIDER with API_KEY',
  );
}

function writeLog(logger, level, message) {
  const fn = logger && logger[level];
  if (typeof fn === 'function') {
    fn.call(logger, message);
    return;
  }
  if (logger && typeof logger.log === 'function' && level !== 'log') {
    logger.log(message);
  }
}

/**
 * Call a provider method, walking to the next configured provider on
 * billing, auth, or model-not-found errors.
 * @param {{ provider: string, apiKey: string | null, options: Object }[]} candidates
 * @param {string} method
 * @param {unknown[]} args
 * @param {{ createProvider?: Function, logger?: Console }} [deps]
 */
async function invokeWithFallback(candidates, method, args, deps = {}) {
  const create = deps.createProvider || createProvider;
  const logger = deps.logger || console;
  if (!candidates || candidates.length === 0) throw noKeyError();

  const failures = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const last = i === candidates.length - 1;
    writeLog(logger, 'log', `Trying provider: ${candidate.provider}`);

    let provider;
    try {
      provider = create(candidate.provider, candidate.apiKey, candidate.options || {});
    } catch (error) {
      if (!isFallbackProviderError(error) || last) throw error;
      const summary = summarizeError(error);
      failures.push(`${candidate.provider}: ${summary}`);
      writeLog(
        logger,
        'error',
        `Provider ${candidate.provider} unavailable (${summary}); trying next provider`,
      );
      continue;
    }

    try {
      const result = await provider[method](...args);
      writeLog(logger, 'log', `Using provider: ${candidate.provider}`);
      return result;
    } catch (error) {
      if (!isFallbackProviderError(error)) throw error;
      const summary = summarizeError(error);
      failures.push(`${candidate.provider}: ${summary}`);
      if (last) {
        const wrapped = new Error(`provider error: ${failures.join('; ')}`);
        wrapped.cause = error;
        throw wrapped;
      }
      writeLog(
        logger,
        'error',
        `Provider ${candidate.provider} unavailable (${summary}); trying next provider`,
      );
    }
  }

  throw new Error(`provider error: ${failures.join('; ') || 'no provider available'}`);
}

class FallbackProvider {
  constructor(candidates, create, logger) {
    this.candidates = candidates;
    this.create = create;
    this.logger = logger;
  }

  analyze(captureData, options) {
    return invokeWithFallback(this.candidates, 'analyze', [captureData, options], {
      createProvider: this.create,
      logger: this.logger,
    });
  }

  reviewCode(diff, context, options) {
    return invokeWithFallback(this.candidates, 'reviewCode', [diff, context, options], {
      createProvider: this.create,
      logger: this.logger,
    });
  }

  generateTests(prompt) {
    return invokeWithFallback(this.candidates, 'generateTests', [prompt], {
      createProvider: this.create,
      logger: this.logger,
    });
  }
}

/**
 * Create a provider instance
 * @param {string} providerName - Provider name
 * @param {string | null} apiKey - API key
 * @param {Object} options - Provider options
 * @returns {import('./base')}
 */
function createProvider(providerName, apiKey, options = {}) {
  const ProviderClass = PROVIDERS[providerName.toLowerCase()];

  if (!ProviderClass) {
    throw new Error(
      `Unknown provider: ${providerName}. Supported: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }

  return new ProviderClass(apiKey, options);
}

/**
 * Get provider from environment (auto-detect or explicit).
 * When more than one provider has a key, billing/auth/model-not-found
 * errors fall through to the next one.
 * @param {{ env?: NodeJS.ProcessEnv, createProvider?: Function, logger?: Console } | string} [options]
 * @returns {import('./base')}
 */
function getProvider(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const env = opts.env || process.env;
  const create = opts.createProvider || createProvider;
  const logger = opts.logger || console;
  const candidates = listConfiguredProviders(env);

  if (candidates.length === 0) throw noKeyError();

  const requested = explicitProviderName(env);
  if (requested && !candidates.some((candidate) => candidate.provider === requested)) {
    writeLog(
      logger,
      'error',
      `Provider ${requested} was requested but has no API key; trying ${candidates[0].provider}`,
    );
  }

  if (candidates.length === 1) {
    writeLog(logger, 'log', `Using provider: ${candidates[0].provider}`);
    return create(candidates[0].provider, candidates[0].apiKey, candidates[0].options);
  }

  return new FallbackProvider(candidates, create, logger);
}

module.exports = {
  PROVIDERS,
  detectProvider,
  listConfiguredProviders,
  isFallbackProviderError,
  invokeWithFallback,
  createProvider,
  getProvider,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
};
