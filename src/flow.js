const { chromium } = require('playwright');
const { isHttpUrl } = require('./check');
const { MODEL, createClient, readApiKey } = require('./typesafe');
const { VerificationInputError } = require('./verify/errors');

// Playwright snapshots the page. Jev picks one action from that closed set.
// Fill text comes only from --data; the model never supplies a value.

const DEFAULT_MAX_STEPS = 15;
const MAX_STEPS_LIMIT = 100;
const MAX_CHOICES = 250;
const SNAPSHOT_CHARS = 12000;
const ACTION_TIMEOUT_MS = 5000;
const GOTO_TIMEOUT_MS = 30000;
const SETTLE_TIMEOUT_MS = 4000;
const SETTLE_POLL_MS = 100;

const DATA_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const ELEMENT_LINE = /^(\s*)-\s+([A-Za-z]+)(?:\s+"((?:\\.|[^"\\])*)")?(.*)$/;
const DISABLED = /\[disabled(?:\s*=\s*true)?\]/;

const CLICK_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'menuitem',
  'tab',
  'switch',
  'option',
  'treeitem',
]);
const FILL_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

const STATUS_LABELS = {
  done: 'DONE',
  skipped: 'SKIPPED',
  failed: 'FAILED',
  'max-steps': 'MAX STEPS',
};

const USAGE =
  'Usage: qai flow <url> <goal> [--data key=value] [--max-steps N] [--json]';
const SKIPPED_SUMMARY =
  'SKIPPED: TYPESAFE_API_KEY is not set. No TypeSafe judgment ran.';

function parseFlowArgs(argv) {
  const rest = argv.slice(3);
  const options = { data: {}, maxSteps: DEFAULT_MAX_STEPS, positionals: [] };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--max-steps') {
      const raw = rest[++i];
      if (raw == null || !/^\d+$/.test(raw) || Number(raw) < 1) {
        throw new VerificationInputError('--max-steps expects a positive integer.');
      }
      options.maxSteps = Number(raw);
    } else if (arg === '--data') {
      const raw = rest[++i];
      if (raw == null || raw.startsWith('--')) {
        throw new VerificationInputError('--data expects key=value.');
      }
      const eq = raw.indexOf('=');
      if (eq <= 0) throw new VerificationInputError('--data expects key=value.');
      const key = raw.slice(0, eq);
      if (!DATA_KEY.test(key)) {
        throw new VerificationInputError(
          `Invalid --data key "${key}". Use letters, numbers, "_" and "-".`,
        );
      }
      options.data[key] = raw.slice(eq + 1);
    } else if (arg.startsWith('--')) {
      throw new VerificationInputError(`Unknown flow option: ${arg}.`);
    } else {
      options.positionals.push(arg);
    }
  }

  const [url, ...goalParts] = options.positionals;
  return normalizeFlowOptions({
    url,
    goal: goalParts.join(' '),
    data: options.data,
    maxSteps: options.maxSteps,
    json: Boolean(options.json),
  });
}

function normalizeFlowOptions(options) {
  const url = options.url;
  const goal = typeof options.goal === 'string' ? options.goal.trim() : '';
  if (!isHttpUrl(url) || !goal) {
    throw new VerificationInputError(USAGE);
  }

  const data = { ...(options.data || {}) };
  for (const [key, value] of Object.entries(data)) {
    if (!DATA_KEY.test(key)) {
      throw new VerificationInputError(
        `Invalid --data key "${key}". Use letters, numbers, "_" and "-".`,
      );
    }
    if (typeof value !== 'string') {
      throw new VerificationInputError(`Data value for ${key} must be a string.`);
    }
  }

  const maxSteps = options.maxSteps == null ? DEFAULT_MAX_STEPS : options.maxSteps;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS_LIMIT) {
    throw new VerificationInputError(
      `--max-steps must be an integer from 1 to ${MAX_STEPS_LIMIT}.`,
    );
  }

  return {
    url,
    goal,
    data,
    maxSteps,
    json: Boolean(options.json),
    client: options.client,
  };
}

function unescapeName(value) {
  return value
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function capSnapshot(text) {
  const raw = typeof text === 'string' ? text : '';
  if (raw.length <= SNAPSHOT_CHARS) return { text: raw, truncated: false };
  const sliced = raw.slice(0, SNAPSHOT_CHARS);
  const lineEnd = sliced.lastIndexOf('\n');
  const body = lineEnd > 0 ? sliced.slice(0, lineEnd) : sliced;
  return { text: `${body}\n[snapshot truncated]`, truncated: true };
}

function fieldMatchesKey(name, key) {
  const phrase = String(key).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`);
  return word.test(String(name).toLowerCase());
}

function actionsFromSnapshot(snapshot, data) {
  const capped = capSnapshot(snapshot);
  const dataKeys = Object.keys(data || {});
  const seen = new Map();
  const actions = new Map();
  const criteria = {
    done: 'The goal is already achieved. Choose this instead of another action.',
  };
  const unmatched = [];
  let actionsTruncated = false;
  let elementNumber = 0;

  for (const line of capped.text.split('\n')) {
    const match = ELEMENT_LINE.exec(line);
    if (!match) continue;
    const role = match[2].toLowerCase();
    const name = match[3] ? unescapeName(match[3]) : '';
    if (!name) continue;
    if (!CLICK_ROLES.has(role) && !FILL_ROLES.has(role)) continue;
    if (DISABLED.test(match[4] || '')) continue;

    const identity = `${role}\0${name}`;
    const nth = seen.get(identity) || 0;
    seen.set(identity, nth + 1);
    elementNumber += 1;
    const elementId = `e${elementNumber}`;
    const shown = name.length > 120 ? `${name.slice(0, 117)}...` : name;
    const base = { role, name, nth, id: elementId };

    const additions = [];
    if (CLICK_ROLES.has(role)) {
      additions.push({
        key: `click_${elementId}`,
        spec: { ...base, type: 'click' },
        description: `Click ${role} "${shown}"`,
      });
    }
    if (FILL_ROLES.has(role)) {
      let matched = false;
      for (const dataKey of dataKeys) {
        if (!fieldMatchesKey(name, dataKey)) continue;
        matched = true;
        additions.push({
          key: `fill_${elementId}_${dataKey}`,
          spec: { ...base, type: 'fill', key: dataKey, value: data[dataKey] },
          description: `Type the fixed ${dataKey} value into ${role} "${shown}"`,
        });
      }
      if (!matched) unmatched.push({ role, name });
    }

    for (const addition of additions) {
      if (Object.keys(criteria).length >= MAX_CHOICES) {
        actionsTruncated = true;
        break;
      }
      criteria[addition.key] = addition.description;
      actions.set(addition.key, addition.spec);
    }
    if (actionsTruncated) break;
  }

  return {
    criteria,
    actions,
    unmatched,
    truncated: actionsTruncated,
    text: capped.text,
  };
}

function missingDataMessage(fields) {
  const labels = [];
  const seen = new Set();
  for (const field of fields) {
    const label = `${field.role} "${field.name}"`;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  const noun = labels.length === 1 ? 'that field' : 'those fields';
  return `Cannot submit ${labels.join(', ')}: no --data key matches ${noun}.`;
}

function pickUsage(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const picked = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!/token|cost/i.test(key)) continue;
    picked[key] = value;
  }
  return Object.keys(picked).length ? picked : null;
}

function usageFromResponse(response) {
  if (!response || typeof response !== 'object') return null;
  const top = {};
  for (const [key, value] of Object.entries(response)) {
    if (key === 'usage') continue;
    if (typeof value === 'number' && Number.isFinite(value) && /token|cost/i.test(key)) {
      top[key] = value;
    }
  }
  const nested = pickUsage(response.usage) || {};
  const merged = { ...top, ...nested };
  return Object.keys(merged).length ? merged : null;
}

function sumUsage(steps) {
  const totals = {};
  for (const step of steps) {
    if (!step.usage) continue;
    for (const [key, value] of Object.entries(step.usage)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      totals[key] = (totals[key] || 0) + value;
    }
  }
  return Object.keys(totals).length ? totals : null;
}

function cleanMessage(error) {
  const message = error && error.message ? String(error.message) : 'Flow failed.';
  return message.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function unknownActionError(choice, criteria) {
  const count = Object.keys(criteria).length;
  const label = choice ? `"${choice}"` : '(none)';
  return `Jev chose ${label}, which is not one of the ${count} offered actions.`;
}

function instructionsFor(goal) {
  return (
    `Goal: ${goal} ` +
    'Choose the single next action from the criteria. ' +
    'Choose done only when the goal is already achieved. ' +
    'A fill is offered only when a data key matches the field name. Do not invent text.'
  );
}

function makeStep({ step, action, description, jevMs, response, error }) {
  const answer = response && response.answers ? response.answers.next : null;
  const confidence = answer ? answer.confidence : undefined;
  const record = {
    step,
    action,
    description,
    jev_ms: jevMs,
    model: response && typeof response.model === 'string' ? response.model : null,
    usage: usageFromResponse(response),
    error,
  };
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    record.confidence = confidence;
  }
  return record;
}

function emptyReport(options, status, summary) {
  return {
    command: 'flow',
    status,
    summary,
    url: options.url,
    goal: options.goal,
    data_keys: Object.keys(options.data),
    max_steps: options.maxSteps,
    steps: [],
    step_count: 0,
    wall_ms: null,
    model: null,
    usage: null,
    final_snapshot: null,
    error: null,
  };
}

function lastModel(steps) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].model) return steps[i].model;
  }
  return null;
}

function exitCodeFor(status) {
  if (status === 'done' || status === 'skipped') return 0;
  return 1;
}

function failStep(report, step) {
  report.steps.push(step);
  report.status = 'failed';
  report.error = step.error;
  report.summary = step.error;
}

async function captureSnapshot(page) {
  const raw = await page.locator('body').ariaSnapshot({ timeout: ACTION_TIMEOUT_MS });
  return capSnapshot(raw);
}

async function waitForSettle(page, beforeText) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let text = beforeText;
    try {
      text = (await captureSnapshot(page)).text;
    } catch {
      text = beforeText;
    }
    if (text !== beforeText) {
      const quiet = Math.min(500, Math.max(1, deadline - Date.now()));
      await page.waitForLoadState('networkidle', { timeout: quiet }).catch(() => {});
      return;
    }
    const pause = Math.min(SETTLE_POLL_MS, deadline - Date.now());
    if (pause <= 0) return;
    await page.waitForTimeout(pause);
  }
}

function locatorFor(page, spec) {
  return page
    .getByRole(spec.role, { name: spec.name, exact: true, disabled: false })
    .nth(spec.nth);
}

const SUBMIT_FORM_ATTR = 'data-qai-flow-form';

async function unmatchedFieldsOnSubmit(page, spec, unmatched) {
  if (!spec || spec.type !== 'click' || !unmatched || unmatched.length === 0) return [];
  const marked = await locatorFor(page, spec).evaluate((el, attr) => {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const submits =
      (tag === 'BUTTON' && type !== 'button' && type !== 'reset') ||
      (tag === 'INPUT' && (type === 'submit' || type === 'image'));
    if (!submits) return false;
    const form = el.form || el.closest('form');
    if (!form) return false;
    form.setAttribute(attr, '1');
    return true;
  }, SUBMIT_FORM_ATTR);
  if (!marked) return [];

  const form = page.locator(`[${SUBMIT_FORM_ATTR}="1"]`);
  try {
    const yaml = await form.ariaSnapshot();
    const wanted = new Set(unmatched.map((field) => `${field.role}\0${field.name}`));
    const hit = [];
    const seen = new Set();
    for (const line of yaml.split('\n')) {
      const match = ELEMENT_LINE.exec(line);
      if (!match) continue;
      const role = match[2].toLowerCase();
      const name = match[3] ? unescapeName(match[3]) : '';
      const key = `${role}\0${name}`;
      if (!name || !wanted.has(key) || seen.has(key)) continue;
      seen.add(key);
      hit.push({ role, name });
    }
    return hit;
  } finally {
    await form.evaluate((el, attr) => el.removeAttribute(attr), SUBMIT_FORM_ATTR).catch(() => {});
  }
}

async function performAction(page, spec) {
  const locator = locatorFor(page, spec);
  if ((await locator.count()) < 1) {
    throw new Error(`Element not found for ${spec.type}: ${spec.role} "${spec.name}".`);
  }
  if (spec.type === 'fill') {
    if (typeof spec.value !== 'string') {
      throw new Error(`No fixed value for ${spec.key}.`);
    }
    await locator.fill(spec.value);
    return;
  }
  if (spec.type === 'click') {
    await locator.click();
    return;
  }
  throw new Error(`Unsupported action type: ${spec.type}.`);
}

async function runSteps(page, client, options, report) {
  const history = [];

  for (let index = 0; index < options.maxSteps; index += 1) {
    const snapshot = await captureSnapshot(page);
    const built = actionsFromSnapshot(snapshot.text, options.data);
    report.final_snapshot = built.text;
    const state = {
      goal: options.goal,
      url: page.url(),
      title: await page.title(),
      data_keys: Object.keys(options.data),
      typing: 'Fill is offered only when a data key matches the field name. Do not invent text.',
      history,
      snapshot: built.text,
      snapshot_truncated: snapshot.truncated,
      actions_truncated: built.truncated,
    };
    const jevStarted = Date.now();
    let response;
    try {
      response = await client.systemOne({
        model: MODEL,
        state,
        questions: {
          next: {
            type: 'choice',
            instructions: instructionsFor(options.goal),
            criteria: built.criteria,
          },
        },
      });
    } catch (error) {
      failStep(
        report,
        makeStep({
          step: index + 1,
          action: null,
          description: null,
          jevMs: Date.now() - jevStarted,
          response: null,
          error: `TypeSafe systemOne failed: ${cleanMessage(error)}`,
        }),
      );
      return;
    }

    const jevMs = Date.now() - jevStarted;
    const answer = response && response.answers ? response.answers.next : null;
    const choice = answer && typeof answer.choice === 'string' ? answer.choice : '';
    if (!choice || !Object.prototype.hasOwnProperty.call(built.criteria, choice)) {
      failStep(
        report,
        makeStep({
          step: index + 1,
          action: choice || null,
          description: null,
          jevMs,
          response,
          error: unknownActionError(choice, built.criteria),
        }),
      );
      return;
    }

    const description = built.criteria[choice];
    if (choice === 'done') {
      report.steps.push(
        makeStep({
          step: index + 1,
          action: 'done',
          description,
          jevMs,
          response,
          error: null,
        }),
      );
      report.status = 'done';
      report.error = null;
      const count = report.steps.length;
      report.summary = `Goal reached in ${count} step${count === 1 ? '' : 's'}.`;
      return;
    }

    try {
      const spec = built.actions.get(choice);
      const blocked = await unmatchedFieldsOnSubmit(page, spec, built.unmatched);
      if (blocked.length) throw new Error(missingDataMessage(blocked));
      await performAction(page, spec);
      await waitForSettle(page, built.text);
    } catch (error) {
      failStep(
        report,
        makeStep({
          step: index + 1,
          action: choice,
          description,
          jevMs,
          response,
          error: cleanMessage(error),
        }),
      );
      return;
    }

    report.steps.push(
      makeStep({
        step: index + 1,
        action: choice,
        description,
        jevMs,
        response,
        error: null,
      }),
    );
    history.push({ step: index + 1, action: choice, description });
  }

  report.status = 'max-steps';
  report.error = `Stopped after ${options.maxSteps} steps without reaching the goal.`;
  report.summary = report.error;
}

async function flow(options = {}) {
  const settings = normalizeFlowOptions(options);
  if (!settings.client && !readApiKey()) {
    return { report: emptyReport(settings, 'skipped', SKIPPED_SUMMARY), exitCode: 0 };
  }

  const report = emptyReport(settings, 'failed', '');
  const started = Date.now();
  let browser;
  try {
    const client = settings.client || createClient('qai flow');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await page.goto(settings.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
    await runSteps(page, client, settings, report);
  } catch (error) {
    report.status = 'failed';
    report.error = cleanMessage(error);
    report.summary = report.error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    report.wall_ms = Date.now() - started;
    report.step_count = report.steps.length;
    report.usage = sumUsage(report.steps);
    report.model = lastModel(report.steps);
  }

  if (!report.summary) report.summary = report.error || 'Flow failed.';
  return { report, exitCode: exitCodeFor(report.status) };
}

function formatUsage(usage) {
  if (!usage) return '';
  return Object.entries(usage)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function formatStep(step) {
  const parts = [`${String(step.step).padStart(2, ' ')}  ${step.action || '(no action)'}`];
  if (step.description) parts.push(step.description);
  parts.push(`jev ${step.jev_ms}ms`);
  if (step.model) parts.push(`model ${step.model}`);
  if (typeof step.confidence === 'number') parts.push(`conf ${step.confidence}`);
  const usage = formatUsage(step.usage);
  if (usage) parts.push(usage);
  if (step.error) parts.push(`error: ${step.error}`);
  return `  ${parts.join('  ')}`;
}

function formatHuman(report) {
  const lines = [];
  lines.push(`qai flow — ${STATUS_LABELS[report.status] || report.status}`);
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  lines.push(`URL       ${report.url}`);
  lines.push(`Goal      ${report.goal}`);
  lines.push(`Data      ${report.data_keys.length ? report.data_keys.join(', ') : '(none)'}`);
  if (report.steps.length) {
    lines.push('');
    lines.push('STEPS');
    for (const step of report.steps) lines.push(formatStep(step));
  }
  lines.push('');
  lines.push('SUMMARY');
  lines.push(`  Steps     ${report.step_count}`);
  lines.push(`  Wall      ${report.wall_ms == null ? 'n/a' : `${report.wall_ms}ms`}`);
  const usage = formatUsage(report.usage);
  if (usage) lines.push(`  Usage     ${usage}`);
  if (report.model) lines.push(`  Model     ${report.model}`);
  lines.push('');
  lines.push(`VERDICT  ${STATUS_LABELS[report.status] || report.status}`);
  return lines.join('\n');
}

async function runFlow() {
  const options = parseFlowArgs(process.argv);
  if (!options.json) console.error('qai flow: running goal...');
  const result = await flow(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(result.report)}\n`);
  }
  process.exitCode = result.exitCode;
}

module.exports = {
  DEFAULT_MAX_STEPS,
  MAX_STEPS_LIMIT,
  actionsFromSnapshot,
  flow,
  formatHuman,
  parseFlowArgs,
  pickUsage,
  runFlow,
  sumUsage,
};
