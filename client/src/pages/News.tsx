import React, { useState } from 'react';
import { List, Card, Tag, Button, Spin, Empty, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api';
import dayjs from 'dayjs';

const { Paragraph } = Typography;

const NewsFeed: React.FC = () => {
  const [limit, setLimit] = useState(20);

  const { data: newsData, isLoading, isFetching } = useQuery({
    queryKey: ['newsData', limit],
    queryFn: async () => {
      const res = await apiClient.get('/news', {
        params: { limit },
      });
      return res.data.data;
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const loadMore = () => {
    setLimit((prev) => prev + 20);
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2>市场快讯 (选股宝)</h2>
      </div>
      
      {isLoading && !newsData ? (
        <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="large" />
        </div>
      ) : newsData && newsData.length > 0 ? (
          <List
            grid={{
              gutter: 16,
              xs: 1,
              sm: 1,
              md: 2,
              lg: 3,
              xl: 4,
              xxl: 4,
            }}
            dataSource={newsData}
            renderItem={(item: any) => (
              <List.Item>
                <Card 
                    title={dayjs(item.created_at * 1000).format('HH:mm')} 
                    size="small"
                    hoverable
                    style={{ height: '100%' }}
                >
                    <div style={{ fontWeight: 'bold', marginBottom: 8, minHeight: 44 }}>
                        <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>
                            {item.title}
                        </Paragraph>
                    </div>
                    <div style={{ color: '#666', marginBottom: 8, fontSize: 12 }}>
                        <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>
                            {item.summary}
                        </Paragraph>
                    </div>
                    {item.stock_list && item.stock_list.length > 0 && (
                        <div style={{ marginTop: 'auto' }}>
                            {item.stock_list.map((stock: string) => (
                                <Tag color="blue" key={stock} style={{ marginBottom: 4 }}>{stock}</Tag>
                            ))}
                        </div>
                    )}
                </Card>
              </List.Item>
            )}
          />
      ) : (
          <Empty description="暂无快讯" />
      )}
      
      <div style={{ textAlign: 'center', marginTop: 20, marginBottom: 40 }}>
        <Button onClick={loadMore} loading={isFetching}>加载更多</Button>
      </div>
    </div>
  );
};

export default NewsFeed;
