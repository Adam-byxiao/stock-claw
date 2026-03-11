# Stock-Claw 前端技术设计文档 (Technical Design)

## 1. 技术栈选型
*   **构建工具**: Vite (高性能、快速热更新)
*   **框架**: React 18 + TypeScript (强类型，主流选择)
*   **UI 组件库**: Ant Design 5.x (企业级 UI，复刻 leek-fund 风格)
*   **状态管理**: Zustand (轻量级，替代 MobX)
*   **数据请求**: Axios + React Query (TanStack Query) (自动缓存、轮询、状态管理)
*   **路由**: React Router v6
*   **图表库**: ECharts 或 Ant Design Charts (适合金融图表)

## 2. 目录结构
```
client/
  ├── src/
  │   ├── api/            # API 接口封装
  │   │   ├── stock.ts
  │   │   ├── news.ts
  │   │   └── fund.ts
  │   ├── assets/         # 静态资源
  │   ├── components/     # 公共组件
  │   │   ├── Layout/     # 全局布局 (Sidebar, Header)
  │   │   └── StockCard/  # 股票卡片
  │   ├── pages/          # 页面视图
  │   │   ├── Dashboard/  # 行情看板
  │   │   ├── News/       # 市场快讯
  │   │   └── FundFlow/   # 资金流向
  │   ├── store/          # 全局状态 (Zustand)
  │   │   └── useStockStore.ts
  │   ├── types/          # TypeScript 类型定义
  │   ├── App.tsx         # 根组件
  │   └── main.tsx        # 入口文件
  ├── index.html
  ├── package.json
  └── vite.config.ts
```

## 3. 核心模块设计

### 3.1 API 层 (Axios + React Query)
*   配置 Axios 实例，设置 BaseURL 为 `http://localhost:3001/api`。
*   使用 React Query 的 `useQuery` 钩子进行数据获取，利用其 `refetchInterval` 属性实现行情的自动轮询（例如每 3000ms）。

### 3.2 状态管理 (Zustand)
*   **自选股管理**: `useStockStore`
    *   `state`: `selectedCodes` (string[])
    *   `actions`: `addCode(code)`, `removeCode(code)`
    *   **持久化**: 使用 `persist` 中间件将自选股列表保存到 `localStorage`。

### 3.3 页面实现

#### 3.3.1 行情看板 (Dashboard)
*   使用 Ant Design `Table` 组件。
*   列定义：
    *   代码/名称 (自定义渲染，带链接)
    *   最新价 (根据涨跌渲染颜色)
    *   涨跌幅 (Render: `<Tag color={val > 0 ? 'red' : 'green'}>{val}%</Tag>`)
*   头部包含 `Input.Search` 用于添加股票。

#### 3.3.2 市场快讯 (News)
*   使用 Ant Design `Timeline` 或 `List` 组件。
*   每个 Item 包含：时间戳 (格式化为 HH:mm)、标题 (加粗)、摘要 (折叠/展开)、相关股票 Tag。

#### 3.3.3 资金流向 (FundFlow)
*   **板块排行**: 使用 `Table` 展示 Top 20 数据。
*   **南北向资金**: 使用 ECharts 仪表盘或简单的 `Statistic` 卡片展示实时净流入。

## 4. 路由设计
*   `/`: 重定向至 `/dashboard`
*   `/dashboard`: 股票行情看板
*   `/news`: 市场快讯
*   `/fund-flow`: 资金流向

## 5. 开发计划
1.  初始化 Vite 项目。
2.  配置 Ant Design 和 Axios。
3.  实现 API 层封装。
4.  开发 Layout 和 Sidebar。
5.  依次开发 Dashboard, News, FundFlow 页面。
6.  联调与优化。
