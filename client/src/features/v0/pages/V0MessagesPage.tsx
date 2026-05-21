import React, { useState } from 'react';
import { Card, Drawer, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../../api';
import MessageFeed from '../components/MessageFeed';
import { getV0MessageDetail, getV0Messages } from '../api';

const V0MessagesPage: React.FC = () => {
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const {
    data: messages,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['v0Messages'],
    queryFn: () => getV0Messages(200),
    refetchInterval: 5000,
  });

  const {
    data: selectedMessage,
    isLoading: isDetailLoading,
    error: detailError,
  } = useQuery({
    queryKey: ['v0MessageDetail', selectedMessageId],
    queryFn: () => getV0MessageDetail(selectedMessageId as number),
    enabled: selectedMessageId !== null,
  });

  return (
    <>
      <Card
        title="V0 消息流"
        extra={<Typography.Text type="secondary">每 5 秒自动刷新</Typography.Text>}
      >
        <MessageFeed
          messages={messages}
          isLoading={isLoading}
          errorMessage={error ? getApiErrorMessage(error, '获取消息流失败') : undefined}
          onViewDetail={(messageId) => setSelectedMessageId(messageId)}
        />
      </Card>
      <Drawer
        title={selectedMessage ? `${selectedMessage.authorName} · #${selectedMessage.floorId}` : '消息详情'}
        open={selectedMessageId !== null}
        onClose={() => setSelectedMessageId(null)}
        width={560}
      >
        <MessageFeed
          messages={selectedMessage ? [selectedMessage] : []}
          isLoading={isDetailLoading}
          errorMessage={detailError ? getApiErrorMessage(detailError, '获取消息详情失败') : undefined}
        />
      </Drawer>
    </>
  );
};

export default V0MessagesPage;
