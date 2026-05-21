import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DatabaseOutlined,
  FireOutlined,
  LineChartOutlined,
  RadarChartOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../../api';
import { getV0ExternalMarketFacts } from '../api';
import type { V0MarketFactItem } from '../types';

type ExternalSectionKey =
  | 'board-rotation'
  | 'stock-picker'
  | 'institution-flow'
  | 'limit-board'
  | 'ma-indicator'
  | 'dragon-review';

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

const sectionButtons: Array<{ key: ExternalSectionKey; label: string }> = [
  { key: 'board-rotation', label: '开盘啦板块轮动' },
  { key: 'stock-picker', label: '开盘啦选股器' },
  { key: 'institution-flow', label: '机构多空单' },
  { key: 'limit-board', label: '涨跌停板行情' },
  { key: 'ma-indicator', label: '均线顶底指标' },
  { key: 'dragon-review', label: '龙虎榜复盘' },
];

const sourceLabels: Record<string, string> = {
  bigamap_points: 'points',
  bigamap_maximized_rankings: 'maximized-rankings',
  bigamap_limit_up_review: 'limit-up-review',
};

const sourceStatusColors: Record<string, string> = {
  success: 'green',
  missing: 'orange',
  failed: 'red',
};

const getBeijingDateString = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const readNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const formatPercent = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${value.toFixed(2)}%`;
};

const formatAmountYi = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '暂无';
  }
  return `${(value / 100000000).toFixed(2)} 亿元`;
};

const getFactDataList = (fact: V0MarketFactItem | undefined, key: string): Array<Record<string, unknown>> => {
  const value = fact?.data?.[key];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
};

const V0ExternalDataPage: React.FC = () => {
  const [queryDate, setQueryDate] = useState(getBeijingDateString());
  const [topN, setTopN] = useState(8);
  const [activeSection, setActiveSection] = useState<ExternalSectionKey>('board-rotation');

  const externalFactsQuery = useQuery({
    queryKey: ['v0ExternalMarketFacts', queryDate, topN],
    queryFn: () =>
      getV0ExternalMarketFacts({
        queryDate,
        topN,
      }),
    enabled: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    void externalFactsQuery.refetch();
  }, []);

  const result = externalFactsQuery.data ?? null;
  const facts = result?.facts ?? [];
  const sources = result?.sources ?? [];
  const citations = result?.citations ?? [];
  const breadthFact = facts.find((fact) => fact.id === 'bigamap-market-breadth');
  const rotationFact = facts.find((fact) => fact.id === 'bigamap-board-rolling-strength');
  const industryFact = facts.find((fact) => fact.id === 'bigamap-industry-strength');
  const stockFact = facts.find((fact) => fact.id === 'bigamap-stock-strength');
  const limitFact = facts.find((fact) => fact.id === 'bigamap-limit-board-overview');

  const breadthData = asRecord(breadthFact?.data);
  const rotationData = asRecord(rotationFact?.data);
  const rotationItems = getFactDataList(rotationFact, 'top7');
  const industryGroups = getFactDataList(industryFact, 'topGroups');
  const stockItems = getFactDataList(stockFact, 'topStocks');
  const chainLeaders = getFactDataList(limitFact, 'chainLeaders');
  const sealedStrong = getFactDataList(limitFact, 'sealedStrong');

  const sourceStatusText = useMemo(() => {
    if (!sources.length) {
      return '暂无数据源状态';
    }
    const successCount = sources.filter((source) => source.status === 'success').length;
    return `${successCount}/${sources.length} 个源可用`;
  }, [sources]);

  const handleRefresh = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate.trim())) {
      message.warning('日期必须是 YYYY-MM-DD');
      return;
    }
    if (!Number.isInteger(topN) || topN <= 0 || topN > 20) {
      message.warning('TopN 需要在 1 到 20 之间');
      return;
    }

    try {
      await externalFactsQuery.refetch();
    } catch (error) {
      message.error(getApiErrorMessage(error, '外部数据源刷新失败'));
    }
  };

  const renderBoardRotation = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="板块轮动" extra={<RadarChartOutlined />}>
        {rotationFact ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{rotationFact.summary}</Typography.Paragraph>
            <Space wrap>
              <Tag color="blue">{`最新交易日 ${readString(rotationData.latestTradeDate) || '暂无'}`}</Tag>
              <Tag>{`默认观察 ${readString(asRecord(rotationData.defaultSelection).board_name) || '暂无'}`}</Tag>
            </Space>
            <List
              size="small"
              dataSource={rotationItems}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap>
                    <Tag>{readString(item.board_name ?? item.boardName ?? item.board_code ?? item.boardCode)}</Tag>
                    <Tag>{readString(item.board_code ?? item.boardCode ?? '')}</Tag>
                    <Tag color="gold">{`强度 ${readNumber(item.total_score ?? item.totalScore)}`}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无板块轮动" />
        )}
      </Card>
    </Space>
  );

  const renderStockPicker = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="选股器" extra={<LineChartOutlined />}>
        {breadthFact ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{breadthFact.summary}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>
                <div style={panelStyle}>
                  <Statistic title="总数" value={readNumber(breadthData.totalItems)} />
                  <Space wrap style={{ marginTop: 8 }}>
                    <Tag color="green">{`上涨 ${readNumber(breadthData.upItems)}`}</Tag>
                    <Tag color="red">{`下跌 ${readNumber(breadthData.downItems)}`}</Tag>
                    <Tag>{`平盘 ${readNumber(breadthData.flatItems)}`}</Tag>
                  </Space>
                  <Progress
                    percent={Math.round(readNumber(breadthData.upRatio) * 100)}
                    status={readNumber(breadthData.upItems) >= readNumber(breadthData.downItems) ? 'success' : 'exception'}
                    style={{ marginTop: 12 }}
                  />
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div style={panelStyle}>
                  <Statistic title="新鲜 / 过期" value={`${readNumber(breadthData.freshItems)} / ${readNumber(breadthData.staleItems)}`} />
                  <Space wrap style={{ marginTop: 8 }}>
                    <Tag>{`涨幅占比 ${formatPercent(readNumber(breadthData.upRatio) * 100)}`}</Tag>
                    <Tag>{`跌幅占比 ${formatPercent(readNumber(breadthData.downRatio) * 100)}`}</Tag>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                    这里把 points 视为全市场选股底座，先看广度，再看个股强度。
                  </Typography.Paragraph>
                </div>
              </Col>
            </Row>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无市场广度" />
        )}
      </Card>

      <Card title="个股强度" extra={<DatabaseOutlined />}>
        {stockFact ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{stockFact.summary}</Typography.Paragraph>
            <List
              grid={{ gutter: 12, xs: 1, md: 2 }}
              dataSource={stockItems}
              renderItem={(item) => (
                <List.Item>
                  <div style={compactPanelStyle}>
                    <Space direction="vertical" size={6}>
                      <Typography.Text strong>{readString(item.name)}</Typography.Text>
                      <Space wrap>
                        <Tag>{readString(item.code)}</Tag>
                        <Tag color={readNumber(item.changePercent) >= 0 ? 'red' : 'blue'}>{formatPercent(readNumber(item.changePercent))}</Tag>
                        {item.swLevel1Name ? <Tag>{readString(item.swLevel1Name)}</Tag> : null}
                      </Space>
                      <Typography.Text type="secondary">{`成交额 ${formatAmountYi(readNumber(item.amount))}`}</Typography.Text>
                    </Space>
                  </div>
                </List.Item>
              )}
            />
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无个股强度" />
        )}
      </Card>

      <Card title="行业强度辅助">
        {industryFact ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{industryFact.summary}</Typography.Paragraph>
            <List
              grid={{ gutter: 12, xs: 1, md: 2, xl: 4 }}
              dataSource={industryGroups}
              renderItem={(item) => (
                <List.Item>
                  <div style={compactPanelStyle}>
                    <Space direction="vertical" size={6}>
                      <Typography.Text strong>{readString(item.key)}</Typography.Text>
                      <Space wrap>
                        <Tag>{`样本 ${readNumber(item.count)}`}</Tag>
                        <Tag color="red">{`上涨 ${readNumber(item.up)}`}</Tag>
                        <Tag color="gold">{`均涨 ${formatPercent(readNumber(item.averageChange))}`}</Tag>
                      </Space>
                    </Space>
                  </div>
                </List.Item>
              )}
            />
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无行业强度" />
        )}
      </Card>
    </Space>
  );

  const renderLimitBoard = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="涨跌停板行情" extra={<FireOutlined />}>
        {limitFact ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{limitFact.summary}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col xs={24} md={8}>
                <Statistic title="涨停数" value={readNumber(asRecord(limitFact.data).limitUpCount)} />
              </Col>
              <Col xs={24} md={8}>
                <Statistic title="跌停数" value={readNumber(asRecord(limitFact.data).limitDownCount)} />
              </Col>
              <Col xs={24} md={8}>
                <Statistic title="封单强势" value={readNumber(sealedStrong.length)} />
              </Col>
            </Row>
            <List
              size="small"
              dataSource={chainLeaders}
              renderItem={(item) => (
                <List.Item>
                  <Space wrap>
                    <Tag>{readString(item.name ?? item.code)}</Tag>
                    <Tag>{`${readNumber(item.limitUpDays)} 板`}</Tag>
                    <Tag>{`封单 ${formatAmountYi(readNumber(item.sealedAmount))}`}</Tag>
                    <Tag>{`炸板 ${readNumber(item.breakBoardCount)}`}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无涨跌停板行情" />
        )}
      </Card>
    </Space>
  );

  const renderPlaceholder = (title: string) => (
    <Card title={title}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message="该子项待接入"
                  description="当前先保留入口和布局，后续把对应的数据源拆分出来后可以直接接在这个页面里。"
                />
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可视化内容" />
              </Space>
            </Card>
  );

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'board-rotation':
        return renderBoardRotation();
      case 'stock-picker':
        return renderStockPicker();
      case 'limit-board':
        return renderLimitBoard();
      case 'institution-flow':
        return renderPlaceholder('机构多空单');
      case 'ma-indicator':
        return renderPlaceholder('均线顶底指标');
      case 'dragon-review':
        return renderPlaceholder('龙虎榜复盘');
      default:
        return null;
    }
  };

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} xl={15}>
            <Space direction="vertical" size={6}>
              <Space wrap>
                <Typography.Title level={2} style={{ margin: 0 }}>
                  BIGAMAP.CN 大A地图
                </Typography.Title>
                <Tag color="processing">外部数据源</Tag>
                <Tag color="blue">{sourceStatusText}</Tag>
              </Space>
              <Typography.Text type="secondary">
                将 BigAMap 的点位、板块轮动、涨停复盘拆成单独视图，先把当前可用的数据源做成可跳转、可比对、可追踪的页面。
              </Typography.Text>
            </Space>
          </Col>
          <Col xs={24} xl={9}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={queryDate}
                  onChange={(event) => setQueryDate(event.target.value)}
                  placeholder="YYYY-MM-DD"
                />
                <InputNumber
                  value={topN}
                  onChange={(value) => setTopN(Number(value ?? 8))}
                  min={1}
                  max={20}
                  style={{ width: 120 }}
                />
              </Space.Compact>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={externalFactsQuery.isFetching}
                onClick={handleRefresh}
              >
                刷新 BigAMap
              </Button>
            </Space>
          </Col>
        </Row>

        <Space wrap style={{ marginTop: 16 }}>
          {sectionButtons.map((section) => (
            <Button
              key={section.key}
              shape="round"
              size="large"
              type={activeSection === section.key ? 'primary' : 'default'}
              onClick={() => setActiveSection(section.key)}
            >
              {section.label}
            </Button>
          ))}
        </Space>
      </div>

      {externalFactsQuery.error ? (
        <Alert type="warning" showIcon message={getApiErrorMessage(externalFactsQuery.error, '外部数据源加载失败')} />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          {externalFactsQuery.isFetching && !result ? (
            <Card>
              <Spin />
            </Card>
          ) : (
            renderActiveSection()
          )}
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="源状态" extra={<DatabaseOutlined />}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {sources.length > 0 ? (
                  sources.map((source) => (
                    <div key={source.source} style={compactPanelStyle}>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag>{sourceLabels[source.source] ?? source.source}</Tag>
                          <Tag color={sourceStatusColors[source.status] ?? 'default'}>{source.status}</Tag>
                          {source.tradeDate ? <Tag>{source.tradeDate}</Tag> : null}
                          {source.itemCount !== undefined ? <Tag>{`条目 ${source.itemCount}`}</Tag> : null}
                        </Space>
                        {source.notice ? <Typography.Text type="secondary">{source.notice}</Typography.Text> : null}
                        {source.error ? <Typography.Text type="danger">{source.error}</Typography.Text> : null}
                      </Space>
                    </div>
                  ))
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无源状态" />
                )}
              </Space>
            </Card>

            <Card title="市场广度">
              {breadthFact ? (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Typography.Paragraph style={{ marginBottom: 0 }}>{breadthFact.summary}</Typography.Paragraph>
                  <Row gutter={[12, 12]}>
                    <Col span={12}>
                      <Statistic title="总数" value={readNumber(breadthData.totalItems)} />
                    </Col>
                    <Col span={12}>
                      <Statistic title="上涨" value={readNumber(breadthData.upItems)} />
                    </Col>
                    <Col span={12}>
                      <Statistic title="下跌" value={readNumber(breadthData.downItems)} />
                    </Col>
                    <Col span={12}>
                      <Statistic title="平盘" value={readNumber(breadthData.flatItems)} />
                    </Col>
                  </Row>
                  <Progress
                    percent={Math.round(readNumber(breadthData.upRatio) * 100)}
                    status={readNumber(breadthData.upItems) >= readNumber(breadthData.downItems) ? 'success' : 'exception'}
                  />
                  <Space wrap>
                    <Tag>{`新鲜 ${readNumber(breadthData.freshItems)}`}</Tag>
                    <Tag>{`过期 ${readNumber(breadthData.staleItems)}`}</Tag>
                  </Space>
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无市场广度" />
              )}
            </Card>

            <Card title="引用概览">
              {citations.length > 0 ? (
                <List
                  size="small"
                  dataSource={citations.slice(0, 6)}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={4}>
                        <Space wrap>
                          <Tag>{item.id}</Tag>
                          <Tag>{item.source}</Tag>
                          <Tag>{item.subjectKey}</Tag>
                        </Space>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Typography.Text type="secondary">{item.excerpt}</Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无引用" />
              )}
            </Card>
          </Space>
        </Col>
      </Row>

      <Card title="事实 / 源状态 / 原始 JSON">
        <Tabs
          items={[
            {
              key: 'facts',
              label: 'Facts',
              children: <pre style={preStyle}>{JSON.stringify(result?.facts ?? [], null, 2)}</pre>,
            },
            {
              key: 'sources',
              label: 'Sources',
              children: <pre style={preStyle}>{JSON.stringify(result?.sources ?? [], null, 2)}</pre>,
            },
            {
              key: 'raw',
              label: 'Raw',
              children: <pre style={preStyle}>{JSON.stringify(result ?? {}, null, 2)}</pre>,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default V0ExternalDataPage;
