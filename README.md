# Stock-Claw 智能投研系统

Stock-Claw 是一个基于 Node.js 和 React 的实时股票行情与分析系统。它复刻了知名 VS Code 插件 `leek-fund` 的核心能力，提供了一套前后端分离的解决方案，旨在为用户提供实时的 A 股行情、市场快讯及资金流向监控，并为后续集成 AI 智能投研提供数据基础。

## 🚀 核心功能

### 1. 实时行情看板 (Dashboard)
*   **自选股管理**: 支持添加和管理 A 股自选股票（数据持久化）。
*   **实时数据**: 毫秒级刷新股票价格、涨跌幅、成交量等关键指标。
*   **直观展示**: 涨跌幅红绿高亮，一目了然。

### 2. 市场快讯 (News Feed)
*   **选股宝源**: 实时接入选股宝快讯接口，获取第一手市场消息。
*   **时间轴**: 按时间倒序展示，支持无限滚动加载。
*   **个股关联**: 自动识别快讯中涉及的股票代码。

### 3. 资金流向 (Fund Flow)
*   **板块资金**: 查看概念、行业、地域板块的主力资金净流入排行。
*   **南北向资金**: 实时监控沪股通、深股通及港股通的资金流向。

### 4. OpenClaw Agent 接口
*   后端服务提供标准的 HTTP API，并输出 `manifest.json`，可直接作为 Tool 集成到 OpenClaw 等 AI Agent 平台中，赋予 AI 获取实时金融数据的能力。

---

## 🛠️ 技术栈

*   **后端 (Server)**: Node.js, Fastify, TypeScript, Axios (模拟浏览器指纹)
*   **前端 (Client)**: React 18, Vite, TypeScript, Ant Design, React Query, Zustand
*   **数据源**: 新浪财经 (Sina), 选股宝 (XuanGuBao), 东方财富 (EastMoney)

---

## ⚡ 快速启动

本项目分为 `server` (后端) 和 `client` (前端) 两个部分，需要分别启动。

### 1. 启动后端服务

后端服务运行在 `3001` 端口，负责数据采集和接口转发。

```bash
cd server
npm install
npm run dev
```
启动成功后，访问 `http://localhost:3001/manifest.json` 可查看 Agent 工具描述。

### 2. 启动前端项目

前端页面运行在 `5173` 端口，提供可视化交互界面。

```bash
cd client
npm install
npm run dev
```
启动成功后，浏览器打开 `http://localhost:5173` 即可使用。

---

## 📂 目录结构

```
stock-claw/
├── server/             # 后端服务 (Node.js)
│   ├── src/core/       # 核心爬虫逻辑 (Stock, News, Fund)
│   └── src/index.ts    # API 入口
├── client/             # 前端项目 (React)
│   ├── src/pages/      # 页面视图 (Dashboard, News, FundFlow)
│   └── src/api/        # API 封装
├── leek-fund/          # 原 leek-fund 插件源码 (参考用)
└── README.md           # 项目说明文档
```
