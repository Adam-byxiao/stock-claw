import fastify from 'fastify';
import cors from '@fastify/cors';
import { StockService } from './core/stock';
import { NewsService } from './core/news';
import { FundFlowService } from './core/fund';

const server = fastify({ logger: true });

// Enable CORS
server.register(cors, { 
  origin: true
});

const stockService = new StockService();
const newsService = new NewsService();
const fundFlowService = new FundFlowService();

// --- API Routes ---

// 1. Get Stock Data
server.get<{ Querystring: { codes: string } }>('/api/stock', async (request, reply) => {
  const codes = request.query.codes ? request.query.codes.split(',') : [];
  if (codes.length === 0) {
    return reply.code(400).send({ error: 'Missing codes parameter' });
  }
  const data = await stockService.getStockData(codes);
  return { data };
});

// 1.1 Search Stock
server.get<{ Querystring: { q: string } }>('/api/stock/search', async (request, reply) => {
    const q = request.query.q;
    if (!q) return { data: [] };
    const data = await stockService.getStockSuggest(q);
    return { data };
});

// 1.2 Get Kline Data
server.get<{ Querystring: { code: string, type: string } }>('/api/stock/kline', async (request, reply) => {
    const { code, type } = request.query;
    if (!code) return reply.code(400).send({ error: 'Missing code' });
    const data = await stockService.getKlineData(code, type || 'day');
    return { data };
});

// 1.3 Get Timeline Data
server.get<{ Querystring: { code: string } }>('/api/stock/timeline', async (request, reply) => {
    const { code } = request.query;
    if (!code) return reply.code(400).send({ error: 'Missing code' });
    const data = await stockService.getTimelineData(code);
    return { data };
});

// 2. Get Flash News
server.get<{ Querystring: { limit?: number } }>('/api/news', async (request, reply) => {
  const limit = request.query.limit || 20;
  const data = await newsService.getFlashNews(Number(limit));
  return { data };
});

// 3. Get Sector Fund Flow
server.get<{ Querystring: { type?: string } }>('/api/fund/sector', async (request, reply) => {
  const type = (request.query.type as any) || 'concept';
  const data = await fundFlowService.getSectorFundFlow(type);
  return { data };
});

// 4. Get HSGT Flow
server.get('/api/fund/hsgt', async (request, reply) => {
  const data = await fundFlowService.getHSGTFlow();
  return { data };
});

// 5. OpenClaw Agent Manifest (Optional, for auto-discovery)
server.get('/manifest.json', async (request, reply) => {
  return {
    name: "StockClaw Agent",
    description: "Real-time stock market data and news agent.",
    tools: [
      {
        name: "get_stock_price",
        description: "Get real-time stock price.",
        parameters: { codes: "string (comma separated)" }
      },
      {
        name: "get_market_news",
        description: "Get latest market news.",
        parameters: { limit: "number" }
      },
      {
        name: "get_fund_flow",
        description: "Get sector fund flow.",
        parameters: { type: "string (concept|industry|region)" }
      }
    ]
  };
});

const start = async () => {
  try {
    const port = 3001;
    // Fastify v4 listen syntax: { port: number, host: string }
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
