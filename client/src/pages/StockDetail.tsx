import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Spin, Row, Col, Button, Descriptions, Tabs } from 'antd';
import { ArrowLeftOutlined, FallOutlined, RiseOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { getKlineData, getStockInfo, getTimelineData } from '../api';

const StockDetail: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [chartType, setChartType] = useState('day'); 
  
  // Fetch stock detailed info (Fundamental + Quote)
  const { data: stockInfo, isLoading: isInfoLoading } = useQuery({
    queryKey: ['stockInfo', code],
    queryFn: async () => {
      if (!code) return null;
      return await getStockInfo(code);
    },
    refetchInterval: 3000,
  });

  // Fetch Kline/Timeline data
  const { data: chartData, isLoading: isChartLoading } = useQuery({
    queryKey: ['chartData', code, chartType],
    queryFn: async () => {
      if (!code) return [];
      if (chartType === 'timeline') {
          return await getTimelineData(code);
      }
      return await getKlineData(code, chartType);
    },
    refetchInterval: chartType === 'timeline' ? 60000 : false,
  });

  const getOption = () => {
    if (!chartData || chartData.length === 0) return {};

    const dates = chartData.map((item: any) => item.time);
    
    if (chartType === 'timeline') {
        const prices = chartData.map((item: any) => item.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const padding = (maxPrice - minPrice) * 0.1;

        return {
            tooltip: { trigger: 'axis' },
            grid: { left: '5%', right: '5%', bottom: '10%', top: '10%' },
            xAxis: { 
                type: 'category', 
                data: dates,
                boundaryGap: false,
                axisLabel: { interval: 29 }
            },
            yAxis: { 
                type: 'value', 
                scale: true,
                min: (minPrice - padding).toFixed(2),
                max: (maxPrice + padding).toFixed(2),
                splitLine: { show: true, lineStyle: { type: 'dashed' } }
            },
            series: [{
                name: '价格',
                type: 'line',
                data: prices,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: '#1890ff' },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(24,144,255,0.2)' }, 
                            { offset: 1, color: 'rgba(24,144,255,0.05)' }
                        ]
                    }
                }
            }]
        };
    } else {
        const data = chartData.map((item: any) => [
            item.open, 
            item.close, 
            item.low, 
            item.high, 
            item.volume
        ]);

        return {
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' }
          },
          grid: { left: '5%', right: '5%', bottom: '10%', top: '10%' },
          xAxis: {
            type: 'category',
            data: dates,
            scale: true,
            boundaryGap: false,
            axisLine: { onZero: false },
            splitLine: { show: false },
            min: 'dataMin',
            max: 'dataMax'
          },
          yAxis: { scale: true, splitArea: { show: false } },
          dataZoom: [{ type: 'inside', start: 50, end: 100 }],
          series: [
            {
              name: 'K线',
              type: 'candlestick',
              data: data,
              barWidth: '60%', 
              barMaxWidth: 20,
              itemStyle: {
                color: '#ec0000',
                color0: '#00da3c',
                borderColor: '#ec0000',
                borderColor0: '#00da3c'
              }
            }
          ]
        };
    }
  };

  if (!code) return <div>Invalid Code</div>;

  const isUp = (stockInfo?.change_percent || 0) >= 0;
  const color = isUp ? '#ff4d4f' : '#52c41a';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header Section */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} type="text" style={{ marginRight: 16 }} />
                <div>
                    <span style={{ fontSize: 24, fontWeight: 'bold', marginRight: 8 }}>{stockInfo?.name || code}</span>
                    <span style={{ color: '#999' }}>{stockInfo?.code}</span>
                </div>
            </div>
            {stockInfo && (
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 32, fontWeight: 'bold', color, marginRight: 16 }}>
                        {stockInfo.price.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 16, color, marginRight: 16 }}>
                        {isUp ? <RiseOutlined /> : <FallOutlined />} {stockInfo.change_percent}%
                    </span>
                    <span style={{ fontSize: 16, color }}>
                         {(stockInfo.price - stockInfo.yestclose).toFixed(2)}
                    </span>
                </div>
            )}
        </div>

        {/* Main Content: Left Chart + Right Stats */}
        <Row gutter={16} style={{ flex: 1 }}>
            {/* Left Column: Charts */}
            <Col span={17}>
                <Card 
                    bodyStyle={{ padding: '0 24px 24px 24px' }}
                    style={{ height: '100%' }}
                >
                    <Tabs 
                        activeKey={chartType} 
                        onChange={setChartType} 
                        tabBarStyle={{ marginBottom: 16 }}
                        items={[
                            { label: '分时', key: 'timeline' },
                            { label: '日线', key: 'day' },
                            { label: '周线', key: 'week' },
                            { label: '月线', key: 'month' },
                            { label: '5分钟', key: '5' },
                            { label: '15分钟', key: '15' },
                            { label: '30分钟', key: '30' },
                            { label: '60分钟', key: '60' },
                        ]}
                    />
                    
                    {isChartLoading ? (
                        <div style={{ height: 500, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <Spin size="large" />
                        </div>
                    ) : (
                        <ReactECharts 
                            option={getOption()} 
                            style={{ height: 500 }} 
                            notMerge={true} 
                            lazyUpdate={true}
                        />
                    )}
                </Card>
            </Col>

            {/* Right Column: Statistics */}
            <Col span={7}>
                {/* 1. Quote Stats */}
                <Card title="基础行情" size="small" style={{ marginBottom: 16 }}>
                    {isInfoLoading ? <Spin /> : (
                        <Descriptions column={2} size="small">
                            <Descriptions.Item label="今开"><span style={{ color: stockInfo?.open! > stockInfo?.yestclose! ? '#ff4d4f' : '#52c41a' }}>{stockInfo?.open}</span></Descriptions.Item>
                            <Descriptions.Item label="昨收">{stockInfo?.yestclose}</Descriptions.Item>
                            <Descriptions.Item label="最高"><span style={{ color: '#ff4d4f' }}>{stockInfo?.high}</span></Descriptions.Item>
                            <Descriptions.Item label="最低"><span style={{ color: '#52c41a' }}>{stockInfo?.low}</span></Descriptions.Item>
                            <Descriptions.Item label="成交量">{(stockInfo?.volume! / 10000).toFixed(0)}万手</Descriptions.Item>
                            <Descriptions.Item label="成交额">{(stockInfo?.amount! / 10000).toFixed(2)}亿</Descriptions.Item>
                            <Descriptions.Item label="振幅">{stockInfo?.amplitude}%</Descriptions.Item>
                            <Descriptions.Item label="换手">{stockInfo?.turnover_rate}%</Descriptions.Item>
                        </Descriptions>
                    )}
                </Card>

                {/* 2. Fundamental Stats */}
                <Card title="基本面指标" size="small">
                    {isInfoLoading ? <Spin /> : (
                        <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="市盈率 (TTM)">
                                <strong>{stockInfo?.pe_ttm}</strong>
                            </Descriptions.Item>
                            <Descriptions.Item label="市净率 (PB)">
                                <strong>{stockInfo?.pb}</strong>
                            </Descriptions.Item>
                            <Descriptions.Item label="总市值">
                                {stockInfo?.market_cap} 亿
                            </Descriptions.Item>
                            <Descriptions.Item label="流通市值">
                                {stockInfo?.float_market_cap} 亿
                            </Descriptions.Item>
                        </Descriptions>
                    )}
                </Card>
            </Col>
        </Row>
    </div>
  );
};

export default StockDetail;
