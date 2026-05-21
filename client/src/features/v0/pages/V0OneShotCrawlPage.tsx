import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import axios from 'axios';
import { getApiErrorMessage } from '../../../api';
import MessageFeed from '../components/MessageFeed';
import { getV0Config, getV0Messages, pollV0Thread, saveV0Config } from '../api';
import type { V0Config, V0PollPayload, V0PollResult, V0StoredForumMessage } from '../types';

const DEFAULT_CONFIG: V0Config = {
  threadUrl: '',
  threadTitle: '',
  ngaCookie: '',
  pollIntervalSeconds: 60,
  enabled: true,
  pushEnabled: false,
  pushChannel: 'console',
  pushWebhookUrl: '',
  pushSecret: '',
  digestEnabled: false,
  digestCron: '0 18 * * *',
  authors: [],
};

const normalizeAuthorsText = (authorsText: string): string[] => {
  return Array.from(
    new Set(
      authorsText
        .split(/[\n,]/)
        .map((author) => author.trim())
        .filter((author) => author.length > 0)
    )
  );
};

const buildConfigPayload = (draftConfig: V0Config, authorsText: string): V0Config => ({
  ...draftConfig,
  threadUrl: draftConfig.threadUrl.trim(),
  threadTitle: draftConfig.threadTitle.trim(),
  ngaCookie: draftConfig.ngaCookie.trim(),
  enabled: true,
  pushEnabled: false,
  digestEnabled: false,
  authors: normalizeAuthorsText(authorsText),
});

const formatBeijingTime = (date: Date = new Date()): string => {
  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
};

interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

const formatErrorDetail = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ? `status=${error.response.status}` : 'status=unknown';
    const responseText =
      typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? {}, null, 2);
    return `${status} ${responseText}`.trim();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const V0OneShotCrawlPage: React.FC = () => {
  const [draftConfig, setDraftConfig] = useState<V0Config>(DEFAULT_CONFIG);
  const [authorsText, setAuthorsText] = useState('');
  const [messages, setMessages] = useState<V0StoredForumMessage[]>([]);
  const [pollResult, setPollResult] = useState<V0PollResult | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [crawlMode, setCrawlMode] = useState<V0PollPayload['crawlMode']>('from_start');
  const [maxPages, setMaxPages] = useState(10);
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(1);

  const appendLog = (level: LogEntry['level'], text: string): void => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: formatBeijingTime(),
      level,
      text,
    };

    setLogs((prev) => [...prev.slice(-99), entry]);

    const prefix = `[v0-oneshot][${level}]`;
    if (level === 'error') {
      console.error(prefix, text);
    } else if (level === 'warning') {
      console.warn(prefix, text);
    } else {
      console.log(prefix, text);
    }
  };

  useEffect(() => {
    let mounted = true;

    appendLog('info', `page mounted at ${window.location.pathname}`);
    appendLog('info', 'loading config from /api/v0/config');

    getV0Config()
      .then((config) => {
        if (!mounted) {
          return;
        }

        setDraftConfig({ ...DEFAULT_CONFIG, ...config, pushEnabled: false, enabled: true });
        setAuthorsText(config.authors.join('\n'));
        setConfigError(null);
        appendLog(
          'success',
          `config loaded: threadUrl=${config.threadUrl || '(empty)'} authors=${config.authors.length}`
        );
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        const detail = formatErrorDetail(error);
        setConfigError(getApiErrorMessage(error, '读取配置失败，可以先填写后保存'));
        appendLog('error', `config load failed: ${detail}`);
      })
      .finally(() => {
        if (mounted) {
          setLoadingConfig(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const canSubmit = useMemo(() => draftConfig.threadUrl.trim().length > 0, [draftConfig.threadUrl]);

  const buildPollPayload = (): V0PollPayload => {
    if (crawlMode === 'range') {
      return { crawlMode, pageStart, pageEnd };
    }

    if (crawlMode === 'full') {
      return { crawlMode };
    }

    return { crawlMode, maxPages };
  };

  const loadStoredMessages = async () => {
    setLoadingMessages(true);
    setMessagesError(null);
    appendLog('info', 'loading local stored messages from /api/v0/messages');
    try {
      const storedMessages = await getV0Messages(1000);
      setMessages(storedMessages);
      appendLog('success', `loaded ${storedMessages.length} local messages`);
    } catch (error) {
      const detail = formatErrorDetail(error);
      setMessagesError(getApiErrorMessage(error, '读取本地消息失败'));
      appendLog('error', `local messages load failed: ${detail}`);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSave = async (): Promise<V0Config | null> => {
    if (!canSubmit) {
      message.warning('请先填写帖子 URL');
      appendLog('warning', 'save skipped: thread URL is empty');
      return null;
    }

    setSaving(true);
    appendLog('info', 'saving config');
    try {
      const saved = await saveV0Config(buildConfigPayload(draftConfig, authorsText));
      setDraftConfig({ ...DEFAULT_CONFIG, ...saved, pushEnabled: false, enabled: true });
      setAuthorsText(saved.authors.join('\n'));
      message.success('配置已保存');
      appendLog('success', `config saved: threadUrl=${saved.threadUrl || '(empty)'}`);
      return saved;
    } catch (error) {
      const detail = formatErrorDetail(error);
      message.error(getApiErrorMessage(error, '保存配置失败'));
      appendLog('error', `save failed: ${detail}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePollOnce = async () => {
    if (!canSubmit) {
      message.warning('请先填写帖子 URL');
      appendLog('warning', 'poll skipped: thread URL is empty');
      return;
    }

    setPolling(true);
    const pollPayload = buildPollPayload();
    appendLog('info', `starting one-shot poll: ${JSON.stringify(pollPayload)}`);
    try {
      const saved = await saveV0Config(buildConfigPayload(draftConfig, authorsText));
      setDraftConfig({ ...DEFAULT_CONFIG, ...saved, pushEnabled: false, enabled: true });
      setAuthorsText(saved.authors.join('\n'));
      appendLog('success', 'config persisted before poll');

      const result = await pollV0Thread(pollPayload);
      setPollResult(result);
      message.success(`抓取完成，新增 ${result.newMessageCount} 条`);
      appendLog(
        'success',
        `poll finished: total=${result.totalMessages}, new=${result.newMessageCount}, duplicate=${result.duplicateMessageCount}`
      );
      await loadStoredMessages();
    } catch (error) {
      const detail = formatErrorDetail(error);
      message.error(getApiErrorMessage(error, '单次抓取失败'));
      appendLog('error', `poll failed: ${detail}`);
    } finally {
      setPolling(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Alert
          type="info"
          showIcon
          message="单次抓取页面不会自动轮询；填写配置后点击一次抓取，结果会保存到本地并显示最新入库消息。"
        />
      </Col>
      {configError ? (
        <Col span={24}>
          <Alert type="warning" showIcon message={configError} />
        </Col>
      ) : null}
      <Col xs={24} lg={12}>
        <Card title="1. 填写配置">
          <Form layout="vertical">
            <Form.Item label="帖子 URL">
              <Input
                disabled={loadingConfig}
                value={draftConfig.threadUrl}
                onChange={(event) =>
                  setDraftConfig((prev) => ({ ...prev, threadUrl: event.target.value }))
                }
                placeholder="https://bbs.nga.cn/read.php?tid=45974302&authorid=150058"
              />
            </Form.Item>
            <Form.Item label="帖子标题">
              <Input
                disabled={loadingConfig}
                value={draftConfig.threadTitle}
                onChange={(event) =>
                  setDraftConfig((prev) => ({ ...prev, threadTitle: event.target.value }))
                }
                placeholder="可选，便于识别"
              />
            </Form.Item>
            <Form.Item label="NGA Cookie">
              <Input.Password
                disabled={loadingConfig}
                value={draftConfig.ngaCookie}
                onChange={(event) =>
                  setDraftConfig((prev) => ({ ...prev, ngaCookie: event.target.value }))
                }
                placeholder="粘贴浏览器请求头里的整段 Cookie"
              />
            </Form.Item>
            <Form.Item label="作者白名单">
              <Input.TextArea
                disabled={loadingConfig}
                value={authorsText}
                onChange={(event) => setAuthorsText(event.target.value)}
                placeholder="可选。每行一个作者名或 UID:150058；留空则展示本次抓到的所有消息。"
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
            <Form.Item label="抓取范围">
              <Select
                value={crawlMode}
                onChange={setCrawlMode}
                options={[
                  { label: '全量抓取', value: 'full' },
                  { label: '从第 1 页开始抓', value: 'from_start' },
                  { label: '只抓最新页', value: 'latest' },
                  { label: '指定页码范围', value: 'range' },
                ]}
              />
            </Form.Item>
            {crawlMode === 'full' ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="全量抓取会请求帖子全部页码。超大帖子可能耗时很久，并可能触发站点限制。"
              />
            ) : null}
            {crawlMode === 'latest' || crawlMode === 'from_start' ? (
              <Form.Item label="本次最多抓取页数">
                <InputNumber
                  min={1}
                  max={10000}
                  precision={0}
                  value={maxPages}
                  onChange={(value) => setMaxPages(typeof value === 'number' ? value : 10)}
                />
              </Form.Item>
            ) : null}
            {crawlMode === 'range' ? (
              <Form.Item label="页码范围">
                <Space wrap>
                  <InputNumber
                    min={1}
                    max={10000}
                    precision={0}
                    value={pageStart}
                    onChange={(value) => {
                      const nextStart = typeof value === 'number' ? value : 1;
                      setPageStart(nextStart);
                      setPageEnd((prev) => Math.max(prev, nextStart));
                    }}
                  />
                  <Typography.Text>到</Typography.Text>
                  <InputNumber
                    min={pageStart}
                    max={10000}
                    precision={0}
                    value={pageEnd}
                    onChange={(value) => setPageEnd(typeof value === 'number' ? value : pageStart)}
                  />
                </Space>
              </Form.Item>
            ) : null}
            <Space wrap>
              <Button onClick={handleSave} loading={saving} disabled={loadingConfig || !canSubmit}>
                2. 保存配置
              </Button>
              <Button
                type="primary"
                onClick={handlePollOnce}
                loading={polling}
                disabled={loadingConfig || !canSubmit}
              >
                3. 执行一次抓取
              </Button>
              <Button onClick={loadStoredMessages} loading={loadingMessages}>
                4. 读取本地存储
              </Button>
            </Space>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="本次结果">
          {pollResult ? (
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title="本次解析消息" value={pollResult.totalMessages} />
              </Col>
              <Col span={12}>
                <Statistic title="新增入库" value={pollResult.newMessageCount} />
              </Col>
              <Col span={12}>
                <Statistic title="重复消息" value={pollResult.duplicateMessageCount} />
              </Col>
              <Col span={12}>
                <Statistic title="命中作者数" value={pollResult.matchedAuthorCount} />
              </Col>
              <Col span={24}>
                <Typography.Text type="secondary">{pollResult.fetchedAt}</Typography.Text>
              </Col>
            </Row>
          ) : (
            <Typography.Text type="secondary">还没有执行本次抓取。</Typography.Text>
          )}
        </Card>
      </Col>
      <Col span={24}>
        <Card title="本次抓取内容">
          {pollResult && pollResult.matchedMessages.length > 0 ? (
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {pollResult.matchedMessages.map((item) => (
                <Card
                  key={`${item.sourceUrl}-${item.floorId}`}
                  size="small"
                  style={{ marginBottom: 8 }}
                >
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Tag color="blue">{item.authorName}</Tag>
                    <Tag>{`#${item.floorId}`}</Tag>
                    <Typography.Text type="secondary">{item.postedAt}</Typography.Text>
                  </Space>
                  <Typography.Paragraph style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                    {item.rawContent}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary">{item.sourceUrl}</Typography.Text>
                </Card>
              ))}
            </div>
          ) : (
            <Typography.Text type="secondary">还没有本次抓取内容。</Typography.Text>
          )}
        </Card>
      </Col>
      <Col span={24}>
        <Card title="本地最新消息">
          <MessageFeed
            messages={messages}
            isLoading={loadingMessages}
            errorMessage={messagesError ?? undefined}
          />
        </Card>
      </Col>
      <Col span={24}>
        <Card
          title="调试日志"
          extra={
            <Button onClick={() => setLogs([])} disabled={logs.length === 0}>
              清空
            </Button>
          }
        >
          {logs.length > 0 ? (
            <div style={{ maxHeight: 280, overflow: 'auto', fontFamily: 'Consolas, monospace' }}>
              {logs.map((entry) => (
                <div key={entry.id} style={{ marginBottom: 8 }}>
                  <Typography.Text type="secondary">[{entry.time}]</Typography.Text>{' '}
                  <Typography.Text
                    style={{
                      color:
                        entry.level === 'error'
                          ? '#cf1322'
                          : entry.level === 'warning'
                            ? '#d48806'
                            : entry.level === 'success'
                              ? '#389e0d'
                              : undefined,
                    }}
                  >
                    {entry.level.toUpperCase()}
                  </Typography.Text>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{entry.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <Typography.Text type="secondary">还没有日志，先执行一次保存或抓取。</Typography.Text>
          )}
        </Card>
      </Col>
    </Row>
  );
};

export default V0OneShotCrawlPage;
