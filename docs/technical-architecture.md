# Stock-Claw 技术架构文档

## 1. 文档目标

本文档定义 `Stock-Claw` 从原型级项目演进为完整多功能股票分析、行情查看与 Agent 平台的目标架构。

当前项目已经具备以下原型能力：

- 实时行情查询
- K 线与分时查看
- 资金流与快讯聚合
- 本地 SQLite 存储
- 基础量化筛选
- LLM 驱动的自然语言问答

下一阶段的核心目标不是继续堆叠页面，而是构建一个统一的平台，使其同时具备：

- `实时市场数据能力`
- `论坛情报监听能力`
- `人物认知与观点蒸馏能力`
- `盘中观点联动与指导能力`
- `可编排、可解释、可追溯的 Agent 能力`

## 2. 产品与架构北极星

### 2.1 平台定位

`Stock-Claw` 的目标形态是一个由四个核心引擎构成的投研工作台：

- `Stock Workbench`
- `Forum Intel`
- `Persona Engine`
- `Intraday Insight Engine`

这四个核心引擎由统一的 `Agent Runtime` 负责编排，并共享统一的 `Research Memory`。

### 2.2 核心原则

- `真实优先`：所有分析必须尽量绑定真实行情、真实原文、真实时间戳。
- `证据优先`：所有蒸馏结论、盘中建议和人物观点都必须可回溯到原始数据。
- `平台优先`：优先建设可复用能力，不做只能服务单一页面的临时逻辑。
- `单体先行`：先采用模块化单体，逻辑清晰后再决定是否拆分服务。
- `可扩展`：后续新增数据源、人物、论坛、信号规则和 Agent 工具时不应破坏主链路。

## 3. 总体架构

### 3.1 目标架构概览

系统整体采用 `单仓库 + 模块化单体后端 + 工作台前端 + 任务调度驱动` 的架构。

整体分为七层：

1. `Connector Layer`
2. `Normalization Layer`
3. `Market & Intel Storage Layer`
4. `Analysis & Distillation Layer`
5. `Skill Runtime Layer`
6. `Agent Orchestration Layer`
7. `Delivery & Workbench Layer`

### 3.2 各层职责

#### Connector Layer

负责接入外部数据源，不直接产生最终结论。

- 股票行情接口
- K 线与分时接口
- 新闻与快讯接口
- NGA 帖子抓取接口
- 后续可扩展公告、财务、研报、社交媒体等源

#### Normalization Layer

负责将不同来源的数据统一成可供后续消费的标准实体。

- `QuoteSnapshot`
- `KlineBar`
- `ForumMessage`
- `ForumThread`
- `MarketMention`
- `OpinionSignal`

#### Market & Intel Storage Layer

负责保存原始数据、结构化结果、任务状态和长期知识资产。

- 市场数据
- 论坛原文
- 作者档案
- 人物画像
- 推送记录
- 日报记录
- Agent 运行记录

#### Analysis & Distillation Layer

负责将原始数据转化为可解释知识。

- 股票与板块提及识别
- 情绪与方向标签
- 观点蒸馏
- 人物画像生成
- 技术指标计算
- 市场状态推断

#### Skill Runtime Layer

负责将分析结果变成可运行的技能。

- `Market Skill`
- `Persona Skill`
- `Forum Intel Skill`
- `Intraday Insight Skill`

#### Agent Orchestration Layer

负责将问题、工具、上下文和证据组织成一次完整执行。

- 意图识别
- 工具选择
- 多步执行
- 证据整合
- 结构化输出

#### Delivery & Workbench Layer

面向用户提供交互与分发能力。

- Web 工作台
- 即时推送
- 日报投递
- 任务面板
- 研究历史

## 4. 四大核心引擎

### 4.1 Stock Workbench

#### 定位

市场数据与研究操作的主工作台。

#### 职责

- 实时行情查看
- 指数、板块、个股、资金流查看
- 自选股与观察池管理
- 个股分析页
- 策略筛选入口
- Agent 分析结果承接

#### 当前可复用能力

项目现有 `client/` 与 `server/src/core/stock.ts`、`fund.ts`、`news.ts`、`screener.ts` 中的大部分逻辑可被吸收进入该引擎。

### 4.2 Forum Intel

#### 定位

高价值论坛情报监听与结构化处理引擎。

#### P0 核心目标

- 实时抓取 NGA 指定帖子中指定用户的发言
- 增量去重
- 即时推送
- 日报生成

#### 子模块

- `ThreadWatcher`
- `NGAConnector`
- `MessageExtractor`
- `IncrementalDeduper`
- `MessageEnricher`
- `Notifier`
- `DigestBuilder`

#### 关键职责

- 配置帖子与监控作者
- 定时轮询帖子内容
- 识别楼层、作者、时间、正文、编辑状态
- 识别股票、板块、指数、市场术语
- 生成新消息事件
- 推送实时提醒
- 生成按人、按票、按主题的日报

### 4.3 Persona Engine

#### 定位

将不同人物的发言沉淀为可检索、可解释、可运行的投资风格与分析能力。

#### P0 核心目标

- 按人聚合历史发言
- 形成结构化画像
- 生成人物风格化分析 skill
- 让 Agent 支持“人物视角分析”

#### 子模块

- `AuthorRegistry`
- `SpeechAggregator`
- `OpinionTagger`
- `PersonaDistiller`
- `EvidenceRetriever`
- `PersonaSkillRuntime`

#### 核心产物

- 人物档案
- 方法论摘要
- 代表性发言样本
- 关注领域偏好
- 风险偏好
- 近期观点变化
- 运行时 skill 配置

### 4.4 Intraday Insight Engine

#### 定位

将人物最新观点与真实盘中行情绑定，转化为可监控、可解释、可提醒的盘中观察与指导引擎。

#### 设计动机

仅有论坛监听和人物蒸馏还不够，系统还必须回答：

- 某人刚才说的大盘黄线，现在实际怎么走
- 某人提到的板块是否真的回流
- 某人关注的个股是不是已经出现确认或失效
- 当前走势在该人物体系下意味着什么

#### P0 核心目标

- 将最新发言中的市场对象自动映射为真实行情监控对象
- 自动生成盘中观察任务
- 持续刷新信号状态
- 输出盘中指导意见

#### 子模块

- `MentionParser`
- `HypothesisBuilder`
- `MarketBindingEngine`
- `SignalWatcher`
- `PersonaConstraintLayer`
- `IntradayAdvisor`

#### 核心输出

- 盘中观察任务
- 当前状态解释
- 条件是否触发
- 人物视角解读
- 盘中建议
- 失效条件

## 5. Agent Runtime

### 5.1 定位

统一编排 `Stock Workbench`、`Forum Intel`、`Persona Engine` 与 `Intraday Insight Engine` 的执行层。

### 5.2 当前问题

当前原型中的 `/api/agent/chat` 更像是单接口串行流程：

- 解析自然语言
- 调用筛选器
- 用 LLM 组织报告

这套模式不足以支撑后续复杂能力。

### 5.3 目标模式

后续升级为 `tool-based orchestration`。

Agent 工作流应当为：

1. 识别问题类型
2. 选择工具集合
3. 拉取实时数据与历史知识
4. 结合人物 skill 与市场上下文进行分析
5. 输出可追溯报告

### 5.4 建议工具注册表

- `get_realtime_quotes`
- `get_kline_context`
- `screen_stocks`
- `get_fund_flow`
- `get_forum_messages`
- `get_thread_watch_status`
- `get_author_recent_opinions`
- `get_author_persona_profile`
- `build_intraday_hypotheses`
- `watch_intraday_signals`
- `analyze_with_persona`
- `compare_persona_views`
- `build_daily_digest`
- `save_to_watchlist`

## 6. Research Memory

### 6.1 定位

所有长期知识、分析记录、任务状态与证据链的统一记忆层。

### 6.2 设计原则

- 所有结论必须留痕
- 所有推送必须可回查
- 所有人物画像必须有版本
- 所有 Agent 执行必须能还原使用过的证据

### 6.3 主要内容

- 论坛消息原文
- 发言结构化标签
- 人物画像与画像版本
- 盘中观察任务
- 行情快照
- 推送记录
- 日报记录
- 用户观察池
- 分析历史
- Agent 运行记录

## 7. 核心领域模型

### 7.1 ForumMessage

表示论坛中的一条结构化发言。

关键字段：

- `threadId`
- `floorId`
- `authorId`
- `authorName`
- `postedAt`
- `rawContent`
- `normalizedContent`
- `contentHash`
- `replyToFloorId`
- `editedAt`
- `sourceUrl`

### 7.2 MarketMention

表示发言中提及的市场对象。

关键字段：

- `messageId`
- `entityType`
- `entityName`
- `normalizedCode`
- `confidence`
- `contextSnippet`

其中 `entityType` 允许：

- `index`
- `yellow_line`
- `white_line`
- `sector`
- `stock`
- `theme`
- `market_style`
- `signal_pattern`

### 7.3 OpinionSignal

表示一条发言中的观点信号。

关键字段：

- `messageId`
- `signalType`
- `direction`
- `timeHorizon`
- `confidence`
- `reasoningType`
- `llmSummary`

### 7.4 PersonaProfile

表示某个作者的人物画像。

关键字段：

- `authorId`
- `styleSummary`
- `frameworkSummary`
- `riskPreference`
- `favoriteThemes`
- `commonSignals`
- `representativeQuotes`
- `recentShiftSummary`
- `sampleCount`
- `confidence`
- `version`

### 7.5 MarketHypothesis

表示从某条发言中提炼出的市场假设，是 `Intraday Insight Engine` 的核心实体。

典型例子：

- 黄线走弱则题材受压制
- 机器人板块午后回流才可参与
- 某个股弱转强后可跟随

关键字段：

- `sourceMessageId`
- `authorId`
- `hypothesisType`
- `subjectType`
- `subjectKey`
- `conditionText`
- `expectedState`
- `watchSignals`
- `activeWindow`
- `status`
- `invalidatedReason`

### 7.6 ObservationTask

表示一个正在运行的盘中观察任务。

关键字段：

- `hypothesisId`
- `taskType`
- `watchObjectType`
- `watchObjectKey`
- `watchConfig`
- `status`
- `lastSnapshotAt`
- `lastEvaluation`
- `triggeredAt`

## 8. 关键数据流

### 8.1 Forum Intel 数据流

1. 调度器触发帖子轮询
2. `NGAConnector` 抓取帖子页面
3. `MessageExtractor` 提取结构化发言
4. `IncrementalDeduper` 去重并判断增量
5. 新消息写入 `forum_messages`
6. `MessageEnricher` 识别股票、板块、主题与观点
7. 命中推送规则时写入 `notifications`
8. 每日由 `DigestBuilder` 生成 `daily_digests`

### 8.2 Persona Engine 数据流

1. 从 `forum_messages` 拉取某作者历史发言
2. `OpinionTagger` 为每条发言打标签
3. `SpeechAggregator` 做按人聚合
4. `PersonaDistiller` 生成人物画像
5. 写入 `persona_profiles` 与版本历史
6. `EvidenceRetriever` 维护画像与原始发言的证据绑定

### 8.3 Intraday Insight Engine 数据流

1. 新论坛发言进入系统
2. `MentionParser` 识别市场对象和观察意图
3. `HypothesisBuilder` 生成一个或多个 `MarketHypothesis`
4. `MarketBindingEngine` 将自然语言对象映射为真实市场实体与监控指标
5. 创建 `ObservationTask`
6. `SignalWatcher` 按频率刷新实时行情
7. `PersonaConstraintLayer` 基于人物画像解释当前状态
8. `IntradayAdvisor` 生成盘中指导意见
9. 状态发生变化时发送盘中提醒或写入日报

### 8.4 Agent 数据流

1. 接收用户问题
2. 识别是否涉及市场、论坛、人物或盘中监控
3. 选择相关工具
4. 拉取实时行情、历史发言、人物画像和盘中状态
5. 整合证据后生成结构化回答
6. 记录到 `agent_runs`

## 9. 行情绑定设计

### 9.1 目标

将论坛发言中的自然语言对象自动绑定到真实市场信号。

### 9.2 典型绑定规则

#### 大盘黄线

绑定对象：

- 指数分时数据
- 黄白线偏离
- 涨跌家数
- 微盘股与权重股强弱差
- 市场情绪风格指标

#### 板块回流

绑定对象：

- 板块指数涨幅
- 板块成交额变化
- 板块内涨停家数
- 核心股与跟风股联动
- 板块热度变化

#### 个股弱转强

绑定对象：

- 分时承接
- 量比
- 换手
- 分时突破情况
- 回封与封单质量

#### 大金融护盘

绑定对象：

- 证券、银行、保险板块走势
- 指数稳定度
- 权重股强度

### 9.3 输出要求

绑定层必须输出：

- 对象映射结果
- 当前监控指标集合
- 指标解释模板
- 触发条件
- 失效条件

## 10. 盘中指导输出规范

`IntradayAdvisor` 输出建议时，必须尽量使用结构化格式：

- `观察对象`
- `当前状态`
- `状态变化`
- `触发依据`
- `人物视角解释`
- `盘中建议`
- `风险提醒`
- `失效条件`

示例：

- 观察对象：机器人板块
- 当前状态：午后出现回流迹象，但扩散度不足
- 触发依据：板块成交额回升，核心股翻红，跟风股数量仍偏少
- 人物视角解释：按该人物一贯框架，这类回流属于试探性修复，不应直接定义为主升确认
- 盘中建议：继续观察，不建议追高，等待核心股二次确认
- 风险提醒：若黄线继续走弱，题材回流可能快速失效

## 11. 存储设计

### 11.1 存储策略

P0 阶段仍采用本地优先方案。

建议组合：

- `SQLite`：结构化业务数据
- `文件系统`：原始页面快照与调试产物
- `本地索引`：关键词检索、后续扩展向量检索

如果后续数据量增长明显，再评估迁移到 `PostgreSQL`。

### 11.2 P0 关键表

- `forum_threads`
- `forum_thread_cursors`
- `forum_authors`
- `forum_messages`
- `forum_message_mentions`
- `forum_message_analysis`
- `persona_profiles`
- `persona_profile_versions`
- `persona_evidence_links`
- `market_hypotheses`
- `market_bindings`
- `observation_tasks`
- `observation_snapshots`
- `intraday_advice_logs`
- `notifications`
- `daily_digests`
- `agent_runs`
- `agent_run_steps`
- `watchlists`
- `research_notes`

## 12. 调度与任务系统

### 12.1 为什么必须引入任务系统

当前项目缺少真正的调度与后台任务机制，而新的目标架构高度依赖定时与异步处理。

### 12.2 任务分类

#### Polling Jobs

- 帖子轮询
- 行情刷新
- 新闻刷新

#### Processing Jobs

- 提及识别
- 观点标签提取
- 人物画像蒸馏
- 市场假设生成
- 盘中状态评估

#### Delivery Jobs

- 实时推送
- 日报投递
- 状态变化通知

### 12.3 任务要求

- 幂等
- 可重试
- 有锁
- 可观测
- 支持手动触发
- 支持失败恢复

## 13. 前端工作台规划

### 13.1 页面模块

- `Market Dashboard`
- `Stock Detail`
- `Forum Monitor`
- `Persona Center`
- `Digest Center`
- `Research Copilot`
- `Task & Health Center`

### 13.2 重点新增页面

#### Forum Monitor

- 当前监控的帖子
- 当前作者白名单
- 最新发言流
- 抓取状态与失败重试
- 快速查看原文与提及对象

#### Persona Center

- 人物列表
- 画像详情
- 代表发言
- 风格与框架摘要
- 近期观点变化

#### Research Copilot

- 支持选择某个人物视角进行分析
- 支持查看某条最新发言所对应的盘中观察任务
- 支持查看盘中建议与失效条件

## 14. 推荐目录结构

### 14.1 后端

建议将 `server/src/core` 逐步演进为以下结构：

```text
server/src/
  modules/
    market/
    forum/
    persona/
    intraday/
    agent/
    research/
  shared/
    db/
    jobs/
    llm/
    types/
    utils/
  index.ts
```

### 14.2 前端

```text
client/src/
  features/
    market/
    forum/
    persona/
    intraday/
    agent/
    research/
  components/
  api/
  store/
  main.tsx
```

## 15. 实施阶段

### Phase 0：架构重整

- 重组模块边界
- 引入统一任务调度
- 建立统一数据模型
- 增加配置与日志层

### Phase 1：Forum Intel MVP

- 单 NGA 帖子监听
- 指定作者过滤
- 增量去重
- 实时推送
- 简版日报

### Phase 2：Persona Engine MVP

- 按人聚合发言
- 结构化观点提取
- 人物画像生成
- 人物视角分析接口

### Phase 3：Intraday Insight MVP

- 发言中的市场对象识别
- 市场假设生成
- 实时行情绑定
- 盘中观察任务
- 盘中指导建议

### Phase 4：Agent Integration

- 工具注册表
- 多步分析链路
- 证据化输出
- 支持人物视角与盘中状态联合分析

### Phase 5：Workbench 完善

- Forum Monitor
- Persona Center
- Digest Center
- Research Copilot
- 任务中心

## 16. P0 最短闭环

第一阶段不追求大而全，只追求一条真正可用的闭环：

- 一个 NGA 帖子
- 一组指定作者
- 一个推送渠道
- 一个日报模板
- 一套人物画像模板
- 一套盘中观点联动模板
- 一个 Agent 查询入口

只要这条链路稳定跑通，后续扩展到多帖子、多作者、多论坛、多人物、多推送渠道就会自然很多。

## 17. 架构结论

`Stock-Claw` 的新架构不应再围绕“几个页面和几个接口”构建，而应围绕以下主链路构建：

`论坛情报 -> 人物认知 -> 盘中观点联动 -> Agent 编排 -> 工作台交付`

其中：

- `Forum Intel` 提供实时情报入口
- `Persona Engine` 提供长期认知沉淀
- `Intraday Insight Engine` 负责把观点接到真实行情上
- `Agent Runtime` 负责统一分析与解释
- `Stock Workbench` 负责承接所有展示、交互与研究闭环

这是系统从原型级项目演进为完整投研平台的目标架构。
