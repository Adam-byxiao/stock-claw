import { httpGet } from '../utils/http';
import axios from 'axios';
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

export interface StockInfo {
    code: string;
    name: string;
    price: number;
    change_percent: number;
    open: number;
    yestclose: number;
    high: number;
    low: number;
    volume: number;
    amount: number;
    turnover_rate: number; // 换手率
    pe_ttm: number;        // 市盈率
    pb: number;            // 市净率
    market_cap: number;    // 总市值
    float_market_cap: number; // 流通市值
    amplitude: number;     // 振幅
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
   * Get Stock Info (Fundamental) from Tencent
   */
  async getStockInfo(code: string): Promise<StockInfo | null> {
      const url = `http://qt.gtimg.cn/q=${code}`;
      
      try {
          const data = await httpGet(url, 'arraybuffer');
          if (!data) return null;
          
          const text = iconv.decode(data, 'gb18030');
          const matches = text.match(/v_(\w+)="(.+)";/);
          if (!matches || matches.length < 3) return null;
          
          const params = matches[2].split('~');
          if (params.length < 45) return null;
          
          return {
              code: matches[1],
              name: params[1],
              price: Number(params[3]),
              yestclose: Number(params[4]),
              open: Number(params[5]),
              high: Number(params[33]),
              low: Number(params[34]),
              volume: Number(params[36]),
              amount: Number(params[37]),
              change_percent: Number(params[32]),
              
              turnover_rate: Number(params[38]),
              pe_ttm: Number(params[39]),
              amplitude: Number(params[43]),
              float_market_cap: Number(params[44]),
              market_cap: Number(params[45]),
              pb: Number(params[46])
          };
      } catch (err) {
          console.error('Failed to get stock info:', err);
          return null;
      }
  }

  /**
   * Search stock suggest from Tencent
   */
  async getStockSuggest(keyword: string): Promise<StockSuggest[]> {
    const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get?q=${encodeURIComponent(keyword)}`;
    try {
      const data = await httpGet(url, 'json');
      if (typeof data === 'string') {
          return [];
      }
      
      if (data && data.code === 0 && data.data && data.data.stock) {
        return data.data.stock.map((item: any[]) => {
            if (!Array.isArray(item) || item.length < 3) return null;
            
            const market = item[0];
            const symbol = item[1];
            const name = item[2];
            const fullCode = `${market}${symbol}`;
            
            return {
                code: fullCode, 
                name: name,
                type: market,
                symbol: symbol
            };
        }).filter((item: any) => item !== null);
      }
      return [];
    } catch (err) {
      console.error('Failed to get suggest:', err);
      return [];
    }
  }

  /**
   * Get Kline data from EastMoney (replacing Tencent to fix outdated data)
   * @param code Stock code with prefix (e.g. sh600519)
   * @param type kline type: day, week, month
   */
  async getKlineData(code: string, type: string = 'day'): Promise<KlineData[]> {
      // EastMoney secid: 1.600519 (SH), 0.000001 (SZ)
      // Map prefix to secid prefix
      let secid = '';
      if (code.startsWith('sh')) {
          secid = `1.${code.substring(2)}`;
      } else if (code.startsWith('sz')) {
          secid = `0.${code.substring(2)}`;
      } else if (code.startsWith('bj')) {
          secid = `0.${code.substring(2)}`; // BJ is usually 0 too in EM? Need verify. Actually BJ is 0.
      } else {
          return [];
      }
      
      // klt: 101=Day, 102=Week, 103=Month
      let klt = '101';
      if (type === 'week') klt = '102';
      if (type === 'month') klt = '103';
      
      // fqt: 1=QFQ (Forward Adjusted)
      // fields1=f1,f2,f3,f4,f5,f6
      // fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61
      // f51: date, f52: open, f53: close, f54: high, f55: low, f56: volume, f57: amount, f58: amplitude, f59: percent, f60: change, f61: turnover
      
      const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=${klt}&fqt=1&end=20500101&lmt=120`;
      
      try {
          const response = await axios.get(url, {
              timeout: 10000,
              proxy: false,
              headers: {
                  Referer: `https://quote.eastmoney.com/${code}.html`,
                  'User-Agent':
                      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
          });
          const data = response.data;
          if (data && data.data && data.data.klines) {
              return data.data.klines.map((item: string) => {
                  const parts = item.split(',');
                  // parts: date, open, close, high, low, volume
                  return {
                      time: parts[0],
                      open: Number(parts[1]),
                      close: Number(parts[2]),
                      high: Number(parts[3]),
                      low: Number(parts[4]),
                      volume: Number(parts[5])
                  };
              });
          }
          return [];
      } catch (err) {
          console.warn(
              'Failed to get kline from EastMoney, falling back to Tencent:',
              err instanceof Error ? err.message : err
          );
          return this.getTencentKlineData(code, type);
      }
  }

  private async getTencentKlineData(code: string, type: string = 'day'): Promise<KlineData[]> {
      const period = type === 'week' || type === 'month' ? type : 'day';
      const dataKey = `qfq${period}`;
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${period},,,120,qfq`;

      try {
          const response = await axios.get(url, {
              timeout: 10000,
              proxy: false,
              headers: {
                  Referer: 'https://gu.qq.com/',
                  'User-Agent':
                      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
          });
          const stockData = response.data?.data?.[code];
          const rows = stockData?.[dataKey] ?? stockData?.[period] ?? [];

          if (!Array.isArray(rows)) {
              return [];
          }

          return rows.map((item: string[]) => ({
              time: item[0],
              open: Number(item[1]),
              close: Number(item[2]),
              high: Number(item[3]),
              low: Number(item[4]),
              volume: Number(item[5]),
          }));
      } catch (err) {
          console.error('Failed to get kline from Tencent:', err);
          return [];
      }
  }

  /**
   * Get Minute Timeline data from Tencent (Keeping Tencent for minute data as it's usually realtime)
   * @param code Stock code with prefix (e.g. sh600519)
   */
  async getTimelineData(code: string): Promise<TimelineData[]> {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
    
    try {
      const data = await httpGet(url, 'json');
      
      if (data && data.code === 0 && data.data && data.data[code]) {
        const stockData = data.data[code];
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
                    time = item.time || item[0];
                    price = Number(item.price || item[1]);
                    volume = Number(item.volume || item[2]);
                }
                
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
