# Stock-Claw V0 实施蓝图

## 1. 文档目标

本文档定义 `Stock-Claw` 的 `V0 快速可跑版` 如何落地。

这不是完整项目架构文档，也不是最终技术方案，而是一份面向“先跑起来”的实施蓝图，目标是：

- 明确 V0 的边界
- 明确 V0 的最短闭环
- 明确 V0 的页面、模块、接口、表结构与任务流
- 明确 V0 的开发顺序
- 让团队可以在不陷入复杂架构的前提下，快速做出一个真正可用的版本

## 2. V0 核心原则

V0 只遵守五个原则：

- `先跑通闭环`：优先把一条可用链路做通，而不是把系统做全
- `先做脚手架式实现`：允许用简化目录和轻量逻辑快速搭建
- `先可观察`：抓取、解析、推送、联动都必须在页面或日志里看得见
- `先保留迁移空间`：即使是临时实现，也要尽量避免后续无法重构
- `先小后大`：V0 只支持一个帖子、一组作者、一个推送渠道、一套最小规则

## 3. V0 一句话定义

V0 是一个能够监听 `NGA 指定帖子 + 指定作者`、展示实时消息流、做基础结构化理解、绑定实时行情并输出基础盘中提示的最小可用工具。

## 4. V0 最短闭环

V0 必须跑通以下闭环：

`帖子配置 -> 定时抓取 -> 指定作者过滤 -> 新发言入库 -> 提及对象识别 -> 行情绑定 -> 页面展示 -> 即时推送 -> 日报汇总 -> 基础 Agent 查询`

只要这条闭环能稳定跑通，V0 就是成功的。

## 5. V0 范围冻结

### 5.1 V0 必做范围

- 一个 NGA 帖子监听
- 一组指定作者白名单
- 轮询抓取与增量去重
- 新发言列表页
- 即时推送
- 简版日报
- 提及股票/板块/黄线等对象识别
- 基础行情绑定
- 基础盘中提示
- 基础 Agent 查询

### 5.2 V0 明确不做

- 多帖子管理
- 多推送渠道并行
- 完整人物画像系统
- 完整盘中观察任务系统
- 复杂多工具 Agent 编排
- 完整工作台重构
- 完整调度平台
- 完整权限系统

## 6. V0 交付形态

V0 建议继续基于当前项目实现，不另起新仓库。

交付形态如下：

- 前端：继续使用当前 `React + Ant Design`
- 后端：继续使用当前 `Fastify + TypeScript`
- 数据库：继续使用 `SQLite`
- 调度：使用进程内定时器或轻量 job runner
- 推送：接入一个最简单可用的渠道

## 7. V0 用户场景

### 场景 1：盘中盯指定人物

1. 用户配置一个 NGA 帖子和若干关注作者
2. 系统开始轮询
3. 页面实时出现新发言
4. 系统对命中发言发送提醒

### 场景 2：看发言对应的市场状态

1. 新发言中提到板块、个股或黄线
2. 系统自动识别对象
3. 系统拉取相关行情
4. 页面展示“当前走势解释 + 基础盘中提示”

### 场景 3：做简版复盘

1. 到达日报时间
2. 系统汇总今日新增发言
3. 输出按人、按票、按主题的简版日报

### 场景 4：通过 Agent 快速询问

用户可以直接提问：

- “今天某人说了什么”
- “某人提到的票现在怎么样”
- “他说的板块回流现在成立吗”

## 8. V0 产品页面

V0 不做复杂信息架构，只做 3 个主页面。

### 8.1 监控配置页

目标：让系统能跑起来。

包含内容：

- 当前监听帖子 URL
- 当前作者白名单
- 抓取间隔
- 推送开关
- 最近一次抓取状态
- 手动触发抓取按钮

### 8.2 消息流页

目标：让用户直观看到新发言与联动结果。

包含内容：

- 最新发言列表
- 作者、时间、原文
- 提及对象标签
- 是否已推送
- 基础行情联动结果
- 一条简短盘中提示

### 8.3 简版 Agent 页

目标：验证问答入口。

支持三类问题：

- 某作者今天说了什么
- 某作者提到的票现在表现如何
- 某个观点当前是否成立

## 9. V0 后端模块拆分

V0 阶段不要直接做完整模块化重构，但需要先以最小边界搭出后续可迁移结构。

建议新增如下目录：

```text
server/src/
  v0/
    forum/
    market/
    digest/
    push/
    agent/
    shared/
```

## 10. V0 文件级实施建议

### 10.1 后端文件

建议新增以下文件：

```text
server/src/v0/forum/threadConfig.ts
server/src/v0/forum/ngaConnector.ts
server/src/v0/forum/messageParser.ts
server/src/v0/forum/messageStore.ts
server/src/v0/forum/messageEnricher.ts
server/src/v0/forum/forumService.ts
server/src/v0/market/marketBinding.ts
server/src/v0/market/marketSummary.ts
server/src/v0/digest/digestService.ts
server/src/v0/push/pushService.ts
server/src/v0/agent/agentService.ts
server/src/v0/shared/types.ts
server/src/v0/shared/jobs.ts
```

#### 文件职责

- `threadConfig.ts`
  - 读取和管理 V0 的帖子配置、作者白名单、抓取间隔
- `ngaConnector.ts`
  - 负责拉取帖子原始内容
- `messageParser.ts`
  - 将页面解析为结构化消息
- `messageStore.ts`
  - 负责消息入库、去重、查询
- `messageEnricher.ts`
  - 负责提及对象识别与初步标签化
- `forumService.ts`
  - 组织一次完整的抓取、解析、存储流程
- `marketBinding.ts`
  - 将消息提到的对象绑定到市场行情
- `marketSummary.ts`
  - 生成简短的盘中状态说明
- `digestService.ts`
  - 生成简版日报
- `pushService.ts`
  - 发送推送消息
- `agentService.ts`
  - 完成 V0 的简化问答逻辑
- `types.ts`
  - 定义 V0 统一类型
- `jobs.ts`
  - 管理轮询、日报等最小任务调度

### 10.2 前端文件

建议新增如下目录和文件：

```text
client/src/features/v0/
  api.ts
  pages/V0MonitorPage.tsx
  pages/V0MessagesPage.tsx
  pages/V0AgentPage.tsx
  components/ThreadConfigCard.tsx
  components/MessageFeed.tsx
  components/MessageCard.tsx
  components/MarketBindingCard.tsx
  components/JobStatusCard.tsx
  types.ts
```

#### 文件职责

- `api.ts`
  - 封装 V0 接口请求
- `V0MonitorPage.tsx`
  - 配置与状态总览页面
- `V0MessagesPage.tsx`
  - 新发言流展示页
- `V0AgentPage.tsx`
  - 简版问答页
- `ThreadConfigCard.tsx`
  - 帖子和作者配置组件
- `MessageFeed.tsx`
  - 消息列表容器
- `MessageCard.tsx`
  - 单条发言展示组件
- `MarketBindingCard.tsx`
  - 单条发言的行情联动展示
- `JobStatusCard.tsx`
  - 显示任务运行状态
- `types.ts`
  - 前端类型定义

## 11. V0 最小数据模型

V0 只建 8 张核心表，先保证闭环。

### 11.1 `v0_thread_configs`

字段建议：

- `id`
- `thread_url`
- `thread_title`
- `poll_interval_seconds`
- `enabled`
- `created_at`
- `updated_at`

### 11.2 `v0_author_watchlist`

字段建议：

- `id`
- `author_name`
- `alias`
- `enabled`
- `created_at`

### 11.3 `v0_thread_cursors`

字段建议：

- `id`
- `thread_config_id`
- `last_floor_id`
- `last_posted_at`
- `last_content_hash`
- `updated_at`

### 11.4 `v0_forum_messages`

字段建议：

- `id`
- `thread_config_id`
- `floor_id`
- `author_name`
- `posted_at`
- `raw_content`
- `normalized_content`
- `content_hash`
- `source_url`
- `is_new`
- `created_at`

### 11.5 `v0_message_mentions`

字段建议：

- `id`
- `message_id`
- `entity_type`
- `entity_name`
- `normalized_code`
- `confidence`

### 11.6 `v0_message_market_state`

字段建议：

- `id`
- `message_id`
- `subject_type`
- `subject_key`
- `snapshot_json`
- `summary_text`
- `advice_text`
- `created_at`

### 11.7 `v0_notifications`

字段建议：

- `id`
- `message_id`
- `channel`
- `status`
- `sent_at`
- `payload_json`

### 11.8 `v0_daily_digests`

字段建议：

- `id`
- `digest_date`
- `content_markdown`
- `status`
- `sent_at`

## 12. V0 API 设计

V0 不追求 REST 完整性，只提供最少可用接口。

### 12.1 配置接口

- `GET /api/v0/config`
  - 获取当前帖子配置、作者名单和抓取间隔
- `POST /api/v0/config`
  - 保存帖子配置和作者名单

### 12.2 抓取与任务接口

- `POST /api/v0/poll`
  - 手动触发一次抓取
- `GET /api/v0/jobs/status`
  - 获取最近抓取状态、最后成功时间、最近错误

### 12.3 消息接口

- `GET /api/v0/messages`
  - 获取最新消息流
- `GET /api/v0/messages/:id`
  - 获取单条消息详情和联动结果

### 12.4 日报接口

- `POST /api/v0/digest/build`
  - 手动触发生成日报
- `GET /api/v0/digests`
  - 查看历史日报

### 12.5 Agent 接口

- `POST /api/v0/agent/query`
  - 执行简版问答

## 13. V0 任务流设计

V0 只做 3 类任务。

### 13.1 帖子轮询任务

执行流程：

1. 读取线程配置
2. 请求 NGA 帖子
3. 解析消息
4. 只保留白名单作者
5. 去重
6. 入库
7. 调用提及识别
8. 调用行情绑定
9. 调用推送

### 13.2 日报任务

执行流程：

1. 读取当天消息
2. 按作者聚合
3. 按股票聚合
4. 按主题聚合
5. 输出 Markdown
6. 保存并推送

### 13.3 简版联动任务

执行流程：

1. 读取一条新消息的 mentions
2. 根据对象类型调用行情接口
3. 生成一个简短 `summary_text`
4. 生成一个基础 `advice_text`
5. 回写数据库

## 14. V0 对象识别规则

V0 不做复杂 NLP，采用 `规则优先 + 少量 LLM 辅助`。

### 14.1 股票识别

- 股票代码正则
- 常见股票简称词典
- 从现有股票池和搜索接口补全

### 14.2 板块识别

- 维护一份常见板块关键词表
- 命中后映射到板块代码或板块名称

### 14.3 大盘黄线与市场术语识别

V0 先支持以下高频术语：

- `黄线`
- `白线`
- `回流`
- `弱转强`
- `分歧`
- `一致`
- `护盘`
- `情绪`
- `龙头`

### 14.4 V0 识别输出

每条消息至少输出：

- 提到了什么对象
- 对象类型是什么
- 是否需要绑定行情

## 15. V0 行情绑定规则

### 15.1 个股

当提到个股时，绑定：

- 最新价
- 涨跌幅
- 分时简述
- 简短提示

提示示例：

- 当前仍弱，不符合强势确认
- 价格翻红但量能一般，先观察
- 走势偏强，但不建议直接追高

### 15.2 板块

当提到板块时，绑定：

- 板块涨幅
- 板块内核心股
- 板块强弱简述

提示示例：

- 板块有回流迹象，但扩散不足
- 板块仍弱，暂未形成修复

### 15.3 黄线 / 白线 / 大盘风格

当提到黄线或白线时，绑定：

- 指数分时
- 黄白线强弱解释
- 市场风格简述

提示示例：

- 黄线偏弱，题材环境承压
- 黄线走强，小票相对占优

## 16. V0 推送方案

V0 只接一个最省事的推送渠道。

推荐优先级：

1. 企业微信机器人
2. Telegram
3. 邮件

推送内容格式建议：

- 作者
- 时间
- 原文摘要
- 提及对象
- 一行行情联动说明
- 回链到本地页面

## 17. V0 简版 Agent 设计

V0 的 Agent 不做完整工具编排，只做有限问答。

### 17.1 支持的问题类型

- `author_daily_summary`
- `author_stock_status`
- `opinion_validation`

### 17.2 回答方式

优先逻辑：

- 先查本地数据库
- 再查实时行情
- 最后由 LLM 组织自然语言

### 17.3 V0 不做

- 多人物辩论
- 完整人物 skill runtime
- 长链路计划执行

## 18. V0 开发顺序

V0 建议按 7 个步骤推进。

### Step 1：最小配置与数据库

目标：

- 先把配置、作者名单、基础表建起来

完成标准：

- 能保存帖子 URL
- 能保存作者名单
- 能初始化 SQLite 表

### Step 2：帖子抓取与去重

目标：

- 跑通最基础抓取链路

完成标准：

- 能拉到帖子内容
- 能解析出结构化消息
- 能过滤作者
- 能避免重复入库

### Step 3：消息流页面

目标：

- 让用户能看到系统已经“活着”

完成标准：

- 能在前端看到最新消息流
- 能看到作者、时间、原文

### Step 4：提及识别与行情绑定

目标：

- 让系统开始理解发言

完成标准：

- 能识别股票/板块/黄线
- 能展示联动的基础行情信息
- 能给出一条简短盘中提示

### Step 5：即时推送

目标：

- 让用户不必一直盯页面

完成标准：

- 新消息可以触发推送
- 有推送记录

### Step 6：日报

目标：

- 做出最基础复盘能力

完成标准：

- 能生成并查看日报
- 能包含按人、按票、按主题汇总

### Step 7：简版 Agent

目标：

- 给 V0 一个可问答入口

完成标准：

- 能回答作者当天发言情况
- 能回答某条观点当前绑定的市场状态

## 19. V0 两周节奏建议

### 第 1 周

- Day 1：建表、配置接口、配置页
- Day 2：帖子抓取与解析
- Day 3：去重与消息入库
- Day 4：消息流页面
- Day 5：手动触发抓取、任务状态展示

### 第 2 周

- Day 6：提及识别
- Day 7：行情绑定
- Day 8：推送接入
- Day 9：日报生成
- Day 10：简版 Agent 问答

## 20. V0 验收清单

### 功能验收

- [ ] 能保存帖子配置与作者名单
- [ ] 能抓取并展示指定作者新发言
- [ ] 能正确去重
- [ ] 能识别至少三类对象：个股、板块、黄线
- [ ] 能展示基础行情联动结果
- [ ] 能发送至少一种推送
- [ ] 能生成至少一种日报
- [ ] 能通过简版 Agent 进行基础查询

### 体验验收

- [ ] 页面可以连续使用，不需要频繁刷新
- [ ] 新消息出现时足够直观
- [ ] 联动结果足够简洁易懂
- [ ] 推送内容不冗长

## 21. V0 之后的升级方向

V0 成功后，下一阶段再逐步演进：

- 从 `单帖子` 扩展到 `多帖子`
- 从 `作者白名单` 扩展到 `作者中心`
- 从 `基础行情绑定` 扩展到 `盘中观察任务`
- 从 `简版 Agent` 扩展到 `完整 tool-based Agent Runtime`
- 从 `脚手架式目录` 迁移到 `modules/forum`、`modules/persona`、`modules/intraday`

## 22. 蓝图结论

V0 的关键不是完整，而是“最短闭环 + 明显价值 + 可持续迭代”。

因此 V0 的正确做法不是一开始追求完整系统，而是先把以下能力跑通：

- 稳定监听指定人物
- 把发言实时呈现出来
- 理解发言中提到的市场对象
- 把对象接到真实行情
- 给出足够有用的基础盘中提示
- 通过推送和日报把使用频率拉起来

只要这几个点跑通，`Stock-Claw` 就从“原型项目”进入了“可真实使用的工具阶段”。
