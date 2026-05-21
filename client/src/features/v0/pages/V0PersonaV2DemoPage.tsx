import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  BranchesOutlined,
  ExperimentOutlined,
  FieldTimeOutlined,
  FireOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../../api';
import {
  analyzeV0PersonaRecentWeights,
  getV0PersonaProfile,
  inferV0Persona,
  queryV0Agent,
  rebuildV0PersonaProfile,
} from '../api';
import type {
  V0AgentQueryResult,
  V0PersonaEvidenceRecord,
  V0PersonaInferenceResponse,
  V0PersonaProfileJsonV2,
  V0PersonaProfileResult,
  V0PersonaRecentWeightResponse,
} from '../types';

const SAMPLE_AUTHOR = '阿狼';
const SAMPLE_AUTHOR_KEY = 'UID:150058';

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const heroStyle: React.CSSProperties = {
  border: '1px solid #d9e2ec',
  borderRadius: 8,
  padding: 20,
  background: '#f8fbff',
};

const panelStyle: React.CSSProperties = {
  border: '1px solid #edf1f5',
  borderRadius: 8,
  padding: 14,
  minHeight: 104,
  background: '#fff',
};

const compactPanelStyle: React.CSSProperties = {
  border: '1px solid #edf1f5',
  borderRadius: 8,
  padding: 12,
  background: '#fff',
};

const preStyle: React.CSSProperties = {
  maxHeight: 440,
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  lineHeight: 1.6,
};

const bucketLabels: Record<string, string> = {
  longformTheory: '长文理论',
  intradayDecision: '盘中决策',
  riskWarning: '风险提示',
  sectorStockReasoning: '板块个股',
  marketStructure: '市场结构',
  expressionStyle: '表达风格',
  recentSignals: '近期信号',
  contradictionCandidates: '矛盾候选',
};

const bucketColors: Record<string, string> = {
  longformTheory: 'blue',
  intradayDecision: 'cyan',
  riskWarning: 'orange',
  sectorStockReasoning: 'green',
  marketStructure: 'geekblue',
  expressionStyle: 'purple',
  recentSignals: 'lime',
  contradictionCandidates: 'red',
};

const bucketOrder = Object.keys(bucketLabels);

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

const parseProfileV2 = (value?: string): V0PersonaProfileJsonV2 | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed?.schemaVersion === 2 ? (parsed as V0PersonaProfileJsonV2) : null;
  } catch {
    return null;
  }
};

const compact = (value: string, maxLength = 120): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const percent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const formatRatio = (value: number): string => `${percent(value * 100)}%`;

const formatTime = (value?: string | null): string => {
  if (!value) {
    return '暂无';
  }
  return value.replace('T', ' ').replace(/\.\d+/, '').replace('+08:00', '').slice(0, 16);
};

const parseCsv = (value: string): string[] =>
  value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const getEvidenceBucket = (item: V0PersonaEvidenceRecord): string => item.bucket ?? item.axis;

const groupEvidence = (evidence: V0PersonaEvidenceRecord[]): Record<string, V0PersonaEvidenceRecord[]> =>
  evidence.reduce<Record<string, V0PersonaEvidenceRecord[]>>((acc, item) => {
    const bucket = getEvidenceBucket(item);
    acc[bucket] = [...(acc[bucket] ?? []), item];
    return acc;
  }, {});

const average = (values: number[]): number => {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return 0;
  }
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
};

const V0PersonaV2DemoPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [authorInput, setAuthorInput] = useState(SAMPLE_AUTHOR);
  const [selectedAuthorInput, setSelectedAuthorInput] = useState(SAMPLE_AUTHOR);
  const [rebuilding, setRebuilding] = useState(false);

  const [agentQuery, setAgentQuery] = useState('分析一下5月15日A股走弱的原因，借助阿狼的分析');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentDebug, setAgentDebug] = useState(false);
  const [agentResult, setAgentResult] = useState<V0AgentQueryResult | null>(null);

  const [inferenceQuery, setInferenceQuery] = useState('长鑫存储 IPO 传闻对5月18日大盘和半导体怎么推演？');
  const [inferenceEvent, setInferenceEvent] = useState('长鑫存储 IPO 传闻影响半导体、存储和光芯存算方向。');
  const [inferenceDate, setInferenceDate] = useState('2026-05-18');
  const [inferenceStockHints, setInferenceStockHints] = useState('');
  const [inferenceSectorHints, setInferenceSectorHints] = useState('半导体,算力,存储');
  const [inferenceDebug, setInferenceDebug] = useState(false);
  const [inferenceLoading, setInferenceLoading] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<V0PersonaInferenceResponse | null>(null);

  const [recentWeightQuery, setRecentWeightQuery] = useState('近期内容权重怎么变化，核心关注点是什么？');
  const [recentWeightSampleSize, setRecentWeightSampleSize] = useState('24');
  const [recentWeightDebug, setRecentWeightDebug] = useState(false);
  const [recentWeightLoading, setRecentWeightLoading] = useState(false);
  const [recentWeightResult, setRecentWeightResult] = useState<V0PersonaRecentWeightResponse | null>(null);

  const authorKey = useMemo(() => resolveAuthorKey(selectedAuthorInput), [selectedAuthorInput]);
  const draftAuthorKey = useMemo(() => resolveAuthorKey(authorInput), [authorInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['v0PersonaProfileV2', authorKey],
    queryFn: () => getV0PersonaProfile(authorKey),
    enabled: authorKey.length > 0,
    refetchOnWindowFocus: false,
  });

  const profile = data?.profile;
  const profileV2 = useMemo(() => parseProfileV2(profile?.profileJson), [profile?.profileJson]);
  const evidence = data?.evidence ?? [];
  const groupedEvidence = useMemo(() => groupEvidence(evidence), [evidence]);
  const sortedEvidence = useMemo(
    () =>
      [...evidence].sort(
        (left, right) =>
          (right.qualityScore ?? 0) - (left.qualityScore ?? 0) ||
          right.postedAt.localeCompare(left.postedAt)
      ),
    [evidence]
  );
  const bucketStats = useMemo(() => {
    if (!profileV2) {
      return [];
    }
    const counts = profileV2.evidenceQuality.bucketCounts ?? {};
    return bucketOrder.map((key) => {
      const items = groupedEvidence[key] ?? [];
      return {
        key,
        label: bucketLabels[key] ?? key,
        count: items.length,
        schemaCount: counts[key] ?? items.length,
        avgQuality: average(items.map((item) => item.qualityScore ?? 0)),
        topEvidence: [...items]
          .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0))
          .slice(0, 3),
      };
    });
  }, [groupedEvidence, profileV2]);

  const setProfileCache = (result: V0PersonaProfileResult) => {
    queryClient.setQueryData(['v0PersonaProfileV2', result.authorName], result);
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
        version: 2,
        fullHistory: true,
        evidencePoolSize: 600,
      });
      setProfileCache(result);
      message.success('V2 画像已生成');
    } catch (rebuildError) {
      message.error(getApiErrorMessage(rebuildError, 'V2 画像生成失败'));
    } finally {
      setRebuilding(false);
    }
  };

  const handlePersonaInference = async () => {
    if (!inferenceQuery.trim()) {
      message.warning('请输入推演问题');
      return;
    }
    if (!draftAuthorKey) {
      message.warning('请输入作者名或 UID');
      return;
    }
    setInferenceLoading(true);
    try {
      const result = await inferV0Persona({
        query: inferenceQuery.trim(),
        authorName: draftAuthorKey,
        queryDate: inferenceDate.trim() || undefined,
        eventText: inferenceEvent.trim() || undefined,
        stockHints: parseCsv(inferenceStockHints),
        sectorHints: parseCsv(inferenceSectorHints),
        debug: inferenceDebug,
      });
      setInferenceResult(result);
      message.success('方法论推演已生成');
    } catch (inferenceError) {
      message.error(getApiErrorMessage(inferenceError, '方法论推演失败'));
    } finally {
      setInferenceLoading(false);
    }
  };

  const handleRecentWeightAnalysis = async () => {
    const parsedSampleSize = Number(recentWeightSampleSize);
    if (!Number.isInteger(parsedSampleSize) || parsedSampleSize <= 0) {
      message.warning('请输入有效样本数');
      return;
    }
    setRecentWeightLoading(true);
    try {
      const result = await analyzeV0PersonaRecentWeights({
        query: recentWeightQuery.trim(),
        authorName: draftAuthorKey,
        queryDate: inferenceDate.trim() || undefined,
        sampleSize: parsedSampleSize,
        debug: recentWeightDebug,
      });
      setRecentWeightResult(result);
      message.success('近期权重分析已生成');
    } catch (analysisError) {
      message.error(getApiErrorMessage(analysisError, '近期权重分析失败'));
    } finally {
      setRecentWeightLoading(false);
    }
  };

  const handleAgentQuery = async () => {
    if (!agentQuery.trim()) {
      message.warning('请输入问题');
      return;
    }
    setAgentLoading(true);
    try {
      setAgentResult(await queryV0Agent(agentQuery, agentDebug));
    } catch (queryError) {
      message.error(getApiErrorMessage(queryError, 'Agent 查询失败'));
    } finally {
      setAgentLoading(false);
    }
  };

  const renderDashboard = (v2: V0PersonaProfileJsonV2) => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="方法论总览" extra={<RadarChartOutlined />}>
            <Typography.Paragraph style={{ fontSize: 16 }}>{v2.summaryText}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              {v2.coreRules.map((rule, index) => (
                <Col xs={24} md={12} key={`${rule}-${index}`}>
                  <div style={panelStyle}>
                    <Space direction="vertical" size={8}>
                      <Tag color="blue">{`规则 ${index + 1}`}</Tag>
                      <Typography.Paragraph style={{ marginBottom: 0 }}>{rule}</Typography.Paragraph>
                    </Space>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="证据质量" extra={<SafetyCertificateOutlined />}>
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <Statistic title="证据" value={v2.evidenceQuality.totalEvidence} />
              </Col>
              <Col span={12}>
                <Statistic title="Chunks" value={v2.evidenceQuality.totalChunks} />
              </Col>
              <Col span={12}>
                <Statistic title="长文占比" value={formatRatio(v2.evidenceQuality.longformRatio)} />
              </Col>
              <Col span={12}>
                <Statistic title="近期占比" value={formatRatio(v2.evidenceQuality.recentRatio)} />
              </Col>
            </Row>
            <Progress percent={percent(v2.evidenceQuality.confidence * 100)} />
          </Card>
        </Col>
      </Row>

      <Card title="证据桶热力" extra={<FireOutlined />}>
        <Row gutter={[12, 12]}>
          {bucketStats.map((stat) => (
            <Col xs={24} md={12} xl={6} key={stat.key}>
              <div style={panelStyle}>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Tag color={bucketColors[stat.key] ?? 'default'}>{stat.label}</Tag>
                    <Typography.Text strong>{stat.count}</Typography.Text>
                  </Space>
                  <Progress percent={percent(stat.avgQuality * 100)} size="small" />
                  <Typography.Text type="secondary">{`画像计数 ${stat.schemaCount}`}</Typography.Text>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {stat.topEvidence[0] ? compact(stat.topEvidence[0].excerpt, 80) : '暂无证据样本'}
                  </Typography.Paragraph>
                </Space>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="市场分析流程" extra={<BranchesOutlined />}>
            <Timeline
              items={v2.marketMethodology.reasoningSteps.map((step, index) => ({
                color: index === 0 ? 'blue' : 'gray',
                children: (
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{`步骤 ${index + 1}`}</Typography.Text>
                    <Typography.Text>{step}</Typography.Text>
                  </Space>
                ),
              }))}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="确认 / 失效 / 风控">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <List size="small" header="确认信号" dataSource={v2.marketMethodology.confirmationSignals} renderItem={(item) => <List.Item>{item}</List.Item>} />
              <List size="small" header="失效信号" dataSource={v2.marketMethodology.invalidationSignals} renderItem={(item) => <List.Item>{item}</List.Item>} />
              <Alert type="warning" showIcon message="风险处理" description={v2.marketMethodology.riskHandling || '暂无'} />
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
  const renderEvidenceWorkbench = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="证据桶明细">
        <Collapse
          items={bucketStats.map((stat) => ({
            key: stat.key,
            label: (
              <Space wrap>
                <Tag color={bucketColors[stat.key] ?? 'default'}>{stat.label}</Tag>
                <Tag>{`${stat.count} 条`}</Tag>
                <Tag color="gold">{`平均质量 ${formatRatio(stat.avgQuality)}`}</Tag>
              </Space>
            ),
            children: (
              <List
                dataSource={groupedEvidence[stat.key] ?? []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据" /> }}
                renderItem={(item) => (
                  <List.Item>
                    <Space direction="vertical" style={{ width: '100%' }} size={6}>
                      <Space wrap>
                        <Tag color={bucketColors[getEvidenceBucket(item)] ?? 'default'}>{bucketLabels[getEvidenceBucket(item)] ?? getEvidenceBucket(item)}</Tag>
                        <Tag>{`#${item.floorId}`}</Tag>
                        <Tag color="gold">{formatRatio(item.qualityScore ?? 0)}</Tag>
                        <Typography.Text type="secondary">{formatTime(item.postedAt)}</Typography.Text>
                      </Space>
                      <Typography.Paragraph style={{ marginBottom: 0 }}>{item.excerpt}</Typography.Paragraph>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          }))}
        />
      </Card>
      <Card title="高质量证据排序">
        <List
          dataSource={sortedEvidence.slice(0, 80)}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                <Space wrap>
                  <Tag color={bucketColors[getEvidenceBucket(item)] ?? 'default'}>{bucketLabels[getEvidenceBucket(item)] ?? getEvidenceBucket(item)}</Tag>
                  <Tag>{`#${item.floorId}`}</Tag>
                  <Tag color="gold">{formatRatio(item.qualityScore ?? 0)}</Tag>
                  <Typography.Text type="secondary">{formatTime(item.postedAt)}</Typography.Text>
                </Space>
                <Typography.Text>{item.excerpt}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );

  const renderInferenceWorkbench = () => {
    const probabilityColor: Record<string, string> = {
      high: 'red',
      medium: 'orange',
      low: 'blue',
      unknown: 'default',
    };

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="方法论推演输入" extra={<ExperimentOutlined />}>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Input value={authorInput} onChange={(event) => setAuthorInput(event.target.value)} placeholder="作者名或 UID" />
                <Input value={inferenceDate} onChange={(event) => setInferenceDate(event.target.value)} placeholder="YYYY-MM-DD" />
                <Input value={inferenceStockHints} onChange={(event) => setInferenceStockHints(event.target.value)} placeholder="股票提示，逗号分隔" />
                <Input value={inferenceSectorHints} onChange={(event) => setInferenceSectorHints(event.target.value)} placeholder="板块提示，逗号分隔" />
              </Space>
            </Col>
            <Col xs={24} xl={14}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Input.TextArea value={inferenceQuery} onChange={(event) => setInferenceQuery(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="推演问题" />
                <Input.TextArea value={inferenceEvent} onChange={(event) => setInferenceEvent(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="事件背景、盘面事实或新闻摘要" />
                <Space>
                  <Button type="primary" icon={<ExperimentOutlined />} loading={inferenceLoading} onClick={handlePersonaInference}>
                    生成结构化推演
                  </Button>
                  <Typography.Text type="secondary">Debug</Typography.Text>
                  <Switch checked={inferenceDebug} onChange={setInferenceDebug} />
                </Space>
              </Space>
            </Col>
          </Row>
        </Card>

        {!inferenceResult ? (
          <Alert type="info" showIcon message="输入事件和问题后，系统会按 V2 画像生成结构化方法论推演。" />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={15}>
                <Card title="推演总结" extra={<RobotOutlined />}>
                  <Typography.Paragraph style={{ fontSize: 16 }}>{inferenceResult.summary}</Typography.Paragraph>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                      <List header="当前事实" size="small" dataSource={inferenceResult.currentFacts} renderItem={(item) => <List.Item>{item}</List.Item>} />
                    </Col>
                    <Col xs={24} md={12}>
                      <List header="缺失输入" size="small" dataSource={inferenceResult.missingInputs} renderItem={(item) => <List.Item>{item}</List.Item>} />
                    </Col>
                  </Row>
                </Card>
              </Col>
              <Col xs={24} xl={9}>
                <Card title="Evidence Pack">
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Statistic title="直接日期发言" value={inferenceResult.evidencePack.directDateMessageCount} />
                    <Statistic title="证据引用" value={inferenceResult.evidenceCitations.length} />
                    <Statistic title="市场事实" value={inferenceResult.marketFacts?.facts.length ?? 0} />
                  </Space>
                </Card>
              </Col>
            </Row>

            <Card title="情景推演">
              <Row gutter={[12, 12]}>
                {inferenceResult.scenarioSimulations.map((scenario) => (
                  <Col xs={24} xl={8} key={scenario.title}>
                    <div style={panelStyle}>
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Space wrap>
                          <Tag color={probabilityColor[scenario.probability]}>{scenario.probability}</Tag>
                          <Tag color="gold">{formatRatio(scenario.confidence)}</Tag>
                        </Space>
                        <Typography.Text strong>{scenario.title}</Typography.Text>
                        <Typography.Text>{scenario.reasoning}</Typography.Text>
                        <Typography.Text type="secondary">{scenario.personaAction}</Typography.Text>
                      </Space>
                    </div>
                  </Col>
                ))}
              </Row>
            </Card>

            <Card title="市场事实">
              <List
                grid={{ gutter: 12, xs: 1, md: 2, xl: 3 }}
                dataSource={inferenceResult.marketFacts?.facts ?? []}
                renderItem={(fact) => (
                  <List.Item>
                    <div style={compactPanelStyle}>
                      <Space direction="vertical" size={8}>
                        <Space wrap>
                          <Tag>{fact.kind}</Tag>
                          <Tag>{fact.subjectKey}</Tag>
                        </Space>
                        <Typography.Text strong>{fact.title}</Typography.Text>
                        <Typography.Text type="secondary">{fact.summary}</Typography.Text>
                      </Space>
                    </div>
                  </List.Item>
                )}
              />
            </Card>

            <Card title="Markdown / Debug">
              <Tabs
                items={[
                  { key: 'markdown', label: 'Markdown', children: <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{inferenceResult.markdown}</Typography.Paragraph> },
                  { key: 'json', label: 'JSON', children: <pre style={preStyle}>{JSON.stringify(inferenceResult, null, 2)}</pre> },
                ]}
              />
            </Card>
          </>
        )}
      </Space>
    );
  };

  const renderRecentWeightWorkbench = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="近期权重分析输入" extra={<FieldTimeOutlined />}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Input value={authorInput} onChange={(event) => setAuthorInput(event.target.value)} placeholder="作者名或 UID" />
              <Input value={inferenceDate} onChange={(event) => setInferenceDate(event.target.value)} placeholder="YYYY-MM-DD" />
              <Input value={recentWeightSampleSize} onChange={(event) => setRecentWeightSampleSize(event.target.value)} placeholder="样本上限" />
            </Space>
          </Col>
          <Col xs={24} xl={14}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Input.TextArea value={recentWeightQuery} onChange={(event) => setRecentWeightQuery(event.target.value)} autoSize={{ minRows: 3, maxRows: 5 }} placeholder="近期权重分析问题" />
              <Space>
                <Button type="primary" icon={<RadarChartOutlined />} loading={recentWeightLoading} onClick={handleRecentWeightAnalysis}>
                  分析近期权重
                </Button>
                <Typography.Text type="secondary">Debug</Typography.Text>
                <Switch checked={recentWeightDebug} onChange={setRecentWeightDebug} />
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      {!recentWeightResult ? (
        <Alert type="info" showIcon message="输入近期分析问题后，系统会以历史画像为底座，提取最近发言权重。" />
      ) : (
        <>
          <Card title="近期焦点" extra={<FireOutlined />}>
            <Typography.Paragraph style={{ fontSize: 16 }}>{recentWeightResult.summary}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">{recentWeightResult.baselineSummary}</Typography.Paragraph>
            <Space wrap>
              {recentWeightResult.recentSignals.map((signal) => (
                <Tag key={signal.key} color={signal.direction === 'up' ? 'red' : signal.direction === 'down' ? 'blue' : 'default'}>
                  {signal.label} {Math.round(signal.weight * 100)}%
                </Tag>
              ))}
            </Space>
          </Card>
          <Card title="近期证据">
            <List
              dataSource={recentWeightResult.recentEvidence}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={4}>
                    <Space wrap>
                      <Tag>{item.id}</Tag>
                      <Tag>{item.source}</Tag>
                      {item.bucket ? <Tag color={bucketColors[item.bucket] ?? 'default'}>{item.bucket}</Tag> : null}
                    </Space>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text type="secondary">{compact(item.excerpt, 220)}</Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </>
      )}
    </Space>
  );

  const renderAgentPanel = () => (
    <Card title="基于 V2 画像提问" extra={<RobotOutlined />}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input.TextArea value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} />
        <Space>
          <Button type="primary" icon={<ExperimentOutlined />} loading={agentLoading} onClick={handleAgentQuery}>
            运行 Agent
          </Button>
          <Typography.Text type="secondary">Debug</Typography.Text>
          <Switch checked={agentDebug} onChange={setAgentDebug} />
        </Space>
        {agentResult ? (
          <Alert
            type="success"
            showIcon
            message={agentResult.queryType}
            description={
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{agentResult.answer}</Typography.Paragraph>
                {agentDebug && agentResult.debugTrace ? <pre style={preStyle}>{JSON.stringify(agentResult.debugTrace, null, 2)}</pre> : null}
              </Space>
            }
          />
        ) : null}
      </Space>
    </Card>
  );

  const renderRawStructure = (v2: V0PersonaProfileJsonV2) => (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12}>
        <Card title="profileJson">
          <pre style={preStyle}>{JSON.stringify(v2, null, 2)}</pre>
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card title="metadata">
          <pre style={preStyle}>{JSON.stringify({ profile, run: data?.run, rebuilt: data?.rebuilt }, null, 2)}</pre>
        </Card>
      </Col>
    </Row>
  );

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={14}>
            <Space direction="vertical" size={6}>
              <Space wrap>
                <Typography.Title level={2} style={{ margin: 0 }}>
                  人物方法论 V2
                </Typography.Title>
                <Tag color="processing">schema v2</Tag>
                {profile?.status ? <Tag color={profile.status === 'ready' ? 'green' : 'default'}>{profile.status}</Tag> : null}
              </Space>
              <Typography.Text type="secondary">
                画像、证据桶、方法论、近期权重、外部市场事实和 Agent 推演统一工作台。
              </Typography.Text>
              <Space wrap>
                <Tag>{selectedAuthorInput}</Tag>
                <Tag>{authorKey || '未选择作者'}</Tag>
                {profile ? <Tag>{`profile v${profile.profileVersion}`}</Tag> : null}
                {profile?.lastBuiltAt ? <Tag>{`构建 ${formatTime(profile.lastBuiltAt)}`}</Tag> : null}
              </Space>
            </Space>
          </Col>
          <Col xs={24} xl={10}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input value={authorInput} onChange={(event) => setAuthorInput(event.target.value)} onPressEnter={handleLoad} placeholder="作者名或 UID" />
                <Button onClick={handleLoad}>读取</Button>
              </Space.Compact>
              <Button type="primary" icon={<ReloadOutlined />} loading={rebuilding} onClick={handleRebuild} disabled={!draftAuthorKey}>
                全量重建 V2
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {error ? <Alert type="warning" showIcon message={getApiErrorMessage(error, '画像读取失败')} /> : null}

      {isLoading ? (
        <Card>
          <Spin />
        </Card>
      ) : !profileV2 ? (
        <Alert type="info" showIcon message="当前还没有 V2 画像" description="点击全量重建 V2 后，会基于本地数据生成方法论画像。" />
      ) : (
        <Tabs
          defaultActiveKey="dashboard"
          items={[
            { key: 'dashboard', label: '总览工作台', children: renderDashboard(profileV2) },
            { key: 'evidence', label: `证据桶 ${evidence.length}`, children: renderEvidenceWorkbench() },
            { key: 'inference', label: '方法论推演', children: renderInferenceWorkbench() },
            { key: 'recent-weight', label: '近期权重', children: renderRecentWeightWorkbench() },
            { key: 'agent', label: 'Agent 提问', children: renderAgentPanel() },
            { key: 'raw', label: '原始结构', children: renderRawStructure(profileV2) },
          ]}
        />
      )}
    </div>
  );
};

export default V0PersonaV2DemoPage;
