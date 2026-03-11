import db from './db';
import { StockService, KlineData, StockInfo } from './stock';
import { SyncService } from './sync';
import { MovingAverageSkill } from '../skills/ma';
import { MACDSkill } from '../skills/macd';

export interface ScreenerResult {
  code: string;
  name: string;
  reason?: string;
  info?: any;
  history?: KlineData[]; // Recent 10 days kline
  indicators?: any;
}

export class ScreenerService {
  private stockService: StockService;
  private syncService: SyncService;
  private maSkill: MovingAverageSkill;
  private macdSkill: MACDSkill;

  constructor() {
    this.stockService = new StockService();
    this.syncService = new SyncService();
    this.maSkill = new MovingAverageSkill();
    this.macdSkill = new MACDSkill();
  }

  async sync(): Promise<void> {
      await this.syncService.syncDailyData();
  }

  getPool(): { code: string, name: string }[] {
      return db.prepare('SELECT code, name, updated_at FROM stocks ORDER BY updated_at DESC').all() as { code: string, name: string }[];
  }

  async search(strategy: string, params: any): Promise<ScreenerResult[]> {
    console.log(`[Screener] Executing strategy: ${strategy} with params:`, params);
    
    // Check freshness logic (same as before)
    const lastRow = db.prepare('SELECT date FROM kline_day ORDER BY date DESC LIMIT 1').get() as { date: string };
    
    let needsSync = true;
    if (lastRow && lastRow.date >= '2026-03-01') { 
        needsSync = false;
    }
    
    if (needsSync) {
        console.log(`[Screener] Data stale (Last: ${lastRow?.date}), syncing pool...`);
        await this.syncService.syncDailyData();
    }
    
    // Get all stocks from DB
    const stocks = db.prepare('SELECT code, name FROM stocks').all() as { code: string, name: string }[];
    console.log(`[Screener] Scanning ${stocks.length} stocks from local DB...`);
    
    const results: ScreenerResult[] = [];
    
    // FIX: Get LATEST 60 records by ordering DESC first, then reversing
    const stmtGetKline = db.prepare(`
        SELECT * FROM (
            SELECT * FROM kline_day 
            WHERE code = ? 
            ORDER BY date DESC 
            LIMIT 60
        ) ORDER BY date ASC
    `); 
    
    for (const stock of stocks) {
        const klines = stmtGetKline.all(stock.code) as any[];
        // Map and sort just in case
        const klineData: KlineData[] = klines.map(k => ({
            time: k.date,
            open: k.open,
            close: k.close,
            high: k.high,
            low: k.low,
            volume: k.volume
        })); // Already sorted by ASC in SQL
        
        if (this.checkStrategy(strategy, params, klineData)) {
            if (stock.code === 'sz002261') {
                console.log(`[Debug] Found sz002261. Last 5 klines:`);
                console.table(klineData.slice(-5));
            }

            const recentHistory = klineData.slice(-10); 
            
            const maRes = await this.maSkill.execute(klineData);
            const macdRes = await this.macdSkill.execute(klineData);
            
            results.push({
                code: stock.code,
                name: stock.name || stock.code,
                reason: this.getReason(strategy, params, klineData, null),
                history: recentHistory,
                indicators: {
                    ma: maRes.success ? maRes.data : null,
                    macd: macdRes.success ? macdRes.data : null
                }
            });
        }
    }

    console.log(`[Screener] Finished. Found ${results.length} matches.`);
    return results.slice(0, 50); 
  }

  // ... (rest of the file remains unchanged)
  private checkStrategy(strategy: string, params: any, kline: KlineData[]): boolean {
      const len = kline.length;
      if (len === 0) return false;
      
      switch (strategy) {
          case 'continuous_rise': {
              const days = params.days || 3;
              if (len < days + 1) return false;
              for (let i = 0; i < days; i++) {
                  const curr = kline[len - 1 - i];
                  const prev = kline[len - 2 - i];
                  if (curr.close <= prev.close) return false;
              }
              return true;
          }
          
          case 'continuous_fall': {
              const days = params.days || 3;
              if (len < days + 1) return false;
              for (let i = 0; i < days; i++) {
                  const curr = kline[len - 1 - i];
                  const prev = kline[len - 2 - i];
                  if (curr.close >= prev.close) return false;
              }
              return true;
          }
          
          case 'box_oscillation': {
              const days = params.days || 20;
              const amplitude = params.amplitude || 0.15;
              if (len < days) return false;
              
              const period = kline.slice(-days);
              const highs = period.map(k => k.high);
              const lows = period.map(k => k.low);
              const closes = period.map(k => k.close);
              
              const maxHigh = Math.max(...highs);
              const minLow = Math.min(...lows);
              const avgClose = closes.reduce((a, b) => a + b, 0) / days;
              
              const osc = (maxHigh - minLow) / avgClose;
              return osc <= amplitude;
          }
          
          case 'limit_up': {
              const days = params.days || 1;
              if (len < days + 1) return false;
              
              for (let i = 0; i < days; i++) {
                  const curr = kline[len - 1 - i];
                  const prev = kline[len - 2 - i];
                  const limit = prev.close * 1.095;
                  if (curr.close < limit) return false;
              }
              return true;
          }
          
          default:
              return false;
      }
  }

  private getReason(strategy: string, params: any, kline: KlineData[], info: StockInfo | null): string {
      switch (strategy) {
          case 'continuous_rise':
              return `连续 ${params.days || 3} 日上涨`;
          case 'continuous_fall':
              return `连续 ${params.days || 3} 日下跌`;
          case 'box_oscillation':
              return `近 ${params.days || 20} 日振幅 ${(params.amplitude || 0.15) * 100}% 以内`;
          case 'limit_up':
              return `连续 ${params.days || 1} 日涨停`;
          default:
              return '符合筛选条件';
      }
  }
}
