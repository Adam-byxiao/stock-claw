import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { NgaConnector } from '../src/v0/forum/ngaConnector';
import { BigAMapPublicMapProvider } from '../src/v0/market/bigamapProvider';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';

process.env.LLM_BASE_URL = '';
process.env.LLM_MODEL = '';
process.env.LLM_API_KEY = '';
process.env.LLM_EMBEDDING_BASE_URL = '';
process.env.LLM_EMBEDDING_MODEL = '';
process.env.LLM_EMBEDDING_FALLBACK_MODE = 'hash';

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-persona-inference-'));
  return path.join(tempDir, 'persona-inference.db');
};

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code === 'sz002261' ? '拓维信息' : code,
      price: '10.00',
      percent: '1.00',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 1.0,
      netInflow: 100000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: 'market',
      indexPercent: '0.10',
      northboundNet: 0,
    };
  },
};

const fakeBigAMapProvider: BigAMapPublicMapProvider = {
  async getPoints() {
    return {
      generated_at: '2026/05/20 15:11:25',
      quote_delay_notice: '行情数据为准实时快照，可能存在约 15 分钟延迟。',
      summary: {
        total_items: 3,
        fresh_items: 3,
        stale_items: 0,
        up_items: 1,
        down_items: 2,
        flat_items: 0,
      },
      items: [
        {
          code: '688001',
          name: '华兴源创',
          market: 'SH',
          province: '江苏',
          industry: '电子',
          sw_level1_name: '电子',
          sw_level2_name: '半导体',
          latest_price: 26,
          change_percent: 3.2,
          amount: 180000000,
          volume: 5000000,
          quote_status: 'fresh',
        },
        {
          code: '002421',
          name: '达实智能',
          market: 'SZ',
          province: '广东',
          industry: '计算机',
          sw_level1_name: '计算机',
          latest_price: 4.27,
          change_percent: -1.2,
          amount: 120000000,
          volume: 10000000,
          quote_status: 'fresh',
        },
        {
          code: '600519',
          name: '贵州茅台',
          market: 'SH',
          province: '贵州',
          industry: '食品饮料',
          sw_level1_name: '食品饮料',
          latest_price: 1500,
          change_percent: -0.8,
          amount: 300000000,
          volume: 200000,
          quote_status: 'fresh',
        },
      ],
    };
  },
  async getMaximizedRankings() {
    return {
      latest_trade_date: '2026-05-20',
      default_selection: {
        trade_date: '2026-05-20',
        board_code: '801001',
        board_name: '芯片',
      },
      rolling_rankings: {
        top7: [
          { board_code: '801001', board_name: '芯片', total_score: 91238 },
          { board_code: '801807', board_name: '算力', total_score: 43925 },
        ],
      },
    };
  },
  async getLimitUpReview() {
    return {
      trade_date: '2026-05-20',
      generated_at: '2026/05/20 15:07:59',
      limit_up: {
        title: '涨停板',
        items: [
          {
            stock_code: '002421',
            stock_name: '达实智能',
            change_percent: 10.05,
            latest_price: 4.27,
            industry: 'IT服务Ⅱ',
            sw_level1_name: '计算机',
            sub_market: '深证主板',
            market_segment: 'main',
            limit_up_days: 4,
            first_limit_up_time: '09:25',
            last_limit_up_time: '10:00',
            sealed_amount: 130102736,
            break_board_count: 8,
          },
        ],
      },
      limit_down: {
        title: '跌停板',
        items: [],
      },
    };
  },
};

const createPersonaInferenceServer = async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="3001" data-author="Alpha">
        <div class="post-time">2026-05-15 09:31</div>
        <div class="content">白线在上黄线在下放量就不要买，先看市场结构。</div>
      </div>
      <div class="postrow" data-floor="3002" data-author="Alpha">
        <div class="post-time">2026-05-15 10:10</div>
        <div class="content">行情不好先降仓位，机器人和算力只看承接，不确认不追。</div>
      </div>
      <div class="postrow" data-floor="3003" data-author="Alpha">
        <div class="post-time">2026-05-15 14:20</div>
        <div class="content">指数接近高点时，每一次诱多大红K都要按减法处理。</div>
      </div>
      <div class="postrow" data-floor="3005" data-author="Alpha">
        <div class="post-time">2026-05-16 09:40</div>
        <div class="content">最近重点还是看半导体和算力主线，板块回流只看承接，不放量不追。</div>
      </div>
      <div class="postrow" data-floor="3006" data-author="Alpha">
        <div class="post-time">2026-05-16 10:15</div>
        <div class="content">仓位先防守，指数没趋势的时候，机器人这种低位方向只做观察。</div>
      </div>
      <div class="postrow" data-floor="3004" data-author="Beta">
        <div class="post-time">2026-05-15 14:30</div>
        <div class="content">证券先观察。</div>
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
    v0BigAMapProvider: fakeBigAMapProvider,
  });

  await server.inject({
    method: 'POST',
    url: '/api/v0/config',
    payload: {
      threadUrl: 'https://nga.178.com/read.php?tid=persona-inference',
      pollIntervalSeconds: 60,
      authors: ['Alpha', 'Beta'],
    },
  });
  database.prepare('UPDATE v0_author_watchlist SET alias = ? WHERE author_name = ?').run('狼大', 'Alpha');

  await server.inject({
    method: 'POST',
    url: '/api/v0/poll',
  });

  await server.inject({
    method: 'POST',
    url: '/api/v0/persona/profile/rebuild',
    payload: {
      authorName: 'Alpha',
      force: true,
      version: 2,
      fullHistory: true,
      evidencePoolSize: 120,
    },
  });

  return { server, database };
};

test('POST /api/v0/agent/persona-inference returns structured fallback inference', async () => {
  const { server, database } = await createPersonaInferenceServer();

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/persona-inference',
      payload: {
        query: '分析一下长鑫存储 IPO 传闻和5月18日大盘策略，借助狼大的分析',
        authorName: 'Alpha',
        queryDate: '2026-05-18',
        eventText: '长鑫存储 IPO 传闻影响半导体和存储板块。',
        stockHints: ['sz002261'],
        sectorHints: ['算力'],
        debug: true,
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.authorName, 'Alpha');
    assert.equal(body.data.queryDate, '2026-05-18');
    assert.equal(typeof body.data.summary, 'string');
    assert.equal(body.data.methodologyBasis.length > 0, true);
    assert.equal(body.data.currentFacts.some((item: string) => item.includes('2026-05-18')), true);
    assert.equal(body.data.currentFacts.some((item: string) => item.includes('暂无作者直接发言')), true);
    assert.equal(body.data.missingInputs.some((item: string) => item.includes('指定日期没有作者直接发言')), true);
    assert.equal(body.data.scenarioSimulations.length, 3);
    assert.equal(body.data.scenarioSimulations[0].triggerConditions.length > 0, true);
    assert.equal(body.data.evidencePack.buckets.length > 0, true);
    assert.equal(body.data.evidenceCitations.length > 0, true);
    assert.equal(body.data.marketFacts.facts.length > 0, true);
    assert.equal(body.data.recentWeight.recentSignals.length > 0, true);
    assert.equal(body.data.recentWeight.recentFocus.length > 0, true);
    assert.equal(
      body.data.evidenceCitations.some((item: { source: string }) => item.source === 'market_fact'),
      true
    );
    assert.equal(
      body.data.evidenceCitations.some((item: { source: string }) => item.source === 'external_market_fact'),
      true
    );
    assert.equal(
      body.data.evidenceCitations.some((item: { source: string }) => item.source === 'profile_evidence'),
      true
    );
    assert.equal(typeof body.data.markdown, 'string');
    assert.equal(body.data.debugTrace.plan.authorName, 'Alpha');
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/persona/recent-weights returns recent overlay on top of full profile', async () => {
  const { server, database } = await createPersonaInferenceServer();

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/persona/recent-weights',
      payload: {
        query: 'Alpha 最近内容权重怎么变化',
        authorName: 'Alpha',
        queryDate: '2026-05-18',
        sampleSize: 12,
        debug: true,
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.authorName, 'Alpha');
    assert.equal(body.data.sampleSize, 12);
    assert.equal(typeof body.data.baselineSummary, 'string');
    assert.equal(body.data.recentSignals.length > 0, true);
    assert.equal(body.data.recentEvidence.length > 0, true);
    assert.equal(body.data.methodologyBasis.some((item: string) => item.includes('长期画像')), true);
    assert.equal(body.data.missingInputs.some((item: string) => item.includes('近期权重是内容频率')), true);
    assert.equal(typeof body.data.markdown, 'string');
    assert.equal(body.data.debugTrace.plan.authorName, 'Alpha');
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/agent/persona-inference rejects unknown author and invalid payloads', async () => {
  const { server, database } = await createPersonaInferenceServer();

  try {
    const unknownAuthorResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/persona-inference',
      payload: {
        query: '完全没有作者名的泛泛问题',
      },
    });
    assert.equal(unknownAuthorResponse.statusCode, 400);

    const invalidDateResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/persona-inference',
      payload: {
        query: 'Alpha 怎么看',
        authorName: 'Alpha',
        queryDate: '2026/05/18',
      },
    });
    assert.equal(invalidDateResponse.statusCode, 400);
    assert.equal(invalidDateResponse.json().error, 'queryDate must match YYYY-MM-DD');

    const invalidHintsResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/persona-inference',
      payload: {
        query: 'Alpha 怎么看',
        authorName: 'Alpha',
        stockHints: ['sz002261', 123],
      },
    });
    assert.equal(invalidHintsResponse.statusCode, 400);
    assert.equal(invalidHintsResponse.json().error, 'stockHints must be an array of strings');

    const invalidRecentWeightResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/persona/recent-weights',
      payload: {
        query: 'Alpha 最近怎么看',
        authorName: 'Alpha',
        sampleSize: 999,
      },
    });
    assert.equal(invalidRecentWeightResponse.statusCode, 400);
    assert.equal(invalidRecentWeightResponse.json().error, 'sampleSize must be an integer from 1 to 80');
  } finally {
    await server.close();
    database.close();
  }
});
