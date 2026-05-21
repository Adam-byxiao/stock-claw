import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createAppDatabase } from '../src/core/db';
import { createServer } from '../src/app';
import { V0MessageParser } from '../src/v0/forum/messageParser';
import { NgaConnector, NgaFetchOptions } from '../src/v0/forum/ngaConnector';
import { V0MarketDataProvider } from '../src/v0/market/marketBinding';
import { buildThreadKey } from '../src/v0/forum/threadKey';

class StubNgaConnector implements NgaConnector {
  constructor(private readonly html: string) {}

  async fetchThreadHtml(_threadUrl: string): Promise<string> {
    return this.html;
  }
}

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-claw-v0-poll-'));
  return path.join(tempDir, 'poll.db');
};

const sampleHtml = `
  <div class="thread">
    <span data-floor="ignore-me">not-a-post-container</span>
    <div class="postrow" data-floor="101" data-author="Alpha">
      <div class="post-time">2026-05-13 09:31</div>
      <div class="content">黄线有点弱，先看看机器人回流。</div>
    </div>
    <div class="postrow" data-floor="102" data-author="Beta">
      <div class="post-time">2026-05-13 09:33</div>
      <div class="content">
        关注拓维信息，
        <div class="quote">这是引用内容，应被忽略</div>
        看看能不能弱转强。
      </div>
    </div>
  </div>
`;

test('V0MessageParser extracts structured forum messages from thread html', () => {
  const parser = new V0MessageParser();
  const messages = parser.parseThreadHtml(sampleHtml, 'https://nga.178.com/read.php?tid=123');

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    floorId: '101',
    authorName: 'Alpha',
    postedAt: '2026-05-13 09:31',
    rawContent: '黄线有点弱，先看看机器人回流。',
    normalizedContent: '黄线有点弱，先看看机器人回流。',
    sourceUrl: 'https://nga.178.com/read.php?tid=123',
  });

  assert.equal(messages[1].floorId, '102');
  assert.equal(messages[1].authorName, 'Beta');
  assert.equal(messages[1].rawContent.includes('引用内容'), false);
  assert.equal(messages[1].normalizedContent, '关注拓维信息， 看看能不能弱转强。');
});

test('V0MessageParser preserves DOM order when mixed container selectors are present', () => {
  const parser = new V0MessageParser();
  const mixedHtml = `
    <div class="thread">
      <div class="post-container" id="post_201">
        <div class="author">Alpha</div>
        <div class="post-time">2026-05-13 09:35</div>
        <div class="content">先看证券有没有护盘。</div>
      </div>
      <div class="postrow" data-floor="202" data-author="Beta">
        <div class="post-time">2026-05-13 09:36</div>
        <div class="content">再看机器人是否回流。</div>
      </div>
    </div>
  `;

  const messages = parser.parseThreadHtml(mixedHtml, 'https://nga.178.com/read.php?tid=456');

  assert.equal(messages.length, 2);
  assert.equal(messages[0].authorName, 'Alpha');
  assert.equal(messages[1].authorName, 'Beta');
});

test('POST /api/v0/poll rejects polling when thread url is not configured', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(sampleHtml),
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'threadUrl is required before polling',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll archives all messages while reporting whitelisted author matches', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(sampleHtml),
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        pollIntervalSeconds: 60,
        authors: ['Beta'],
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(body, {
      data: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        matchedAuthorCount: 1,
        totalMessages: 2,
        matchedMessages: [
          {
            floorId: '102',
            authorName: 'Beta',
            postedAt: '2026-05-13 09:33',
            rawContent: '关注拓维信息， 看看能不能弱转强。',
            normalizedContent: '关注拓维信息， 看看能不能弱转强。',
            sourceUrl: 'https://nga.178.com/read.php?tid=123',
          },
        ],
        newMessageCount: 2,
        duplicateMessageCount: 0,
        pushedMessageCount: 1,
        pushFailureCount: 0,
        fetchedAt: body.data.fetchedAt,
      },
    });

    const storedMessages = database
      .prepare(
        `SELECT
          floor_id AS floorId,
          author_name AS authorName
        FROM v0_forum_messages
        ORDER BY id ASC`
      )
      .all() as Array<{ floorId: string; authorName: string }>;

    assert.deepEqual(storedMessages, [
      { floorId: '101', authorName: 'Alpha' },
      { floorId: '102', authorName: 'Beta' },
    ]);

    const cursor = database
      .prepare(
        `SELECT
          thread_key AS threadKey,
          last_floor_id AS lastFloorId
        FROM v0_thread_cursors
        WHERE thread_key = ?`
      )
      .get(buildThreadKey('https://nga.178.com/read.php?tid=123')) as {
        threadKey: string;
        lastFloorId: string;
      };

    assert.deepEqual(cursor, {
      threadKey: buildThreadKey('https://nga.178.com/read.php?tid=123'),
      lastFloorId: '102',
    });

    const snapshot = database
      .prepare(
        `SELECT
          thread_key AS threadKey,
          thread_url AS threadUrl,
          parsed_message_count AS parsedMessageCount,
          LENGTH(html_content) AS htmlLength
        FROM v0_thread_snapshots
        ORDER BY id DESC
        LIMIT 1`
      )
      .get() as {
        threadKey: string;
        threadUrl: string;
        parsedMessageCount: number;
        htmlLength: number;
      };

    assert.equal(snapshot.threadKey, buildThreadKey('https://nga.178.com/read.php?tid=123'));
    assert.equal(snapshot.threadUrl, 'https://nga.178.com/read.php?tid=123');
    assert.equal(snapshot.parsedMessageCount, 2);
    assert.equal(snapshot.htmlLength > 0, true);
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll does not insert duplicates on repeated polling', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(sampleHtml),
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 'Beta'],
      },
    });

    const firstResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const firstBody = firstResponse.json();

    assert.equal(firstBody.data.newMessageCount, 2);
    assert.equal(firstBody.data.duplicateMessageCount, 0);

    const secondResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const secondBody = secondResponse.json();

    assert.equal(secondBody.data.newMessageCount, 0);
    assert.equal(secondBody.data.duplicateMessageCount, 2);

    const countRow = database
      .prepare('SELECT COUNT(*) AS total FROM v0_forum_messages')
      .get() as { total: number };

    assert.equal(countRow.total, 2);
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll uses first page for metadata but archives latest pages only by default', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const firstPageHtml = `
    <div class="thread">
      <script>var __PAGE = {0:'/read.php?tid=multi',1:40,2:1,3:20};</script>
      <div class="postrow" data-floor="1" data-author="Alpha">
        <div class="post-time">2026-05-13 09:31</div>
        <div class="content">第一页 Alpha。</div>
      </div>
      <div class="postrow" data-floor="2" data-author="Beta">
        <div class="post-time">2026-05-13 09:32</div>
        <div class="content">第一页 Beta。</div>
      </div>
    </div>
  `;
  const fetchedUrls: string[] = [];
  const buildPageHtml = (pageNumber: number): string => `
    <div class="thread">
      <div class="postrow" data-floor="${pageNumber * 10}" data-author="${pageNumber === 40 ? 'Alpha' : 'Gamma'}">
        <div class="post-time">2026-05-13 10:${pageNumber}</div>
        <div class="content">Page ${pageNumber} content.</div>
      </div>
    </div>
  `;
  const connector: NgaConnector = {
    async fetchThreadHtml(threadUrl: string) {
      fetchedUrls.push(threadUrl);
      const pageMatch = threadUrl.match(/[?&]page=(\d+)/);
      if (!pageMatch) {
        return firstPageHtml;
      }

      return buildPageHtml(Number(pageMatch[1]));
    },
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
        threadUrl: 'https://nga.178.com/read.php?tid=multi&rand=123',
        pollIntervalSeconds: 60,
        pushEnabled: false,
        authors: ['Alpha'],
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(fetchedUrls, [
      'https://nga.178.com/read.php?tid=multi',
      'https://nga.178.com/read.php?tid=multi&page=36',
      'https://nga.178.com/read.php?tid=multi&page=37',
      'https://nga.178.com/read.php?tid=multi&page=38',
      'https://nga.178.com/read.php?tid=multi&page=39',
      'https://nga.178.com/read.php?tid=multi&page=40',
    ]);
    assert.equal(body.data.totalMessages, 5);
    assert.equal(body.data.newMessageCount, 5);
    assert.equal(body.data.matchedMessages.length, 1);
    assert.deepEqual(
      body.data.matchedMessages.map((message: { floorId: string }) => message.floorId),
      ['400']
    );

    const storedRows = database
      .prepare(
        `SELECT floor_id AS floorId, source_url AS sourceUrl
         FROM v0_forum_messages
         ORDER BY CAST(floor_id AS INTEGER) ASC`
      )
      .all() as Array<{ floorId: string; sourceUrl: string }>;

    assert.deepEqual(
      storedRows.map((row) => row.floorId),
      ['360', '370', '380', '390', '400']
    );
    assert.equal(storedRows[0].sourceUrl, 'https://nga.178.com/read.php?tid=multi&page=36');

    const snapshotCount = database
      .prepare('SELECT COUNT(*) AS total FROM v0_thread_snapshots')
      .get() as { total: number };
    assert.equal(snapshotCount.total, 5);
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll supports configurable from-start and page-range strategies', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const fetchedUrls: string[] = [];
  const firstPageHtml = `
    <div class="thread">
      <script>var __PAGE = {0:'/read.php?tid=strategy',1:40,2:1,3:20};</script>
      <div class="postrow" data-floor="1" data-author="Alpha">
        <div class="post-time">2026-05-13 09:31</div>
        <div class="content">Page 1 content.</div>
      </div>
    </div>
  `;
  const buildPageHtml = (pageNumber: number): string => `
    <div class="thread">
      <div class="postrow" data-floor="${pageNumber * 10}" data-author="Alpha">
        <div class="post-time">2026-05-13 10:${pageNumber}</div>
        <div class="content">Page ${pageNumber} content.</div>
      </div>
    </div>
  `;
  const connector: NgaConnector = {
    async fetchThreadHtml(threadUrl: string) {
      fetchedUrls.push(threadUrl);
      const pageMatch = threadUrl.match(/[?&]page=(\d+)/);
      return pageMatch ? buildPageHtml(Number(pageMatch[1])) : firstPageHtml;
    },
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
        threadUrl: 'https://nga.178.com/read.php?tid=strategy',
        pollIntervalSeconds: 60,
        pushEnabled: false,
        authors: ['Alpha'],
      },
    });

    const fromStartResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
      payload: { crawlMode: 'from_start', maxPages: 3 },
    });
    assert.equal(fromStartResponse.statusCode, 200);
    assert.equal(fromStartResponse.json().data.totalMessages, 3);

    const rangeResponse = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
      payload: { crawlMode: 'range', pageStart: 12, pageEnd: 13 },
    });
    assert.equal(rangeResponse.statusCode, 200);
    assert.equal(rangeResponse.json().data.totalMessages, 2);

    assert.deepEqual(fetchedUrls, [
      'https://nga.178.com/read.php?tid=strategy',
      'https://nga.178.com/read.php?tid=strategy&page=2',
      'https://nga.178.com/read.php?tid=strategy&page=3',
      'https://nga.178.com/read.php?tid=strategy',
      'https://nga.178.com/read.php?tid=strategy&page=12',
      'https://nga.178.com/read.php?tid=strategy&page=13',
    ]);
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll preserves authorid view and passes configured NGA cookie', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const fetched: Array<{ threadUrl: string; cookie: string }> = [];
  const connector: NgaConnector = {
    async fetchThreadHtml(threadUrl: string, options?: NgaFetchOptions) {
      fetched.push({ threadUrl, cookie: options?.cookie ?? '' });
      return `
        <div class="thread">
          <script>var __PAGE = {0:'/read.php?tid=45974302&authorid=150058',1:1,2:1,3:20};</script>
          <div class="postrow" data-floor="1" data-author="UID:150058">
            <div class="post-time">2026-05-13 09:31</div>
            <div class="content">Author-only content.</div>
          </div>
        </div>
      `;
    },
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
        threadUrl: 'https://bbs.nga.cn/read.php?tid=45974302&authorid=150058&rand=401',
        ngaCookie: 'ngaPassportUid=150058; ngaPassportCid=demo',
        pollIntervalSeconds: 60,
        pushEnabled: false,
        authors: ['UID:150058'],
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(fetched, [
      {
        threadUrl: 'https://bbs.nga.cn/read.php?tid=45974302&authorid=150058',
        cookie: 'ngaPassportUid=150058; ngaPassportCid=demo',
      },
    ]);
    assert.equal(body.data.totalMessages, 1);
    assert.equal(body.data.matchedMessages[0].sourceUrl, fetched[0].threadUrl);
    assert.equal(buildThreadKey(body.data.threadUrl), buildThreadKey(fetched[0].threadUrl));
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll updates same floor message instead of inserting a duplicate', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const initialHtml = `
    <div class="thread">
      <div class="postrow" data-floor="301" data-author="Alpha">
        <div class="post-time">2026-05-13 09:41</div>
        <div class="content">先看黄线。</div>
      </div>
    </div>
  `;
  const updatedHtml = `
    <div class="thread">
      <div class="postrow" data-floor="301" data-author="Alpha">
        <div class="post-time">2026-05-13 09:42</div>
        <div class="content">先看黄线，题材还得再等等。</div>
      </div>
    </div>
  `;

  let currentHtml = initialHtml;
  const mutableConnector: NgaConnector = {
    fetchThreadHtml: async () => currentHtml,
  };

  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: mutableConnector,
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=789',
        pollIntervalSeconds: 60,
        authors: ['Alpha'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    currentHtml = updatedHtml;

    const responseAfterUpdate = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const body = responseAfterUpdate.json();
    assert.equal(body.data.newMessageCount, 0);
    assert.equal(body.data.duplicateMessageCount, 1);

    const countRow = database
      .prepare('SELECT COUNT(*) AS total FROM v0_forum_messages WHERE thread_key = ? AND floor_id = ?')
      .get(buildThreadKey('https://nga.178.com/read.php?tid=789'), '301') as { total: number };
    assert.equal(countRow.total, 1);

    const updatedRow = database
      .prepare(
        `SELECT
          posted_at AS postedAt,
          normalized_content AS normalizedContent,
          is_new AS isNew,
          insight_status AS insightStatus
        FROM v0_forum_messages
        WHERE thread_key = ? AND floor_id = ?`
      )
      .get(buildThreadKey('https://nga.178.com/read.php?tid=789'), '301') as {
        postedAt: string;
        normalizedContent: string;
        isNew: number;
        insightStatus: string;
      };

    assert.deepEqual(updatedRow, {
      postedAt: '2026-05-13 09:42',
      normalizedContent: '先看黄线，题材还得再等等。',
      isNew: 1,
      insightStatus: 'success',
    });

    const messageResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/messages',
    });
    const messageBody = messageResponse.json();

    assert.equal(messageBody.data[0].floorId, '301');
    assert.equal(messageBody.data[0].isNew, true);
  } finally {
    await server.close();
    database.close();
  }
});

test('polling a different thread url with the same floor id creates a separate stored message', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const connectorA = new StubNgaConnector(`
    <div class="thread">
      <div class="postrow" data-floor="501" data-author="Alpha">
        <div class="post-time">2026-05-13 10:01</div>
        <div class="content">线程 A 内容。</div>
      </div>
    </div>
  `);
  const connectorB = new StubNgaConnector(`
    <div class="thread">
      <div class="postrow" data-floor="501" data-author="Alpha">
        <div class="post-time">2026-05-13 10:02</div>
        <div class="content">线程 B 内容。</div>
      </div>
    </div>
  `);

  const serverA = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: connectorA,
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await serverA.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=aaa',
        pollIntervalSeconds: 60,
        authors: ['Alpha'],
      },
    });

    await serverA.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });
  } finally {
    await serverA.close();
  }

  const serverB = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: connectorB,
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await serverB.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=bbb',
        pollIntervalSeconds: 60,
        authors: ['Alpha'],
      },
    });

    await serverB.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const rows = database
      .prepare(
        `SELECT
          thread_key AS threadKey,
          floor_id AS floorId,
          normalized_content AS normalizedContent
        FROM v0_forum_messages
        WHERE floor_id = '501'
        ORDER BY id ASC`
      )
      .all() as Array<{ threadKey: string; floorId: string; normalizedContent: string }>;

    assert.equal(rows.length, 2);
    assert.deepEqual(rows, [
      {
        threadKey: buildThreadKey('https://nga.178.com/read.php?tid=aaa'),
        floorId: '501',
        normalizedContent: '线程 A 内容。',
      },
      {
        threadKey: buildThreadKey('https://nga.178.com/read.php?tid=bbb'),
        floorId: '501',
        normalizedContent: '线程 B 内容。',
      },
    ]);
  } finally {
    await serverB.close();
    database.close();
  }
});

test('POST /api/v0/poll returns 409 when thread polling is disabled', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(sampleHtml),
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        threadTitle: '盘中观察贴',
        pollIntervalSeconds: 60,
        enabled: false,
        authors: ['Alpha'],
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: 'thread polling is disabled',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('GET /api/v0/messages returns recent persisted messages in reverse order', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(sampleHtml),
    v0MarketDataProvider: fakeMarketDataProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=123',
        pollIntervalSeconds: 60,
        authors: ['Alpha', 'Beta'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v0/messages',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].authorName, 'Beta');
    assert.equal(body.data[1].authorName, 'Alpha');
    assert.equal(body.data[0].isNew, true);
    assert.equal(Array.isArray(body.data[0].mentions), true);
    assert.equal(Array.isArray(body.data[0].marketStates), true);

    const secondResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/messages',
    });
    const secondBody = secondResponse.json();
    assert.equal(secondBody.data[0].isNew, false);

    const limitedResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/messages?limit=1',
    });
    const limitedBody = limitedResponse.json();
    assert.equal(limitedResponse.statusCode, 200);
    assert.equal(limitedBody.data.length, 1);

    const invalidLimitResponse = await server.inject({
      method: 'GET',
      url: '/api/v0/messages?limit=0',
    });
    assert.equal(invalidLimitResponse.statusCode, 400);
    assert.deepEqual(invalidLimitResponse.json(), {
      error: 'limit must be an integer from 1 to 10000',
    });
  } finally {
    await server.close();
    database.close();
  }
});

test('POST /api/v0/poll retries insight enrichment for duplicate messages after previous failure', async () => {
  const database = createAppDatabase(createTempDatabasePath());
  let shouldFail = true;
  const flakyMarketProvider: V0MarketDataProvider = {
    async getStockSnapshot(code: string) {
      if (shouldFail) {
        throw new Error('stock snapshot unavailable');
      }

      return {
        code,
        name: '拓维信息',
        price: '11.22',
        percent: '1.05',
      };
    },
    async getSectorSnapshot(name: string) {
      return {
        name,
        changePercent: 0.5,
        netInflow: 1000000,
      };
    },
    async getMarketOverview() {
      return {
        indexName: '上证指数',
        indexPercent: '0.12',
      };
    },
  };

  const html = `
    <div class="thread">
      <div class="postrow" data-floor="701" data-author="Alpha">
        <div class="post-time">2026-05-13 11:08</div>
        <div class="content">拓维信息今天先观察。</div>
      </div>
    </div>
  `;

  const server = createServer({
    database,
    logger: false,
    includeLegacyRoutes: false,
    v0Connector: new StubNgaConnector(html),
    v0MarketDataProvider: flakyMarketProvider,
  });

  try {
    await server.inject({
      method: 'POST',
      url: '/api/v0/config',
      payload: {
        threadUrl: 'https://nga.178.com/read.php?tid=retry',
        pollIntervalSeconds: 60,
        authors: ['Alpha'],
      },
    });

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const failedRow = database
      .prepare(
        `SELECT
          insight_status AS insightStatus
        FROM v0_forum_messages
        WHERE floor_id = '701'`
      )
      .get() as { insightStatus: string };

    assert.equal(failedRow.insightStatus, 'failed');

    shouldFail = false;

    await server.inject({
      method: 'POST',
      url: '/api/v0/poll',
    });

    const recoveredRow = database
      .prepare(
        `SELECT
          insight_status AS insightStatus,
          enriched_at AS enrichedAt
        FROM v0_forum_messages
        WHERE floor_id = '701'`
      )
      .get() as { insightStatus: string; enrichedAt: string | null };

    assert.equal(recoveredRow.insightStatus, 'success');
    assert.equal(Boolean(recoveredRow.enrichedAt), true);
  } finally {
    await server.close();
    database.close();
  }
});
