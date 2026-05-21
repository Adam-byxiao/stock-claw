import { httpGet } from '../../utils/http';

const BIGAMAP_BASE_URL = 'https://api.bigamap.cn/api/v1/public/map';

export interface BigAMapPointsSummary {
  total_items?: number;
  fresh_items?: number;
  stale_items?: number;
  up_items?: number;
  down_items?: number;
  flat_items?: number;
}

export interface BigAMapPointItem {
  stock_id?: number;
  code?: string;
  name?: string;
  market?: string;
  province?: string;
  industry?: string;
  sw_level1_name?: string;
  sw_level2_name?: string;
  sw_level3_name?: string;
  longitude?: number;
  latitude?: number;
  latest_price?: number;
  change_amount?: number;
  change_percent?: number;
  amount?: number;
  volume?: number;
  source_synced_at?: string;
  quote_status?: string;
}

export interface BigAMapPointsResponse {
  generated_at?: string;
  quote_delay_notice?: string;
  summary?: BigAMapPointsSummary;
  items?: BigAMapPointItem[];
}

export interface BigAMapBoardRankingItem {
  board_code?: string;
  board_name?: string;
  total_score?: number;
}

export interface BigAMapMaximizedRankingsResponse {
  latest_trade_date?: string;
  default_selection?: {
    trade_date?: string;
    board_code?: string;
    board_name?: string;
  };
  rolling_rankings?: Record<string, BigAMapBoardRankingItem[]>;
}

export interface BigAMapLimitUpItem {
  stock_code?: string;
  stock_name?: string;
  change_percent?: number;
  latest_price?: number;
  industry?: string;
  sw_level1_name?: string;
  sub_market?: string;
  market_segment?: string;
  limit_up_days?: number | null;
  first_limit_up_time?: string | null;
  last_limit_up_time?: string | null;
  limit_down_days?: number | null;
  sealed_amount?: number | null;
  break_board_count?: number | null;
  previous_limit_up_days?: number | null;
  previous_limit_up_time?: string | null;
  strong_reason?: string | null;
  is_new_high?: boolean | null;
  board_traded_amount?: number | null;
}

export interface BigAMapLimitUpReviewResponse {
  trade_date?: string;
  generated_at?: string;
  limit_up?: {
    title?: string;
    items?: BigAMapLimitUpItem[];
  };
  limit_down?: {
    title?: string;
    items?: BigAMapLimitUpItem[];
  };
}

export interface BigAMapPublicMapProvider {
  getPoints(): Promise<BigAMapPointsResponse | null>;
  getMaximizedRankings(): Promise<BigAMapMaximizedRankingsResponse | null>;
  getLimitUpReview(): Promise<BigAMapLimitUpReviewResponse | null>;
}

export class HttpBigAMapPublicMapProvider implements BigAMapPublicMapProvider {
  async getPoints(): Promise<BigAMapPointsResponse | null> {
    return this.getJson<BigAMapPointsResponse>('/points');
  }

  async getMaximizedRankings(): Promise<BigAMapMaximizedRankingsResponse | null> {
    return this.getJson<BigAMapMaximizedRankingsResponse>('/boards/maximized-rankings');
  }

  async getLimitUpReview(): Promise<BigAMapLimitUpReviewResponse | null> {
    return this.getJson<BigAMapLimitUpReviewResponse>('/limit-up-review');
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const data = await httpGet(`${BIGAMAP_BASE_URL}${path}`, 'json', {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://bigamap.cn',
      Referer: 'https://bigamap.cn/',
      Host: 'api.bigamap.cn',
    });

    if (!data || typeof data !== 'object') {
      return null;
    }

    return data as T;
  }
}
