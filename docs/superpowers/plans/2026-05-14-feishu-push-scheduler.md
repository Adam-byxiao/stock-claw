# Feishu Push And Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 V0 增加飞书机器人推送框架，并补一套可扩展的进程内定时任务骨架。

**Architecture:** 在现有 `V0PushService` 上增加可配置的通道工厂，先接 `console` 和 `feishu_bot` 两种渠道；调度层新增独立 `jobs.ts`，只负责根据配置决定是否启动轮询与日报任务，并把运行状态暴露给接口。实现遵循“默认安全、配置驱动、失败可记录”的原则。

**Tech Stack:** Fastify, TypeScript, better-sqlite3, axios, React, Ant Design, React Query

---

### Task 1: 推送配置模型

**Files:**
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\init.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\types.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\forum\threadConfig.ts`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\types.ts`
- Test: `d:\project\bussiness\stock-claw\server\test\v0_config.test.ts`

- [ ] 增加 `pushChannel`、`pushWebhookUrl`、`pushSecret`、`digestEnabled`、`digestCron` 字段
- [ ] 配置服务支持部分更新与默认值回填
- [ ] 测试覆盖默认配置、保存、部分更新和类型校验

### Task 2: 飞书机器人通道

**Files:**
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\push\pushService.ts`
- Create: `d:\project\bussiness\stock-claw\server\src\v0\push\feishuBotChannel.ts`
- Test: `d:\project\bussiness\stock-claw\server\test\v0_push_digest.test.ts`

- [ ] 抽出 `V0PushChannelFactory`
- [ ] 新增 `FeishuBotPushChannel`，用 webhook URL 发送卡片或文本消息
- [ ] 当 `pushChannel = feishu_bot` 但缺 webhook 时，跳过发送并记录失败
- [ ] 保留 `console` 通道作为回退路径

### Task 3: 调度骨架

**Files:**
- Create: `d:\project\bussiness\stock-claw\server\src\v0\shared\jobs.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\types.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\app.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\routes.ts`
- Test: `d:\project\bussiness\stock-claw\server\test\v0_status.test.ts`

- [ ] 设计 `V0Scheduler`，支持 `start()`、`stop()`、`refreshConfig()`、`getRuntimeStatus()`
- [ ] 轮询任务先用 `setInterval` 骨架，日报任务先用简单 cron 匹配占位
- [ ] 不在测试中自动启动真实长轮询，保持可注入和可观察
- [ ] 给 `jobs/status` 增加运行态字段，例如 `schedulerRunning`、`nextPollAt`、`digestJobEnabled`

### Task 4: 前端配置与状态面板

**Files:**
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\components\ThreadConfigCard.tsx`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\pages\V0MonitorPage.tsx`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\components\JobStatusCard.tsx`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\api.ts`

- [ ] 配置页增加推送渠道选择、飞书 webhook 输入框、日报开关和 cron 文本框
- [ ] 状态卡片增加调度骨架状态展示
- [ ] 保存配置后刷新运行态

### Task 5: 静态测试与文档补充

**Files:**
- Modify: `d:\project\bussiness\stock-claw\server\package.json`
- Modify: `d:\project\bussiness\stock-claw\docs\v0-implementation-blueprint.md`

- [ ] 更新已有 `test:v0` 覆盖新增测试
- [ ] 在蓝图中补一段“飞书机器人推送框架”和“进程内定时任务骨架”的说明
- [ ] 在无法运行 `node/tsc` 的前提下，完成代码级静态回读和契约搜索

## 自检

- 配置新增字段只放在一处数据源，避免前后端字段名漂移
- 调度骨架不直接绑死 `forumService` 构造，优先依赖注入
- 飞书通道失败必须写 `v0_notifications`

## 执行

计划已保存到 `docs/superpowers/plans/2026-05-14-feishu-push-scheduler.md`，本次按 Inline Execution 直接继续实现。
