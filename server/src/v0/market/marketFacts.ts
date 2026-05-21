import { toBeijingDateString } from '../shared/authorIdentity';
import {
  V0ExternalMarketFactsResponse,
  V0MarketFactCitation,
  V0MarketFactItem,
  V0MarketFactsPayload,
  V0MarketFactsResponse,
} from '../shared/types';
import { V0ExternalMarketFactsService } from './externalMarketFacts';
import {
  MarketOverviewSnapshot,
  SectorSnapshot,
  StockSnapshot,
  V0MarketDataProvider,
} from './marketBinding';

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
};

const normalizeStockCode = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('sh') || normalized.startsWith('sz') || normalized.startsWith('bj')) {
    return normalized;
  }

  if (/^\d{6}$/.test(normalized)) {
    if (normalized.startsWith('6')) {
      return `sh${normalized}`;
    }

    if (normalized.startsWith('8') || normalized.startsWith('4')) {
      return `bj${normalized}`;
    }

    return `sz${normalized}`;
  }

  return normalized;
};

export class V0MarketFactsService {
  constructor(
    private readonly provider: V0MarketDataProvider,
    private readonly externalFactsService?: V0ExternalMarketFactsService
  ) {}

  async buildFacts(payload: V0MarketFactsPayload): Promise<V0MarketFactsResponse> {
    const queryDate = payload.queryDate?.trim() || null;
    const realtimeDate = toBeijingDateString();
    const isRealtime = !queryDate || queryDate === realtimeDate;
    const requestedStocks = uniqueStrings((payload.stocks ?? []).map(normalizeStockCode).filter(Boolean));
    const requestedSectors = uniqueStrings(payload.sectors ?? []);
    const includeOverview = payload.includeOverview ?? true;
    const includeExternal = payload.includeExternal ?? true;
    const generatedAt = new Date().toISOString();
    const facts: V0MarketFactItem[] = [];
    const citations: V0MarketFactCitation[] = [];
    const missingInputs: string[] = [];
    let externalFacts: V0ExternalMarketFactsResponse | null = null;

    const pushFact = (fact: V0MarketFactItem): void => {
      facts.push(fact);
      citations.push({
        id: fact.citationId,
        source: 'market_realtime',
        title: fact.title,
        excerpt: fact.summary,
        subjectType: fact.subjectType,
        subjectKey: fact.subjectKey,
        capturedAt: fact.capturedAt,
        confidence: fact.confidence,
      });
    };

    if (!isRealtime) {
      const summary = `查询日期 ${queryDate} 不是实时交易日 ${realtimeDate}；当前接口只提供实时行情，不能把实时快照当成历史行情。`;
      pushFact({
        id: 'market-date-scope',
        kind: 'not_realtime',
        subjectType: 'system',
        subjectKey: queryDate ?? 'unknown',
        title: '实时行情日期边界',
        summary,
        capturedAt: generatedAt,
        data: { queryDate, realtimeDate },
        citationId: 'market-fact-date-scope',
        confidence: 1,
      });
      missingInputs.push('缺少指定日期的历史行情快照，实时行情只用于当前盘面。');
    }

    if (includeOverview && isRealtime) {
      const overview = await this.safeGetMarketOverview();
      if (overview) {
        pushFact(this.buildOverviewFact(overview, generatedAt));
      } else {
        missingInputs.push('实时大盘概览获取失败。');
        pushFact(this.buildMissingFact('market-overview', 'market', '大盘概览', generatedAt));
      }
    }

    if (isRealtime) {
      for (const code of requestedStocks.slice(0, 8)) {
        const snapshot = await this.safeGetStockSnapshot(code);
        if (snapshot) {
          pushFact(this.buildStockFact(snapshot, generatedAt));
        } else {
          missingInputs.push(`实时股票快照获取失败：${code}`);
          pushFact(this.buildMissingFact(`stock-${code}`, 'stock', code, generatedAt));
        }
      }

      for (const sector of requestedSectors.slice(0, 8)) {
        const snapshot = await this.safeGetSectorSnapshot(sector);
        if (snapshot) {
          pushFact(this.buildSectorFact(snapshot, generatedAt));
        } else {
          missingInputs.push(`实时板块快照获取失败：${sector}`);
          pushFact(this.buildMissingFact(`sector-${sector}`, 'sector', sector, generatedAt));
        }
      }
    }

    if (requestedStocks.length === 0 && requestedSectors.length === 0) {
      missingInputs.push('未提供股票或板块提示，市场事实仅包含大盘概览。');
    }

    if (includeExternal && this.externalFactsService) {
      externalFacts = await this.externalFactsService.buildFacts({
        queryDate: payload.queryDate,
      });
      facts.push(...externalFacts.facts);
      citations.push(...externalFacts.citations);
      missingInputs.push(...externalFacts.missingInputs);
    }

    return {
      queryDate,
      realtimeDate,
      isRealtime,
      requestedStocks,
      requestedSectors,
      externalSources: externalFacts?.sources,
      facts,
      citations,
      missingInputs: uniqueStrings(missingInputs),
      generatedAt,
    };
  }

  private buildOverviewFact(
    overview: MarketOverviewSnapshot,
    capturedAt: string
  ): V0MarketFactItem {
    const northboundText =
      overview.northboundNet === undefined ? '北向资金暂无' : `北向净流入 ${overview.northboundNet}`;
    const summary = `${overview.indexName} 当前涨跌幅 ${overview.indexPercent}%，${northboundText}。`;
    return {
      id: 'market-overview',
      kind: 'market_overview',
      subjectType: 'market',
      subjectKey: overview.indexName,
      title: '实时大盘概览',
      summary,
      capturedAt,
      data: { ...overview },
      citationId: 'market-fact-overview',
      confidence: 0.86,
    };
  }

  private buildStockFact(snapshot: StockSnapshot, capturedAt: string): V0MarketFactItem {
    const percent = Number(snapshot.percent);
    const bias = Number.isFinite(percent) ? (percent >= 0 ? '偏强' : '偏弱') : '待确认';
    const summary = `${snapshot.name}(${snapshot.code}) 当前 ${snapshot.price} 元，涨跌幅 ${snapshot.percent}%，短线状态${bias}。`;
    return {
      id: `stock-${snapshot.code}`,
      kind: 'stock_snapshot',
      subjectType: 'stock',
      subjectKey: snapshot.code,
      title: `实时个股快照：${snapshot.name}`,
      summary,
      capturedAt,
      data: { ...snapshot, bias },
      citationId: `market-fact-stock-${snapshot.code}`,
      confidence: 0.84,
    };
  }

  private buildSectorFact(snapshot: SectorSnapshot, capturedAt: string): V0MarketFactItem {
    const flowText = snapshot.netInflow >= 0 ? '资金净流入' : '资金净流出';
    const summary = `${snapshot.name} 当前涨跌幅 ${snapshot.changePercent}%，${flowText} ${snapshot.netInflow}。`;
    return {
      id: `sector-${snapshot.name}`,
      kind: 'sector_snapshot',
      subjectType: 'sector',
      subjectKey: snapshot.name,
      title: `实时板块快照：${snapshot.name}`,
      summary,
      capturedAt,
      data: { ...snapshot },
      citationId: `market-fact-sector-${snapshot.name}`,
      confidence: 0.78,
    };
  }

  private buildMissingFact(
    id: string,
    subjectType: 'market' | 'stock' | 'sector',
    subjectKey: string,
    capturedAt: string
  ): V0MarketFactItem {
    const summary = `${subjectKey} 暂未获取到实时行情快照。`;
    return {
      id,
      kind: 'missing',
      subjectType,
      subjectKey,
      title: `行情缺失：${subjectKey}`,
      summary,
      capturedAt,
      data: { status: 'missing' },
      citationId: `market-fact-missing-${id}`,
      confidence: 1,
    };
  }

  private async safeGetMarketOverview(): Promise<MarketOverviewSnapshot | null> {
    try {
      return await this.provider.getMarketOverview();
    } catch (error) {
      console.warn('V0 market overview fact failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async safeGetStockSnapshot(code: string): Promise<StockSnapshot | null> {
    try {
      return await this.provider.getStockSnapshot(code);
    } catch (error) {
      console.warn('V0 stock fact failed:', code, error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async safeGetSectorSnapshot(name: string): Promise<SectorSnapshot | null> {
    try {
      return await this.provider.getSectorSnapshot(name);
    } catch (error) {
      console.warn('V0 sector fact failed:', name, error instanceof Error ? error.message : error);
      return null;
    }
  }
}
