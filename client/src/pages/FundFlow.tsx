import React, { useState } from 'react';
import { Tabs, Table, Card, Row, Col, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api';

const { TabPane } = Tabs;

const FundFlow: React.FC = () => {
  const [activeTab, setActiveTab] = useState('concept');

  // Sector Flow Query
  const { data: sectorData, isLoading: isSectorLoading } = useQuery({
    queryKey: ['sectorFlow', activeTab],
    queryFn: async () => {
      const res = await apiClient.get('/fund/sector', {
        params: { type: activeTab },
      });
      return res.data.data;
    },
  });

  // HSGT Flow Query
  const { data: hsgtData } = useQuery({
    queryKey: ['hsgtFlow'],
    queryFn: async () => {
      const res = await apiClient.get('/fund/hsgt');
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  const columns = [
    {
      title: '排名',
      key: 'index',
      render: (_: any, __: any, index: number) => index + 1,
      width: 80,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    // The dataapi interface might not return price/change info, 
    // hide these columns if data is missing or show placeholders
    {
      title: '最新价',
      dataIndex: 'price',
      key: 'price',
      render: (text: number) => text ? text.toFixed(2) : '-',
    },
    {
      title: '涨跌幅',
      dataIndex: 'change_percent',
      key: 'change_percent',
      render: (text: number) => {
        if (!text) return '-';
        return (
            <span style={{ color: text >= 0 ? '#ff4d4f' : '#52c41a' }}>
                {text}%
            </span>
        );
      },
    },
    {
      title: '主力净流入',
      dataIndex: 'net_inflow',
      key: 'net_inflow',
      render: (text: number) => {
         const val = Number(text);
         const color = val >= 0 ? '#ff4d4f' : '#52c41a';
         // text is in Yuan
         return (
            <span style={{ color, fontWeight: 'bold' }}>
                {(val / 100000000).toFixed(2)} 亿
            </span>
         );
      },
      sorter: (a: any, b: any) => a.net_inflow - b.net_inflow,
      defaultSortOrder: 'descend' as const,
    },
  ];

  // Helper to format money (input unit: Yuan)
  const formatMoney = (val: number) => {
      if (!val) return '0.00';
      const absVal = Math.abs(val);
      if (absVal >= 100000000) {
          return (val / 100000000).toFixed(2);
      } else {
          return (val / 10000).toFixed(2);
      }
  };

  const getSuffix = (val: number) => {
      if (!val) return '';
      return Math.abs(val) >= 100000000 ? '亿' : '万';
  };

  // HSGT data is in Wan (10^4), convert to Yuan for unified formatting
  const northSh = (hsgtData?.north_sh_net || 0) * 10000;
  const northSz = (hsgtData?.north_sz_net || 0) * 10000;
  const southSh = (hsgtData?.south_sh_net || 0) * 10000;
  const southSz = (hsgtData?.south_sz_net || 0) * 10000;

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
            <Card hoverable>
                <Statistic 
                    title="沪股通净流入 (北向)" 
                    value={northSh} 
                    precision={2}
                    formatter={(val) => formatMoney(Number(val))}
                    suffix={getSuffix(northSh)}
                    valueStyle={{ color: northSh >= 0 ? '#ff4d4f' : '#52c41a' }}
                />
            </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
            <Card hoverable>
                <Statistic 
                    title="深股通净流入 (北向)" 
                    value={northSz} 
                    precision={2}
                    formatter={(val) => formatMoney(Number(val))}
                    suffix={getSuffix(northSz)}
                    valueStyle={{ color: northSz >= 0 ? '#ff4d4f' : '#52c41a' }}
                />
            </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
            <Card hoverable>
                <Statistic 
                    title="港股通(沪)净流入 (南向)" 
                    value={southSh} 
                    precision={2}
                    formatter={(val) => formatMoney(Number(val))}
                    suffix={getSuffix(southSh)}
                    valueStyle={{ color: southSh >= 0 ? '#ff4d4f' : '#52c41a' }}
                />
            </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
            <Card hoverable>
                <Statistic 
                    title="港股通(深)净流入 (南向)" 
                    value={southSz} 
                    precision={2}
                    formatter={(val) => formatMoney(Number(val))}
                    suffix={getSuffix(southSz)}
                    valueStyle={{ color: southSz >= 0 ? '#ff4d4f' : '#52c41a' }}
                />
            </Card>
        </Col>
      </Row>

      <Card title="板块资金流向排行">
        <Tabs defaultActiveKey="concept" onChange={setActiveTab}>
            <TabPane tab="概念板块" key="concept" />
            <TabPane tab="行业板块" key="industry" />
            <TabPane tab="地域板块" key="region" />
        </Tabs>
        <Table 
            columns={columns} 
            dataSource={sectorData || []} 
            rowKey="name" // f12 (code) might be missing or not unique in some aggregated data?
            loading={isSectorLoading}
            pagination={false}
        />
      </Card>
    </div>
  );
};

export default FundFlow;
