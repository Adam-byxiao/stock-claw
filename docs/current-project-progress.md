# Stock-Claw 当前项目进度文档

## 1. 文档目标

本文档用于记录 `Stock-Claw` 截至当前时点的实际工程进度、闭环完成情况、调试观察、已知问题与下一阶段建议，供后续开发直接参考。

当前阶段定位：

- 已从“原型项目”推进到 `V0 可运行闭环`
- 核心方向仍然是：
  - 论坛人物监听
  - 行情联动
  - 推送与日报
  - 简版 Agent
  - 运行态联调

## 2. 当前总体结论

当前项目已经完成一条可验证的 `V0 主闭环`：

1. 保存帖子与作者配置
2. 抓取 NGA 帖子 HTML
3. 解析结构化消息
4. 消息入库、去重、游标更新
5. 提及识别与基础行情绑定
6. 推送记录与日报生成
7. 简版 Agent 问答
8. 联调状态面板、消息详情、任务运行态与执行历史

这意味着项目已经不再只是“能展示行情”的旧原型，而是具备了论坛监听与研究工作流的基础工程形态。

## 3. 已完成模块

### 3.1 文档体系

已完成：

- `docs/technical-architecture.md`
- `docs/project-prd.md`
- `docs/v0-implementation-blueprint.md`
- `docs/v0-development-plan.md`
- `docs/v0-feishu-scheduler-design.md`

状态判断：

- 架构目标、产品目标、V0 路线和最近一轮飞书/调度设计都已具备文档落点。

### 3.2 V0 后端骨架

已完成：

- 惰性数据库初始化
- 可注入 `createServer()`
- V0 路由独立注册
- SQLite V0 表初始化

当前价值：

- 便于局部注入测试
- 便于后续继续拆分服务

### 3.3 帖子抓取与解析

已完成：

- `HttpNgaConnector`
- charset 解码处理
- `V0MessageParser`
- 白名单作者过滤
- `threadKey` 隔离

当前状态：

- 已能解析一个固定帖子下的结构化消息
- 仍属于启发式解析，后续需关注 NGA 结构波动

### 3.4 消息入库与去重

已完成：

- `(threadKey, floorId)` 唯一语义
- 同楼层更新走 `UPDATE`
- 游标保存
- `is_new` 首次读取后清零
- 同楼层更新后重新标记 `is_new = 1`

当前状态：

- 核心去重逻辑已稳定到可继续往上叠功能

### 3.5 提及识别与基础行情绑定

已完成：

- 股票、板块、黄线、白线识别
- 行情摘要 `summaryText`
- 基础建议 `adviceText`
- 洞察失败补偿重试
- 消息流展示洞察状态

当前状态：

- 已满足 V0 基础联动要求
- 仍是规则优先，覆盖率和精度后续可持续提升

### 3.6 推送与日报

已完成：

- `console` 推送通道
- `feishu_bot` 推送框架
- 推送结果落库
- 日报生成与保存
- 日报查看接口
- 前端日报展示

当前状态：

- 推送与日报都具备最小可跑框架
- 飞书已到“可配置、可发送、可记录失败”阶段

### 3.7 简版 Agent

已完成：

- `POST /api/v0/agent/query`
- 3 类问题规则分类：
  - `author_daily_summary`
  - `author_stock_status`
  - `opinion_validation`
- 独立 `V0 Agent` 页面

当前状态：

- 已满足 V0 单轮问答
- 尚未进入多轮上下文、多人物对照或 LLM 混合规划阶段

### 3.8 联调与运行态

已完成：

- 单条消息详情接口
- 任务状态接口
- 调度器运行态
- 最近执行历史
- 监控页状态面板
- 消息详情抽屉

当前状态：

- V0 已具备较完整的可观察性
- 页面上能直接看到配置、抓取、推送、日报、调度的联调结果

## 4. 本轮新增成果

本轮主要完成两部分：

### 4.1 Scheduler 运行态联调

已新增：

- `v0_job_runs` 执行历史表
- `V0JobRunStore`
- 手动 `poll` / `digest` 统一执行日志
- `GET /api/v0/jobs/runs`
- `V0Scheduler` 自动任务执行历史记录
- 调度器重入保护
- 调度器测试态注入参数
- 轮询任务首次激活时立即触发首轮自动抓取
- `digestCron` 接口校验与配置存储校验对齐

效果：

- `V0_SCHEDULER_ENABLED=true` 时，服务会真正启动自动轮询与自动日报骨架
- scheduler 从“启动后等待首个周期”改为“任务激活后立刻跑首轮 poll，再进入周期轮询”
- 状态接口和执行历史接口都能看到运行结果

### 4.2 一项额外 debug 修复

已修复：

- `client/src/api/index.ts` 原先写死 `http://localhost:3001/api`
- 飞书通道过去只要 HTTP 不抛错就算成功，现已补真实返回体判定与错误映射

现状：

- 优先读取 `VITE_API_BASE_URL`
- 默认退回相对路径 `/api`
- 飞书会对 `code/msg`、HTTP 状态和超时网络异常做分层错误映射

价值：

- 减少本地联调和后续部署时的跨域/地址错配问题
- 提高飞书真实联调阶段的可定位性

## 5. 当前关键文件地图

后端核心：

- `server/src/app.ts`
- `server/src/v0/routes.ts`
- `server/src/v0/forum/forumService.ts`
- `server/src/v0/forum/messageStore.ts`
- `server/src/v0/forum/messageEnricher.ts`
- `server/src/v0/market/marketBinding.ts`
- `server/src/v0/push/pushService.ts`
- `server/src/v0/push/feishuBotChannel.ts`
- `server/src/v0/digest/digestService.ts`
- `server/src/v0/agent/agentService.ts`
- `server/src/v0/shared/jobs.ts`
- `server/src/v0/shared/jobRunStore.ts`
- `server/src/v0/shared/jobStatus.ts`

前端核心：

- `client/src/features/v0/pages/V0MonitorPage.tsx`
- `client/src/features/v0/pages/V0MessagesPage.tsx`
- `client/src/features/v0/pages/V0AgentPage.tsx`
- `client/src/features/v0/components/ThreadConfigCard.tsx`
- `client/src/features/v0/components/JobStatusCard.tsx`
- `client/src/features/v0/components/JobRunListCard.tsx`
- `client/src/features/v0/components/MessageCard.tsx`
- `client/src/features/v0/api.ts`

## 6. 调试观察

本轮结合代码回读，当前最值得关注的观察如下：

### 6.1 已修复问题

- 前端 API 基地址写死
- scheduler 无执行历史
- scheduler 无可注入运行态参数
- 手动任务与自动任务不共用统一日志
- scheduler 首次激活后需要等待完整周期，导致启动阶段看起来像“未自动运行”
- `digestCron` 路由校验与配置落库校验不一致，可能造成“保存后未生效”的假象

### 6.2 仍需持续关注的问题

- NGA 解析依赖 DOM 启发式，帖子结构变化仍可能导致解析退化
- 飞书通道目前只做最小 HTTP 调用，还缺少：
  - 卡片消息模板
  - 失败重试
- 调度器目前是进程内骨架，不具备：
  - 任务持久化恢复
  - 分布式互斥
  - 重启补偿
- Agent 仍是规则优先，不适合复杂问题

### 6.3 工程层面的技术债

- 项目里仍有不少旧原型阶段的 `console.log`
- 旧能力与 V0 能力共存在一个服务中，后续继续演进时要防止路由和职责继续堆叠
- 尚未完成真实运行环境下的编译和自动化回归，因为当前开发环境缺少 `node/npm/tsc`
- `v0_job_runs` 当前只保留执行明细，还没有运行耗时、重试次数和错误分类等更强观测字段

## 7. 当前完成度判断

按 `docs/v0-development-plan.md` 的 8 个任务包估算：

- `1. V0 基础骨架`：已完成
- `2. 帖子抓取与解析`：已完成
- `3. 消息入库与去重`：已完成
- `4. 前端消息流`：已完成
- `5. 提及识别与行情绑定`：已完成
- `6. 推送与日报`：已完成 V0 版，仍可继续增强
- `7. 简版 Agent`：已完成 V0 版，仍可继续增强
- `8. 联调与验收`：已进入联调收口阶段，仍未完成最终运行态验证

结论：

- `V0 核心能力已基本完成`
- 当前阶段重点已从“补功能”切到“做真实联调、修运行态问题、为 V1 演进做边界收口”

## 8. 下一阶段优先级建议

建议后续严格按以下优先级推进：

### P0：真实联调

优先做：

1. 飞书真实 webhook 联调
2. `V0_SCHEDULER_ENABLED=true` 的实际运行验证
3. 一轮真实帖子连续观察

交付目标：

- 真实新消息自动推送到飞书
- 自动轮询稳定运行，且服务启动后能立刻看到首轮抓取落库
- 自动日报按预期生成

### P1：稳定性增强

优先做：

1. 飞书错误码映射
2. 执行历史摘要优化
3. 调度器失败重试与退避
4. NGA 解析失败样本沉淀

### P2：认知增强

优先做：

1. 提及识别规则继续扩展
2. 人物发言风格蒸馏
3. 人物画像与观点变化跟踪
4. Agent 与人物 skill 的衔接

### P3：架构演进

优先做：

1. 把进程内调度器升级为更明确的 job runner
2. 拆分 V0 与 legacy 服务边界
3. 增加配置安全存储与环境隔离

## 9. 后续开发建议

如果下一轮继续开发，建议采用以下顺序：

1. 先做飞书真实发送联调与错误映射
2. 再做 scheduler 真实运行验证
3. 再开始“人物 skill / 发言蒸馏 / 多人物对照”

原因：

- 现在系统的基础闭环已经基本完成
- 最大短板不再是缺页面或缺接口，而是缺真实运行环境下的稳定验证
- 如果不先把运行态打稳，后续叠更高级能力会放大问题定位成本

## 10. 当前结论

截至当前，`Stock-Claw` 已经从原型式股票工具，演进到一个具备以下特征的 `V0 投研工作流系统`：

- 能监听指定论坛帖子和人物
- 能解析、去重、入库并展示消息
- 能理解基础盘中对象并联动行情
- 能生成推送、日报和简版 Agent 答案
- 能展示任务状态、执行历史和联调结果

当前最重要的工作不是再大面积铺新功能，而是：

- 做真实联调
- 压稳定性
- 为下一阶段的人物 skill 和更强 Agent 打基础
