import { Skill, SkillResult } from './types';

export class MovingAverageSkill implements Skill {
  name = 'moving_average';
  description = 'Calculate MA5 and MA10, and provide trend analysis.';

  async execute(kline: any[]): Promise<SkillResult> {
    if (!kline || kline.length < 10) {
      return { success: false, error: 'Not enough data for MA10' };
    }

    // Sort by date ascending (assuming input is ascending)
    // We need the last day's MA
    const closes = kline.map(k => k.close);
    const len = closes.length;
    
    // Calculate MA5
    const ma5 = this.calculateMA(closes, 5);
    // Calculate MA10
    const ma10 = this.calculateMA(closes, 10);
    
    const currentPrice = closes[len - 1];
    const currentMA5 = ma5;
    const currentMA10 = ma10;
    
    let signal = 'neutral';
    let advice = '';
    
    if (currentPrice > currentMA5 && currentPrice > currentMA10) {
        signal = 'strong';
        advice = '股价位于5日、10日均线之上，走势强劲，注意上方压力，适当止盈。';
    } else if (currentPrice < currentMA5 && currentPrice < currentMA10) {
        signal = 'weak';
        advice = '股价位于5日、10日均线之下，走势偏弱，可关注企稳后的介入机会。';
    } else {
        signal = 'consolidation';
        advice = '股价在5日、10日均线之间震荡，方向不明。';
    }

    return {
      success: true,
      data: {
        ma5: currentMA5.toFixed(2),
        ma10: currentMA10.toFixed(2),
        signal,
        advice
      }
    };
  }

  private calculateMA(data: number[], period: number): number {
      if (data.length < period) return 0;
      const slice = data.slice(-period);
      const sum = slice.reduce((a, b) => a + b, 0);
      return sum / period;
  }
}
