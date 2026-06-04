# Scheduler Runtime And Progress Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `V0_SCHEDULER_ENABLED=true` 时真正进入自动轮询和自动日报联调状态，并补运行日志/执行历史与当前项目进度文档。

**Architecture:** 在现有 `V0Scheduler` 基础上补执行日志表与统一 job runner，把手动任务和调度任务都落到同一套历史记录里；同时为 `createServer()` 和 V0 路由增加可注入调度选项，便于静态测试和运行态联调。完成代码后，再整理一份项目进度、已完成功能、风险和后续路线文档。

**Tech Stack:** Fastify, TypeScript, better-sqlite3, React, React Query, Ant Design

---

### Task 1: 调度运行历史

**Files:**
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\init.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\types.ts`
- Create: `d:\project\bussiness\stock-claw\server\src\v0\shared\jobRunStore.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\routes.ts`
- Test: `d:\project\bussiness\stock-claw\server\test\v0_status.test.ts`

- [ ] 增加 `v0_job_runs` 表
- [ ] 新增统一 job run 记录服务
- [ ] 手动 `poll` / `digest` 也写执行历史
- [ ] 增加 `GET /api/v0/jobs/runs`

### Task 2: Scheduler 运行态联调

**Files:**
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\jobs.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\app.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\routes.ts`
- Modify: `d:\project\bussiness\stock-claw\server\src\v0\shared\jobStatus.ts`
- Test: `d:\project\bussiness\stock-claw\server\test\v0_status.test.ts`

- [ ] 增加调度选项注入，便于测试和联调
- [ ] 防止轮询任务和日报任务重入
- [ ] 调度执行成功/失败写历史和运行态
- [ ] 暴露最近一次轮询/日报执行结果

### Task 3: 前端运行历史与状态可视化

**Files:**
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\types.ts`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\api.ts`
- Create: `d:\project\bussiness\stock-claw\client\src\features\v0\components\JobRunListCard.tsx`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\pages\V0MonitorPage.tsx`
- Modify: `d:\project\bussiness\stock-claw\client\src\features\v0\components\JobStatusCard.tsx`

- [ ] 监控页新增最近执行历史卡片
- [ ] 状态卡片增加最近轮询/日报结果
- [ ] 自动刷新 job runs

### Task 4: 项目回顾与进度文档

**Files:**
- Create: `d:\project\bussiness\stock-claw\docs\current-project-progress.md`

- [ ] 整理当前模块完成度
- [ ] 记录已知问题、调试观察和技术债
- [ ] 给出后续开发优先级建议

## 自检

- 执行历史要同时覆盖手动触发和调度触发
- 调度器注入选项不能破坏现有 `createServer()` 默认行为
- 进度文档必须能指导下一轮开发，而不是只有总结

## 执行

计划已保存到 `docs/superpowers/plans/2026-05-14-scheduler-runtime-review.md`，本次按 Inline Execution 直接继续实现。
