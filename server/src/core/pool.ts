import { RankService } from './rank';

export class StockPool {
  private static instance: StockPool;
  private rankService: RankService;
  
  // Set to store unique stock codes
  private pool: Set<string> = new Set();
  
  // Static predefined pool (Blue chips)
  private static BLUE_CHIPS = [
    'sh600519', 'sz000858', 'sz300750', 'sh601318', 'sh600036', 
    'sz002594', 'sh601888', 'sz000651', 'sh601012', 'sz002415', 
    'sh600030', 'sh600887', 'sz002352', 'sh603288', 'sz002714', 
    'sh600276', 'sz000333', 'sh601166', 'sh601288', 'sz000001', 
    'sz000002', 'sh600000', 'sh601919', 'sh601899', 'sh600900'
  ];

  private constructor() {
    this.rankService = new RankService();
    // Initialize with blue chips
    StockPool.BLUE_CHIPS.forEach(code => this.pool.add(code));
  }

  public static getInstance(): StockPool {
    if (!StockPool.instance) {
      StockPool.instance = new StockPool();
    }
    return StockPool.instance;
  }

  /**
   * Refresh the dynamic pool by fetching latest rankings
   * This should be called periodically (e.g. every hour or manually)
   */
  async refreshPool(): Promise<number> {
    console.log('[StockPool] Refreshing dynamic pool...');
    const startSize = this.pool.size;
    
    try {
        // 1. Get Turnover Rank (Top 100)
        const turnoverList = await this.rankService.getTurnoverRank(100);
        turnoverList.forEach(s => this.pool.add(s.code));
        
        // 2. Get Volume Ratio Rank (Top 100)
        const volumeList = await this.rankService.getVolumeRatioRank(100);
        volumeList.forEach(s => this.pool.add(s.code));
        
        // Note: Popularity rank is harder to get via public API, skipping for now.
        
    } catch (e) {
        console.error('[StockPool] Failed to refresh:', e);
    }
    
    const endSize = this.pool.size;
    console.log(`[StockPool] Refreshed. Size: ${startSize} -> ${endSize}`);
    return endSize;
  }

  /**
   * Get all stocks in the pool
   */
  getStocks(): string[] {
    return Array.from(this.pool);
  }
  
  /**
   * Add a specific stock to pool (e.g. user query)
   */
  addStock(code: string) {
      this.pool.add(code);
  }
}
