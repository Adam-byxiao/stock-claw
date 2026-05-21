import React from 'react';
import { Alert, Empty, Spin } from 'antd';
import MessageCard from './MessageCard';
import type { V0StoredForumMessage } from '../types';

interface MessageFeedProps {
  messages: V0StoredForumMessage[] | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onViewDetail?: (messageId: number) => void;
}

const MessageFeed: React.FC<MessageFeedProps> = ({
  messages,
  isLoading,
  errorMessage,
  onViewDetail,
}) => {
  if (isLoading) {
    return <Spin />;
  }

  if (errorMessage) {
    return <Alert type="error" showIcon message={errorMessage} />;
  }

  if (!messages || messages.length === 0) {
    return <Empty description="还没有抓取到消息" />;
  }

  return (
    <div>
      {messages.map((message) => (
        <MessageCard key={message.id} message={message} onViewDetail={onViewDetail} />
      ))}
    </div>
  );
};

export default MessageFeed;
