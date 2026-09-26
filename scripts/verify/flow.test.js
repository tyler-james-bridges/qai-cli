const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const test = require('node:test');
const {
  actionsFromSnapshot,
  flow,
  formatHuman,
  parseFlowArgs,
  pickUsage,
  sumUsage,
} = require('../../src/flow');
const { fixture, runCli } = require('./test-helpers');

const GOAL = 'Create a new board, list, and card';
const DATA = { board: 'Trip', list: 'Todo', card: 'Pack' };

function startFixtureServer() {
  const board = fs.readFileSync(fixture('flow', 'board.html'));
  const missing = fs.readFileSync(fixture('flow', 'missing.html'));
  const spa = fs.readFileSync(fixture('flow', 'spa.html'));
  const server = http.createServer((req, res) => {
    const pathName = new URL(req.url, 'http://127.0.0.1').pathname;
    let body = board;
    if (pathName === '/missing') body = missing;
    else if (pathName === '/spa' || pathName === '/docs') body = spa;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        boardUrl: `http://127.0.0.1:${port}/`,
        missingUrl: `http://127.0.0.1:${port}/missing`,
        spaUrl: `http://127.0.0.1:${port}/spa`,
      });
    });
  });
}

function findAction(criteria, pattern) {
  return Object.keys(criteria).find((key) => key !== 'done' && pattern.test(`${key} ${criteria[key]}`));
}

function chooseNext(request) {
  const criteria = request.questions.next.criteria;
  const snapshot = request.state.snapshot || '';
  const lastAction = (request.state.history || []).at(-1)?.action || '';
  const filled = lastAction.startsWith('fill_');

  if (snapshot.includes('status: Card ready')) return 'done';

  if (!snapshot.includes('heading "Trip"')) {
    if (!filled) {
      const fill = findAction(criteria, /^fill_e\d+_board .*textbox "Board name"/);
      if (fill) return fill;
    }
    if (filled) {
      const create = findAction(criteria, /^click_e\d+ .*button "Create board"/);
      if (create) return create;
    }
    const open = findAction(criteria, /^click_e\d+ .*button "New board"/);
    if (open) return open;
  } else if (!snapshot.includes('heading "Todo"')) {
    if (!filled) {
      const fill = findAction(criteria, /^fill_e\d+_list .*textbox "List name"/);
      if (fill) return fill;
    }
    if (filled) {
      const create = findAction(criteria, /^click_e\d+ .*button "Create list"/);
      if (create) return create;
    }
    const add = findAction(criteria, /^click_e\d+ .*button "Add list"/);
    if (add) return add;
  } else if (!snapshot.includes('listitem: Pack')) {
    if (!filled) {
      const fill = findAction(criteria, /^fill_e\d+_card .*textbox "Card title"/);
      if (fill) return fill;
    }
    if (filled) {
      const save = findAction(criteria, /^click_e\d+ .*button "Save card"/);
      if (save) return save;
    }
    const add = findAction(criteria, /^click_e\d+ .*button "Add card"/);
    if (add) return add;
  }

  throw new Error(`No next action after ${lastAction}. Snapshot: ${snapshot}`);
}

function scriptedClient(requests) {
  let calls = 0;
  return {
    async systemOne(request) {
      requests.push(request);
      calls += 1;
      const choice = chooseNext(request);
      const response = {
        answers: { next: { type: 'choice', choice, confidence: 0.91 } },
      };
      if (choice !== 'done') {
        response.model = 'jev-1.13.0';
        response.usage = { input_tokens: 100, output_tokens: 5 };
      }
      if (calls === 1) response.usage.cost_usd = 0.0001;
      return response;
    },
  };
}

let pages;

test.before(async () => {
  pages = await startFixtureServer();
});

test.after(() => {
  pages.server.close();
});

test('parseFlowArgs reads the goal, repeatable data, max steps, and json', () => {
  const options = parseFlowArgs([
    'node',
    'qai',
    'flow',
    'http://127.0.0.1:3000/board',
    'Create',
    'a',
    'board',
    '--data',
    'board=Trip=west',
    '--data',
    'list=Todo',
    '--max-steps',
    '4',
    '--json',
  ]);
  assert.equal(options.url, 'http://127.0.0.1:3000/board');
  assert.equal(options.goal, 'Create a board');
  assert.deepEqual(options.data, { board: 'Trip=west', list: 'Todo' });
  assert.equal(options.maxSteps, 4);
  assert.equal(options.json, true);
});

test('pickUsage keeps numeric token and cost fields and invents nothing else', () => {
  assert.equal(pickUsage(undefined), null);
  assert.equal(pickUsage({ note: 'free', confidence: 1 }), null);
  assert.deepEqual(pickUsage({ input_tokens: 3, cost_usd: 0.1, ignored: 4 }), {
    input_tokens: 3,
    cost_usd: 0.1,
  });
  const summed = sumUsage([
    { usage: { input_tokens: 3, cost_usd: 0.1 } },
    { usage: null },
    { usage: { input_tokens: 2 } },
  ]);
  assert.deepEqual(summed, { input_tokens: 5, cost_usd: 0.1 });
});

test('a data key is not a fill for an unmatched field name', () => {
  const snapshot = [
    '- textbox "Board name"',
    '- textbox "List name"',
    '- textbox "Card title"',
  ].join('\n');
  const built = actionsFromSnapshot(snapshot, { board: 'Trip' });
  assert.equal(built.actions.get('fill_e1_board').value, 'Trip');
  assert.equal(built.actions.get('fill_e1_board').name, 'Board name');
  const fills = Object.entries(built.criteria).filter(([key]) => key.startsWith('fill_'));
  assert.deepEqual(
    fills.map(([, description]) => description),
    ['Type the fixed board value into textbox "Board name"'],
  );
});

test('actionsFromSnapshot offers clicks and fixed fills, skipping disabled controls', () => {
  const snapshot = [
    '- heading "Boards" [level=1]',
    '- button "New board"',
    '- textbox "Board name"',
    '- button "Save" [disabled]',
    '- button "Add card"',
    '- button "Add card"',
    '- status: Card ready',
  ].join('\n');
  const built = actionsFromSnapshot(snapshot, { board: 'Trip' });
  assert.equal(built.criteria.click_e1, 'Click button "New board"');
  assert.equal(built.actions.get('fill_e2_board').value, 'Trip');
  assert.equal(built.actions.get('fill_e2_board').name, 'Board name');
  assert.equal(built.actions.get('click_e3').nth, 0);
  assert.equal(built.actions.get('click_e4').nth, 1);
  assert.equal(Object.values(built.criteria).some((line) => line.includes('Save')), false);
  assert.doesNotMatch(JSON.stringify(built.criteria), /Trip/);
});

test('missing TYPESAFE_API_KEY skips without a browser', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const result = await flow({
      url: 'http://127.0.0.1:9/',
      goal: GOAL,
      data: DATA,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.status, 'skipped');
    assert.equal(result.report.wall_ms, null);
    assert.equal(result.report.usage, null);
    assert.match(result.report.summary, /SKIPPED/);
    assert.match(result.report.summary, /TYPESAFE_API_KEY/);
    assert.match(formatHuman(result.report), /qai flow — SKIPPED/);
    assert.match(formatHuman(result.report), /VERDICT {2}SKIPPED/);
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
});

test('multi-step goal types only --data values and reaches done', { timeout: 60000 }, async () => {
  const requests = [];
  const result = await flow({
    url: pages.boardUrl,
    goal: GOAL,
    data: DATA,
    maxSteps: 15,
    client: scriptedClient(requests),
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.report, null, 2));
  assert.equal(result.report.status, 'done');
  assert.equal(result.report.steps.length, 10, result.report.steps.map((step) => step.action).join(','));
  assert.equal(result.report.steps.at(-1).action, 'done');
  assert.equal(result.report.steps.at(-1).model, null);
  assert.equal(result.report.steps.at(-1).usage, null);
  assert.equal(result.report.model, 'jev-1.13.0');
  assert.equal(result.report.usage.input_tokens, 900);
  assert.equal(result.report.usage.output_tokens, 45);
  assert.equal(result.report.usage.cost_usd, 0.0001);
  assert.equal(result.report.steps[0].usage.cost_usd, 0.0001);
  assert.equal(result.report.steps[1].usage.cost_usd, undefined);
  assert.ok(
    result.report.steps.every((step) => typeof step.jev_ms === 'number' && step.jev_ms >= 0),
  );
  const jevMs = result.report.steps.reduce((sum, step) => sum + step.jev_ms, 0);
  assert.ok(result.report.wall_ms >= jevMs);
  assert.match(result.report.final_snapshot, /heading "Trip"/);
  assert.match(result.report.final_snapshot, /heading "Todo"/);
  assert.match(result.report.final_snapshot, /listitem: Pack/);
  assert.match(result.report.final_snapshot, /status: Card ready/);

  assert.equal(requests[0].model, 'jev-latest');
  assert.equal(requests[0].questions.next.type, 'choice');
  assert.doesNotMatch(requests[0].state.snapshot, /Trip|Todo|Pack/);
  for (const request of requests) {
    assert.deepEqual(request.state.data_keys, ['board', 'list', 'card']);
    assert.equal(request.state.board, undefined);
    assert.doesNotMatch(JSON.stringify(request.questions), /Trip|Todo|Pack/);
  }

  const human = formatHuman(result.report);
  assert.match(human, /qai flow — DONE/);
  assert.match(human, /VERDICT {2}DONE/);
  assert.match(human, /jev \d+ms/);
  assert.match(human, /input_tokens=900/);
  assert.match(human, /cost_usd=0\.0001/);
  assert.equal(human.split('cost_usd=').length - 1, 2);
});

test('client-side navigation waits for the new snapshot', { timeout: 60000 }, async () => {
  const result = await flow({
    url: pages.spaUrl,
    goal: 'Open the Docs page',
    maxSteps: 3,
    client: {
      async systemOne(request) {
        const snapshot = request.state.snapshot || '';
        if (snapshot.includes('heading "Docs intro"')) {
          return { answers: { next: { type: 'choice', choice: 'done', confidence: 1 } } };
        }
        const click = findAction(request.questions.next.criteria, /link "Docs"/);
        if (!click) {
          throw new Error(`Docs link was not offered. Snapshot: ${snapshot}`);
        }
        return { answers: { next: { type: 'choice', choice: click, confidence: 1 } } };
      },
    },
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.report, null, 2));
  assert.equal(result.report.status, 'done');
  assert.match(result.report.final_snapshot, /heading "Docs intro"/);
  assert.doesNotMatch(result.report.final_snapshot, /heading "Home"/);
  assert.equal(result.report.steps.length, 2);
  assert.match(result.report.steps[0].description, /link "Docs"/);
});

test('one data key is not typed into an unmatched field', { timeout: 60000 }, async () => {
  const requests = [];
  const result = await flow({
    url: pages.boardUrl,
    goal: 'Create a board',
    data: { board: 'Trip' },
    maxSteps: 8,
    client: {
      async systemOne(request) {
        requests.push(request);
        const criteria = request.questions.next.criteria;
        const snapshot = request.state.snapshot || '';
        const lastAction = (request.state.history || []).at(-1)?.action || '';
        if (snapshot.includes('textbox "List name"') || snapshot.includes('textbox "Card title"')) {
          return { answers: { next: { type: 'choice', choice: 'done', confidence: 1 } } };
        }
        if (!snapshot.includes('heading "Trip"')) {
          if (!lastAction.startsWith('fill_')) {
            const fill = findAction(criteria, /^fill_e\d+_board .*textbox "Board name"/);
            if (fill) {
              return { answers: { next: { type: 'choice', choice: fill, confidence: 1 } } };
            }
          }
          const create = findAction(criteria, /button "Create board"/);
          if (create && lastAction.startsWith('fill_')) {
            return { answers: { next: { type: 'choice', choice: create, confidence: 1 } } };
          }
          const open = findAction(criteria, /button "New board"/);
          if (open) {
            return { answers: { next: { type: 'choice', choice: open, confidence: 1 } } };
          }
        }
        const addList = findAction(criteria, /button "Add list"/);
        if (addList) {
          return { answers: { next: { type: 'choice', choice: addList, confidence: 1 } } };
        }
        return { answers: { next: { type: 'choice', choice: 'done', confidence: 1 } } };
      },
    },
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.report, null, 2));
  assert.match(result.report.final_snapshot, /heading "Trip"/);
  assert.match(result.report.final_snapshot, /textbox "List name"/);
  const fills = result.report.steps.filter((step) => String(step.action).startsWith('fill_'));
  assert.equal(fills.length, 1);
  assert.match(fills[0].description, /textbox "Board name"/);
  for (const request of requests) {
    for (const [key, description] of Object.entries(request.questions.next.criteria)) {
      if (!key.startsWith('fill_')) continue;
      assert.match(description, /textbox "Board name"/);
      assert.doesNotMatch(description, /List name|Card title/);
    }
  }
});

test('missing element fails cleanly and does not click another control', { timeout: 60000 }, async () => {
  const result = await flow({
    url: pages.missingUrl,
    goal: 'Click Save',
    maxSteps: 4,
    client: {
      async systemOne(request) {
        const save = Object.keys(request.questions.next.criteria).find((key) =>
          /button "Save"/.test(request.questions.next.criteria[key]),
        );
        return {
          model: 'jev-latest',
          answers: {
            next: { type: 'choice', choice: save || 'click_save', confidence: 0.4 },
          },
          usage: { input_tokens: 11, output_tokens: 3 },
        };
      },
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.steps.length, 1);
  assert.match(
    result.report.error,
    /Jev chose "click_save", which is not one of the \d+ offered actions/,
  );
  assert.match(result.report.final_snapshot, /button "Cancel"/);
  assert.doesNotMatch(result.report.final_snapshot, /Cancelled/);
  assert.deepEqual(result.report.usage, { input_tokens: 11, output_tokens: 3 });
  assert.equal(result.report.usage.cost, undefined);
  assert.equal(result.report.usage.cost_usd, undefined);
  const human = formatHuman(result.report);
  assert.match(human, /qai flow — FAILED/);
  assert.match(human, /click_save/);
  assert.match(human, /VERDICT {2}FAILED/);
});

test('max steps exits non-zero when Jev never finishes', { timeout: 60000 }, async () => {
  const result = await flow({
    url: pages.boardUrl,
    goal: GOAL,
    data: DATA,
    maxSteps: 2,
    client: {
      async systemOne(request) {
        const keys = Object.keys(request.questions.next.criteria);
        const choice = keys.find((key) => key.startsWith('click_')) || keys.find((key) => key.startsWith('fill_'));
        return {
          answers: { next: { type: 'choice', choice, confidence: 0.2 } },
          usage: { input_tokens: 7 },
        };
      },
    },
  });

  assert.equal(result.exitCode, 1, result.report.summary);
  assert.equal(result.report.status, 'max-steps');
  assert.equal(result.report.steps.length, 2);
  assert.ok(result.report.steps.every((step) => step.action !== 'done'));
  assert.match(result.report.summary, /Stopped after 2 steps/);
  assert.match(formatHuman(result.report), /MAX STEPS/);
  assert.equal(result.report.model, null);
});

test('CLI skips without TYPESAFE_API_KEY and rejects a bad option', () => {
  const skipped = runCli(
    ['flow', 'http://127.0.0.1:9/', 'Create a board', '--data', 'board=Trip', '--json'],
    { env: { TYPESAFE_API_KEY: '' } },
  );
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stderr, '');
  const report = JSON.parse(skipped.stdout);
  assert.equal(report.status, 'skipped');
  assert.match(report.summary, /SKIPPED/);
  assert.match(report.summary, /TYPESAFE_API_KEY/);

  const human = runCli(['flow', 'http://127.0.0.1:9/', 'Create a board'], {
    env: { TYPESAFE_API_KEY: '' },
  });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^qai flow — SKIPPED/);
  assert.match(human.stdout, /VERDICT {2}SKIPPED/);

  const unknown = runCli(['flow', 'http://127.0.0.1:9/', 'Create a board', '--nope']);
  assert.equal(unknown.status, 3);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown flow option/);

  const missingGoal = runCli(['flow', 'http://127.0.0.1:9/']);
  assert.equal(missingGoal.status, 3);
  assert.match(missingGoal.stderr, /qai flow <url> <goal>/);

  const badSteps = runCli(['flow', 'http://127.0.0.1:9/', 'Create a board', '--max-steps', '0']);
  assert.equal(badSteps.status, 3);
  assert.match(badSteps.stderr, /--max-steps/);

  const help = runCli(['help']);
  assert.match(help.stdout, /qai flow <url> <goal>/);
  assert.match(help.stdout, /--data <key=value>/);
  assert.match(help.stdout, /TYPESAFE_API_KEY/);
});
