import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-'));

let databaseFileCounter = 0;

const createTempDatabasePath = (): string => {
  databaseFileCounter += 1;
  return path.join(tempRoot, `v0-config-${databaseFileCounter}.db`);
};

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test uses a fresh database path to ensure isolation.
});

test('GET /api/v0/config returns default config when nothing is stored', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v0/config',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      threadUrl: '',
      threadTitle: '',
      ngaCookie: '',
      pollIntervalSeconds: 60,
      enabled: true,
      pushEnabled: true,
      pushChannel: 'console',
      pushWebhookUrl: '',
      pushSecret: '',
      digestEnabled: false,
      digestCron: '0 18 * * *',
      authors: [],
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/config persists normalized config and removes duplicate authors', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    const saveResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: ' https://nga.178.com/read.php?tid=123 ',
        threadTitle: ' 盘中观察贴 ',
        ngaCookie: ' ngaPassportUid=150058; ngaPassportCid=demo ',
        pollIntervalSeconds: 45,
        enabled: true,
        pushEnabled: false,
        pushChannel: 'feishu_bot',
        pushWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
        pushSecret: 'demo-secret',
        digestEnabled: true,
        digestCron: '0 20 * * *',
        authors: ['Alpha', ' Beta ', 'Alpha', ''],
      },
    });

    assert.equal(saveResponse.statusCode, 200);
    assert.deepEqual(saveResponse.json(), {
      data: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        ngaCookie: 'ngaPassportUid=150058; ngaPassportCid=demo',
        pollIntervalSeconds: 45,
        enabled: true,
        pushEnabled: false,
        pushChannel: 'feishu_bot',
        pushWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
        pushSecret: 'demo-secret',
        digestEnabled: true,
        digestCron: '0 20 * * *',
        authors: ['Alpha', 'Beta'],
      },
    });

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/config',
    });

    assert.equal(getResponse.statusCode, 200);
    assert.deepEqual(getResponse.json(), {
      threadUrl: 'https://nga.178.com/read.php?tid=123',
      threadTitle: '盘中观察贴',
      ngaCookie: 'ngaPassportUid=150058; ngaPassportCid=demo',
      pollIntervalSeconds: 45,
      enabled: true,
      pushEnabled: false,
      pushChannel: 'feishu_bot',
      pushWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
      pushSecret: 'demo-secret',
      digestEnabled: true,
      digestCron: '0 20 * * *',
      authors: ['Alpha', 'Beta'],
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/config rejects invalid poll interval', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        pollIntervalSeconds: 0,
        authors: ['Alpha'],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'pollIntervalSeconds must be a positive integer',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/config rejects non-string authors', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 123],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'authors must be an array of strings',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/config rejects non-string thread url and non-boolean flags', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    const invalidUrlResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 123,
      },
    });

    assert.equal(invalidUrlResponse.statusCode, 400);
    assert.deepEqual(invalidUrlResponse.json(), {
      error: 'threadUrl must be a string',
    });

    const invalidCookieResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        ngaCookie: 123,
      },
    });

    assert.equal(invalidCookieResponse.statusCode, 400);
    assert.deepEqual(invalidCookieResponse.json(), {
      error: 'ngaCookie must be a string',
    });

    const invalidFlagResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        enabled: 'yes',
      },
    });

    assert.equal(invalidFlagResponse.statusCode, 400);
    assert.deepEqual(invalidFlagResponse.json(), {
      error: 'enabled must be a boolean',
    });

    const invalidPushChannelResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        pushChannel: 'telegram',
      },
    });

    assert.equal(invalidPushChannelResponse.statusCode, 400);
    assert.deepEqual(invalidPushChannelResponse.json(), {
      error: 'pushChannel must be console or feishu_bot',
    });

    const invalidCronResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        digestCron: '0 18 * *',
      },
    });

    assert.equal(invalidCronResponse.statusCode, 400);
    assert.deepEqual(invalidCronResponse.json(), {
      error: 'digestCron must be a valid 5-field cron expression',
    });

    const invalidCronTokenResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        digestCron: '0 xx * * *',
      },
    });

    assert.equal(invalidCronTokenResponse.statusCode, 400);
    assert.deepEqual(invalidCronTokenResponse.json(), {
      error: 'digestCron must be a valid 5-field cron expression',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/config supports partial updates without resetting existing values', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({ database, logger: false, includeLegacyRoutes: false });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        ngaCookie: '',
        pollIntervalSeconds: 45,
        enabled: true,
        pushEnabled: true,
        pushChannel: 'console',
        pushWebhookUrl: '',
        pushSecret: '',
        digestEnabled: false,
        digestCron: '0 18 * * *',
        authors: ['Alpha', 'Beta'],
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        pushEnabled: false,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      data: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        ngaCookie: '',
        pollIntervalSeconds: 45,
        enabled: true,
        pushEnabled: false,
        pushChannel: 'console',
        pushWebhookUrl: '',
        pushSecret: '',
        digestEnabled: false,
        digestCron: '0 18 * * *',
        authors: ['Alpha', 'Beta'],
      },
    });
  } finally {
    await server.close();
    database.close();
  }
});
