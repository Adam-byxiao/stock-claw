import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V0MessageEnricher } from '../src/v0/forum/messageEnricher';
import { V0MarketBindingService, V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { V0ParsedForumMessage } from '../src/v0/shared/types';

const baseMessage: V0ParsedForumMessage = {
  floorId: '9001',
  authorName: 'Alpha',
  postedAt: '2026-05-13 10:30',
  rawContent: '黄线偏弱，机器人和拓维信息(002261)先观察。',
  normalizedContent: '黄线偏弱，机器人和拓维信息(002261)先观察。',
  sourceUrl: 'https://nga.178.com/read.php?tid=test',
};

const fakeProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code === 'sz002261' ? '拓维信息' : '未知个股',
      price: '15.66',
      percent: '4.20',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 1.8,
      netInflow: 120000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: '上证指数',
      indexPercent: '0.33',
      northboundNet: 99800000,
    };
  },
};

test('V0MessageEnricher extracts stock sector and yellow line mentions', () => {
  const enricher = new V0MessageEnricher();
  const mentions = enricher.extractMentions(baseMessage);

  assert.deepEqual(
    mentions.map((mention) => ({
      entityType: mention.entityType,
      entityName: mention.entityName,
      normalizedCode: mention.normalizedCode,
    })),
    [
      { entityType: 'stock', entityName: '002261', normalizedCode: 'sz002261' },
      { entityType: 'sector', entityName: '机器人', normalizedCode: null },
      { entityType: 'yellow_line', entityName: '黄线', normalizedCode: null },
    ]
  );
});

test('V0MarketBindingService builds market summaries for recognized mentions', async () => {
  const enricher = new V0MessageEnricher();
  const marketBindingService = new V0MarketBindingService(fakeProvider);
  const mentions = enricher.extractMentions(baseMessage);

  const marketStates = await marketBindingService.buildMarketStates(baseMessage, mentions);

  assert.equal(marketStates.length, 3);
  assert.equal(marketStates.some((state) => state.subjectType === 'stock'), true);
  assert.equal(marketStates.some((state) => state.subjectType === 'sector'), true);
  assert.equal(marketStates.some((state) => state.subjectType === 'yellow_line'), true);

  const stockState = marketStates.find((state) => state.subjectType === 'stock');
  assert.equal(stockState?.summaryText.includes('涨跌幅 4.20%'), true);
  assert.equal(stockState?.adviceText.includes('短线偏强'), true);

  const sectorState = marketStates.find((state) => state.subjectType === 'sector');
  assert.equal(sectorState?.summaryText.includes('机器人'), true);

  const yellowLineState = marketStates.find((state) => state.subjectType === 'yellow_line');
  assert.equal(yellowLineState?.adviceText.includes('V0 暂以指数强弱替代直连黄白线数据'), true);
});
