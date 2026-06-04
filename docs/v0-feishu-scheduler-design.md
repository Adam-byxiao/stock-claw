# V0 飞书推送与定时任务骨架设计

## 1. 目标

本设计文档描述 `Stock-Claw V0` 在当前阶段如何落地两项能力：

- 飞书机器人推送框架
- 进程内定时任务骨架

目标不是一步做到完整调度平台，而是先把后续演进需要的边界和最小实现固定下来。

## 2. 飞书推送框架

### 2.1 配置模型

V0 在现有 `v0_thread_configs` 上扩展以下字段：

- `push_channel`
  - 当前支持：
    - `console`
    - `feishu_bot`
- `push_webhook_url`
- `push_secret`

这样做的原因是：

- V0 仍是单帖子单配置
- 无需单独引入复杂渠道配置表
- 前端配置页可以直接保存和回显

### 2.2 服务边界

推送相关职责拆为两层：

- `V0PushService`
  - 负责统一记录推送结果
  - 负责根据配置选择渠道
- `FeishuBotPushChannel`
  - 负责具体的飞书 webhook HTTP 调用
  - 负责签名生成和消息体组织

### 2.3 失败策略

V0 阶段采用“失败写库，不中断主链路”的策略：

- webhook 缺失
- webhook 地址非法
- 飞书返回错误
- 网络异常

以上都只会把本次通知记为 `failed`，不会让抓取任务整体失败。

### 2.4 当前联调细节

当前飞书通道已补充以下运行细节：

- webhook 地址格式校验
- HTTP 失败与网络超时映射
- 飞书返回体 `code/msg` 判定
- 常见错误码的可读化映射
  - `19022`：IP 白名单校验失败
  - `19024`：关键词校验失败
  - `11232`：频率限制
  - `9499`：请求体不合法
- 消息文本长度保护，避免请求体过大

这样通知失败时，`v0_notifications.error_message` 中会保存更接近真实原因的错误信息，便于联调和排障。

## 3. 定时任务骨架

### 3.1 目标

当前阶段只提供“可扩展、可观察、默认安全”的调度骨架。

因此定时任务的设计原则是：

- 默认不自动启动
- 通过 `V0_SCHEDULER_ENABLED=true` 才启用
- 所有运行态都能从接口里看见
- 后续可以平滑替换为真正 job runner

### 3.2 任务类型

V0 先保留两类任务：

- 轮询任务
  - 根据 `poll_interval_seconds` 用 `setInterval` 驱动
- 日报任务
  - 根据 `digest_cron` 做最小 cron 匹配
  - 先用每分钟检查一次的骨架实现

### 3.3 调度器职责

`V0Scheduler` 提供以下能力：

- `start()`
- `stop()`
- `refreshConfig()`
- `getRuntimeStatus()`

它不直接管理数据库，也不组织业务逻辑，只负责：

- 读取配置决定是否挂任务
- 调用 `forumService.pollThread()`
- 调用 `digestService.buildDailyDigest()`
- 维护运行态

### 3.4 运行态字段

对外通过 `jobs/status` 暴露：

- `schedulerEnabled`
- `schedulerRunning`
- `pollJobActive`
- `digestJobActive`
- `nextPollAt`
- `nextDigestAt`
- `lastSchedulerError`

这样联调时不需要查日志也能知道调度器是否真正工作。

## 4. 后续演进

当 V0 完成验证后，下一阶段建议按以下顺序升级：

1. 飞书消息升级为卡片模板
2. 增加飞书失败重试与退避
3. 把进程内调度替换为更明确的 job runner
4. 支持多任务注册与任务执行历史

## 5. 当前边界

本轮设计明确不做：

- 多渠道并行推送
- 完整密钥托管
- 分布式调度
- 任务持久化恢复
- 失败告警链路

V0 只保证：

- 飞书机器人链路有框架
- 任务调度有骨架
- 配置、接口、页面、状态面板是贯通的
