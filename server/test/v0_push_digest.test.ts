import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { NgaConnector } from '../src/v0/forum/ngaConnector';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code === 'sz002261' ? '拓维信息' : '测试个股',
      price: '12.34',
      percent: '3.21',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 1.23,
      netInflow: 88000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: '上证指数',
      indexPercent: '0.56',
      northboundNet: 123000000,
    };
  },
};

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-push-digest-'));
  return path.join(tempDir, 'push-digest.db');
};

test('POST /api/v0/poll records push notifications for newly matched messages', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="801" data-author="Alpha">
        <div class="post-time">2026-05-13 13:01</div>
        <div class="content">拓维信息今天看看承接。</div>
      </div>
    </div>
  `;
  const connector: NgaConnector = {
    fetchThreadHtml: async () => html,
  };
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: connector,
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=push',
        pollIntervalSeconds: 60,
        pushEnabled: true,
        authors: ['Alpha'],
      },
    });

    const pollResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const pollBody = pollResponse.json();

    assert.equal(pollResponse.statusCode, 200);
    assert.equal(pollBody.data.pushedMessageCount, 1);
    assert.equal(pollBody.data.pushFailureCount, 0);

    const notificationsResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/notifications',
    });
    const notificationsBody = notificationsResponse.json();

    assert.equal(notificationsResponse.statusCode, 200);
    assert.equal(notificationsBody.data.length, 1);
    assert.equal(notificationsBody.data[0].status, 'success');
    assert.equal(notificationsBody.data[0].channel, 'console');

    const payload = JSON.parse(notificationsBody.data[0].payloadJson) as {
      authorName: string;
      rawContent: string;
      mentions: string[];
    };
    assert.equal(payload.authorName, 'Alpha');
    assert.equal(payload.rawContent, '拓维信息今天看看承接。');
    assert.equal(payload.mentions.includes('stock:拓维信息'), true);
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/digest/build creates a daily digest and GET /api/v0/digests returns it', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="901" data-author="Alpha">
        <div class="post-time">2026-05-13 13:11</div>
        <div class="content">黄线有点弱，机器人先看看。</div>
      </div>
      <div class="postrow" data-floor="902" data-author="Beta">
        <div class="post-time">2026-05-13 13:15</div>
        <div class="content">拓维信息如果回封再说。</div>
      </div>
    </div>
  `;
  const connector: NgaConnector = {
    fetchThreadHtml: async () => html,
  };
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: connector,
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=digest',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 'Beta'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const buildResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/digest/build',
      payload: {
        digestDate: '2026-05-13',
      },
    });
    const buildBody = buildResponse.json();

    assert.equal(buildResponse.statusCode, 200);
    assert.equal(buildBody.data.digestDate, '2026-05-13');
    assert.equal(buildBody.data.messageCount, 2);
    assert.equal(buildBody.data.contentMarkdown.includes('# V0 日报 2026-05-13'), true);
    assert.equal(buildBody.data.contentMarkdown.includes('## 按作者汇总'), true);
    assert.equal(buildBody.data.contentMarkdown.includes('机器人'), true);
    assert.equal(buildBody.data.contentMarkdown.includes('拓维信息如果回封再说。'), true);

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/digests',
    });
    const listBody = listResponse.json();

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].digestDate, '2026-05-13');
    assert.equal(listBody.data[0].status, 'success');
  } finally {
    await server.close();
    database.close();
  }
});
