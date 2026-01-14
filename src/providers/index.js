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
 * Supports both standard env vars (ANTHROPIC_API_KEY) and GitHub Actions format (INPUT_ANTHROPIC_API_KEY)
 * @returns {{ provider: string, apiKey: string, options: Object } | null}
 */
function detectProvider() {
  const env = process.env;

  // Check for explicit provider + api_key (both formats)
  const provider = env.PROVIDER || env.INPUT_PROVIDER;
  const apiKey = env.API_KEY || env.INPUT_API_KEY;
  if (provider && apiKey) {
    return {
      provider: provider.toLowerCase(),
      apiKey: apiKey,
      options: {},
    };
  }

  // Check for provider-specific keys (standard format first, then INPUT_ format)
  const anthropicKey = env.ANTHROPIC_API_KEY || env.INPUT_ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      options: {},
    };
  }

  const openaiKey = env.OPENAI_API_KEY || env.INPUT_OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      options: {},
    };
  }

  const codexKey = env.CODEX_API_KEY || env.INPUT_CODEX_API_KEY;
  if (codexKey) {
    return {
      provider: 'codex',
      apiKey: codexKey,
      options: { model: 'codex-mini-latest' },
    };
  }

  const geminiKey = env.GEMINI_API_KEY || env.INPUT_GEMINI_API_KEY;
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      options: {},
    };
  }

  // Ollama doesn't need an API key
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      apiKey: null,
      options: {
        baseUrl: env.OLLAMA_BASE_URL || env.INPUT_OLLAMA_BASE_URL || 'http://localhost:11434',
        model: env.OLLAMA_MODEL || env.INPUT_OLLAMA_MODEL || 'llava',
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
      'ANTHROPIC_API_KEY, OPENAI_API_KEY, CODEX_API_KEY, GEMINI_API_KEY, ' +
      'or PROVIDER with API_KEY',
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
