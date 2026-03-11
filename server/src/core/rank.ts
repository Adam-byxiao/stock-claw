import { httpGet } from '../utils/http';

export interface RankStock {
  code: string;
  name: string;
  price: number;
  change_percent: number;
  value: number; // The ranking value (turnover rate, volume ratio, etc.)
}

export class RankService {
  /**
   * Get Top Stocks by Turnover Rate (HuanShouLv) from EastMoney
   */
  async getTurnoverRank(limit: number = 100): Promise<RankStock[]> {
    // f8: turnover rate
    // fs: m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23 (All A-shares)
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f8&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f8`;
    
    try {
        const data = await httpGet(url, 'json');
        if (data && data.data && data.data.diff) {
            return data.data.diff.map((item: any) => ({
                code: this.formatCode(item.f12), // e.g. 600519 -> sh600519
                name: item.f14,
                price: item.f2,
                change_percent: item.f3,
                value: item.f8 // Turnover rate %
            }));
        }
        return [];
    } catch (e) {
        console.error('Failed to get turnover rank:', e);
        return [];
    }
  }

  /**
   * Get Top Stocks by Volume Ratio (LiangBi) from EastMoney
   */
  async getVolumeRatioRank(limit: number = 100): Promise<RankStock[]> {
    // f10: volume ratio
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f10&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f10`;
    
    try {
        const data = await httpGet(url, 'json');
        if (data && data.data && data.data.diff) {
            return data.data.diff.map((item: any) => ({
                code: this.formatCode(item.f12),
                name: item.f14,
                price: item.f2,
                change_percent: item.f3,
                value: item.f10 // Volume ratio
            }));
        }
        return [];
    } catch (e) {
        console.error('Failed to get volume ratio rank:', e);
        return [];
    }
  }
  
  /**
   * Helper to format code (EastMoney returns just numbers usually)
   * 6xxxxx -> sh6xxxxx
   * 0xxxxx -> sz0xxxxx
   * 3xxxxx -> sz3xxxxx
   * 8xxxxx -> bj8xxxxx (but we might ignore BJ for now or treat as sh/sz based on prefix rules)
   */
  private formatCode(symbol: string): string {
      if (!symbol) return '';
      if (symbol.startsWith('6')) return `sh${symbol}`;
      if (symbol.startsWith('0') || symbol.startsWith('3')) return `sz${symbol}`;
      if (symbol.startsWith('8') || symbol.startsWith('4')) return `bj${symbol}`;
      return symbol;
  }
}
