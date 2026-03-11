import React, { useState } from 'react';
import { Table, Tag, Button, Space, message, Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useStockStore } from '../store';
import { apiClient, searchStock } from '../api';

const StockDashboard: React.FC = () => {
  const { selectedCodes, addCode, removeCode } = useStockStore();
  const [searchOptions, setSearchOptions] = useState<any[]>([]);
  const [fetching, setFetching] = useState(false);
  const navigate = useNavigate();

  const { data: stockData, isLoading } = useQuery({
    queryKey: ['stockData', selectedCodes],
    queryFn: async () => {
      if (selectedCodes.length === 0) return [];
      const res = await apiClient.get('/stock', {
        params: { codes: selectedCodes.join(',') },
      });
      return res.data.data;
    },
    refetchInterval: 3000,
    enabled: selectedCodes.length > 0,
  });

  const handleSearch = async (value: string) => {
    if (!value) {
        setSearchOptions([]);
        return;
    }
    setFetching(true);
    try {
        const data = await searchStock(value);
        const options = data.map((item: any) => ({
            label: `${item.code} - ${item.name}`,
            value: item.code,
            key: item.code
        }));
        setSearchOptions(options);
    } finally {
        setFetching(false);
    }
  };

  const handleSelect = (value: string) => {
    if (selectedCodes.includes(value)) {
      message.warning('该股票已存在');
      return;
    }
    addCode(value);
    setSearchOptions([]);
    message.success('添加成功');
  };

  const columns = [
    {
      title: '代码',
      dataIndex: 'code',
      key: 'code',
      render: (text: string) => <a onClick={() => navigate(`/stock/${text}`)}>{text}</a>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: any) => (
          <a onClick={() => navigate(`/stock/${record.code}`)}>{text}</a>
      ),
    },
    {
      title: '最新价',
      dataIndex: 'price',
      key: 'price',
      render: (text: string, record: any) => {
        const color = Number(record.percent) >= 0 ? '#ff4d4f' : '#52c41a';
        return <span style={{ color, fontWeight: 'bold' }}>{Number(text).toFixed(2)}</span>;
      },
    },
    {
      title: '涨跌幅',
      dataIndex: 'percent',
      key: 'percent',
      render: (text: string) => {
        const val = Number(text);
        const color = val >= 0 ? 'red' : 'green';
        return <Tag color={color}>{val > 0 ? '+' : ''}{val}%</Tag>;
      },
    },
    {
      title: '涨跌额',
      dataIndex: 'updown',
      key: 'updown',
      render: (text: string) => {
        const val = Number(text);
        const color = val >= 0 ? '#ff4d4f' : '#52c41a';
        return <span style={{ color }}>{val > 0 ? '+' : ''}{val}</span>;
      },
    },
    {
        title: '今开',
        dataIndex: 'open',
        key: 'open',
    },
    {
        title: '昨收',
        dataIndex: 'yestclose',
        key: 'yestclose',
    },
    {
        title: '成交量(手)',
        dataIndex: 'volume',
        key: 'volume',
        render: (text: string) => (Number(text) / 100).toFixed(0),
    },
    {
        title: '成交额(万)',
        dataIndex: 'amount',
        key: 'amount',
        render: (text: string) => (Number(text) / 10000).toFixed(2),
    },
    {
      title: '更新时间',
      dataIndex: 'time',
      key: 'time',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="middle">
          <Button type="link" danger onClick={() => removeCode(record.code)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>自选股行情</h2>
        <Select
          showSearch
          placeholder="输入代码/名称/拼音搜索 (如 600519/茅台/gzmt)"
          defaultActiveFirstOption={false}
          filterOption={false}
          onSearch={handleSearch}
          onSelect={handleSelect}
          notFoundContent={fetching ? <Spin size="small" /> : null}
          options={searchOptions}
          style={{ width: 300 }}
          size="large"
          allowClear
        />
      </div>
      <Table 
        columns={columns} 
        dataSource={stockData || []} 
        rowKey="id" 
        loading={isLoading && !stockData}
        pagination={false}
      />
    </div>
  );
};

export default StockDashboard;
