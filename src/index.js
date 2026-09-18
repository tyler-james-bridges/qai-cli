#!/usr/bin/env node

const { check, isHttpUrl, parseCheckArgs } = require('./check');
const { verify, formatHuman, EXIT_CODES } = require('./verify');
const { VerificationInputError, VerificationRuntimeError } = require('./verify/errors');

const command = process.argv[2];

if (command === 'check' || isHttpUrl(command)) {
  runCheck().catch(handleVerifyError);
} else if (command === 'verify') {
  runVerify().catch(handleVerifyError);
} else if (command === 'risk') {
  // Loaded only for risk so check/verify never import the TypeSafe SDK.
  const { runRisk } = require('./risk');
  runRisk().catch(handleVerifyError);
} else if (command === 'review' || command === 'generate' || command === 'scan') {
  // Loaded only for optional AI commands so check/verify never import providers.
  const { dispatch } = require('./ai-cli');
  dispatch(command).catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
  });
} else if (command === 'help' || command === '--help' || command === '-h' || !command) {
  printHelp();
} else if (command === '--version' || command === '-v') {
  printVersion();
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "qai help" for usage information.');
  process.exit(1);
}

function printVersion() {
  const pkg = require('../package.json');
  console.log(`qai v${pkg.version}`);
}

function printHelp() {
  const pkg = require('../package.json');
  console.log(`
qai v${pkg.version} - evidence-based QA checks. Optional AI for scan, review, generate, and risk.

Usage:
  qai check <url>                   Live HTTP health check (no API key)
  qai <url>                         Same as check
  qai verify <contract> [options]   Replay a reviewed verification contract
  qai risk [pr] [options]           Change-risk score for a local or PR diff
  qai help                          Show this help
  qai --version                     Show version

Check options:
  <url>                       http(s) URL. Bare sites also probe /api/health
  --json                      Emit one JSON document to stdout
  --out <path>                Persist report without overwriting files

Verify options:
  <contract>                  Reviewed JSON verification contract
  --claim <file|->            Agent completion claim file or stdin
  --repo <path>               Repository path (default: current directory)
  --json                      Emit one JSON document to stdout
  --out <path>                Persist report without overwriting files

Risk options:
  <number>                    PR number (uses gh pr diff)
  --base <branch>             Base branch for local diff (default: main)
  --repo <path>               Repository path (default: current directory)
  --json                      Emit one JSON document to stdout
  --out <path>                Persist report without overwriting files

Exit codes:
  0  PASS / AUTO-OK / risk skipped (no TYPESAFE_API_KEY)
  1  FAIL
  2  NEEDS HUMAN REVIEW / NEEDS EYES
  3  verifier/input error

Optional AI (requires a provider key):
  qai scan <url>                    Visual QA analysis
  qai review <pr> [options]         PR code review
  qai generate <url|file> [options] Test generation
  qai risk [pr]                     TypeSafe change-risk (needs TYPESAFE_API_KEY)

Scan options:
  URL=<url>                   Target URL (or set via env)
  VIEWPORTS=desktop,mobile    Viewports to test
  FOCUS=all|accessibility|visual|responsive|forms|performance

Review options:
  <number>                    PR number to review
  --base <branch>             Base branch for diff (default: main)
  --focus <area>              Focus: all|security|performance|bugs
  --json                      Output JSON instead of markdown

Generate options:
  <url>                       Crawl site and generate E2E tests
  <file|dir>                  Generate unit tests from source
  --out <dir>                 Output directory (default: ./tests/generated)
  --framework <name>          playwright|jest|vitest
  --dry-run                   Print to stdout instead of writing files

Environment (AI commands only):
  ANTHROPIC_API_KEY           Use Anthropic Claude
  OPENAI_API_KEY              Use OpenAI GPT-4
  GEMINI_API_KEY              Use Google Gemini
  OLLAMA_HOST                 Use Ollama (local)
  TYPESAFE_API_KEY            Required for live qai risk judgments
  QAI_VERIFY_NOW              Pin verifier clock (ISO-8601) when replaying recorded evidence

Examples:
  qai check https://canary.0x402.sh
  qai check https://canary.0x402.sh/api/health
  qai check https://ack-onchain.dev/api/health
  qai verify .qai/task.json --claim completion.md
  qai risk --base main
  qai risk 42
  qai scan https://mysite.com
  qai review 42
  qai generate src/utils.ts --dry-run
  `);
}

async function runCheck() {
  const options = parseCheckArgs(process.argv);
  if (!options.json) console.error('qai check: fetching live HTTP evidence...');
  const result = await check(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(result.report) + '\n');
  }
  process.exitCode = result.exitCode;
}

/**
 * Run evidence-based completion verification.
 */
async function runVerify() {
  const args = process.argv.slice(3);
  const options = { repoPath: process.cwd() };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--claim' && args[i + 1]) {
      options.claimPath = args[++i];
    } else if (args[i] === '--repo' && args[i + 1]) {
      options.repoPath = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      options.outPath = args[++i];
    } else if (args[i] === '--json') {
      options.json = true;
    } else if (args[i].startsWith('--')) {
      throw new VerificationInputError(`Unknown verify option: ${args[i]}.`);
    } else if (!options.contractPath) {
      options.contractPath = args[i];
    } else {
      throw new VerificationInputError(`Unexpected verify argument: ${args[i]}.`);
    }
  }

  if (!options.contractPath) {
    throw new VerificationInputError(
      'Usage: qai verify <contract> --claim <file|-> [--repo <path>] [--json] [--out <path>]',
    );
  }

  if (process.env.QAI_VERIFY_NOW) {
    const parsed = new Date(process.env.QAI_VERIFY_NOW);
    if (Number.isNaN(parsed.getTime())) {
      throw new VerificationInputError(
        `QAI_VERIFY_NOW is not a valid timestamp: ${process.env.QAI_VERIFY_NOW}.`,
      );
    }
    options.now = parsed;
  }

  if (!options.json) console.error('qai verify: collecting declared read-only evidence...');
  const result = await verify(options);
  if (options.json) {
    process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(result.report) + '\n');
  }
  process.exitCode = result.exitCode;
}

function handleVerifyError(error) {
  const isKnown =
    error instanceof VerificationInputError || error instanceof VerificationRuntimeError;
  const prefix = error instanceof VerificationInputError ? 'Input error' : 'Verifier error';
  console.error(`${prefix}: ${error.message}`);
  for (const detail of error.details || []) console.error(`- ${detail}`);
  if (!isKnown && process.env.DEBUG) console.error(error.stack);
  process.exitCode = EXIT_CODES.verifier_error;
}
