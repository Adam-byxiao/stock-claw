import { httpGet } from '../utils/http';
import * as iconv from 'iconv-lite';

export interface StockData {
  id: string;
  code: string;
  name: string;
  price: string;
  high: string;
  low: string;
  open: string;
  yestclose: string;
  percent: string;
  updown: string;
  volume: string;
  amount: string;
  time: string;
  source: string;
}

export interface StockSuggest {
  code: string;
  name: string;
  type: string;
  symbol: string;
}

export interface KlineData {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface TimelineData {
  time: string;
  price: number;
  volume: number;
  avgPrice: number;
}

export class StockService {
  /**
   * Get stock data from Sina (A-Share)
   */
  async getStockData(codes: string[]): Promise<StockData[]> {
    if (!codes || codes.length === 0) return [];
    
    // Ensure codes have prefixes (sh/sz) and are lowercase
    // This logic mimics leek-fund's processing
    const formattedCodes = codes.map(c => c.toLowerCase());
    const url = `https://hq.sinajs.cn/list=${formattedCodes.join(',')}`;
    
    try {
      const data = await httpGet(url, 'arraybuffer', {
        Referer: 'http://finance.sina.com.cn/',
      });
      
      if (!data) return [];
      
      const text = iconv.decode(data, 'gb18030');
      const lines = text.split('\n');
      const result: StockData[] = [];
      
      for (const line of lines) {
        if (!line || line.length < 10) continue;
        
        // Format: var hq_str_sh600519="Name,Open,PreClose,Price,High,Low,..."
        const matches = line.match(/var hq_str_(\w+)="(.+)";/);
        if (!matches || matches.length < 3) continue;
        
        const code = matches[1];
        const params = matches[2].split(',');
        
        if (params.length < 30) continue;
        
        const price = params[3];
        const open = params[1];
        const yestclose = params[2];
        const high = params[4];
        const low = params[5];
        const name = params[0];
        const time = `${params[30]} ${params[31]}`;
        
        let percent = '';
        let updown = '';
        if (Number(yestclose) > 0) {
            const p = (Number(price) - Number(yestclose)) / Number(yestclose) * 100;
            percent = p.toFixed(2);
            updown = (Number(price) - Number(yestclose)).toFixed(2);
        } else {
            percent = '0.00';
            updown = '0.00';
        }
        
        result.push({
          id: code,
          code,
          name,
          price,
          high,
          low,
          open,
          yestclose,
          percent,
          updown,
          volume: params[8],
          amount: params[9],
          time,
          source: 'sina'
        });
      }
      
      return result;
    } catch (err) {
      console.error('Failed to get stock data:', err);
      return [];
    }
  }

  /**
   * Search stock suggest from Tencent
   */
  async getStockSuggest(keyword: string): Promise<StockSuggest[]> {
    const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get?q=${encodeURIComponent(keyword)}`;
    try {
      const data = await httpGet(url, 'json');
      if (data && data.code === 0 && data.data && data.data.stock) {
        return data.data.stock.map((item: any) => ({
          code: item.t + item.c, // e.g. sh600519
          name: item.n,
          type: item.t,
          symbol: item.c
        }));
      }
      return [];
    } catch (err) {
      console.error('Failed to get suggest:', err);
      return [];
    }
  }

  /**
   * Get Kline data from Tencent
   * @param code Stock code with prefix (e.g. sh600519)
   * @param type kline type: day, week, month, 5, 15, 30, 60
   */
  async getKlineData(code: string, type: string = 'day'): Promise<KlineData[]> {
      // Map frontend type to Tencent API param
      // Tencent API: day, week, month, m5, m15, m30, m60
      const typeMap: Record<string, string> = {
          day: 'day',
          week: 'week',
          month: 'month',
          '5': 'm5',
          '15': 'm15',
          '30': 'm30',
          '60': 'm60'
      };
      
      const kType = typeMap[type] || 'day';
      // e.g. https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,320,qfq
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${kType},,,320,qfq`;
      
      try {
          const data = await httpGet(url, 'json');
          if (data && data.code === 0 && data.data && data.data[code]) {
             const klineRaw = data.data[code][kType] || data.data[code]['qfq' + kType] || data.data[code][type];
             if (Array.isArray(klineRaw)) {
                 return klineRaw.map((item: any[]) => ({
                     time: item[0],
                     open: Number(item[1]),
                     close: Number(item[2]),
                     high: Number(item[3]),
                     low: Number(item[4]),
                     volume: Number(item[5])
                 }));
             }
          }
          return [];
      } catch (err) {
          console.error('Failed to get kline:', err);
          return [];
      }
  }

  /**
   * Get Minute Timeline data from Tencent
   * @param code Stock code with prefix (e.g. sh600519)
   */
  async getTimelineData(code: string): Promise<TimelineData[]> {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
    
    try {
      const data = await httpGet(url, 'json');
      
      if (data && data.code === 0 && data.data && data.data[code]) {
        const stockData = data.data[code];
        // Usually data is in 'data.data' or 'minute' field
        // Tencent minute data might be "0930 14.55 4609" strings or objects
        const minuteData = stockData.data?.data || stockData.minute;
        
        if (Array.isArray(minuteData)) {
            return minuteData.map((item: any) => {
                let time, price, volume;
                
                if (typeof item === 'string') {
                    const parts = item.split(' ');
                    time = parts[0];
                    price = Number(parts[1]);
                    volume = Number(parts[2]);
                } else {
                    // Object format
                    time = item.time || item[0]; // some apis return [time, price, vol]
                    price = Number(item.price || item[1]);
                    volume = Number(item.volume || item[2]);
                }
                
                // Format time: 0930 -> 09:30
                if (time && time.length === 4 && !time.includes(':')) {
                    time = `${time.substring(0,2)}:${time.substring(2,4)}`;
                }
                
                return {
                    time,
                    price,
                    volume, 
                    avgPrice: 0 
                };
            });
        }
      }
      return [];
    } catch (err) {
      console.error('Failed to get timeline:', err);
      return [];
    }
  }
}
