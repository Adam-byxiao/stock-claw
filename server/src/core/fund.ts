import { httpGet } from '../utils/http';

export class FundFlowService {
  // Token from leek-fund source
  private readonly TOKEN = 'b2884a393a59ad64002292a3e90d46a5';

  private readonly EXCLUDE_GN = [
    '深成', '昨日涨停', '沪股通', 'MSCI中国', '央国企改革', '标准普尔', 
    '创业板综', '富时罗素', '深股通', '融资融券', 'S300', '沪深'
  ];

  async getSectorFundFlow(type: 'concept' | 'industry' | 'region' = 'concept') {
    // Mapping based on leek-fund/src/service/eastmoney.ts
    // Region: t:1, Industry: t:2, Concept: t:3
    const typeMap: Record<string, string> = {
        region: 'm:90+t:1',
        industry: 'm:90+t:2',
        concept: 'm:90+t:3'
    };
    
    const code = typeMap[type] || typeMap.concept;
    
    // Using the same API as leek-fund
    // https://data.eastmoney.com/dataapi/bkzj/getbkzj?key=f174&code=m%3A90%2Bt%3A1
    const url = `https://data.eastmoney.com/dataapi/bkzj/getbkzj?key=f174&code=${code}`;
    
    try {
        const data = await httpGet(url, 'json', { 
            Host: 'data.eastmoney.com',
            Referer: 'https://data.eastmoney.com/bkzj/'
        });
        
        if (data && data.data && data.data.diff) {
            let items = data.data.diff;
            
            // Filter logic for concepts
            if (type === 'concept') {
                items = items.filter((item: any) => 
                    !this.EXCLUDE_GN.some(exclude => item.f14.includes(exclude))
                );
            }

            // Map and sort
            const result = items.map((item: any) => ({
                code: item.f12,
                name: item.f14,
                // f174 is net inflow in Yuan (based on leek-fund dividing by 10^8)
                // leek-fund: parseFloat(convertToYi(item.f174))
                // We return raw value in Yuan, consistent with other APIs
                net_inflow: item.f174, 
                // This API doesn't seem to return price/change% (f2/f3) in the same way?
                // leek-fund only uses f14 (name) and f174 (inflow).
                // Let's check if f2/f3 exist. If not, frontend will show empty.
                // Based on leek-fund code, it only extracts f14 and f174.
                // We might need another API call if we want price info, 
                // but for now let's stick to what this API provides to ensure correct ranking.
                price: item.f2 || 0,
                change_percent: item.f3 || 0,
                net_inflow_ratio: item.f184 || 0
            }));

            // Sort by net_inflow desc
            result.sort((a: any, b: any) => b.net_inflow - a.net_inflow);

            // Return top 20
            return result.slice(0, 20);
        }
        return [];
    } catch (err) {
        console.error('Failed to get sector flow:', err);
        return [];
    }
  }

  async getHSGTFlow() {
    // Parameters from leek-fund template/flow.html
    // Using http://push2.eastmoney.com/api/qt/kamt/get
    const params = {
        fields1: 'f1,f3',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        ut: this.TOKEN
    };
    
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
      
    const url = `http://push2.eastmoney.com/api/qt/kamt/get?${queryString}`;
    
    try {
        const data = await httpGet(url, 'json', { Host: 'push2.eastmoney.com' });
        if (data && data.data) {
            const d = data.data;
            return {
                // f51: 沪股通净流入 (北向) - 单位: 万元
                // f52: 深股通净流入 (北向) - 单位: 万元
                // f53: 港股通(沪)净流入 (南向) - 单位: 万元
                // f54: 港股通(深)净流入 (南向) - 单位: 万元
                north_sh_net: d.f51, 
                north_sz_net: d.f52, 
                south_sh_net: d.f53, 
                south_sz_net: d.f54
            };
        }
        return {};
    } catch (err) {
        console.error('Failed to get HSGT flow:', err);
        return {};
    }
  }
}
