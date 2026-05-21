import db from './db';
import { StockService } from './stock';
import { RankService } from './rank';
import { toBeijingISOString } from '../v0/shared/time';

export class SyncService {
  private stockService: StockService;
  private rankService: RankService;

  constructor() {
    this.stockService = new StockService();
    this.rankService = new RankService();
  }

  /**
   * Sync stocks to local DB.
   * Scope:
   * 1. Top active stocks (Turnover/Volume Rank)
   * 2. All stocks already in DB (to ensure we update historical candidates)
   */
  async syncDailyData() {
    console.log('[Sync] Starting daily sync task...');
    
    // 1. Get Active Stocks List
    const syncMap = new Map<string, string>(); // code -> name
    
    try {
        // Fetch fresh ranks
        const turnover = await this.rankService.getTurnoverRank(200);
        turnover.forEach(s => syncMap.set(s.code, s.name));
        
        const volume = await this.rankService.getVolumeRatioRank(100);
        volume.forEach(s => syncMap.set(s.code, s.name));
        
        // Add Blue chips
        const blueChips = [
            'sh600519', 'sz000858', 'sz300750', 'sh601318', 'sh600036', 
            'sz002594', 'sh601888', 'sz000651', 'sh601012', 'sz002415'
        ];
        blueChips.forEach(c => {
            if (!syncMap.has(c)) syncMap.set(c, c);
        });

        // Add existing stocks from DB to ensure continuity
        const existing = db.prepare('SELECT code, name FROM stocks').all() as { code: string, name: string }[];
        existing.forEach(s => {
            if (!syncMap.has(s.code)) {
                syncMap.set(s.code, s.name);
            }
        });
        
    } catch (e) {
        console.error('[Sync] Failed to fetch ranks:', e);
    }
    
    const pool = Array.from(syncMap.entries());
    console.log(`[Sync] Target pool size: ${pool.length}. Checking for sz002261: ${syncMap.has('sz002261')}`);
    
    // 2. Batch Sync K-line
    const batchSize = 10;
    let syncedCount = 0;
    
    const stmtInsertStock = db.prepare('INSERT OR REPLACE INTO stocks (code, name, updated_at) VALUES (?, ?, ?)');
    const stmtInsertKline = db.prepare('INSERT OR REPLACE INTO kline_day (code, date, open, close, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)');
    
    // Use transaction for speed
    const insertMany = db.transaction((klines: any[], code: string, name: string) => {
        stmtInsertStock.run(code, name, toBeijingISOString());
        for (const k of klines) {
            stmtInsertKline.run(code, k.time, k.open, k.close, k.high, k.low, k.volume);
        }
    });

    for (let i = 0; i < pool.length; i += batchSize) {
        const batch = pool.slice(i, i + batchSize);
        console.log(`[Sync] Syncing batch ${i / batchSize + 1}/${Math.ceil(pool.length / batchSize)}...`);
        
        await Promise.all(batch.map(async ([code, name]) => {
            try {
                // Get K-line (Day)
                const kline = await this.stockService.getKlineData(code, 'day');
                if (!kline || kline.length === 0) return;
                
                let finalName = name;
                // If name is missing or just code, try to fetch info (lazy)
                if (!finalName || finalName === code) {
                     // Only fetch if really needed to save time
                     // For now, keep it simple.
                }
                
                insertMany(kline, code, finalName);
                syncedCount++;
            } catch (e) {
                console.error(`[Sync] Failed to sync ${code}:`, e);
            }
        }));
    }
    
    console.log(`[Sync] Completed. Synced ${syncedCount} stocks.`);
  }
}
