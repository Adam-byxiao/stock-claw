import { Skill, SkillResult } from './types';

export class MACDSkill implements Skill {
  name = 'macd';
  description = 'Calculate MACD (DIF, DEA, Bar) and analyze signals (Golden Cross, Divergence).';

  async execute(kline: any[]): Promise<SkillResult> {
    if (!kline || kline.length < 26) {
      return { success: false, error: 'Not enough data for MACD' };
    }

    const closes = kline.map(k => k.close);
    const { dif, dea, bar } = this.calculateMACD(closes);
    
    // Analysis
    const len = dif.length;
    const currDIF = dif[len - 1];
    const currDEA = dea[len - 1];
    const prevDIF = dif[len - 2];
    const prevDEA = dea[len - 2];
    const currBar = bar[len - 1];
    const prevBar = bar[len - 2];

    let signal = 'neutral';
    let trend = '';
    let divergence = '';

    // 1. Cross Signal
    if (prevDIF < prevDEA && currDIF > currDEA) {
        signal = 'golden_cross';
        trend = 'DIF上穿DEA形成金叉，趋势偏多。';
    } else if (prevDIF > prevDEA && currDIF < currDEA) {
        signal = 'dead_cross';
        trend = 'DIF下穿DEA形成死叉，趋势偏空。';
    } else if (currDIF > currDEA) {
        trend = 'DIF位于DEA上方，多头主导。';
    } else {
        trend = 'DIF位于DEA下方，空头主导。';
    }

    // 2. Bar Strength
    let barTrend = '';
    if (currBar > 0 && currBar > prevBar) {
        barTrend = '红柱增长，多头动能增强。';
    } else if (currBar > 0 && currBar < prevBar) {
        barTrend = '红柱缩短，多头动能减弱。';
    } else if (currBar < 0 && currBar < prevBar) {
        barTrend = '绿柱增长，空头动能增强。';
    } else if (currBar < 0 && currBar > prevBar) {
        barTrend = '绿柱缩短，空头动能减弱。';
    }

    // 3. Divergence (Simplified: Price Low vs MACD Low)
    // Need more historical data logic for strict divergence, simplified here for recent 5 days
    // Logic: Price makes new low, but MACD low is higher (Bottom Divergence)
    // Logic: Price makes new high, but MACD high is lower (Top Divergence)
    
    // Check last 10 days extrema
    const recentPrices = closes.slice(-10);
    const recentDIFs = dif.slice(-10);
    
    // Very simple heuristic for divergence warning
    if (currBar > 0 && currBar < prevBar && closes[len-1] > closes[len-2]) {
        divergence = '警惕顶背离风险（股价上涨但动能减弱）。';
    }
    if (currBar < 0 && currBar > prevBar && closes[len-1] < closes[len-2]) {
        divergence = '关注底背离机会（股价下跌但动能减弱）。';
    }

    return {
      success: true,
      data: {
        dif: currDIF.toFixed(3),
        dea: currDEA.toFixed(3),
        bar: (currBar * 2).toFixed(3), // Standard MACD bar is usually (DIF-DEA)*2
        signal,
        analysis: `${trend} ${barTrend} ${divergence}`
      }
    };
  }

  private calculateMACD(prices: number[]): { dif: number[], dea: number[], bar: number[] } {
      // EMA12, EMA26, DIF, DEA9
      const ema12 = this.calculateEMA(prices, 12);
      const ema26 = this.calculateEMA(prices, 26);
      
      const dif: number[] = [];
      for(let i=0; i<prices.length; i++) {
          dif.push(ema12[i] - ema26[i]);
      }
      
      const dea = this.calculateEMA(dif, 9);
      
      const bar: number[] = [];
      for(let i=0; i<prices.length; i++) {
          bar.push(dif[i] - dea[i]);
      }
      
      return { dif, dea, bar };
  }

  private calculateEMA(data: number[], period: number): number[] {
      const k = 2 / (period + 1);
      const ema: number[] = [data[0]];
      
      for (let i = 1; i < data.length; i++) {
          ema.push(data[i] * k + ema[i - 1] * (1 - k));
      }
      return ema;
  }
}
