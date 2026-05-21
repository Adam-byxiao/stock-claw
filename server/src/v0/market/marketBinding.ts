import { FundFlowService } from '../../core/fund';
import { StockService } from '../../core/stock';
import { V0MessageMarketState, V0MessageMention, V0ParsedForumMessage } from '../shared/types';

export interface StockSnapshot {
  code: string;
  name: string;
  price: string;
  percent: string;
}

export interface SectorSnapshot {
  name: string;
  changePercent: number;
  netInflow: number;
}

export interface MarketOverviewSnapshot {
  indexName: string;
  indexPercent: string;
  northboundNet?: number;
}

export interface V0MarketDataProvider {
  getStockSnapshot(code: string): Promise<StockSnapshot | null>;
  getSectorSnapshot(name: string): Promise<SectorSnapshot | null>;
  getMarketOverview(): Promise<MarketOverviewSnapshot | null>;
}

export class DefaultV0MarketDataProvider implements V0MarketDataProvider {
  private readonly stockService = new StockService();
  private readonly fundFlowService = new FundFlowService();

  async getStockSnapshot(code: string): Promise<StockSnapshot | null> {
    const result = await this.stockService.getStockData([code]);
    const stock = result[0];

    if (!stock) {
      return null;
    }

    return {
      code: stock.code,
      name: stock.name,
      price: stock.price,
      percent: stock.percent,
    };
  }

  async getSectorSnapshot(name: string): Promise<SectorSnapshot | null> {
    const sectors = await this.fundFlowService.getSectorFundFlow('concept');
    const sector = sectors.find((item: any) => item.name.includes(name) || name.includes(item.name));

    if (!sector) {
      return null;
    }

    return {
      name: sector.name,
      changePercent: Number(sector.change_percent || 0),
      netInflow: Number(sector.net_inflow || 0),
    };
  }

  async getMarketOverview(): Promise<MarketOverviewSnapshot | null> {
    const [indices, hsgt] = await Promise.all([
      this.stockService.getStockData(['sh000001']),
      this.fundFlowService.getHSGTFlow(),
    ]);
    const index = indices[0];

    if (!index) {
      return null;
    }

    return {
      indexName: index.name || '上证指数',
      indexPercent: index.percent,
      northboundNet:
        typeof hsgt.north_sh_net === 'number' && typeof hsgt.north_sz_net === 'number'
          ? hsgt.north_sh_net + hsgt.north_sz_net
          : undefined,
    };
  }
}

export class V0MarketBindingService {
  constructor(private readonly provider: V0MarketDataProvider) {}

  async buildMarketStates(
    message: V0ParsedForumMessage,
    mentions: V0MessageMention[]
  ): Promise<V0MessageMarketState[]> {
    const states: V0MessageMarketState[] = [];

    for (const mention of mentions) {
      if (mention.entityType === 'stock' && mention.normalizedCode) {
        const snapshot = await this.provider.getStockSnapshot(mention.normalizedCode);
        states.push(this.buildStockState(mention, snapshot));
        continue;
      }

      if (mention.entityType === 'sector') {
        const snapshot = await this.provider.getSectorSnapshot(mention.entityName);
        states.push(this.buildSectorState(mention, snapshot));
        continue;
      }

      if (mention.entityType === 'yellow_line' || mention.entityType === 'white_line') {
        const snapshot = await this.provider.getMarketOverview();
        states.push(this.buildLineState(mention, snapshot, message));
      }
    }

    return states;
  }

  private buildStockState(
    mention: V0MessageMention,
    snapshot: StockSnapshot | null
  ): V0MessageMarketState {
    if (!snapshot) {
      return {
        subjectType: 'stock',
        subjectKey: mention.normalizedCode ?? mention.entityName,
        snapshotJson: JSON.stringify({ status: 'missing' }),
        summaryText: `未能获取 ${mention.entityName} 的实时行情快照。`,
        adviceText: '先观察该股最新走势，再决定是否继续跟踪。',
      };
    }

    const percent = Number(snapshot.percent || 0);
    const strengthText = percent >= 0 ? '偏强' : '偏弱';

    return {
      subjectType: 'stock',
      subjectKey: snapshot.code,
      snapshotJson: JSON.stringify(snapshot),
      summaryText: `${snapshot.name} 当前 ${snapshot.price} 元，涨跌幅 ${snapshot.percent}% ，走势${strengthText}。`,
      adviceText: percent >= 3 ? '短线偏强，注意不要盲目追高。' : '先结合量能和承接继续观察。',
    };
  }

  private buildSectorState(
    mention: V0MessageMention,
    snapshot: SectorSnapshot | null
  ): V0MessageMarketState {
    if (!snapshot) {
      return {
        subjectType: 'sector',
        subjectKey: mention.entityName,
        snapshotJson: JSON.stringify({ status: 'missing' }),
        summaryText: `暂未获取到 ${mention.entityName} 板块快照。`,
        adviceText: '先观察核心股是否同步走强，再判断板块是否有回流。',
      };
    }

    const flowText = snapshot.netInflow >= 0 ? '资金净流入' : '资金承压';

    return {
      subjectType: 'sector',
      subjectKey: snapshot.name,
      snapshotJson: JSON.stringify(snapshot),
      summaryText: `${snapshot.name} 当前涨跌幅 ${snapshot.changePercent}% ，${flowText}。`,
      adviceText:
        snapshot.changePercent > 0
          ? '板块有修复迹象，观察核心股是否继续扩散。'
          : '板块暂未明显转强，先避免过早追击。',
    };
  }

  private buildLineState(
    mention: V0MessageMention,
    snapshot: MarketOverviewSnapshot | null,
    message: V0ParsedForumMessage
  ): V0MessageMarketState {
    if (!snapshot) {
      return {
        subjectType: mention.entityType,
        subjectKey: mention.entityName,
        snapshotJson: JSON.stringify({ status: 'missing' }),
        summaryText: `V0 暂未获取到 ${mention.entityName} 的直连快照。`,
        adviceText: '先结合指数分时与盘面强弱手动确认。',
      };
    }

    const northboundText =
      snapshot.northboundNet !== undefined ? `北向净流入 ${snapshot.northboundNet}。` : '北向资金数据暂缺。';
    const messageBias = message.normalizedContent.includes('弱') ? '当前更适合谨慎观察。' : '可继续结合盘面确认强弱。';

    return {
      subjectType: mention.entityType,
      subjectKey: mention.entityName,
      snapshotJson: JSON.stringify(snapshot),
      summaryText: `${snapshot.indexName} 当前涨跌幅 ${snapshot.indexPercent}% ，${northboundText}`,
      adviceText: `${mention.entityName} 属于盘面风格信号，V0 暂以指数强弱替代直连黄白线数据。${messageBias}`,
    };
  }
}
