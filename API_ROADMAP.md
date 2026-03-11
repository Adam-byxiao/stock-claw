# Stock-Claw API 开发路线图 (Roadmap)

为了更好地支持外部 Agent（如 OpenClaw）进行智能投研，我们需要进一步丰富后端 API 的能力，使其不仅限于基础行情，还能提供深度的基本面、消息面及资金面数据。

## 1. 现有 API 功能

目前已实现的基础行情与快讯接口：

| 接口路径 | 方法 | 描述 | 数据源 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| `/api/stock` | GET | 批量获取实时行情 (Price, Volume, Change) | Sina | ✅ 已完成 |
| `/api/stock/search` | GET | 股票模糊搜索 (Code/Name/Pinyin) | Tencent | ✅ 已完成 |
| `/api/stock/kline` | GET | K 线数据 (Day/Week/Month/Min5/15/30/60) | Tencent | ✅ 已完成 |
| `/api/stock/timeline` | GET | 分时走势数据 (Minute Timeline) | Tencent | ✅ 已完成 |
| `/api/news` | GET | 市场快讯 (Flash News) | XuanGuBao | ✅ 已完成 |
| `/api/fund/sector` | GET | 板块资金流向 (Concept/Industry/Region) | EastMoney | ✅ 已完成 |
| `/api/fund/hsgt` | GET | 沪深港通资金流 (North/South Bound) | EastMoney | ✅ 已完成 |

---

## 2. 计划新增 API (Planned)

### 2.1 股票基本面 (Fundamental)
Agent 需要了解公司的基本情况，如市盈率、市净率、总市值、流通市值、行业地位等。

- **接口**: `/api/stock/info`
- **参数**: `code` (e.g., `sh600519`)
- **返回**:
  ```json
  {
    "code": "sh600519",
    "name": "贵州茅台",
    "pe_ttm": 30.5,       // 市盈率(TTM)
    "pb": 8.2,            // 市净率
    "total_market_cap": 21000.0, // 总市值(亿)
    "float_market_cap": 21000.0, // 流通市值(亿)
    "industry": "白酒",    // 所属行业
    "roe": 28.5,          // 净资产收益率
    "net_profit_growth": 15.2 // 净利润增长率
  }
  ```
- **建议数据源**: 腾讯财经 (`http://qt.gtimg.cn/q=sh600519`) 或 新浪财经。

### 2.2 个股新闻与公告 (Individual News)
Agent 需要针对特定股票进行舆情分析，而不仅仅是全市场的快讯。

- **接口**: `/api/stock/news`
- **参数**: `code`, `limit` (default 10)
- **返回**:
  ```json
  [
    {
      "title": "贵州茅台：2023年净利润同比增长19%",
      "url": "http://...",
      "publish_time": "2024-03-10 18:00:00",
      "source": "公司公告"
    }
  ]
  ```
- **建议数据源**: 东方财富 (`http://guba.eastmoney.com`) 或 新浪财经 (`http://vip.stock.finance.sina.com.cn`).

### 2.3 龙虎榜数据 (Dragon Tiger List)
Agent 可通过龙虎榜分析游资和机构的动向。

- **接口**: `/api/stock/longhubang`
- **参数**: `date` (YYYY-MM-DD, optional)
- **返回**:
  ```json
  [
    {
      "code": "sz000001",
      "name": "平安银行",
      "reason": "日涨幅偏离值达7%",
      "net_buy": 5000.0, // 净买入(万)
      "buy_seats": ["深股通专用", "机构专用"],
      "sell_seats": ["中信证券上海分公司"]
    }
  ]
  ```
- **建议数据源**: 东方财富 (`https://data.eastmoney.com/stock/lhb.html`).

### 2.4 财务报表摘要 (Financial Summary)
获取最近几个季度的核心财务指标。

- **接口**: `/api/stock/financial`
- **参数**: `code`
- **返回**:
  ```json
  {
    "quarters": ["2023Q4", "2023Q3", "2023Q2"],
    "revenue": [100.0, 90.0, 85.0], // 营收
    "net_profit": [50.0, 45.0, 40.0] // 净利润
  }
  ```
- **建议数据源**: 东方财富 (`http://emweb.securities.eastmoney.com`).

---

## 3. Agent 交互示例 (Prompt)

完善上述 API 后，OpenClaw Agent 可以处理如下复杂指令：

1.  **基本面选股**:
    > "帮我找出食品饮料行业中，PE低于30且ROE大于20%的股票。"
    > (Agent 调用 `/api/stock/info` 批量筛选)

2.  **舆情分析**:
    > "分析一下贵州茅台最近一周的新闻，看看有没有利空消息。"
    > (Agent 调用 `/api/stock/news` 获取列表并总结)

3.  **异动分析**:
    > "今天龙虎榜上有哪些机构净买入超过1亿的股票？"
    > (Agent 调用 `/api/stock/longhubang` 过滤数据)

4.  **综合诊断**:
    > "结合技术面（K线形态）和基本面（财报），给出一份平安银行的投资分析报告。"
    > (Agent 综合调用 `/api/stock/kline` 和 `/api/stock/financial`)

## 4. 开发优先级

1.  **P0**: `/api/stock/info` - 补全个股基本面数据，这是最基础的分析维度。
2.  **P1**: `/api/stock/news` - 引入个股维度的消息面。
3.  **P2**: `/api/stock/financial` - 引入简要财报数据。
4.  **P3**: `/api/stock/longhubang` - 引入资金博弈数据。
