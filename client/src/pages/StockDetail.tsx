import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Radio, Spin, Statistic, Row, Col, Button, Descriptions } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { getKlineData, getStockData, getTimelineData } from '../api';

const StockDetail: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [chartType, setChartType] = useState('day'); // 'timeline' or 'day', 'week', etc.
  
  // Fetch real-time info
  const { data: stockInfo, isLoading: isInfoLoading } = useQuery({
    queryKey: ['stockDetail', code],
    queryFn: async () => {
      if (!code) return null;
      const res = await getStockData([code]);
      return res[0];
    },
    refetchInterval: 3000,
  });

  // Fetch Kline data
  const { data: klineData, isLoading: isKlineLoading } = useQuery({
    queryKey: ['klineData', code, chartType],
    queryFn: async () => {
      if (!code) return [];
      if (chartType === 'timeline') {
          return await getTimelineData(code);
      }
      return await getKlineData(code, chartType);
    },
    refetchInterval: chartType === 'timeline' ? 60000 : false, // Refresh timeline every minute
  });

  const getOption = () => {
    if (!klineData || klineData.length === 0) return {};

    const dates = klineData.map((item: any) => item.time);
    
    if (chartType === 'timeline') {
        // Timeline Chart (Line)
        const prices = klineData.map((item: any) => item.price);
        // Calculate min/max for better y-axis scaling
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const padding = (maxPrice - minPrice) * 0.1;

        return {
            title: { text: `${stockInfo?.name || code} 分时图`, left: 0 },
            tooltip: { trigger: 'axis' },
            grid: { left: '5%', right: '5%', bottom: '10%' },
            xAxis: { 
                type: 'category', 
                data: dates,
                boundaryGap: false,
                axisLabel: { interval: 29 } // Show label every 30 mins roughly (240 points total)
            },
            yAxis: { 
                type: 'value', 
                scale: true,
                min: (minPrice - padding).toFixed(2),
                max: (maxPrice + padding).toFixed(2)
            },
            series: [{
                name: '价格',
                type: 'line',
                data: prices,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 2, color: '#1890ff' },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(24,144,255,0.3)' }, 
                            { offset: 1, color: 'rgba(24,144,255,0.1)' }
                        ]
                    }
                }
            }]
        };
    } else {
        // Kline Chart (Candlestick)
        const data = klineData.map((item: any) => [
            item.open, 
            item.close, 
            item.low, 
            item.high, 
            item.volume
        ]);

        return {
          title: {
              text: `${stockInfo?.name || code} K线图`,
              left: 0
          },
          tooltip: {
            trigger: 'axis',
            axisPointer: {
              type: 'cross'
            }
          },
          grid: {
            left: '10%',
            right: '10%',
            bottom: '15%'
          },
          xAxis: {
            type: 'category',
            data: dates,
            scale: true,
            boundaryGap: false,
            axisLine: { onZero: false },
            splitLine: { show: false },
            splitNumber: 20,
            min: 'dataMin',
            max: 'dataMax'
          },
          yAxis: {
            scale: true,
            splitArea: {
              show: true
            }
          },
          dataZoom: [
            {
              type: 'inside',
              start: 50,
              end: 100
            },
            {
              show: true,
              type: 'slider',
              top: '90%',
              start: 50,
              end: 100
            }
          ],
          series: [
            {
              name: '日K',
              type: 'candlestick',
              data: data,
              // Adjust bar width here
              barWidth: '60%', 
              barMaxWidth: 20,
              itemStyle: {
                color: '#ec0000',
                color0: '#00da3c',
                borderColor: '#8A0000',
                borderColor0: '#008F28'
              }
            }
          ]
        };
    }
  };

  if (!code) return <div>Invalid Code</div>;

  return (
    <div>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>
        
        {isInfoLoading && !stockInfo ? <Spin /> : (
            <Card style={{ marginBottom: 16 }}>
                <Row gutter={24}>
                    <Col span={6}>
                        <Statistic 
                            title="最新价" 
                            value={stockInfo?.price} 
                            precision={2}
                            valueStyle={{ color: Number(stockInfo?.percent) >= 0 ? '#ff4d4f' : '#52c41a' }}
                        />
                    </Col>
                    <Col span={6}>
                        <Statistic 
                            title="涨跌幅" 
                            value={stockInfo?.percent} 
                            precision={2}
                            suffix="%"
                            valueStyle={{ color: Number(stockInfo?.percent) >= 0 ? '#ff4d4f' : '#52c41a' }}
                        />
                    </Col>
                    <Col span={12}>
                        <Descriptions size="small" column={4}>
                            <Descriptions.Item label="最高">{stockInfo?.high}</Descriptions.Item>
                            <Descriptions.Item label="最低">{stockInfo?.low}</Descriptions.Item>
                            <Descriptions.Item label="今开">{stockInfo?.open}</Descriptions.Item>
                            <Descriptions.Item label="昨收">{stockInfo?.yestclose}</Descriptions.Item>
                            <Descriptions.Item label="成交量">{(Number(stockInfo?.volume)/100).toFixed(0)}手</Descriptions.Item>
                            <Descriptions.Item label="成交额">{(Number(stockInfo?.amount)/10000).toFixed(2)}万</Descriptions.Item>
                        </Descriptions>
                    </Col>
                </Row>
            </Card>
        )}

        <Card>
            <div style={{ marginBottom: 16, textAlign: 'right' }}>
                <Radio.Group value={chartType} onChange={(e) => setChartType(e.target.value)} buttonStyle="solid">
                    <Radio.Button value="timeline">分时</Radio.Button>
                    <Radio.Button value="day">日线</Radio.Button>
                    <Radio.Button value="week">周线</Radio.Button>
                    <Radio.Button value="month">月线</Radio.Button>
                    <Radio.Button value="5">5分钟</Radio.Button>
                    <Radio.Button value="15">15分钟</Radio.Button>
                    <Radio.Button value="30">30分钟</Radio.Button>
                    <Radio.Button value="60">60分钟</Radio.Button>
                </Radio.Group>
            </div>
            
            {isKlineLoading ? (
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
    </div>
  );
};

export default StockDetail;
