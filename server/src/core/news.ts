import { httpGet } from '../utils/http';

export interface FlashNews {
  id: number;
  title: string;
  summary: string;
  created_at: number;
  impact: number;
  stock_list: string[];
}

export class NewsService {
  async getFlashNews(limit: number = 20): Promise<FlashNews[]> {
    const url = 'https://baoer-api.xuangubao.com.cn/api/v6/message/newsflash';
    const params = {
      limit,
      subj_ids: '9,10,723,35,469',
      platform: 'pcweb'
    };
    
    // Construct query string manually or use a lib. 
    // leek-fund uses objectToQueryString.
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
      
    const fullUrl = `${url}?${queryString}`;
    
    const headers = {
        'Referer': 'https://xuangutong.com.cn/',
        'x-appgo-platform': 'device=pc',
        'x-track-info': '{"AppId":"com.xuangutong.web","AppVersion":"1.0.0"}',
        'Origin': 'https://xuangutong.com.cn'
    };

    try {
      const data = await httpGet(fullUrl, 'json', headers);
      if (data && data.code === 20000 && data.data && data.data.messages) {
        return data.data.messages.map((msg: any) => ({
          id: msg.id,
          title: msg.title,
          summary: msg.summary,
          created_at: msg.created_at,
          impact: msg.impact,
          stock_list: msg.bkj_stock_list || []
        }));
      }
      return [];
    } catch (err) {
      console.error('Failed to get flash news:', err);
      return [];
    }
  }
}
