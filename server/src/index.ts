import fastify from 'fastify';
import cors from '@fastify/cors';
import { StockService } from './core/stock';
import { NewsService } from './core/news';
import { FundFlowService } from './core/fund';
import { LLMService } from './core/llm';
import { ScreenerService } from './core/screener';
import { SYSTEM_ANALYSIS_PROMPT } from './prompts/analysis';

const server = fastify({ logger: true });

// Enable CORS
server.register(cors, { 
  origin: true
});

const stockService = new StockService();
const newsService = new NewsService();
const fundFlowService = new FundFlowService();
const llmService = new LLMService();
const screenerService = new ScreenerService();

// --- API Routes ---

// 1. Get Stock Data (Sina)
server.get<{ Querystring: { codes: string } }>('/api/stock', async (request, reply) => {
  const codes = request.query.codes ? request.query.codes.split(',') : [];
  if (codes.length === 0) {
    return reply.code(400).send({ error: 'Missing codes parameter' });
  }
  const data = await stockService.getStockData(codes);
  return { data };
});

// 1.0 Get Stock Info (Fundamental)
server.get<{ Querystring: { code: string } }>('/api/stock/info', async (request, reply) => {
    const { code } = request.query;
    if (!code) return reply.code(400).send({ error: 'Missing code' });
    const data = await stockService.getStockInfo(code);
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

// 6. Agent Chat (Updated with Analysis)
server.post<{ Body: { message: string, model?: string } }>('/api/agent/chat', async (request, reply) => {
    const { message } = request.body;
    if (!message) return reply.code(400).send({ error: 'Missing message' });

    console.log(`[Agent] Received message: "${message}"`);
    
    // 1. Parse Intent with LLM
    const intent = await llmService.parseIntent(message);
    console.log(`[Agent] Intent parsed:`, intent);
    
    if (intent.type === 'screen' && intent.strategy) {
        // 2. Execute Screener Strategy
        const results = await screenerService.search(intent.strategy, intent.params || {});
        
        if (results.length === 0) {
            return {
                type: 'text',
                reply: `已为您筛选符合策略【${intent.strategy}】的股票，但暂无匹配结果。`,
                data: []
            };
        }

        // 3. Generate Deep Analysis using LLM
        // Limit to top 3 for analysis to avoid token limit
        const topResults = results.slice(0, 3);
        const analysisData = JSON.stringify(topResults);
        
        console.log(`[Agent] Generating analysis for ${topResults.length} stocks...`);
        const startTime = Date.now();
        
        const analysisReport = await llmService.chat([
            { role: 'system', content: SYSTEM_ANALYSIS_PROMPT },
            { role: 'user', content: `筛选策略：${intent.strategy}\n筛选结果数据：${analysisData}` }
        ]);
        
        const duration = Date.now() - startTime;
        console.log(`[Agent] Analysis generated in ${duration}ms`);

        return {
            type: 'screener_result',
            reply: analysisReport, // Markdown report
            data: results // Full list for UI rendering
        };
    } else {
        // Chat mode
        return {
            type: 'text',
            reply: intent.reply || '抱歉，我无法处理该请求。',
            data: null
        };
    }
});

// 7. Get Stock Pool
server.get('/api/stocks/pool', async (request, reply) => {
    const data = screenerService.getPool();
    return { code: 0, data };
});

// 8. Trigger Sync
server.post('/api/sync/trigger', async (request, reply) => {
    // Run sync asynchronously to avoid blocking
    screenerService.sync().catch(err => {
        console.error('[Sync] Manual trigger failed:', err);
    });
    return { status: 'ok', message: 'Sync started' };
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
        name: "get_stock_info",
        description: "Get stock fundamental info (PE, PB, MarketCap).",
        parameters: { code: "string" }
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
      },
      {
        name: "get_stock_pool",
        description: "Get the current dynamic stock pool (Top 100 active stocks).",
        parameters: {}
      },
      {
        name: "trigger_sync",
        description: "Trigger manual data synchronization from external sources.",
        parameters: {}
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
