# Stock-Claw 前端更新设计文档

为了支持更丰富的投研数据展示，我们将对 `StockDetail`（股票详情页）进行全面重构。新设计将采用专业的“交易终端”风格布局，整合实时行情、图表分析与基本面数据。

## 1. 页面布局 (Layout)

页面将采用 **左右分栏** 布局，以最大化信息展示效率。

### 1.1 顶部栏 (Header)
*   **左侧**: 返回按钮、股票名称 (大号字体)、股票代码 (灰色小字)。
*   **右侧**: 实时价格 (特大号字体，红涨绿跌)、涨跌幅、涨跌额、更新时间。

### 1.2 左侧主区域 (Main Chart Area) - 占比 70%
*   **功能**: 承载核心图表交互。
*   **组件**:
    *   **周期切换 Tabs**: 分时 | 日线 | 周线 | 月线 | 5分 | 15分 | 30分 | 60分。
    *   **图表容器**: ECharts 实例 (支持 K 线与分时图切换)。
    *   **未来扩展**: 下方可预留新闻 (News) 和公告 (Notices) 的 Tab 页签。

### 1.3 右侧侧边栏 (Side Panel) - 占比 30%
侧边栏用于展示详细的统计数据，分为两个卡片：

#### A. 基础行情 (Quote Stats)
展示当日交易的核心数据：
*   **今开 / 昨收**
*   **最高 / 最低**
*   **成交量 / 成交额**
*   **振幅 / 换手率** (新增)
*   **量比 / 委比** (新增，如数据源支持)

#### B. 基本面指标 (Fundamental Stats) - **New**
展示公司的估值与规模数据，辅助价值判断：
*   **市盈率 (PE-TTM)**: 动态市盈率，评估估值高低。
*   **市净率 (PB)**: 评估资产溢价。
*   **总市值**: 公司整体价值。
*   **流通市值**: 实际可交易的市值规模。

## 2. API 接口需求

需要新增 `/api/stock/info` 接口来支持上述数据展示。

### GET /api/stock/info
*   **描述**: 获取股票的详细行情与基本面数据。
*   **参数**: `code` (e.g., `sh600519`)
*   **数据源**: 腾讯财经 (`http://qt.gtimg.cn/q=`)
*   **返回字段**:
    ```typescript
    interface StockInfo {
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
      // 新增字段
      turnover_rate: number; // 换手率 (v[38])
      pe_ttm: number;        // 市盈率 (v[39])
      pb: number;            // 市净率 (v[46])
      market_cap: number;    // 总市值 (v[45])
      float_market_cap: number; // 流通市值 (v[44])
      amplitude: number;     // 振幅 (v[43])
    }
    ```

## 3. 组件拆分 (Component Strategy)

为了保持代码整洁，`StockDetail.tsx` 将拆分为以下子组件（建议）：
1.  `StockHeader`: 顶部价格栏。
2.  `StockChart`: 图表区域封装。
3.  `StockStats`: 右侧侧边栏，内部包含 `QuoteInfo` 和 `FundamentalInfo`。

(本次重构暂不强制拆分文件，但在代码结构上会保持模块化)
