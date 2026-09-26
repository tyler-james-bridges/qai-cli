const { VerificationRuntimeError } = require('./verify/errors');

const MODEL = 'jev-latest';

function readApiKey() {
  return String(process.env.TYPESAFE_API_KEY || '').trim();
}

function loadTypeSafeSdk(command) {
  try {
    // Lazy-load so `qai check` / `qai verify` never import the TypeSafe SDK,
    // and a missing key can skip before this module is evaluated.
    return require('@typesafe-ai/sdk');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new VerificationRuntimeError(
        `${command} requires @typesafe-ai/sdk. Install it with npm install @typesafe-ai/sdk.`,
        error,
      );
    }
    throw error;
  }
}

function createClient(command = 'qai risk') {
  const { TypeSafeClient } = loadTypeSafeSdk(command);
  return new TypeSafeClient({ defaultModel: MODEL });
}

module.exports = {
  MODEL,
  createClient,
  readApiKey,
};
