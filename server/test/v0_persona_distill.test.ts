import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { toBeijingISOString } from '../src/v0/shared/time';

process.env.LLM_BASE_URL = '';
process.env.LLM_MODEL = '';
process.env.LLM_API_KEY = '';
process.env.LLM_EMBEDDING_BASE_URL = '';
process.env.LLM_EMBEDDING_MODEL = '';
process.env.LLM_EMBEDDING_FALLBACK_MODE = 'hash';

const createTempDatabasePath = (): string => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-distill-'));
  return path.join(tempDir, 'distill.db');
};

const fakeMarketDataProvider: V0MarketDataProvider = {
  async getStockSnapshot(code: string) {
    return {
      code,
      name: code,
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

test('v0 persona distill bootstraps legacy messages and builds profiles', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const now = toBeijingISOString();
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0MarketDataProvider: fakeMarketDataProvider,
  });
  const rows = [
    {
      threadKey: 'legacy-thread',
      floorId: '1001',
      authorName: 'Alpha',
      postedAt: '2026-05-15 09:31',
      rawContent: '先看机器人承接，弱转强不确认就不追。',
    },
    {
      threadKey: 'legacy-thread',
      floorId: '1002',
      authorName: 'Alpha',
      postedAt: '2026-05-15 10:12',
      rawContent: '拓维信息只看回封质量，量能不够继续等。',
    },
    {
      threadKey: 'legacy-thread',
      floorId: '1003',
      authorName: 'Beta',
      postedAt: '2026-05-15 10:20',
      rawContent: '证券先观察护盘。',
    },
  ];

  for (const row of rows) {
    database
      .prepare(
        `INSERT INTO v0_forum_messages (
          thread_key,
          floor_id,
          author_name,
          posted_at,
          raw_content,
          normalized_content,
          content_hash,
          source_url,
          is_new,
          insight_status,
          insight_error,
          enriched_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', '', NULL, ?)`
      )
      .run(
        row.threadKey,
        row.floorId,
        row.authorName,
        row.postedAt,
        row.rawContent,
        row.rawContent,
        crypto.createHash('sha256').update(`${row.threadKey}|${row.floorId}`).digest('hex'),
        'https://nga.178.com/read.php?tid=legacy',
        now
      );
  }

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/persona/distill',
      payload: {
        bootstrap: true,
      },
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.bootstrapped, true);
    assert.equal(body.data.indexedMessageCount, 3);
    assert.equal(body.data.processedAuthors, 2);
    assert.equal(body.data.profiles.length, 2);

    const chunkCount = database
      .prepare('SELECT COUNT(*) AS count FROM v0_message_chunks')
      .get() as { count: number };
    const profileCount = database
      .prepare('SELECT COUNT(*) AS count FROM v0_author_profiles')
      .get() as { count: number };

    assert.equal(chunkCount.count > 0, true);
    assert.equal(profileCount.count, 2);

    const profileResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/persona/profiles/Alpha',
    });
    assert.equal(profileResponse.statusCode, 200);

    const profileBody = profileResponse.json();
    assert.equal(profileBody.data.authorName, 'Alpha');
    assert.equal(profileBody.data.profile.status, 'ready');
    assert.equal(profileBody.data.profile.profileVersion, 2);
    const profileJson = JSON.parse(profileBody.data.profile.profileJson);
    assert.equal(profileJson.schemaVersion, 2);
    assert.equal(Array.isArray(profileJson.coreRules), true);
    assert.equal(profileBody.data.evidence.length > 2, true);
  } finally {
    await server.close();
    database.close();
  }
});
