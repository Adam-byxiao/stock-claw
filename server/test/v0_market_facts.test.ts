import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { BigAMapPublicMapProvider } from '../src/v0/market/bigamapProvider';
import { V0ExternalMarketFactsService } from '../src/v0/market/externalMarketFacts';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { V0MarketFactsService } from '../src/v0/market/marketFacts';
import { toBeijingDateString } from '../src/v0/shared/authorIdentity';

const fakeProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code === 'sz002261' ? '拓维信息' : code,
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-market-facts-'));
  return path.join(tempDir, 'market-facts.db');
};

const fakeBigAMapProvider: BigAMapPublicMapProvider = {
  async getPoints() {
    return {
      generated_at: '2026/05/20 15:11:25',
      quote_delay_notice: '行情数据为准实时快照，可能存在约 15 分钟延迟。',
      summary: {
        total_items: 4,
        fresh_items: 4,
        stale_items: 0,
        up_items: 2,
        down_items: 2,
        flat_items: 0,
      },
      items: [
        {
          code: '000001',
          name: '平安银行',
          market: 'SZ',
          province: '广东',
          industry: '银行',
          sw_level1_name: '银行',
          sw_level2_name: '股份制银行',
          latest_price: 10,
          change_percent: 1.5,
          amount: 100000000,
          volume: 1000000,
          quote_status: 'fresh',
        },
        {
          code: '000020',
          name: '深华发A',
          market: 'SZ',
          province: '广东',
          industry: '电子',
          sw_level1_name: '电子',
          sw_level2_name: '光学光电子',
          latest_price: 13.25,
          change_percent: -1.63,
          amount: 48335340,
          volume: 3644300,
          quote_status: 'fresh',
        },
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
          code: '600519',
          name: '贵州茅台',
          market: 'SH',
          province: '贵州',
          industry: '食品饮料',
          sw_level1_name: '食品饮料',
          sw_level2_name: '白酒',
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
          { board_code: '801159', board_name: '机器人概念', total_score: 45366 },
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
          {
            stock_code: '300069',
            stock_name: '金利华电',
            change_percent: 20,
            latest_price: 36.72,
            industry: '电网设备',
            sw_level1_name: '电力设备',
            sub_market: '创业板',
            market_segment: 'growth',
            limit_up_days: 1,
            first_limit_up_time: '09:25',
            last_limit_up_time: '09:25',
            sealed_amount: 539869190,
            break_board_count: 0,
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

test('V0MarketFactsService builds realtime overview stock and sector facts', async () => {
  const service = new V0MarketFactsService(fakeProvider);
  const facts = await service.buildFacts({
    queryDate: toBeijingDateString(),
    stocks: ['002261'],
    sectors: ['机器人'],
  });

  assert.equal(facts.isRealtime, true);
  assert.deepEqual(facts.requestedStocks, ['sz002261']);
  assert.deepEqual(facts.requestedSectors, ['机器人']);
  assert.equal(facts.facts.some((fact) => fact.kind === 'market_overview'), true);
  assert.equal(facts.facts.some((fact) => fact.kind === 'stock_snapshot'), true);
  assert.equal(facts.facts.some((fact) => fact.kind === 'sector_snapshot'), true);
  assert.equal(facts.citations.length, facts.facts.length);
});

test('V0ExternalMarketFactsService normalizes BigAMap points rankings and limit board', async () => {
  const service = new V0ExternalMarketFactsService(fakeBigAMapProvider);
  const response = await service.buildFacts({
    queryDate: toBeijingDateString(),
    topN: 3,
  });

  assert.equal(response.provider, 'bigamap');
  assert.equal(response.sources.length, 3);
  assert.equal(response.sources.every((source) => source.status === 'success'), true);
  assert.equal(response.facts.some((fact) => fact.kind === 'external_market_overview'), true);
  assert.equal(response.facts.some((fact) => fact.kind === 'external_sector_strength'), true);
  assert.equal(response.facts.some((fact) => fact.kind === 'external_limit_board'), true);
  assert.equal(response.citations.every((citation) => citation.source === 'bigamap'), true);
  assert.equal(
    response.facts.some((fact) => fact.summary.includes('15 分钟延迟')),
    true
  );
});

test('V0MarketFactsService can merge BigAMap facts into realtime facts', async () => {
  const service = new V0MarketFactsService(
    fakeProvider,
    new V0ExternalMarketFactsService(fakeBigAMapProvider)
  );
  const facts = await service.buildFacts({
    queryDate: toBeijingDateString(),
    stocks: ['002261'],
    sectors: ['芯片'],
  });

  assert.equal(facts.facts.some((fact) => fact.citationId.startsWith('bigamap-')), true);
  assert.equal(facts.externalSources?.length, 3);
  assert.equal(facts.citations.some((citation) => citation.source === 'bigamap'), true);
});

test('V0MarketFactsService marks historical date boundary without realtime snapshots', async () => {
  const service = new V0MarketFactsService(fakeProvider);
  const facts = await service.buildFacts({
    queryDate: '2026-01-01',
    stocks: ['sz002261'],
    sectors: ['机器人'],
  });

  assert.equal(facts.isRealtime, false);
  assert.equal(facts.facts.some((fact) => fact.kind === 'not_realtime'), true);
  assert.equal(facts.facts.some((fact) => fact.kind === 'stock_snapshot'), false);
  assert.equal(facts.missingInputs.some((item) => item.includes('历史行情快照')), true);
});

test('GET /api/v0/market/facts returns normalized realtime facts', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0MarketDataProvider: fakeProvider,
    v0BigAMapProvider: fakeBigAMapProvider,
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v0/market/facts?queryDate=${toBeijingDateString()}&stocks=002261&sectors=机器人`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.requestedStocks[0], 'sz002261');
    assert.equal(body.data.facts.some((fact: { kind: string }) => fact.kind === 'stock_snapshot'), true);
  } finally {
    await server.close();
    database.close();
  }
});

test('GET /api/v0/market/external-facts returns BigAMap normalized facts', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0MarketDataProvider: fakeProvider,
    v0BigAMapProvider: fakeBigAMapProvider,
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v0/market/external-facts?queryDate=${toBeijingDateString()}&topN=3`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.provider, 'bigamap');
    assert.equal(body.data.facts.some((fact: { kind: string }) => fact.kind === 'external_stock_strength'), true);
    assert.equal(body.data.citations.some((citation: { source: string }) => citation.source === 'bigamap'), true);
  } finally {
    await server.close();
    database.close();
  }
});

test('GET /api/v0/market/external-facts rejects invalid topN', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0MarketDataProvider: fakeProvider,
    v0BigAMapProvider: fakeBigAMapProvider,
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v0/market/external-facts?topN=99',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'topN must be an integer from 1 to 20');
  } finally {
    await server.close();
    database.close();
  }
});

test('GET /api/v0/market/facts rejects invalid queryDate', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0MarketDataProvider: fakeProvider,
  });

  try {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v0/market/facts?queryDate=2026/05/18',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'queryDate must match YYYY-MM-DD');
  } finally {
    await server.close();
    database.close();
  }
});
