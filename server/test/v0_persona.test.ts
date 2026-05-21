import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { NgaConnector } from '../src/v0/forum/ngaConnector';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { toBeijingDateString } from '../src/v0/shared/time';

process.env.LLM_BASE_URL = '';
process.env.LLM_MODEL = '';
process.env.LLM_API_KEY = '';
process.env.LLM_EMBEDDING_BASE_URL = '';
process.env.LLM_EMBEDDING_MODEL = '';
process.env.LLM_EMBEDDING_FALLBACK_MODE = 'hash';

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-persona-'));
  return path.join(tempDir, 'persona.db');
};

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code,
      price: '10.00',
      percent: '1.23',
    };
  },
  async getSectorSnapshot(name: string) {
    return {
      name,
      changePercent: 1.5,
      netInflow: 1000000,
    };
  },
  async getMarketOverview() {
    return {
      indexName: 'market',
      indexPercent: '0.12',
      northboundNet: 0,
    };
  },
};

test('v0 persona indexes messages and rebuilds an author profile', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const today = toBeijingDateString();
  const html = `
    <div class="thread">
      <div class="postrow" data-floor="2001" data-author="Alpha">
        <div class="post-time">${today} 09:31</div>
        <div class="content">今天先看机器人和黄线承接，弱转强不确认就不追。</div>
      </div>
      <div class="postrow" data-floor="2002" data-author="Alpha">
        <div class="post-time">${today} 10:10</div>
        <div class="content">拓维信息只看回封质量，量能不够就继续等。</div>
      </div>
      <div class="postrow" data-floor="2003" data-author="Beta">
        <div class="post-time">${today} 10:15</div>
        <div class="content">证券这里先观察护盘。</div>
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
        threadUrl: 'https://nga.178.com/read.php?tid=persona',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 'Beta'],
      },
    });

    const pollResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    assert.equal(pollResponse.statusCode, 200);

    const chunkCount = database
      .prepare('SELECT COUNT(*) AS count FROM v0_message_chunks')
      .get() as { count: number };
    assert.equal(chunkCount.count, 3);

    const rebuildResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/persona/profile/rebuild',
      payload: {
        authorName: 'Alpha',
        force: true,
        axisTopK: 1,
      },
    });
    const rebuildBody = rebuildResponse.json();

    assert.equal(rebuildResponse.statusCode, 200);
    assert.equal(rebuildBody.data.authorName, 'Alpha');
    assert.equal(rebuildBody.data.profile.status, 'ready');
    assert.equal(rebuildBody.data.profile.sourceMessageCount, 2);
    assert.equal(rebuildBody.data.evidence.length > 0, true);
    assert.equal(rebuildBody.data.profile.profileVersion, 2);
    const profileJson = JSON.parse(rebuildBody.data.profile.profileJson);
    assert.equal(profileJson.schemaVersion, 2);
    assert.equal(Array.isArray(profileJson.marketMethodology.reasoningSteps), true);
    assert.equal(Array.isArray(profileJson.agenticProtocol.analysisSteps), true);
    assert.equal(typeof profileJson.evidenceQuality.confidence, 'number');
    assert.equal(rebuildBody.data.evidence.some((item: any) => item.bucket), true);

    const successEmbeddingCount = database
      .prepare("SELECT COUNT(*) AS count FROM v0_message_embeddings WHERE status = 'success'")
      .get() as { count: number };
    assert.equal(successEmbeddingCount.count >= 2, true);

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/persona/profiles/Alpha',
    });
    assert.equal(getResponse.statusCode, 200);

    const agentResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/agent/query',
      payload: {
        query: 'Alpha 的思想画像是什么',
      },
    });
    const agentBody = agentResponse.json();

    assert.equal(agentResponse.statusCode, 200);
    assert.equal(agentBody.data.queryType, 'author_profile');
    assert.equal(agentBody.data.references.length > 0, true);
  } finally {
    await server.close();
    database.close();
  }
});
