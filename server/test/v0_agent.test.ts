import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { NgaConnector } from '../src/v0/forum/ngaConnector';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { toBeijingDateString } from '../src/v0/shared/authorIdentity';

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code === 'sz002261' ? '拓维信息' : '测试个股',
      price: '18.88',
      percent: '5.12',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 2.35,
      netInflow: 56000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: '上证指数',
      indexPercent: '-0.21',
      northboundNet: -12000000,
    };
  },
};

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-agent-'));
  return path.join(tempDir, 'agent.db');
};

const today = toBeijingDateString();

test('POST /api/v0/agent/query handles author summaries, stock status, validation and market analysis', async () => {
  process.env.LLM_BASE_URL = '';
  process.env.LLM_MODEL = '';
  process.env.LLM_EMBEDDING_BASE_URL = '';
  process.env.LLM_EMBEDDING_MODEL = '';
  process.env.LLM_EMBEDDING_FALLBACK_MODE = 'hash';

  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="1001" data-author="Alpha">
        <div class="post-time">${today} 09:31</div>
        <div class="content">黄线偏弱，机器人先观察。</div>
      </div>
      <div class="postrow" data-floor="1002" data-author="Alpha">
        <div class="post-time">${today} 09:36</div>
        <div class="content">拓维信息今天看看承接，回封再说。</div>
      </div>
      <div class="postrow" data-floor="1003" data-author="Beta">
        <div class="post-time">${today} 09:40</div>
        <div class="content">证券这边先看是否护盘。</div>
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
        threadUrl: 'https://nga.178.com/read.php?tid=agent',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 'Beta'],
      },
    });

    database.prepare('UPDATE v0_author_watchlist SET alias = ? WHERE author_name = ?').run('狼大', 'Alpha');

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const summaryResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: '今天 Alpha 说了什么？',
      },
    });
    const summaryBody = summaryResponse.json();

    assert.equal(summaryResponse.statusCode, 200);
    assert.equal(summaryBody.data.queryType, 'author_daily_summary');
    assert.equal(summaryBody.data.answer.length > 0, true);
    assert.equal(summaryBody.data.references.length >= 1, true);

    const stockResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: 'Alpha 提到的拓维信息现在怎么样？',
      },
    });
    const stockBody = stockResponse.json();

    assert.equal(stockResponse.statusCode, 200);
    assert.equal(stockBody.data.queryType, 'author_stock_status');
    assert.equal(stockBody.data.answer.length > 0, true);
    assert.equal(stockBody.data.references.length >= 1, true);

    const opinionResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: 'Alpha 说的黄线偏弱现在成立吗？',
      },
    });
    const opinionBody = opinionResponse.json();

    assert.equal(opinionResponse.statusCode, 200);
    assert.equal(opinionBody.data.queryType, 'opinion_validation');
    assert.equal(opinionBody.data.answer.length > 0, true);
    assert.equal(opinionBody.data.references.length >= 1, true);

    const marketResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: '分析一下今天A股走弱的原因吧，借助狼大的分析。',
      },
    });
    const marketBody = marketResponse.json();

    assert.equal(marketResponse.statusCode, 200);
    assert.equal(marketBody.data.queryType, 'market_analysis');
    assert.equal(marketBody.data.answer.length > 0, true);
    assert.equal(marketBody.data.references.length >= 1, true);

    const personaMarketResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: '分析一下5月15日A股走弱的原因吧 借助狼大的分析',
      },
    });
    const personaMarketBody = personaMarketResponse.json();

    assert.equal(personaMarketResponse.statusCode, 200);
    assert.equal(personaMarketBody.data.queryType, 'market_analysis');
    assert.match(personaMarketBody.data.answer, /历史画像|方法论|模拟推演/);

    const debugResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: '分析一下今天A股走弱的原因吧，借助狼大的分析。',
        debug: true,
      },
    });
    const debugBody = debugResponse.json();

    assert.equal(debugResponse.statusCode, 200);
    assert.equal(debugBody.data.debugTrace.plan.authorName, 'Alpha');
  } finally {
    await server.close();
    database.close();
  }
});
