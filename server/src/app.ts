import Database from 'better-sqlite3';
import cors from '@fastify/cors';
import fastify, { FastifyInstance } from 'fastify';
import { getDefaultDatabase } from './core/db';
import { NgaConnector } from './v0/forum/ngaConnector';
import { BigAMapPublicMapProvider } from './v0/market/bigamapProvider';
import { V0MarketDataProvider } from './v0/market/marketBinding';
import { registerV0Routes } from './v0/routes';

interface CreateServerOptions {
  database?: Database.Database;
  logger?: boolean;
  includeLegacyRoutes?: boolean;
  v0Connector?: NgaConnector;
  v0MarketDataProvider?: V0MarketDataProvider;
  v0BigAMapProvider?: BigAMapPublicMapProvider;
  v0SchedulerEnabled?: boolean;
  v0SchedulerNow?: () => Date;
  v0SchedulerPollIntervalMsOverride?: number;
  v0SchedulerDigestCheckIntervalMs?: number;
}

export const createServer = (options: CreateServerOptions = {}): FastifyInstance => {
  const server = fastify({ logger: options.logger ?? true });
  const database = options.database ?? getDefaultDatabase();

  server.register(cors, {
    origin: true,
  });

  registerV0Routes(server, {
    database,
    connector: options.v0Connector,
    marketDataProvider: options.v0MarketDataProvider,
    bigAMapProvider: options.v0BigAMapProvider,
    schedulerEnabled: options.v0SchedulerEnabled,
    schedulerNow: options.v0SchedulerNow,
    schedulerPollIntervalMsOverride: options.v0SchedulerPollIntervalMsOverride,
    schedulerDigestCheckIntervalMs: options.v0SchedulerDigestCheckIntervalMs,
  });

  if (options.includeLegacyRoutes === false) {
    return server;
  }

  const { StockService } = require('./core/stock') as typeof import('./core/stock');
  const { NewsService } = require('./core/news') as typeof import('./core/news');
  const { FundFlowService } = require('./core/fund') as typeof import('./core/fund');
  const { LLMService } = require('./core/llm') as typeof import('./core/llm');
  const { ScreenerService } = require('./core/screener') as typeof import('./core/screener');
  const { SYSTEM_ANALYSIS_PROMPT } =
    require('./prompts/analysis') as typeof import('./prompts/analysis');

  const stockService = new StockService();
  const newsService = new NewsService();
  const fundFlowService = new FundFlowService();
  const llmService = new LLMService();
  const screenerService = new ScreenerService();

  server.get<{ Querystring: { codes: string } }>('/api/stock', async (request, reply) => {
    const codes = request.query.codes ? request.query.codes.split(',') : [];
    if (codes.length === 0) {
      return reply.code(400).send({ error: 'Missing codes parameter' });
    }
    const data = await stockService.getStockData(codes);
    return { data };
  });

  server.get<{ Querystring: { code: string } }>('/api/stock/info', async (request, reply) => {
    const { code } = request.query;
    if (!code) return reply.code(400).send({ error: 'Missing code' });
    const data = await stockService.getStockInfo(code);
    return { data };
  });

  server.get<{ Querystring: { q: string } }>('/api/stock/search', async (request, reply) => {
    const q = request.query.q;
    if (!q) return { data: [] };
    const data = await stockService.getStockSuggest(q);
    return { data };
  });

  server.get<{ Querystring: { code: string; type: string } }>(
    '/api/stock/kline',
    async (request, reply) => {
      const { code, type } = request.query;
      if (!code) return reply.code(400).send({ error: 'Missing code' });
      const data = await stockService.getKlineData(code, type || 'day');
      return { data };
    }
  );

  server.get<{ Querystring: { code: string } }>('/api/stock/timeline', async (request, reply) => {
    const { code } = request.query;
    if (!code) return reply.code(400).send({ error: 'Missing code' });
    const data = await stockService.getTimelineData(code);
    return { data };
  });

  server.get<{ Querystring: { limit?: number } }>('/api/news', async (request) => {
    const limit = request.query.limit || 20;
    const data = await newsService.getFlashNews(Number(limit));
    return { data };
  });

  server.get<{ Querystring: { type?: string } }>('/api/fund/sector', async (request) => {
    const type = (request.query.type as any) || 'concept';
    const data = await fundFlowService.getSectorFundFlow(type);
    return { data };
  });

  server.get('/api/fund/hsgt', async () => {
    const data = await fundFlowService.getHSGTFlow();
    return { data };
  });

  server.post<{ Body: { message: string; model?: string } }>(
    '/api/agent/chat',
    async (request, reply) => {
      const { message } = request.body;
      if (!message) return reply.code(400).send({ error: 'Missing message' });

      console.log(`[Agent] Received message: "${message}"`);

      const intent = await llmService.parseIntent(message);
      console.log(`[Agent] Intent parsed:`, intent);

      if (intent.type === 'screen' && intent.strategy) {
        const results = await screenerService.search(intent.strategy, intent.params || {});

        if (results.length === 0) {
          return {
            type: 'text',
            reply: `已为您筛选符合策略【${intent.strategy}】的股票，但暂无匹配结果。`,
            data: [],
          };
        }

        const topResults = results.slice(0, 3);
        const analysisData = JSON.stringify(topResults);

        console.log(`[Agent] Generating analysis for ${topResults.length} stocks...`);
        const startTime = Date.now();

        const analysisReport = await llmService.chat([
          { role: 'system', content: SYSTEM_ANALYSIS_PROMPT },
          { role: 'user', content: `筛选策略：${intent.strategy}\n筛选结果数据：${analysisData}` },
        ]);

        const duration = Date.now() - startTime;
        console.log(`[Agent] Analysis generated in ${duration}ms`);

        return {
          type: 'screener_result',
          reply: analysisReport,
          data: results,
        };
      }

      return {
        type: 'text',
        reply: intent.reply || '抱歉，我无法处理该请求。',
        data: null,
      };
    }
  );

  server.get('/api/stocks/pool', async () => {
    const data = screenerService.getPool();
    return { code: 0, data };
  });

  server.post('/api/sync/trigger', async () => {
    screenerService.sync().catch((err) => {
      console.error('[Sync] Manual trigger failed:', err);
    });
    return { status: 'ok', message: 'Sync started' };
  });

  server.get('/manifest.json', async () => {
    return {
      name: 'StockClaw Agent',
      description: 'Real-time stock market data and news agent.',
      tools: [
        {
          name: 'get_stock_price',
          description: 'Get real-time stock price.',
          parameters: { codes: 'string (comma separated)' },
        },
        {
          name: 'get_stock_info',
          description: 'Get stock fundamental info (PE, PB, MarketCap).',
          parameters: { code: 'string' },
        },
        {
          name: 'get_market_news',
          description: 'Get latest market news.',
          parameters: { limit: 'number' },
        },
        {
          name: 'get_fund_flow',
          description: 'Get sector fund flow.',
          parameters: { type: 'string (concept|industry|region)' },
        },
        {
          name: 'get_stock_pool',
          description: 'Get the current dynamic stock pool (Top 100 active stocks).',
          parameters: {},
        },
        {
          name: 'trigger_sync',
          description: 'Trigger manual data synchronization from external sources.',
          parameters: {},
        },
      ],
    };
  });

  return server;
};
