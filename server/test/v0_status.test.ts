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
      price: '16.66',
      percent: '2.18',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 0.88,
      netInflow: 26000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: '上证指数',
      indexPercent: '0.16',
      northboundNet: 23000000,
    };
  },
};

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-status-'));
  return path.join(tempDir, 'status.db');
};

test('GET /api/v0/messages/:id returns stored message detail with insights', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1101" data-author="Alpha">
        <div class="post-time">2026-05-14 10:01</div>
        <div class="content">黄线偏弱，拓维信息先观察。</div>
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
        threadUrl: 'https://nga.178.com/read.php?tid=status-detail',
        pollIntervalSeconds: 60,
        authors: ['Alpha'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const messagesResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/messages',
    });
    const messagesBody = messagesResponse.json();
    const messageId = messagesBody.data[0].id;

    const detailResponse = await server.inject({
      method: 'GET',
      url: `/api/v0/messages/${messageId}`,
    });
    const detailBody = detailResponse.json();

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailBody.data.id, messageId);
    assert.equal(detailBody.data.authorName, 'Alpha');
    assert.equal(detailBody.data.rawContent, '黄线偏弱，拓维信息先观察。');
    assert.equal(detailBody.data.mentions.length > 0, true);
    assert.equal(detailBody.data.marketStates.length > 0, true);
  } finally {
    await server.close();
    database.close();
  }
});

test('GET /api/v0/jobs/status returns integration summary after poll and digest build', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1201" data-author="Alpha">
        <div class="post-time">2026-05-14 10:11</div>
        <div class="content">机器人今天先看回流。</div>
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
        threadUrl: 'https://nga.178.com/read.php?tid=status-job',
        threadTitle: '状态联调贴',
        pollIntervalSeconds: 45,
        pushEnabled: true,
        authors: ['Alpha'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/digest/build',
      payload: {
        digestDate: '2026-05-14',
      },
    });

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/status',
    });
    const statusBody = statusResponse.json();
    const jobRunsResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/runs',
    });
    const jobRunsBody = jobRunsResponse.json();

    assert.equal(statusResponse.statusCode, 200);
    assert.equal(jobRunsResponse.statusCode, 200);
    assert.equal(statusBody.data.threadTitle, '状态联调贴');
    assert.equal(statusBody.data.pollIntervalSeconds, 45);
    assert.equal(statusBody.data.pushChannel, 'console');
    assert.equal(statusBody.data.digestEnabled, false);
    assert.equal(statusBody.data.digestCron, '0 18 * * *');
    assert.equal(statusBody.data.totalStoredMessages, 1);
    assert.equal(statusBody.data.unreadMessageCount, 1);
    assert.equal(statusBody.data.lastNotificationStatus, 'success');
    assert.equal(statusBody.data.lastDigestDate, '2026-05-14');
    assert.equal(statusBody.data.schedulerEnabled, false);
    assert.equal(statusBody.data.schedulerRunning, false);
    assert.equal(statusBody.data.pollJobActive, false);
    assert.equal(statusBody.data.digestJobActive, false);
    assert.equal(statusBody.data.lastPollRun.status, 'success');
    assert.equal(statusBody.data.lastDigestRun.status, 'success');
    assert.equal(jobRunsBody.data.length, 2);
    assert.equal(jobRunsBody.data[0].jobType, 'build_digest');
    assert.equal(jobRunsBody.data[1].jobType, 'poll_thread');
    assert.equal(Boolean(statusBody.data.lastMessageAt), true);
    assert.equal(Boolean(statusBody.data.lastNotificationAt), true);
    assert.equal(Boolean(statusBody.data.lastDigestAt), true);
  } finally {
    await server.close();
    database.close();
  }
});

test('scheduler runtime becomes active when V0 scheduler is enabled', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1301" data-author="Alpha">
        <div class="post-time">2026-05-14 10:12</div>
        <div class="content">机器人回流先看一眼。</div>
      </div>
    </div>
  `;
  const connector: NgaConnector = {
    fetchThreadHtml: async () => html,
  };
  const fixedNow = () => new Date(2026, 4, 14, 10, 12, 0, 0);
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: connector,
    v0MarketDataProvider: fakeMarketDataProvider,
    v0SchedulerEnabled: true,
    v0SchedulerNow: fixedNow,
    v0SchedulerPollIntervalMsOverride: 20,
    v0SchedulerDigestCheckIntervalMs: 20,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=scheduler-runtime',
        pollIntervalSeconds: 30,
        digestEnabled: true,
        digestCron: '12 10 * * *',
        authors: ['Alpha'],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/status',
    });
    const statusBody = statusResponse.json();
    const runsResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/runs',
    });
    const runsBody = runsResponse.json();

    assert.equal(statusResponse.statusCode, 200);
    assert.equal(runsResponse.statusCode, 200);
    assert.equal(statusBody.data.schedulerEnabled, true);
    assert.equal(statusBody.data.schedulerRunning, true);
    assert.equal(statusBody.data.pollJobActive, true);
    assert.equal(statusBody.data.digestJobActive, true);
    assert.equal(Boolean(statusBody.data.nextPollAt), true);
    assert.equal(Boolean(statusBody.data.lastDigestRun), true);
    assert.equal(runsBody.data.some((run: { jobType: string; triggerSource: string }) => run.jobType === 'build_digest' && run.triggerSource === 'scheduler'), true);
    assert.equal(runsBody.data.some((run: { jobType: string; triggerSource: string }) => run.jobType === 'poll_thread' && run.triggerSource === 'scheduler'), true);
  } finally {
    await server.close();
    database.close();
  }
});

test('scheduler runtime can be started and stopped through API', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1401" data-author="Alpha">
        <div class="post-time">2026-05-14 10:20</div>
        <div class="content">机器人继续看承接。</div>
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
    v0SchedulerPollIntervalMsOverride: 20,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=scheduler-control',
        pollIntervalSeconds: 600,
        authors: ['Alpha'],
      },
    });

    const initialStatusResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/status',
    });
    const initialStatusBody = initialStatusResponse.json();

    assert.equal(initialStatusBody.data.schedulerEnabled, false);
    assert.equal(initialStatusBody.data.schedulerRunning, false);
    assert.equal(initialStatusBody.data.pollJobActive, false);

    const startResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/jobs/scheduler/start',
    });
    const startBody = startResponse.json();

    assert.equal(startResponse.statusCode, 200);
    assert.equal(startBody.data.schedulerEnabled, true);
    assert.equal(startBody.data.schedulerRunning, true);
    assert.equal(startBody.data.pollJobActive, true);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const runsResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/jobs/runs',
    });
    const runsBody = runsResponse.json();

    assert.equal(runsBody.data.some((run: { jobType: string; triggerSource: string }) => run.jobType === 'poll_thread' && run.triggerSource === 'scheduler'), true);

    const stopResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/jobs/scheduler/stop',
    });
    const stopBody = stopResponse.json();

    assert.equal(stopResponse.statusCode, 200);
    assert.equal(stopBody.data.schedulerEnabled, false);
    assert.equal(stopBody.data.schedulerRunning, false);
    assert.equal(stopBody.data.pollJobActive, false);
  } finally {
    await server.close();
    database.close();
  }
});
