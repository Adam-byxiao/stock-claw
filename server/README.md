# Stock-Claw Server 技术文档

## 1. 概述
本项目是一个基于 Node.js 和 Fastify 的轻量级金融数据代理服务，旨在复刻 VS Code 插件 `leek-fund` 的核心数据获取逻辑。它提供了一套 RESTful API，用于获取实时股票行情、市场快讯以及资金流向数据。该服务设计为 OpenClaw Agent 的后端接口组件。

## 2. 技术栈
*   **运行时**: Node.js
*   **语言**: TypeScript
*   **Web 框架**: Fastify
*   **HTTP 客户端**: Axios (模拟浏览器请求头)
*   **编码处理**: iconv-lite (处理 GBK/GB18030 编码)

## 3. 接口文档

### 3.1 实时股票数据
获取指定 A 股股票的实时行情数据。

*   **URL**: `/api/stock`
*   **Method**: `GET`
*   **Query Params**:
    *   `codes`: 股票代码列表，逗号分隔 (e.g., `sh600519,sz000001`)
*   **Response**:
    ```json
    {
      "data": [
        {
          "id": "sh600519",
          "code": "sh600519",
          "name": "贵州茅台",
          "price": "1785.00",
          "open": "1788.00",
          "percent": "1.23",
          "updown": "20.50",
          "time": "2026-03-11 11:30:00"
          // ...更多字段
        }
      ]
    }
    ```

### 3.2 市场快讯 (选股宝)
获取最新的市场快讯和异动信息。

*   **URL**: `/api/news`
*   **Method**: `GET`
*   **Query Params**:
    *   `limit`: 获取数量 (默认 20)
*   **Response**:
    ```json
    {
      "data": [
        {
          "id": 123456,
          "title": "快讯标题",
          "summary": "快讯摘要...",
          "created_at": 1709123456,
          "stock_list": ["600519"]
        }
      ]
    }
    ```

### 3.3 板块资金流向
获取行业、概念或地域板块的资金净流入排行。

*   **URL**: `/api/fund/sector`
*   **Method**: `GET`
*   **Query Params**:
    *   `type`: 板块类型，可选 `concept` (概念), `industry` (行业), `region` (地域)
*   **Response**:
    ```json
    {
      "data": [
        {
          "code": "BK0123",
          "name": "白酒",
          "net_inflow": 100000000,
          "change_percent": 2.5
        }
      ]
    }
    ```

### 3.4 沪深港通资金流向 (HSGT)
获取北向和南向资金的实时流向。

*   **URL**: `/api/fund/hsgt`
*   **Method**: `GET`
*   **Response**:
    ```json
    {
      "data": {
        "hk2sh": { ... }, // 沪股通
        "hk2sz": { ... }, // 深股通
        "s2n": { ... }    // 北向资金汇总? (具体字段视上游接口而定)
      }
    }
    ```

## 4. 部署与运行
1.  安装依赖: `npm install`
2.  开发模式: `npm run dev` (监听端口 3001)
3.  构建: `npm run build`
4.  生产运行: `npm start`

## 5. Agent 集成
访问 `/manifest.json` 可获取 OpenClaw 兼容的工具描述文件，用于自动注册 Agent 工具。
