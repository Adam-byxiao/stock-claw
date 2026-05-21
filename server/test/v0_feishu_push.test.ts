import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import {
  createFeishuBotSignature,
  FeishuBotPushChannel,
  FeishuBotPushError,
} from '../src/v0/push/feishuBotChannel';
import { NgaConnector } from '../src/v0/forum/ngaConnector';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { V0PushService } from '../src/v0/push/pushService';
import { initV0Tables } from '../src/v0/shared/init';

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: '拓维信息',
      price: '13.01',
      percent: '2.56',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 1.1,
      netInflow: 18000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: '上证指数',
      indexPercent: '0.22',
      northboundNet: 3000000,
    };
  },
};

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-feishu-'));
  return path.join(tempDir, 'feishu.db');
};

test('createFeishuBotSignature returns a deterministic signature', () => {
  const signature = createFeishuBotSignature('1700000000', 'demo-secret');
  assert.equal(typeof signature, 'string');
  assert.equal(signature.length > 0, true);
});

test('FeishuBotPushChannel posts webhook payload with signature fields', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;

  const channel = new FeishuBotPushChannel({
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
    secret: 'demo-secret',
    httpClient: {
      post: async (url, body) => {
        capturedUrl = url;
        capturedBody = body as Record<string, unknown>;
        return { data: { ok: true } } as any;
      },
    },
  });

  await channel.send({
    authorName: 'Alpha',
    postedAt: '2026-05-14 10:30',
    sourceUrl: 'https://nga.178.com/read.php?tid=demo',
    rawContent: '拓维信息先观察。',
    mentions: ['stock:拓维信息'],
    marketSummaries: ['拓维信息 当前 13.01 元，涨跌幅 2.56%。'],
  });

  assert.equal(capturedUrl, 'https://open.feishu.cn/open-apis/bot/v2/hook/demo');
  assert.equal(capturedBody?.msg_type, 'text');
  assert.equal(typeof capturedBody?.timestamp, 'string');
  assert.equal(typeof capturedBody?.sign, 'string');
});

test('FeishuBotPushChannel maps Feishu keyword validation errors', async () => {
  const channel = new FeishuBotPushChannel({
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
    httpClient: {
      post: async () => {
        return {
          data: {
            code: 19024,
            msg: 'Key Words Not Found',
          },
        } as any;
      },
    },
  });

  await assert.rejects(
    async () =>
      channel.send({
        authorName: 'Alpha',
        postedAt: '2026-05-14 10:31',
        sourceUrl: 'https://nga.178.com/read.php?tid=demo',
        rawContent: '拓维信息先观察。',
        mentions: ['stock:拓维信息'],
        marketSummaries: [],
      }),
    (error: unknown) => {
      assert.equal(error instanceof FeishuBotPushError, true);
      assert.equal((error as FeishuBotPushError).message, 'feishu webhook keyword check failed: Key Words Not Found');
      assert.equal((error as FeishuBotPushError).details.reason, 'keyword_not_found');
      assert.equal((error as FeishuBotPushError).details.retryable, false);
      assert.equal((error as FeishuBotPushError).details.feishuCode, 19024);
      return true;
    }
  );
});

test('FeishuBotPushChannel maps timeout errors as retryable', async () => {
  const channel = new FeishuBotPushChannel({
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
    httpClient: {
      post: async () => {
        const error = new Error('timeout') as Error & { isAxiosError: boolean; code: string };
        error.isAxiosError = true;
        error.code = 'ECONNABORTED';
        throw error;
      },
    },
  });

  await assert.rejects(
    async () =>
      channel.send({
        authorName: 'Alpha',
        postedAt: '2026-05-14 10:31',
        sourceUrl: 'https://nga.178.com/read.php?tid=demo',
        rawContent: '拓维信息先观察。',
        mentions: [],
        marketSummaries: [],
      }),
    (error: unknown) => {
      assert.equal(error instanceof FeishuBotPushError, true);
      assert.equal((error as FeishuBotPushError).message, 'feishu webhook request timed out');
      assert.equal((error as FeishuBotPushError).details.reason, 'timeout');
      assert.equal((error as FeishuBotPushError).details.retryable, true);
      return true;
    }
  );
});

test('V0PushService stores mapped Feishu errors into notification history', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  initV0Tables(database);
  const pushService = new V0PushService(database, {
    createChannel() {
      return {
        channelName: 'feishu_bot',
        async send() {
          throw new FeishuBotPushError('feishu webhook rate limit exceeded: too many requests', {
            reason: 'rate_limited',
            retryable: true,
            feishuCode: 11232,
            feishuMessage: 'too many requests',
          });
        },
      };
    },
  });

  try {
    const result = await pushService.sendMessageNotification(
      {
        pushChannel: 'feishu_bot',
        pushWebhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
        pushSecret: '',
      },
      1,
      {
        floorId: '1',
        authorName: 'Alpha',
        postedAt: '2026-05-14 10:50',
        rawContent: '测试推送',
        normalizedContent: '测试推送',
        sourceUrl: 'https://nga.178.com/read.php?tid=demo',
      },
      [],
      []
    );

    const notifications = pushService.getRecentNotifications();

    assert.equal(result, 'failed');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].channel, 'feishu_bot');
    assert.equal(notifications[0].status, 'failed');
    assert.equal(
      notifications[0].errorMessage,
      'feishu webhook rate limit exceeded: too many requests'
    );
  } finally {
    database.close();
  }
});

test('POST /api/v0/poll records failed feishu notification when webhook is missing', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1301" data-author="Alpha">
        <div class="post-time">2026-05-14 10:40</div>
        <div class="content">拓维信息今天继续观察。</div>
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
        threadUrl: 'https://nga.178.com/read.php?tid=feishu',
        pollIntervalSeconds: 60,
        pushEnabled: true,
        pushChannel: 'feishu_bot',
        pushWebhookUrl: '',
        authors: ['Alpha'],
      },
    });

    const pollResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const pollBody = pollResponse.json();

    assert.equal(pollResponse.statusCode, 200);
    assert.equal(pollBody.data.pushedMessageCount, 0);
    assert.equal(pollBody.data.pushFailureCount, 1);

    const notificationsResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/notifications',
    });
    const notificationsBody = notificationsResponse.json();

    assert.equal(notificationsBody.data[0].channel, 'feishu_bot');
    assert.equal(notificationsBody.data[0].status, 'failed');
    assert.equal(notificationsBody.data[0].errorMessage, 'feishu webhook url is required');
  } finally {
    await server.close();
    database.close();
  }
});
