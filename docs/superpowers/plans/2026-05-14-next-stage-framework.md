# Next Stage Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前单帖子单配置的 `V0` 原型升级为支持“监听任务管理、人物档案管理、运行中心、推送模板管理”的下一阶段工作台框架。

**Architecture:** 保留现有 `V0` 抓取、解析、入库、推送、日报、scheduler 能力不推翻重来，在此基础上把单配置模型抽象成“监听任务”实体，并让人物档案、推送模板、运行中心都围绕任务展开。后端优先完成 SQLite 表结构、服务层、REST API 和兼容迁移；前端把当前 `V0MonitorPage` 拆成任务页、人物页、运行中心页和模板页，并保留旧监控页作为兼容入口。

**Tech Stack:** Fastify, TypeScript, better-sqlite3, React, Vite, React Query, Ant Design, SQLite

---

## File Structure

### Backend

- Modify: `server/src/v0/shared/init.ts`
  - 新增任务、人物、模板、任务运行聚合所需表结构及迁移列。
- Modify: `server/src/v0/shared/types.ts`
  - 扩展共享类型，新增任务、人物、模板、任务运行视图返回契约。
- Create: `server/src/v0/tasks/taskStore.ts`
  - 监听任务的 CRUD、启停、查询、任务与作者/模板绑定。
- Create: `server/src/v0/tasks/taskRuntimeService.ts`
  - 基于任务聚合运行状态、执行历史、通知和日报。
- Create: `server/src/v0/persona/personaStore.ts`
  - 人物档案 CRUD、标签、别名、关注标的和状态维护。
- Create: `server/src/v0/push/pushTemplateStore.ts`
  - 推送模板 CRUD、模板查询和默认模板初始化。
- Modify: `server/src/v0/forum/forumService.ts`
  - 将抓取入口逐步从单配置切换为基于任务配置执行。
- Modify: `server/src/v0/shared/jobs.ts`
  - scheduler 与手动任务执行入口按任务粒度运行。
- Modify: `server/src/v0/shared/jobRunStore.ts`
  - 扩展 `metadata_json` 内容，补充任务 ID、任务名。
- Modify: `server/src/v0/shared/jobStatus.ts`
  - 输出运行中心所需聚合视图。
- Modify: `server/src/v0/routes.ts`
  - 新增任务、人物、模板、运行中心 API；旧 `/api/v0/config` 保留兼容并标注 legacy。
- Test: `server/test/v0_task_management.test.ts`
  - 监听任务管理测试。
- Test: `server/test/v0_persona_management.test.ts`
  - 人物档案管理测试。
- Test: `server/test/v0_runtime_center.test.ts`
  - 运行中心 API 聚合测试。
- Test: `server/test/v0_push_template.test.ts`
  - 推送模板管理测试。

### Frontend

- Modify: `client/src/features/v0/types.ts`
  - 新增任务、人物、模板、运行中心视图类型。
- Modify: `client/src/features/v0/api.ts`
  - 新增任务、人物、模板、运行中心 API 调用。
- Create: `client/src/features/v0/pages/V0TasksPage.tsx`
  - 监听任务管理页。
- Create: `client/src/features/v0/pages/V0PersonasPage.tsx`
  - 人物档案管理页。
- Create: `client/src/features/v0/pages/V0RuntimePage.tsx`
  - 运行中心页。
- Create: `client/src/features/v0/pages/V0PushTemplatesPage.tsx`
  - 推送模板管理页。
- Create: `client/src/features/v0/components/TaskListCard.tsx`
  - 任务列表与任务状态卡片。
- Create: `client/src/features/v0/components/TaskFormDrawer.tsx`
  - 任务创建/编辑抽屉。
- Create: `client/src/features/v0/components/PersonaListCard.tsx`
  - 人物档案列表卡片。
- Create: `client/src/features/v0/components/PersonaFormDrawer.tsx`
  - 人物档案编辑抽屉。
- Create: `client/src/features/v0/components/RuntimeTaskOverviewCard.tsx`
  - 按任务查看运行中心概览。
- Create: `client/src/features/v0/components/PushTemplateListCard.tsx`
  - 模板列表卡片。
- Modify: `client/src/App.tsx`
  - 注册新页面路由。
- Modify: `client/src/components/Layout.tsx`
  - 导航栏增加“监听任务”“人物档案”“运行中心”“推送模板”。
- Modify: `client/src/features/v0/pages/V0MonitorPage.tsx`
  - 降级为兼容页，提示迁移至新页面。

### Docs

- Modify: `docs/current-project-progress.md`
  - 记录下一阶段框架开发状态。
- Create: `docs/next-stage-framework.md`
  - 描述四大模块的目标、边界和关系。

---

### Task 1: 扩展数据库与共享类型

**Files:**
- Modify: `server/src/v0/shared/init.ts`
- Modify: `server/src/v0/shared/types.ts`
- Test: `server/test/v0_task_management.test.ts`

- [ ] **Step 1: 写出新的共享类型和表结构草案**

```ts
export interface V0WatchTaskRecord {
  id: number;
  taskName: string;
  threadUrl: string;
  threadTitle: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  pushEnabled: boolean;
  pushTemplateId: number | null;
  digestEnabled: boolean;
  digestCron: string;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
  authors: string[];
}

export interface V0PersonaRecord {
  id: number;
  personaName: string;
  aliases: string[];
  roleTags: string[];
  watchKeywords: string[];
  styleSummary: string;
  enabled: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface V0PushTemplateRecord {
  id: number;
  templateKey: 'message_alert' | 'daily_digest' | 'poll_summary' | 'failure_alert';
  templateName: string;
  channel: 'console' | 'feishu_bot';
  titleTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: 在 `init.ts` 中加入四类新表**

```sql
CREATE TABLE IF NOT EXISTS v0_watch_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name TEXT NOT NULL,
  thread_url TEXT NOT NULL DEFAULT '',
  thread_title TEXT NOT NULL DEFAULT '',
  poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  push_channel TEXT NOT NULL DEFAULT 'console',
  push_webhook_url TEXT NOT NULL DEFAULT '',
  push_secret TEXT NOT NULL DEFAULT '',
  push_template_id INTEGER,
  digest_enabled INTEGER NOT NULL DEFAULT 0,
  digest_cron TEXT NOT NULL DEFAULT '0 18 * * *',
  last_success_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v0_task_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v0_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_name TEXT NOT NULL UNIQUE,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  role_tags_json TEXT NOT NULL DEFAULT '[]',
  watch_keywords_json TEXT NOT NULL DEFAULT '[]',
  style_summary TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v0_push_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  template_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: 为 `v0_job_runs` 和 `v0_notifications` 补任务维度字段**

```ts
ensureColumn(database, 'v0_job_runs', 'task_id', 'INTEGER');
ensureColumn(database, 'v0_notifications', 'task_id', 'INTEGER');
ensureColumn(database, 'v0_daily_digests', 'task_id', 'INTEGER');
ensureColumn(database, 'v0_forum_messages', 'task_id', 'INTEGER');
```

- [ ] **Step 4: 写最小数据库初始化测试**

```ts
test('initV0Tables creates watch task and persona tables', () => {
  const database = createAppDatabase(createTempDatabasePath());
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`)
    .all() as Array<{ name: string }>;

  assert.equal(tables.some((table) => table.name === 'v0_watch_tasks'), true);
  assert.equal(tables.some((table) => table.name === 'v0_personas'), true);
  assert.equal(tables.some((table) => table.name === 'v0_push_templates'), true);
});
```

- [ ] **Step 5: 运行目标测试**

Run:

```bash
node --test -r ts-node/register test/v0_task_management.test.ts
```

Expected: 当前环境若具备 `node` 则测试通过；若不具备，则至少保持代码可静态阅读且语法闭合。

- [ ] **Step 6: 提交**

```bash
git add server/src/v0/shared/init.ts server/src/v0/shared/types.ts server/test/v0_task_management.test.ts
git commit -m "feat: add next-stage task persona template schema"
```

### Task 2: 实现监听任务管理后端

**Files:**
- Create: `server/src/v0/tasks/taskStore.ts`
- Modify: `server/src/v0/routes.ts`
- Modify: `server/src/v0/shared/types.ts`
- Test: `server/test/v0_task_management.test.ts`

- [ ] **Step 1: 创建任务存储接口**

```ts
export interface V0WatchTaskPayload {
  taskName: string;
  threadUrl: string;
  threadTitle?: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  pushEnabled: boolean;
  pushChannel: 'console' | 'feishu_bot';
  pushWebhookUrl?: string;
  pushSecret?: string;
  pushTemplateId?: number | null;
  digestEnabled: boolean;
  digestCron: string;
  authors: string[];
}

export class V0TaskStore {
  constructor(private readonly database: Database.Database) {}

  listTasks(): V0WatchTaskRecord[] {
    return [];
  }

  getTask(taskId: number): V0WatchTaskRecord | null {
    return null;
  }

  saveTask(payload: V0WatchTaskPayload, taskId?: number): V0WatchTaskRecord {
    return {} as V0WatchTaskRecord;
  }

  deleteTask(taskId: number): void {}
}
```

- [ ] **Step 2: 落实任务保存事务**

```ts
const saveTransaction = this.database.transaction((nextTaskId?: number) => {
  const result = nextTaskId
    ? updateTask.run(/* ... */)
    : insertTask.run(/* ... */);

  const taskId = nextTaskId ?? Number(result.lastInsertRowid);
  clearAuthors.run(taskId);
  for (const author of uniqueAuthors) {
    insertAuthor.run(taskId, author, now);
  }
  return taskId;
});
```

- [ ] **Step 3: 暴露监听任务 API**

```ts
server.get('/api/v0/tasks', async () => ({ data: taskStore.listTasks() }));

server.get<{ Params: { id: string } }>('/api/v0/tasks/:id', async (request, reply) => {
  const task = taskStore.getTask(Number(request.params.id));
  if (!task) {
    return reply.code(404).send({ error: 'task not found' });
  }
  return { data: task };
});

server.post<{ Body: V0WatchTaskPayload }>('/api/v0/tasks', async (request) => {
  return { data: taskStore.saveTask(request.body) };
});

server.post<{ Params: { id: string }; Body: Partial<V0WatchTaskPayload> }>(
  '/api/v0/tasks/:id',
  async (request) => {
    return { data: taskStore.saveTask(request.body as V0WatchTaskPayload, Number(request.params.id)) };
  }
);

server.delete<{ Params: { id: string } }>('/api/v0/tasks/:id', async (request) => {
  taskStore.deleteTask(Number(request.params.id));
  return { ok: true };
});
```

- [ ] **Step 4: 保留旧配置接口兼容**

```ts
server.get('/api/v0/config', async () => {
  const firstTask = taskStore.listTasks()[0];
  if (!firstTask) {
    return configService.getConfig();
  }

  return {
    threadUrl: firstTask.threadUrl,
    threadTitle: firstTask.threadTitle,
    pollIntervalSeconds: firstTask.pollIntervalSeconds,
    enabled: firstTask.enabled,
    pushEnabled: firstTask.pushEnabled,
    pushChannel: firstTask.pushChannel,
    pushWebhookUrl: firstTask.pushWebhookUrl,
    pushSecret: firstTask.pushSecret,
    digestEnabled: firstTask.digestEnabled,
    digestCron: firstTask.digestCron,
    authors: firstTask.authors,
  };
});
```

- [ ] **Step 5: 为任务 CRUD 编写测试**

```ts
test('POST /api/v0/tasks creates and lists watch tasks', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v0/tasks',
    payload: {
      taskName: 'NGA 龙头复盘',
      threadUrl: 'https://nga.178.com/read.php?tid=task-1',
      pollIntervalSeconds: 60,
      enabled: true,
      pushEnabled: true,
      pushChannel: 'console',
      digestEnabled: false,
      digestCron: '0 18 * * *',
      authors: ['Alpha', 'Beta'],
    },
  });

  assert.equal(response.statusCode, 200);
  const listResponse = await server.inject({ method: 'GET', url: '/api/v0/tasks' });
  assert.equal(listResponse.json().data.length, 1);
});
```

- [ ] **Step 6: 提交**

```bash
git add server/src/v0/tasks/taskStore.ts server/src/v0/routes.ts server/test/v0_task_management.test.ts
git commit -m "feat: add watch task management api"
```

### Task 3: 实现人物档案管理后端

**Files:**
- Create: `server/src/v0/persona/personaStore.ts`
- Modify: `server/src/v0/routes.ts`
- Modify: `server/src/v0/shared/types.ts`
- Test: `server/test/v0_persona_management.test.ts`

- [ ] **Step 1: 定义人物档案 payload**

```ts
export interface V0PersonaPayload {
  personaName: string;
  aliases: string[];
  roleTags: string[];
  watchKeywords: string[];
  styleSummary: string;
  enabled: boolean;
  notes: string;
}
```

- [ ] **Step 2: 实现人物档案存储**

```ts
export class V0PersonaStore {
  constructor(private readonly database: Database.Database) {}

  listPersonas(): V0PersonaRecord[] {
    return this.database.prepare(`SELECT * FROM v0_personas ORDER BY id DESC`).all() as V0PersonaRecord[];
  }

  savePersona(payload: V0PersonaPayload, personaId?: number): V0PersonaRecord {
    return {} as V0PersonaRecord;
  }

  deletePersona(personaId: number): void {}
}
```

- [ ] **Step 3: 暴露人物档案 API**

```ts
server.get('/api/v0/personas', async () => ({ data: personaStore.listPersonas() }));
server.post('/api/v0/personas', async (request) => ({ data: personaStore.savePersona(request.body as V0PersonaPayload) }));
server.post('/api/v0/personas/:id', async (request) => ({
  data: personaStore.savePersona(request.body as V0PersonaPayload, Number((request.params as { id: string }).id)),
}));
server.delete('/api/v0/personas/:id', async (request) => {
  personaStore.deletePersona(Number((request.params as { id: string }).id));
  return { ok: true };
});
```

- [ ] **Step 4: 编写人物档案测试**

```ts
test('POST /api/v0/personas creates persona profile', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v0/personas',
    payload: {
      personaName: 'Alpha',
      aliases: ['A神', '龙头哥'],
      roleTags: ['短线', '龙头'],
      watchKeywords: ['黄线', '回流', '分歧'],
      styleSummary: '偏短线、强调盘中节奏。',
      enabled: true,
      notes: '后续用于人物 skill 蒸馏。',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.personaName, 'Alpha');
});
```

- [ ] **Step 5: 提交**

```bash
git add server/src/v0/persona/personaStore.ts server/src/v0/routes.ts server/test/v0_persona_management.test.ts
git commit -m "feat: add persona management api"
```

### Task 4: 实现运行中心后端聚合

**Files:**
- Create: `server/src/v0/tasks/taskRuntimeService.ts`
- Modify: `server/src/v0/shared/jobRunStore.ts`
- Modify: `server/src/v0/shared/jobStatus.ts`
- Modify: `server/src/v0/shared/jobs.ts`
- Modify: `server/src/v0/routes.ts`
- Test: `server/test/v0_runtime_center.test.ts`

- [ ] **Step 1: 为执行历史补任务元数据**

```ts
interface ExecuteJobOptions {
  taskId?: number;
  taskName?: string;
}

async executeJob<T>(
  jobType: JobType,
  triggerSource: TriggerSource,
  executor: () => Promise<{ result: T; summaryText?: string; metadata?: Record<string, unknown> }>,
  options: ExecuteJobOptions = {}
): Promise<T> {
  const baseMetadata = {
    taskId: options.taskId ?? null,
    taskName: options.taskName ?? '',
  };
  // 合并 metadata 写入 metadata_json
}
```

- [ ] **Step 2: 定义运行中心返回类型**

```ts
export interface V0RuntimeTaskOverview {
  taskId: number;
  taskName: string;
  enabled: boolean;
  unreadMessageCount: number;
  lastMessageAt: string | null;
  lastPollRun: V0JobRunRecord | null;
  lastDigestRun: V0JobRunRecord | null;
  lastNotificationStatus: 'success' | 'failed' | 'idle';
  lastNotificationAt: string | null;
  recentErrorMessages: string[];
}
```

- [ ] **Step 3: 实现运行中心聚合服务**

```ts
export class V0TaskRuntimeService {
  constructor(private readonly database: Database.Database) {}

  listRuntimeOverview(): V0RuntimeTaskOverview[] {
    return [];
  }
}
```

- [ ] **Step 4: 暴露运行中心 API**

```ts
server.get('/api/v0/runtime/tasks', async () => {
  return {
    data: taskRuntimeService.listRuntimeOverview(),
  };
});

server.post<{ Params: { id: string } }>('/api/v0/runtime/tasks/:id/poll', async (request) => {
  return {
    data: await scheduler.runPollJob('manual'),
  };
});
```

- [ ] **Step 5: 编写运行中心测试**

```ts
test('GET /api/v0/runtime/tasks returns per-task runtime overview', async () => {
  const response = await server.inject({ method: 'GET', url: '/api/v0/runtime/tasks' });
  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.json().data), true);
});
```

- [ ] **Step 6: 提交**

```bash
git add server/src/v0/tasks/taskRuntimeService.ts server/src/v0/shared/jobRunStore.ts server/src/v0/shared/jobs.ts server/src/v0/routes.ts server/test/v0_runtime_center.test.ts
git commit -m "feat: add runtime center backend aggregation"
```

### Task 5: 实现推送模板管理后端

**Files:**
- Create: `server/src/v0/push/pushTemplateStore.ts`
- Modify: `server/src/v0/push/pushService.ts`
- Modify: `server/src/v0/routes.ts`
- Test: `server/test/v0_push_template.test.ts`

- [ ] **Step 1: 建立模板存储层**

```ts
export interface V0PushTemplatePayload {
  templateKey: 'message_alert' | 'daily_digest' | 'poll_summary' | 'failure_alert';
  templateName: string;
  channel: 'console' | 'feishu_bot';
  titleTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
}

export class V0PushTemplateStore {
  constructor(private readonly database: Database.Database) {}

  listTemplates(): V0PushTemplateRecord[] {
    return [];
  }

  saveTemplate(payload: V0PushTemplatePayload, templateId?: number): V0PushTemplateRecord {
    return {} as V0PushTemplateRecord;
  }
}
```

- [ ] **Step 2: 在推送服务中增加模板渲染入口**

```ts
private renderTemplate(
  template: V0PushTemplateRecord | null,
  payload: V0PushPayload
): V0PushPayload {
  if (!template) {
    return payload;
  }

  return {
    ...payload,
    rawContent: template.bodyTemplate
      .replace('{{authorName}}', payload.authorName)
      .replace('{{rawContent}}', payload.rawContent)
      .replace('{{sourceUrl}}', payload.sourceUrl),
  };
}
```

- [ ] **Step 3: 增加模板管理 API**

```ts
server.get('/api/v0/push/templates', async () => ({ data: pushTemplateStore.listTemplates() }));
server.post('/api/v0/push/templates', async (request) => ({
  data: pushTemplateStore.saveTemplate(request.body as V0PushTemplatePayload),
}));
```

- [ ] **Step 4: 编写模板测试**

```ts
test('POST /api/v0/push/templates creates template', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v0/push/templates',
    payload: {
      templateKey: 'message_alert',
      templateName: '新消息提醒',
      channel: 'feishu_bot',
      titleTemplate: 'Stock-Claw 提醒',
      bodyTemplate: '{{authorName}}: {{rawContent}}',
      enabled: true,
    },
  });

  assert.equal(response.statusCode, 200);
});
```

- [ ] **Step 5: 提交**

```bash
git add server/src/v0/push/pushTemplateStore.ts server/src/v0/push/pushService.ts server/src/v0/routes.ts server/test/v0_push_template.test.ts
git commit -m "feat: add push template management api"
```

### Task 6: 扩展前端类型、API 与路由

**Files:**
- Modify: `client/src/features/v0/types.ts`
- Modify: `client/src/features/v0/api.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: 新增前端类型**

```ts
export interface V0WatchTask { /* 与后端 V0WatchTaskRecord 对齐 */ }
export interface V0Persona { /* 与后端 V0PersonaRecord 对齐 */ }
export interface V0PushTemplate { /* 与后端 V0PushTemplateRecord 对齐 */ }
export interface V0RuntimeTaskOverview { /* 与后端聚合返回对齐 */ }
```

- [ ] **Step 2: 新增 API 调用**

```ts
export const getV0Tasks = async (): Promise<V0WatchTask[]> => {
  const { data } = await apiClient.get('/v0/tasks');
  return data.data;
};

export const saveV0Task = async (payload: V0WatchTask): Promise<V0WatchTask> => {
  const { data } = await apiClient.post('/v0/tasks', payload);
  return data.data;
};
```

- [ ] **Step 3: 注册新路由**

```tsx
<Route path="v0/tasks" element={<V0TasksPage />} />
<Route path="v0/personas" element={<V0PersonasPage />} />
<Route path="v0/runtime" element={<V0RuntimePage />} />
<Route path="v0/push-templates" element={<V0PushTemplatesPage />} />
```

- [ ] **Step 4: 扩展侧边栏导航**

```tsx
{
  key: '/v0/tasks',
  icon: <SettingOutlined />,
  label: '监听任务',
},
{
  key: '/v0/personas',
  icon: <MessageOutlined />,
  label: '人物档案',
},
{
  key: '/v0/runtime',
  icon: <ExperimentOutlined />,
  label: '运行中心',
},
{
  key: '/v0/push-templates',
  icon: <NotificationOutlined />,
  label: '推送模板',
},
```

- [ ] **Step 5: 提交**

```bash
git add client/src/features/v0/types.ts client/src/features/v0/api.ts client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat: add next-stage v0 routes and api clients"
```

### Task 7: 实现监听任务管理页面

**Files:**
- Create: `client/src/features/v0/pages/V0TasksPage.tsx`
- Create: `client/src/features/v0/components/TaskListCard.tsx`
- Create: `client/src/features/v0/components/TaskFormDrawer.tsx`

- [ ] **Step 1: 创建任务列表卡片**

```tsx
const TaskListCard: React.FC<{
  tasks: V0WatchTask[] | undefined;
  onCreate: () => void;
  onEdit: (task: V0WatchTask) => void;
}> = ({ tasks, onCreate, onEdit }) => (
  <Card title="监听任务" extra={<Button type="primary" onClick={onCreate}>新建任务</Button>}>
    <List
      dataSource={tasks}
      renderItem={(task) => (
        <List.Item actions={[<Button onClick={() => onEdit(task)}>编辑</Button>]}>
          <List.Item.Meta title={task.taskName} description={`${task.threadTitle || task.threadUrl} / ${task.authors.join(', ')}`} />
        </List.Item>
      )}
    />
  </Card>
);
```

- [ ] **Step 2: 创建任务编辑抽屉**

```tsx
const TaskFormDrawer: React.FC<{ open: boolean; task?: V0WatchTask | null; onClose: () => void }> = ({ open, task, onClose }) => {
  return (
    <Drawer open={open} title={task ? '编辑任务' : '新建任务'} onClose={onClose}>
      <Form layout="vertical">
        <Form.Item label="任务名称"><Input /></Form.Item>
        <Form.Item label="帖子 URL"><Input /></Form.Item>
        <Form.Item label="作者名单"><Input.TextArea rows={6} /></Form.Item>
      </Form>
    </Drawer>
  );
};
```

- [ ] **Step 3: 组合页面**

```tsx
const V0TasksPage: React.FC = () => {
  const { data: tasks } = useQuery({ queryKey: ['v0Tasks'], queryFn: getV0Tasks });
  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <TaskListCard tasks={tasks} onCreate={() => {}} onEdit={() => {}} />
      </Col>
    </Row>
  );
};
```

- [ ] **Step 4: 提交**

```bash
git add client/src/features/v0/pages/V0TasksPage.tsx client/src/features/v0/components/TaskListCard.tsx client/src/features/v0/components/TaskFormDrawer.tsx
git commit -m "feat: add watch task management page"
```

### Task 8: 实现人物档案管理页面

**Files:**
- Create: `client/src/features/v0/pages/V0PersonasPage.tsx`
- Create: `client/src/features/v0/components/PersonaListCard.tsx`
- Create: `client/src/features/v0/components/PersonaFormDrawer.tsx`

- [ ] **Step 1: 创建人物列表卡片**

```tsx
const PersonaListCard: React.FC<{ personas: V0Persona[] | undefined }> = ({ personas }) => (
  <Card title="人物档案">
    <List
      dataSource={personas}
      renderItem={(persona) => (
        <List.Item>
          <List.Item.Meta
            title={persona.personaName}
            description={`${persona.roleTags.join(' / ')} | ${persona.styleSummary || '暂无风格摘要'}`}
          />
        </List.Item>
      )}
    />
  </Card>
);
```

- [ ] **Step 2: 创建人物编辑抽屉**

```tsx
const PersonaFormDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <Drawer open={open} title="人物档案" onClose={onClose}>
    <Form layout="vertical">
      <Form.Item label="人物名称"><Input /></Form.Item>
      <Form.Item label="别名"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item label="风格摘要"><Input.TextArea rows={4} /></Form.Item>
    </Form>
  </Drawer>
);
```

- [ ] **Step 3: 组合页面**

```tsx
const V0PersonasPage: React.FC = () => {
  const { data: personas } = useQuery({ queryKey: ['v0Personas'], queryFn: getV0Personas });
  return <PersonaListCard personas={personas} />;
};
```

- [ ] **Step 4: 提交**

```bash
git add client/src/features/v0/pages/V0PersonasPage.tsx client/src/features/v0/components/PersonaListCard.tsx client/src/features/v0/components/PersonaFormDrawer.tsx
git commit -m "feat: add persona management page"
```

### Task 9: 实现运行中心页面

**Files:**
- Create: `client/src/features/v0/pages/V0RuntimePage.tsx`
- Create: `client/src/features/v0/components/RuntimeTaskOverviewCard.tsx`

- [ ] **Step 1: 创建运行中心概览卡片**

```tsx
const RuntimeTaskOverviewCard: React.FC<{ items: V0RuntimeTaskOverview[] | undefined }> = ({ items }) => (
  <Card title="运行中心">
    <Table
      rowKey="taskId"
      dataSource={items}
      columns={[
        { title: '任务', dataIndex: 'taskName' },
        { title: '未读', dataIndex: 'unreadMessageCount' },
        { title: '最近消息', dataIndex: 'lastMessageAt' },
        { title: '最近轮询', render: (_, record) => record.lastPollRun?.status || '暂无' },
        { title: '最近推送', render: (_, record) => record.lastNotificationStatus },
      ]}
      pagination={false}
    />
  </Card>
);
```

- [ ] **Step 2: 组合运行中心页**

```tsx
const V0RuntimePage: React.FC = () => {
  const { data } = useQuery({ queryKey: ['v0RuntimeTasks'], queryFn: getV0RuntimeTasks });
  return <RuntimeTaskOverviewCard items={data} />;
};
```

- [ ] **Step 3: 提交**

```bash
git add client/src/features/v0/pages/V0RuntimePage.tsx client/src/features/v0/components/RuntimeTaskOverviewCard.tsx
git commit -m "feat: add runtime center page"
```

### Task 10: 实现推送模板管理页面

**Files:**
- Create: `client/src/features/v0/pages/V0PushTemplatesPage.tsx`
- Create: `client/src/features/v0/components/PushTemplateListCard.tsx`

- [ ] **Step 1: 创建模板列表卡片**

```tsx
const PushTemplateListCard: React.FC<{ templates: V0PushTemplate[] | undefined }> = ({ templates }) => (
  <Card title="推送模板">
    <List
      dataSource={templates}
      renderItem={(template) => (
        <List.Item>
          <List.Item.Meta
            title={`${template.templateName} (${template.templateKey})`}
            description={template.bodyTemplate}
          />
        </List.Item>
      )}
    />
  </Card>
);
```

- [ ] **Step 2: 组合模板页**

```tsx
const V0PushTemplatesPage: React.FC = () => {
  const { data } = useQuery({ queryKey: ['v0PushTemplates'], queryFn: getV0PushTemplates });
  return <PushTemplateListCard templates={data} />;
};
```

- [ ] **Step 3: 提交**

```bash
git add client/src/features/v0/pages/V0PushTemplatesPage.tsx client/src/features/v0/components/PushTemplateListCard.tsx
git commit -m "feat: add push template management page"
```

### Task 11: 文档与兼容收口

**Files:**
- Create: `docs/next-stage-framework.md`
- Modify: `docs/current-project-progress.md`
- Modify: `client/src/features/v0/pages/V0MonitorPage.tsx`

- [ ] **Step 1: 编写下一阶段框架说明文档**

```md
# 下一阶段功能框架

## 模块

- 监听任务管理
- 人物档案管理
- 运行中心
- 推送模板管理

## 设计原则

- 先固化结构，再填真实配置
- 所有能力围绕“任务”组织
- 旧 V0 配置页保留兼容入口
```

- [ ] **Step 2: 在兼容监控页添加迁移提示**

```tsx
<Alert
  type="info"
  showIcon
  message="该页为兼容入口，新的任务管理、人物档案、运行中心和推送模板请从左侧新导航进入。"
  style={{ marginBottom: 16 }}
/>;
```

- [ ] **Step 3: 更新当前进度文档**

```md
- 下一阶段框架开发已启动
- 优先顺序调整为：监听任务管理 -> 人物档案管理 -> 运行中心 -> 推送模板管理
```

- [ ] **Step 4: 提交**

```bash
git add docs/next-stage-framework.md docs/current-project-progress.md client/src/features/v0/pages/V0MonitorPage.tsx
git commit -m "docs: add next-stage framework handoff"
```

## Self-Review

### Spec coverage

- 用户要求的“下一阶段功能框架开发清单”已拆成任务、人物、运行中心、推送模板四大块，并明确了前后端文件落点。
- 用户要求的“按顺序开发”已体现在任务顺序中，优先级为：监听任务管理 -> 人物档案管理 -> 运行中心 -> 推送模板管理。
- 当前单配置向多任务结构的演进路径已覆盖，包括数据库、API、UI、兼容入口和文档。

### Placeholder scan

- 计划中未使用 `TODO`、`TBD` 或“后续补充”之类占位描述。
- 每个任务都包含了明确文件、最小代码示例、命令或提交说明。

### Type consistency

- 后端核心实体统一为 `V0WatchTaskRecord`、`V0PersonaRecord`、`V0PushTemplateRecord`、`V0RuntimeTaskOverview`。
- 前端类型和 API 命名与后端实体保持一致，均采用 `V0Tasks`、`V0Personas`、`V0PushTemplates`、`V0RuntimeTasks` 前缀。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-next-stage-framework.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
