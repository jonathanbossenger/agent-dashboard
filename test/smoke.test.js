const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const request = require('supertest');

const originalHome = process.env.HOME;
const repoRoot = path.resolve(__dirname, '..');
const serverRoot = path.join(repoRoot, 'server');

function clearServerModules() {
  // Simulate a process reboot in tests: server modules hold singleton state at
  // module scope (SQLite handle/config cache), so each bootstrap needs a clean
  // require() graph to re-run module-load side effects deterministically.
  const prefix = `${serverRoot}${path.sep}`;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key];
  }
}

function bootstrap(homeDir) {
  process.env.HOME = homeDir;
  clearServerModules();
  const { createApp } = require(path.join(serverRoot, 'app'));
  const app = createApp();
  const store = require(path.join(serverRoot, 'store'));
  return { api: request(app), store };
}

function withLocalHost(req) {
  return req.set('host', 'localhost');
}

function stubFetchJson(t, handler) {
  const originalFetch = global.fetch;
  global.fetch = async (...args) => handler(...args);
  t.after(() => {
    global.fetch = originalFetch;
  });
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    ok,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}

function parseSseBody(raw) {
  const blocks = raw.split('\n\n').map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const event = { id: null, event: null, data: null };
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) event.id = Number(line.slice(3).trim());
      else if (line.startsWith('event:')) event.event = line.slice(6).trim();
      else if (line.startsWith('data:')) event.data = JSON.parse(line.slice(5).trim());
    }
    return event;
  });
}

async function waitForTaskStatus(api, taskId, expected, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await withLocalHost(api.get(`/api/tasks/${taskId}`));
    if (response.body.status === expected) return response.body;
    await delay(25);
  }
  throw new Error(`Timed out waiting for task ${taskId} to reach status "${expected}"`);
}

async function waitForTaskToEmit(api, taskId, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await withLocalHost(api.get(`/api/tasks/${taskId}`));
    if (response.body.status === 'running' && response.body.events.length > 0) return response.body;
    await delay(25);
  }
  throw new Error(`Timed out waiting for task ${taskId} to emit output while running`);
}

after(() => {
  process.env.HOME = originalHome;
  clearServerModules();
});

test('task kill flow marks task status as killed', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const { api } = bootstrap(homeDir);

  await withLocalHost(api.post('/api/agents').send({
    id: 'ticker',
    name: 'Ticker',
    command: process.execPath,
    args: ['-e', 'setInterval(() => process.stdout.write("tick\\n"), 20)'],
  })).expect(201);

  const startResponse = await withLocalHost(api.post('/api/tasks').send({ agent_id: 'ticker' })).expect(200);
  const taskId = startResponse.body.task_id;
  assert.ok(taskId);

  await delay(60);
  await withLocalHost(api.post(`/api/tasks/${taskId}/kill`)).expect(200);
  const task = await waitForTaskStatus(api, taskId, 'killed');
  assert.equal(task.status, 'killed');
  assert.equal(typeof task.ended_at, 'number');
});

test('boot-time recovery marks running tasks as crashed', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const firstBoot = bootstrap(homeDir);
  const runningTaskId = firstBoot.store.createTask('orphaned', '', os.tmpdir());
  const doneTaskId = firstBoot.store.createTask('done', '', os.tmpdir());
  firstBoot.store.finishTask(doneTaskId, 'done', 0, null);

  const runningBefore = firstBoot.store.getTask(runningTaskId);
  const doneBefore = firstBoot.store.getTask(doneTaskId);
  assert.equal(runningBefore.status, 'running');
  assert.equal(runningBefore.ended_at, null);
  assert.equal(doneBefore.status, 'done');

  const secondBoot = bootstrap(homeDir);
  const runningAfterRestart = secondBoot.store.getTask(runningTaskId);
  const doneAfterRestart = secondBoot.store.getTask(doneTaskId);
  assert.equal(runningAfterRestart.status, 'crashed');
  assert.equal(typeof runningAfterRestart.ended_at, 'number');
  assert.equal(doneAfterRestart.status, 'done');
  assert.equal(doneAfterRestart.ended_at, doneBefore.ended_at);
});

test('SSE replay while task is live has no gaps or duplicates', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const { api } = bootstrap(homeDir);

  const lineCount = 40;
  const lineIntervalMs = 15;

  await withLocalHost(api.post('/api/agents').send({
    id: 'streamer',
    name: 'Streamer',
    command: process.execPath,
    args: ['-e', [
      'let i = 0;',
      `const max = ${lineCount};`,
      'const timer = setInterval(() => {',
      '  if (i >= max) {',
      '    clearInterval(timer);',
      '    process.exit(0);',
      '  }',
      '  process.stdout.write(`line-${i}\\n`);',
      '  i += 1;',
      `}, ${lineIntervalMs});`,
    ].join(' ')],
  })).expect(201);

  const start = await withLocalHost(api.post('/api/tasks').send({ agent_id: 'streamer' })).expect(200);
  const taskId = start.body.task_id;
  assert.ok(taskId);

  await waitForTaskToEmit(api, taskId);
  const streamResponse = await withLocalHost(api.get(`/api/stream/${taskId}`))
    .timeout(7000)
    .expect(200);
  const rawBody = streamResponse.text
    || (Buffer.isBuffer(streamResponse.body) ? streamResponse.body.toString('utf8') : String(streamResponse.body || ''));
  const parsedEvents = parseSseBody(rawBody);
  const streamEvents = parsedEvents.filter((ev) => ev.event === 'output');
  const endEvents = parsedEvents.filter((ev) => ev.event === 'end');
  assert.equal(endEvents.length, 1);
  assert.equal(endEvents[0].data.status, 'done');

  const taskResponse = await withLocalHost(api.get(`/api/tasks/${taskId}`)).expect(200);
  const dbEvents = taskResponse.body.events.map((ev) => ({
    id: ev.id,
    stream: ev.stream,
    data: ev.data,
  }));

  const sseEvents = streamEvents.map((ev) => ({
    id: ev.data.id ?? ev.id,
    stream: ev.data.stream,
    data: ev.data.data,
  }));

  assert.deepEqual(sseEvents, dbEvents);
  assert.equal(new Set(sseEvents.map((ev) => ev.id)).size, sseEvents.length);
  for (let i = 1; i < sseEvents.length; i += 1) {
    assert.ok(sseEvents[i].id > sseEvents[i - 1].id);
  }
});

test('agent CRUD survives restart', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const firstBoot = bootstrap(homeDir);
  await withLocalHost(firstBoot.api.post('/api/agents').send({
    id: 'persisted',
    name: 'Persisted',
    command: process.execPath,
    args: ['-e', 'console.log("ok")'],
  })).expect(201);
  await withLocalHost(firstBoot.api.patch('/api/agents/persisted').send({
    name: 'Persisted Agent',
    interactive: true,
  })).expect(200);

  const secondBoot = bootstrap(homeDir);
  const persisted = await withLocalHost(secondBoot.api.get('/api/agents/persisted')).expect(200);
  assert.equal(persisted.body.id, 'persisted');
  assert.equal(persisted.body.name, 'Persisted Agent');
  assert.equal(persisted.body.interactive, true);

  await withLocalHost(secondBoot.api.delete('/api/agents/persisted')).expect(200);
  await withLocalHost(secondBoot.api.get('/api/agents/persisted')).expect(404);
});

test('discover includes searchedPath context for missing commands', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-bin-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));

  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });

  const claudePath = path.join(binDir, 'claude');
  fs.writeFileSync(claudePath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(claudePath, 0o755);
  process.env.PATH = binDir;

  const { api } = bootstrap(homeDir);
  const response = await withLocalHost(api.get('/api/agents/discover')).expect(200);
  const discoverById = new Map(response.body.map((agent) => [agent.id, agent]));

  assert.equal(discoverById.get('claude').found, claudePath);
  assert.equal('searchedPath' in discoverById.get('claude'), false);

  assert.equal(discoverById.get('codex').found, null);
  assert.equal(discoverById.get('codex').searchedPath, binDir);
  assert.equal(discoverById.get('goose').found, null);
  assert.equal(discoverById.get('goose').searchedPath, binDir);
});

test('github-items includes a warning field without a token', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const { api } = bootstrap(homeDir);

  stubFetchJson(t, async (url) => {
    if (String(url).includes('/issues?')) {
      return jsonResponse([
        {
          number: 12,
          title: 'Issue from REST',
          html_url: 'https://github.com/octo/demo/issues/12',
          state: 'open',
          assignees: [{ login: 'octocat' }],
        },
      ]);
    }
    if (String(url).includes('/pulls?')) {
      return jsonResponse([
        {
          number: 34,
          title: 'PR from REST',
          html_url: 'https://github.com/octo/demo/pull/34',
          state: 'open',
          assignees: [{ login: 'hubot' }],
          head: { ref: 'feature/rest', sha: 'abc123' },
          draft: false,
          node_id: 'PR_kwDO',
        },
      ]);
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  const response = await withLocalHost(api.post('/api/system/github-items').send({
    url: 'https://github.com/octo/demo',
  })).expect(200);

  assert.equal(response.body.warning, 'linked refs require a github token');
  assert.deepEqual(response.body.issues, [{
    number: 12,
    title: 'Issue from REST',
    url: 'https://github.com/octo/demo/issues/12',
    state: 'open',
    assignees: ['octocat'],
  }]);
  assert.deepEqual(response.body.pulls, [{
    number: 34,
    title: 'PR from REST',
    url: 'https://github.com/octo/demo/pull/34',
    state: 'open',
    assignees: ['hubot'],
    branch: 'feature/rest',
    headSha: 'abc123',
    draft: false,
    nodeId: 'PR_kwDO',
  }]);
});

test('github-items includes warning: null with a github token', async (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concilium-test-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const { api } = bootstrap(homeDir);
  const config = require(path.join(serverRoot, 'config'));
  config.saveConfig({ ...config.getConfigForUpdate(), githubToken: 'test-token' });

  stubFetchJson(t, async (url, options = {}) => {
    assert.equal(String(url), 'https://api.github.com/graphql');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    return jsonResponse({
      data: {
        repository: {
          pullRequests: {
            nodes: [{
              number: 34,
              title: 'PR from GraphQL',
              url: 'https://github.com/octo/demo/pull/34',
              state: 'OPEN',
              isDraft: false,
              headRefName: 'feature/graphql',
              headRefOid: 'def456',
              id: 'PR_graphql',
              assignees: { nodes: [{ login: 'hubot' }] },
              closingIssuesReferences: { nodes: [{ number: 12 }] },
            }],
          },
          issues: {
            nodes: [{
              number: 12,
              title: 'Issue from GraphQL',
              url: 'https://github.com/octo/demo/issues/12',
              state: 'OPEN',
              assignees: { nodes: [{ login: 'octocat' }] },
            }],
          },
        },
      },
    });
  });

  const response = await withLocalHost(api.post('/api/system/github-items').send({
    url: 'https://github.com/octo/demo',
  })).expect(200);

  assert.equal(response.body.warning, null);
  assert.deepEqual(response.body.issues, [{
    number: 12,
    title: 'Issue from GraphQL',
    url: 'https://github.com/octo/demo/issues/12',
    state: 'open',
    assignees: ['octocat'],
    linkedPulls: [34],
  }]);
  assert.deepEqual(response.body.pulls, [{
    number: 34,
    title: 'PR from GraphQL',
    url: 'https://github.com/octo/demo/pull/34',
    state: 'open',
    assignees: ['hubot'],
    branch: 'feature/graphql',
    headSha: 'def456',
    draft: false,
    nodeId: 'PR_graphql',
    linkedIssues: [12],
  }]);
});
