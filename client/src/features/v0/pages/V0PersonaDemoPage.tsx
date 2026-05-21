import React, { useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  List,
  message,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  LinkOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../../api';
import {
  distillV0Personas,
  getV0PersonaProfile,
  rebuildV0PersonaProfile,
} from '../api';
import type { V0PersonaEvidenceRecord, V0PersonaProfileResult } from '../types';

type PersonaProfileJson = {
  authorName?: string;
  summaryText?: string;
  axes?: Record<string, unknown> | unknown[];
  themes?: unknown[];
  stocks?: unknown[];
  concepts?: unknown[];
  relatedTopics?: unknown[];
  recentChange?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
};

type AxisView = {
  key: string;
  label: string;
  value: string;
  score?: number;
};

const SAMPLE_AUTHOR = '阿狼';
const SAMPLE_AUTHOR_KEY = 'UID:150058';

const AXIS_ORDER = ['stance', 'style', 'horizon', 'risk', 'theme'];
const AXIS_LABELS: Record<string, string> = {
  stance: '立场',
  style: '表达风格',
  horizon: '时间尺度',
  risk: '风险偏好',
  theme: '题材偏好',
};

const AXIS_COLORS: Record<string, string> = {
  stance: 'blue',
  style: 'purple',
  horizon: 'cyan',
  risk: 'orange',
  theme: 'green',
};

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const heroStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 20,
  background: '#fbfdff',
};

const softPanelStyle: React.CSSProperties = {
  border: '1px solid #edf0f4',
  borderRadius: 8,
  padding: 14,
  minHeight: 118,
  background: '#ffffff',
};

const resolveAuthorKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('阿狼') || trimmed.includes('150058')) {
    return SAMPLE_AUTHOR_KEY;
  }

  if (/^uid:/i.test(trimmed)) {
    const uid = trimmed.split(':').slice(1).join(':').trim();
    return uid ? `UID:${uid}` : trimmed;
  }

  return trimmed;
};

const formatTime = (value?: string | null): string => {
  if (!value) {
    return '暂无';
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
};

const parseProfileJson = (value?: string): PersonaProfileJson => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as PersonaProfileJson) : {};
  } catch {
    return {};
  }
};

const getStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const compactText = (value: string, maxLength = 38): string => {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const displayUnknown = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(displayUnknown).filter(Boolean).join(' / ');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = record.summary ?? record.value ?? record.label ?? record.description;
    if (preferred !== undefined) {
      return displayUnknown(preferred);
    }

    return JSON.stringify(record);
  }

  return '待生成';
};

const extractScore = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const score = record.score ?? record.confidence;
    if (typeof score === 'number') {
      return Math.max(0, Math.min(100, score > 1 ? score : score * 100));
    }
  }

  return undefined;
};

const buildAxisViews = (profileJson: PersonaProfileJson): AxisView[] => {
  const axes = profileJson.axes;
  const axisMap = Array.isArray(axes)
    ? Object.fromEntries(axes.map((value, index) => [AXIS_ORDER[index] ?? `axis-${index + 1}`, value]))
    : axes && typeof axes === 'object'
      ? (axes as Record<string, unknown>)
      : {};

  const keys = Array.from(new Set([...AXIS_ORDER, ...Object.keys(axisMap)]));

  return keys.map((key) => ({
    key,
    label: AXIS_LABELS[key] ?? key,
    value: displayUnknown(axisMap[key]),
    score: extractScore(axisMap[key]),
  }));
};

const buildTopicTags = (
  profileJson: PersonaProfileJson,
  evidence: V0PersonaEvidenceRecord[]
): string[] => {
  const fromProfile = [
    ...getStringArray(profileJson.stocks),
    ...getStringArray(profileJson.concepts),
    ...getStringArray(profileJson.relatedTopics),
  ];
  const fromEvidence = evidence.flatMap((item) =>
    item.mentions.map((mention) => mention.replace(/^(stock|sector):/i, '').trim())
  );

  return Array.from(new Set([...fromProfile, ...fromEvidence].filter(Boolean))).slice(0, 20);
};

const buildThemeHighlights = (profileJson: PersonaProfileJson): string[] => {
  return getStringArray(profileJson.themes).slice(0, 4);
};

const evidenceScoreText = (score: number): string => `${(score * 100).toFixed(1)}%`;

const V0PersonaDemoPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [authorInput, setAuthorInput] = useState(SAMPLE_AUTHOR);
  const [selectedAuthorInput, setSelectedAuthorInput] = useState(SAMPLE_AUTHOR);
  const [rebuilding, setRebuilding] = useState(false);
  const [distilling, setDistilling] = useState(false);

  const authorKey = useMemo(() => resolveAuthorKey(selectedAuthorInput), [selectedAuthorInput]);
  const draftAuthorKey = useMemo(() => resolveAuthorKey(authorInput), [authorInput]);
  const displayName = selectedAuthorInput.trim() || authorKey;

  const {
    data: personaResult,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['v0PersonaProfile', authorKey],
    queryFn: () => getV0PersonaProfile(authorKey),
    enabled: authorKey.length > 0,
    refetchOnWindowFocus: false,
  });

  const profile = personaResult?.profile;
  const profileJson = useMemo(() => parseProfileJson(profile?.profileJson), [profile?.profileJson]);
  const axisViews = useMemo(() => buildAxisViews(profileJson), [profileJson]);
  const evidence = useMemo(
    () => [...(personaResult?.evidence ?? [])].sort((left, right) => right.postedAt.localeCompare(left.postedAt)),
    [personaResult?.evidence]
  );
  const topicTags = useMemo(() => buildTopicTags(profileJson, evidence), [profileJson, evidence]);
  const themeHighlights = useMemo(() => buildThemeHighlights(profileJson), [profileJson]);
  const latestEvidence = evidence[0];

  const completionValue =
    profile?.status === 'ready' ? 100 : profile?.status === 'failed' ? 0 : profile ? 55 : 0;
  const evidenceCoverage =
    profile && profile.sourceChunkCount > 0
      ? Math.min(100, Number(((evidence.length / profile.sourceChunkCount) * 100).toFixed(2)))
      : 0;

  const setProfileCache = (result: V0PersonaProfileResult) => {
    queryClient.setQueryData(['v0PersonaProfile', result.authorName], result);
  };

  const handleLoad = () => {
    if (!draftAuthorKey) {
      message.warning('请输入作者名或 UID');
      return;
    }

    setSelectedAuthorInput(authorInput.trim());
  };

  const handleRebuild = async () => {
    if (!draftAuthorKey) {
      message.warning('请输入作者名或 UID');
      return;
    }

    setSelectedAuthorInput(authorInput.trim());
    setRebuilding(true);
    try {
      const result = await rebuildV0PersonaProfile({
        authorName: draftAuthorKey,
        force: true,
        axisTopK: 20,
        evidencePoolSize: 300,
      });
      setProfileCache(result);
      message.success('画像已重建');
    } catch (rebuildError) {
      console.error(rebuildError);
      message.error(getApiErrorMessage(rebuildError, '画像重建失败'));
    } finally {
      setRebuilding(false);
    }
  };

  const handleDistill = async () => {
    if (!draftAuthorKey) {
      message.warning('请输入作者名或 UID');
      return;
    }

    setSelectedAuthorInput(authorInput.trim());
    setDistilling(true);
    try {
      const result = await distillV0Personas({
        authorNames: [draftAuthorKey],
        bootstrap: true,
        force: true,
        axisTopK: 20,
        evidencePoolSize: 300,
      });
      const nextProfile = result.profiles.find((item) => item.authorName === draftAuthorKey) ?? result.profiles[0];
      if (nextProfile) {
        setProfileCache(nextProfile);
      }
      message.success(`蒸馏完成，处理 ${result.processedAuthors} 个作者`);
    } catch (distillError) {
      console.error(distillError);
      message.error(getApiErrorMessage(distillError, '蒸馏失败'));
    } finally {
      setDistilling(false);
    }
  };

  const overviewContent = profile ? (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        <Card
          title="核心画像"
          extra={<Tag color={profile.status === 'ready' ? 'green' : 'default'}>{profile.status}</Tag>}
        >
          <Typography.Paragraph style={{ fontSize: 16, marginBottom: 0 }}>
            {profile.summaryText || profileJson.summaryText || '暂无摘要'}
          </Typography.Paragraph>
          <Divider />
          <Row gutter={[12, 12]}>
            {axisViews.map((axis) => (
              <Col xs={24} sm={12} lg={8} key={axis.key}>
                <div style={softPanelStyle}>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Tag color={AXIS_COLORS[axis.key] ?? 'default'}>{axis.label}</Tag>
                      {axis.score !== undefined ? (
                        <Typography.Text type="secondary">{axis.score.toFixed(0)}%</Typography.Text>
                      ) : null}
                    </Space>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {axis.value}
                    </Typography.Paragraph>
                    {axis.score !== undefined ? <Progress percent={axis.score} showInfo={false} size="small" /> : null}
                  </Space>
                </div>
              </Col>
            ))}
          </Row>
          {themeHighlights.length > 0 ? (
            <>
              <Divider />
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>主题线索</Typography.Text>
                {themeHighlights.map((theme, index) => (
                  <Typography.Paragraph key={`${theme}-${index}`} style={{ marginBottom: 0 }}>
                    {compactText(theme, 120)}
                  </Typography.Paragraph>
                ))}
              </Space>
            </>
          ) : null}
        </Card>
      </Col>

      <Col xs={24} xl={8}>
        <Card title="覆盖与新鲜度">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <Statistic title="消息" value={profile.sourceMessageCount} prefix={<DatabaseOutlined />} />
              </Col>
              <Col span={12}>
                <Statistic title="Chunks" value={profile.sourceChunkCount} />
              </Col>
              <Col span={12}>
                <Statistic title="证据" value={evidence.length} />
              </Col>
              <Col span={12}>
                <Statistic title="版本" value={profile.profileVersion} prefix="v" />
              </Col>
            </Row>
            <div>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Typography.Text>画像完成度</Typography.Text>
                <Typography.Text type="secondary">{completionValue}%</Typography.Text>
              </Space>
              <Progress percent={completionValue} showInfo={false} status={profile.status === 'failed' ? 'exception' : 'active'} />
            </div>
            <div>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Typography.Text>精选证据覆盖</Typography.Text>
                <Typography.Text type="secondary">{evidenceCoverage}%</Typography.Text>
              </Space>
              <Progress percent={evidenceCoverage} showInfo={false} />
            </div>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">
                <ClockCircleOutlined /> 最新消息：{formatTime(profile.lastMessageAt)}
              </Typography.Text>
              <Typography.Text type="secondary">
                <SafetyCertificateOutlined /> 最近构建：{formatTime(profile.lastBuiltAt)}
              </Typography.Text>
            </Space>
          </Space>
        </Card>

        <Card title="最新信号" style={{ marginTop: 16 }}>
          {latestEvidence ? (
            <Space direction="vertical" size={8}>
              <Space wrap>
                <Tag color={AXIS_COLORS[latestEvidence.axis] ?? 'blue'}>
                  {AXIS_LABELS[latestEvidence.axis] ?? latestEvidence.axis}
                </Tag>
                <Tag>{`#${latestEvidence.floorId}`}</Tag>
                <Typography.Text type="secondary">{formatTime(latestEvidence.postedAt)}</Typography.Text>
              </Space>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                {latestEvidence.excerpt}
              </Typography.Paragraph>
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据" />
          )}
        </Card>
      </Col>

      <Col span={24}>
        <Card title="关联对象">
          {topicTags.length > 0 ? (
            <Space wrap>
              {topicTags.map((topic) => (
                <Tag key={topic} color="geekblue">
                  {compactText(topic, 18)}
                </Tag>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无结构化关联对象" />
          )}
        </Card>
      </Col>
    </Row>
  ) : (
    <Empty description="暂无画像数据" />
  );

  const evidenceContent = evidence.length > 0 ? (
    <Card title="证据链" extra={<Tag>{`${evidence.length} 条`}</Tag>}>
      <List
        dataSource={evidence}
        split={false}
        renderItem={(item) => (
          <List.Item style={{ paddingInline: 0 }}>
            <div style={{ ...softPanelStyle, width: '100%', minHeight: 'auto' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={AXIS_COLORS[item.axis] ?? 'blue'}>{AXIS_LABELS[item.axis] ?? item.axis}</Tag>
                  <Tag>{`#${item.floorId}`}</Tag>
                  <Tooltip title="向量相似度">
                    <Tag color="gold">{evidenceScoreText(item.similarity)}</Tag>
                  </Tooltip>
                  <Typography.Text type="secondary">{formatTime(item.postedAt)}</Typography.Text>
                  <Typography.Link href={item.sourceUrl} target="_blank" rel="noreferrer">
                    <LinkOutlined /> 原帖
                  </Typography.Link>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {item.excerpt}
                </Typography.Paragraph>
                {item.mentions.length > 0 || item.marketSummaries.length > 0 ? (
                  <Space direction="vertical" size={4}>
                    {item.mentions.length > 0 ? (
                      <Space wrap>
                        {item.mentions.map((mention) => (
                          <Tag key={`${item.messageId}-${mention}`}>{mention}</Tag>
                        ))}
                      </Space>
                    ) : null}
                    {item.marketSummaries.map((summary) => (
                      <Typography.Text key={`${item.messageId}-${summary}`} type="secondary">
                        {summary}
                      </Typography.Text>
                    ))}
                  </Space>
                ) : null}
              </Space>
            </div>
          </List.Item>
        )}
      />
    </Card>
  ) : (
    <Empty description="暂无证据链" />
  );

  const rawContent = profile ? (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title="profileJson">
          <pre style={{ maxHeight: 520, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(profileJson, null, 2)}
          </pre>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="run">
          <pre style={{ maxHeight: 520, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(personaResult?.run ?? {}, null, 2)}
          </pre>
        </Card>
      </Col>
    </Row>
  ) : (
    <Empty description="暂无原始数据" />
  );

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={14}>
            <Space align="center" size={16}>
              <Avatar size={64} icon={<IdcardOutlined />} style={{ backgroundColor: '#1d39c4' }} />
              <Space direction="vertical" size={4}>
                <Space wrap align="center">
                  <Typography.Title level={2} style={{ margin: 0 }}>
                    人物画像 Demo
                  </Typography.Title>
                  <Tag color="blue">DEMO</Tag>
                </Space>
                <Space wrap>
                  <Tag color="processing">{displayName}</Tag>
                  <Tag>{authorKey || '未选择作者'}</Tag>
                  {profile ? <Tag color={profile.status === 'ready' ? 'green' : 'default'}>{profile.status}</Tag> : null}
                </Space>
              </Space>
            </Space>
          </Col>

          <Col xs={24} xl={10}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={authorInput}
                  onChange={(event) => setAuthorInput(event.target.value)}
                  onPressEnter={handleLoad}
                  placeholder="作者名或 UID"
                />
                <Button onClick={handleLoad} disabled={!draftAuthorKey}>
                  读取
                </Button>
              </Space.Compact>
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleRebuild}
                  loading={rebuilding}
                  disabled={!draftAuthorKey || distilling}
                >
                  重建画像
                </Button>
                <Button
                  type="primary"
                  icon={<ExperimentOutlined />}
                  onClick={handleDistill}
                  loading={distilling}
                  disabled={!draftAuthorKey || rebuilding}
                >
                  蒸馏并生成
                </Button>
              </Space>
            </Space>
          </Col>
        </Row>
      </div>

      {error ? (
        <Alert type="warning" showIcon message={getApiErrorMessage(error, '画像读取失败')} />
      ) : null}

      {isLoading ? (
        <Card>
          <Spin />
        </Card>
      ) : (
        <Tabs
          defaultActiveKey="overview"
          items={[
            { key: 'overview', label: '画像概览', children: overviewContent },
            { key: 'evidence', label: '证据链', children: evidenceContent },
            { key: 'raw', label: '原始数据', children: rawContent },
          ]}
        />
      )}
    </div>
  );
};

export default V0PersonaDemoPage;
