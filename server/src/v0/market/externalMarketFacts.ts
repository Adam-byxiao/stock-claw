import { toBeijingDateString } from '../shared/authorIdentity';
import {
  V0ExternalMarketDataSource,
  V0ExternalMarketDataSourceSnapshot,
  V0ExternalMarketFactsPayload,
  V0ExternalMarketFactsResponse,
  V0MarketFactCitation,
  V0MarketFactItem,
} from '../shared/types';
import {
  BigAMapLimitUpItem,
  BigAMapLimitUpReviewResponse,
  BigAMapMaximizedRankingsResponse,
  BigAMapPointItem,
  BigAMapPointsResponse,
  BigAMapPublicMapProvider,
  HttpBigAMapPublicMapProvider,
} from './bigamapProvider';

const DEFAULT_TOP_N = 8;

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

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatPercent = (value: unknown): string => {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : '暂无';
};

const formatAmountYi = (value: unknown): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '暂无';
  }

  return `${(num / 100000000).toFixed(2)}亿`;
};

const normalizeStockCode = (market: string | undefined, code: string | undefined): string => {
  const symbol = (code ?? '').trim();
  const prefix = (market ?? '').trim().toLowerCase();

  if (!symbol) {
    return '';
  }

  if (prefix === 'sh' || prefix === 'sz' || prefix === 'bj') {
    return `${prefix}${symbol}`;
  }

  if (symbol.startsWith('6')) {
    return `sh${symbol}`;
  }

  if (symbol.startsWith('8') || symbol.startsWith('4')) {
    return `bj${symbol}`;
  }

  return `sz${symbol}`;
};

interface AggregatedGroup {
  key: string;
  count: number;
  up: number;
  down: number;
  flat: number;
  amount: number;
  averageChange: number;
  score: number;
}

export class V0ExternalMarketFactsService {
  constructor(
    private readonly provider: BigAMapPublicMapProvider = new HttpBigAMapPublicMapProvider()
  ) {}

  async buildFacts(
    payload: V0ExternalMarketFactsPayload = {}
  ): Promise<V0ExternalMarketFactsResponse> {
    const queryDate = payload.queryDate?.trim() || null;
    const realtimeDate = toBeijingDateString();
    const isRealtime = !queryDate || queryDate === realtimeDate;
    const generatedAt = new Date().toISOString();
    const topN = this.normalizeTopN(payload.topN);
    const facts: V0MarketFactItem[] = [];
    const citations: V0MarketFactCitation[] = [];
    const sources: V0ExternalMarketDataSourceSnapshot[] = [];
    const missingInputs: string[] = [];

    const pushFact = (fact: V0MarketFactItem): void => {
      facts.push(fact);
      citations.push({
        id: fact.citationId,
        source: 'bigamap',
        title: fact.title,
        excerpt: fact.summary,
        subjectType: fact.subjectType,
        subjectKey: fact.subjectKey,
        capturedAt: fact.capturedAt,
        confidence: fact.confidence,
      });
    };

    if (!isRealtime) {
      missingInputs.push('BigAMap 当前只接入最新快照；指定历史日期时只能作为实时事实边界，不能替代历史行情。');
    }

    if (payload.includePoints ?? true) {
      const points = await this.safeSource('bigamap_points', () => this.provider.getPoints(), sources, generatedAt);
      if (points) {
        this.pushPointsFacts(points, generatedAt, topN, pushFact);
      } else {
        missingInputs.push('BigAMap points 全市场点位快照获取失败。');
      }
    }

    if (payload.includeRankings ?? true) {
      const rankings = await this.safeSource(
        'bigamap_maximized_rankings',
        () => this.provider.getMaximizedRankings(),
        sources,
        generatedAt
      );
      if (rankings) {
        this.pushRankingFacts(rankings, generatedAt, topN, pushFact);
      } else {
        missingInputs.push('BigAMap maximized-rankings 板块轮动排名获取失败。');
      }
    }

    if (payload.includeLimitReview ?? true) {
      const review = await this.safeSource(
        'bigamap_limit_up_review',
        () => this.provider.getLimitUpReview(),
        sources,
        generatedAt
      );
      if (review) {
        this.pushLimitReviewFacts(review, generatedAt, topN, pushFact);
      } else {
        missingInputs.push('BigAMap limit-up-review 涨跌停复盘获取失败。');
      }
    }

    return {
      queryDate,
      realtimeDate,
      isRealtime,
      provider: 'bigamap',
      sources,
      facts,
      citations,
      missingInputs: uniqueStrings(missingInputs),
      generatedAt,
    };
  }

  private normalizeTopN(value: number | undefined): number {
    if (!Number.isInteger(value) || value === undefined) {
      return DEFAULT_TOP_N;
    }

    return Math.max(1, Math.min(value, 20));
  }

  private async safeSource<T>(
    source: V0ExternalMarketDataSource,
    load: () => Promise<T | null>,
    sources: V0ExternalMarketDataSourceSnapshot[],
    capturedAt: string
  ): Promise<T | null> {
    try {
      const data = await load();
      if (!data) {
        sources.push({
          source,
          status: 'missing',
          capturedAt,
        });
        return null;
      }

      sources.push(this.buildSourceSnapshot(source, data, capturedAt));
      return data;
    } catch (error) {
      sources.push({
        source,
        status: 'failed',
        capturedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private buildSourceSnapshot<T>(
    source: V0ExternalMarketDataSource,
    data: T,
    capturedAt: string
  ): V0ExternalMarketDataSourceSnapshot {
    const asRecord = data as Record<string, any>;
    const itemCount =
      source === 'bigamap_points'
        ? Array.isArray(asRecord.items)
          ? asRecord.items.length
          : toNumber(asRecord.summary?.total_items)
        : source === 'bigamap_limit_up_review'
          ? Array.isArray(asRecord.limit_up?.items)
            ? asRecord.limit_up.items.length
            : undefined
          : undefined;

    return {
      source,
      status: 'success',
      capturedAt,
      tradeDate: asRecord.latest_trade_date ?? asRecord.trade_date ?? asRecord.default_selection?.trade_date,
      generatedAt: asRecord.generated_at,
      itemCount,
      notice: asRecord.quote_delay_notice,
    };
  }

  private pushPointsFacts(
    points: BigAMapPointsResponse,
    capturedAt: string,
    topN: number,
    pushFact: (fact: V0MarketFactItem) => void
  ): void {
    const summary = points.summary ?? {};
    const total = toNumber(summary.total_items);
    const up = toNumber(summary.up_items);
    const down = toNumber(summary.down_items);
    const flat = toNumber(summary.flat_items);
    const fresh = toNumber(summary.fresh_items);
    const stale = toNumber(summary.stale_items);
    const upRatio = total > 0 ? up / total : 0;
    const downRatio = total > 0 ? down / total : 0;

    pushFact({
      id: 'bigamap-market-breadth',
      kind: 'external_market_overview',
      subjectType: 'market',
      subjectKey: 'bigamap_market_breadth',
      title: 'BigAMap 全市场广度',
      summary: `BigAMap 全市场 ${total} 只股票，上涨 ${up}、下跌 ${down}、平盘 ${flat}；上涨占比 ${formatPercent(upRatio * 100)}，下跌占比 ${formatPercent(downRatio * 100)}。${points.quote_delay_notice ?? ''}`,
      capturedAt,
      data: {
        totalItems: total,
        freshItems: fresh,
        staleItems: stale,
        upItems: up,
        downItems: down,
        flatItems: flat,
        upRatio,
        downRatio,
        generatedAt: points.generated_at,
        quoteDelayNotice: points.quote_delay_notice,
      },
      citationId: 'bigamap-fact-market-breadth',
      confidence: 0.86,
    });

    const items = Array.isArray(points.items) ? points.items : [];
    const industryGroups = this.aggregatePointGroups(items, (item) => item.sw_level1_name || item.industry || '');
    if (industryGroups.length > 0) {
      pushFact({
        id: 'bigamap-industry-strength',
        kind: 'external_sector_strength',
        subjectType: 'sector',
        subjectKey: 'sw_level1',
        title: 'BigAMap 行业强度聚合',
        summary: `BigAMap 按申万一级行业聚合，靠前行业：${industryGroups
          .slice(0, topN)
          .map((item) => `${item.key}(${formatPercent(item.averageChange)}，上涨${item.up}/${item.count})`)
          .join('、')}。`,
        capturedAt,
        data: {
          dimension: 'sw_level1_name',
          topGroups: industryGroups.slice(0, topN),
          generatedAt: points.generated_at,
        },
        citationId: 'bigamap-fact-industry-strength',
        confidence: 0.8,
      });
    }

    const provinceGroups = this.aggregatePointGroups(items, (item) => item.province || '');
    if (provinceGroups.length > 0) {
      pushFact({
        id: 'bigamap-province-strength',
        kind: 'external_sector_strength',
        subjectType: 'sector',
        subjectKey: 'province',
        title: 'BigAMap 地域强度聚合',
        summary: `BigAMap 按地域聚合，靠前地域：${provinceGroups
          .slice(0, Math.min(topN, 6))
          .map((item) => `${item.key}(${formatPercent(item.averageChange)}，成交${formatAmountYi(item.amount)})`)
          .join('、')}。`,
        capturedAt,
        data: {
          dimension: 'province',
          topGroups: provinceGroups.slice(0, topN),
          generatedAt: points.generated_at,
        },
        citationId: 'bigamap-fact-province-strength',
        confidence: 0.74,
      });
    }

    const strongStocks = items
      .slice()
      .filter((item) => typeof item.change_percent === 'number')
      .sort((left, right) => toNumber(right.change_percent) - toNumber(left.change_percent))
      .slice(0, topN)
      .map((item) => ({
        code: normalizeStockCode(item.market, item.code),
        name: item.name,
        changePercent: item.change_percent,
        amount: item.amount,
        swLevel1Name: item.sw_level1_name,
        swLevel2Name: item.sw_level2_name,
        province: item.province,
      }));

    if (strongStocks.length > 0) {
      pushFact({
        id: 'bigamap-stock-strength',
        kind: 'external_stock_strength',
        subjectType: 'stock',
        subjectKey: 'top_change_percent',
        title: 'BigAMap 个股强度 Top',
        summary: `BigAMap 涨幅靠前个股：${strongStocks
          .slice(0, Math.min(topN, 8))
          .map((item) => `${item.name}(${item.code}) ${formatPercent(item.changePercent)}`)
          .join('、')}。`,
        capturedAt,
        data: {
          rankingField: 'change_percent',
          topStocks: strongStocks,
          generatedAt: points.generated_at,
        },
        citationId: 'bigamap-fact-stock-strength',
        confidence: 0.82,
      });
    }
  }

  private aggregatePointGroups(
    items: BigAMapPointItem[],
    pickKey: (item: BigAMapPointItem) => string
  ): AggregatedGroup[] {
    const groups = new Map<string, { count: number; up: number; down: number; flat: number; amount: number; changeSum: number }>();

    for (const item of items) {
      const key = pickKey(item).trim();
      if (!key) {
        continue;
      }

      const change = toNumber(item.change_percent);
      const group = groups.get(key) ?? {
        count: 0,
        up: 0,
        down: 0,
        flat: 0,
        amount: 0,
        changeSum: 0,
      };

      group.count += 1;
      group.amount += toNumber(item.amount);
      group.changeSum += change;
      if (change > 0) {
        group.up += 1;
      } else if (change < 0) {
        group.down += 1;
      } else {
        group.flat += 1;
      }
      groups.set(key, group);
    }

    return Array.from(groups.entries())
      .map(([key, group]) => {
        const averageChange = group.count > 0 ? group.changeSum / group.count : 0;
        const upRatio = group.count > 0 ? group.up / group.count : 0;
        return {
          key,
          count: group.count,
          up: group.up,
          down: group.down,
          flat: group.flat,
          amount: group.amount,
          averageChange,
          score: averageChange * 100 + upRatio * 20 + Math.log10(Math.max(group.amount, 1)),
        };
      })
      .sort((left, right) => right.score - left.score);
  }

  private pushRankingFacts(
    rankings: BigAMapMaximizedRankingsResponse,
    capturedAt: string,
    topN: number,
    pushFact: (fact: V0MarketFactItem) => void
  ): void {
    const rollingRankings = rankings.rolling_rankings ?? {};
    const top7 = Array.isArray(rollingRankings.top7) ? rollingRankings.top7.slice(0, topN) : [];
    const dailyKeys = Object.keys(rollingRankings)
      .filter((key) => key !== 'top7' && Array.isArray(rollingRankings[key]))
      .sort()
      .reverse();

    const latestDaily = dailyKeys.length > 0 ? rollingRankings[dailyKeys[0]].slice(0, topN) : [];
    const primaryRanking = top7.length > 0 ? top7 : latestDaily;

    if (primaryRanking.length === 0) {
      return;
    }

    pushFact({
      id: 'bigamap-board-rolling-strength',
      kind: 'external_sector_strength',
      subjectType: 'sector',
      subjectKey: 'rolling_rankings',
      title: 'BigAMap 板块轮动强度',
      summary: `BigAMap 板块滚动强度靠前：${primaryRanking
        .map((item) => `${item.board_name ?? item.board_code}(${item.total_score ?? 0})`)
        .join('、')}。默认观察板块：${rankings.default_selection?.board_name ?? '暂无'}。`,
      capturedAt,
      data: {
        latestTradeDate: rankings.latest_trade_date,
        defaultSelection: rankings.default_selection,
        top7: top7,
        latestDaily,
      },
      citationId: 'bigamap-fact-board-rolling-strength',
      confidence: 0.86,
    });
  }

  private pushLimitReviewFacts(
    review: BigAMapLimitUpReviewResponse,
    capturedAt: string,
    topN: number,
    pushFact: (fact: V0MarketFactItem) => void
  ): void {
    const limitUpItems = Array.isArray(review.limit_up?.items) ? review.limit_up.items : [];
    const limitDownItems = Array.isArray(review.limit_down?.items) ? review.limit_down.items : [];
    const sealedStrong = limitUpItems
      .slice()
      .sort((left, right) => toNumber(right.sealed_amount) - toNumber(left.sealed_amount))
      .slice(0, topN);
    const chainLeaders = limitUpItems
      .slice()
      .sort(
        (left, right) =>
          toNumber(right.limit_up_days) - toNumber(left.limit_up_days) ||
          toNumber(right.sealed_amount) - toNumber(left.sealed_amount)
      )
      .slice(0, topN);

    pushFact({
      id: 'bigamap-limit-board-overview',
      kind: 'external_limit_board',
      subjectType: 'market',
      subjectKey: 'limit_board',
      title: 'BigAMap 涨跌停复盘',
      summary: `BigAMap ${review.trade_date ?? '最新交易日'} 涨停 ${limitUpItems.length} 只，跌停 ${limitDownItems.length} 只；封单靠前：${sealedStrong
        .slice(0, Math.min(topN, 6))
        .map((item) => `${item.stock_name ?? item.stock_code}(${formatAmountYi(item.sealed_amount)})`)
        .join('、') || '暂无'}。`,
      capturedAt,
      data: {
        tradeDate: review.trade_date,
        generatedAt: review.generated_at,
        limitUpCount: limitUpItems.length,
        limitDownCount: limitDownItems.length,
        sealedStrong: this.mapLimitItems(sealedStrong),
        chainLeaders: this.mapLimitItems(chainLeaders),
      },
      citationId: 'bigamap-fact-limit-board-overview',
      confidence: 0.84,
    });

    if (chainLeaders.length > 0) {
      pushFact({
        id: 'bigamap-limit-chain-leaders',
        kind: 'external_stock_strength',
        subjectType: 'stock',
        subjectKey: 'limit_up_days',
        title: 'BigAMap 连板梯队',
        summary: `BigAMap 连板高度靠前：${chainLeaders
          .map((item) => `${item.stock_name ?? item.stock_code}(${item.limit_up_days ?? 1}板，开板${item.break_board_count ?? 0}次)`)
          .join('、')}。`,
        capturedAt,
        data: {
          tradeDate: review.trade_date,
          chainLeaders: this.mapLimitItems(chainLeaders),
        },
        citationId: 'bigamap-fact-limit-chain-leaders',
        confidence: 0.82,
      });
    }
  }

  private mapLimitItems(items: BigAMapLimitUpItem[]): Array<Record<string, unknown>> {
    return items.map((item) => ({
      code: normalizeStockCode(undefined, item.stock_code),
      name: item.stock_name,
      changePercent: item.change_percent,
      latestPrice: item.latest_price,
      industry: item.industry,
      swLevel1Name: item.sw_level1_name,
      subMarket: item.sub_market,
      marketSegment: item.market_segment,
      limitUpDays: item.limit_up_days,
      firstLimitUpTime: item.first_limit_up_time,
      lastLimitUpTime: item.last_limit_up_time,
      sealedAmount: item.sealed_amount,
      breakBoardCount: item.break_board_count,
    }));
  }
}
