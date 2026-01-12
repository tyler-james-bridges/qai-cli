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

/**
 * Auto-detect provider from environment variables
 * @returns {{ provider: string, apiKey: string, options: Object } | null}
 */
function detectProvider() {
  const env = process.env;

  // Check for explicit provider + api_key
  if (env.INPUT_PROVIDER && env.INPUT_API_KEY) {
    return {
      provider: env.INPUT_PROVIDER.toLowerCase(),
      apiKey: env.INPUT_API_KEY,
      options: {},
    };
  }

  // Check for provider-specific keys (in order of preference)
  if (env.INPUT_ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: env.INPUT_ANTHROPIC_API_KEY,
      options: {},
    };
  }

  if (env.INPUT_OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: env.INPUT_OPENAI_API_KEY,
      options: {},
    };
  }

  if (env.INPUT_CODEX_API_KEY) {
    return {
      provider: 'codex',
      apiKey: env.INPUT_CODEX_API_KEY,
      options: { model: 'codex-mini-latest' },
    };
  }

  if (env.INPUT_GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: env.INPUT_GEMINI_API_KEY,
      options: {},
    };
  }

  // Ollama doesn't need an API key
  if (env.INPUT_PROVIDER === 'ollama') {
    return {
      provider: 'ollama',
      apiKey: null,
      options: {
        baseUrl: env.INPUT_OLLAMA_BASE_URL || 'http://localhost:11434',
        model: env.INPUT_OLLAMA_MODEL || 'llava',
      },
    };
  }

  return null;
}

/**
 * Create a provider instance
 * @param {string} providerName - Provider name
 * @param {string} apiKey - API key
 * @param {Object} options - Provider options
 * @returns {BaseProvider}
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
 * Get provider from environment (auto-detect or explicit)
 * @returns {BaseProvider}
 */
function getProvider() {
  const detected = detectProvider();

  if (!detected) {
    throw new Error(
      'No API key provided. Set one of: ' +
      'INPUT_ANTHROPIC_API_KEY, INPUT_OPENAI_API_KEY, INPUT_CODEX_API_KEY, ' +
      'INPUT_GEMINI_API_KEY, or INPUT_PROVIDER with INPUT_API_KEY',
    );
  }

  console.log(`Using provider: ${detected.provider}`);
  return createProvider(detected.provider, detected.apiKey, detected.options);
}

module.exports = {
  PROVIDERS,
  detectProvider,
  createProvider,
  getProvider,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
};
