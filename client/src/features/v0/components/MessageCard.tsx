import React from 'react';
import { Button, Card, Divider, Space, Tag, Typography } from 'antd';
import type { V0StoredForumMessage } from '../types';

interface MessageCardProps {
  message: V0StoredForumMessage;
  onViewDetail?: (messageId: number) => void;
}

const MessageCard: React.FC<MessageCardProps> = ({ message, onViewDetail }) => {
  const insightTagColor =
    message.insightStatus === 'success'
      ? 'green'
      : message.insightStatus === 'failed'
        ? 'red'
        : 'gold';

  const insightTagText =
    message.insightStatus === 'success'
      ? '洞察完成'
      : message.insightStatus === 'failed'
        ? '洞察失败'
        : '洞察待处理';

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag color="blue">{message.authorName}</Tag>
        <Tag>{`#${message.floorId}`}</Tag>
        <Tag color={message.isNew ? 'green' : 'default'}>{message.isNew ? '新消息' : '已入库'}</Tag>
        <Tag color={insightTagColor}>{insightTagText}</Tag>
        <Typography.Text type="secondary">{message.postedAt || message.createdAt}</Typography.Text>
        {onViewDetail ? (
          <Button size="small" type="link" onClick={() => onViewDetail(message.id)}>
            查看详情
          </Button>
        ) : null}
      </Space>
      <Typography.Paragraph style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
        {message.rawContent}
      </Typography.Paragraph>
      {message.insightStatus === 'failed' && message.insightError ? (
        <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
          {`洞察错误: ${message.insightError}`}
        </Typography.Paragraph>
      ) : null}
      {message.mentions.length > 0 ? (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            {message.mentions.map((mention) => (
              <Tag key={`${mention.entityType}-${mention.normalizedCode ?? mention.entityName}`} color="purple">
                {`${mention.entityType}: ${mention.entityName}`}
              </Tag>
            ))}
          </Space>
          <Divider style={{ margin: '8px 0' }} />
        </>
      ) : null}
      {message.marketStates.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          {message.marketStates.map((state) => (
            <div key={`${state.subjectType}-${state.subjectKey}`} style={{ marginBottom: 8 }}>
              <Typography.Text strong>{state.summaryText}</Typography.Text>
              <br />
              <Typography.Text type="secondary">{state.adviceText}</Typography.Text>
            </div>
          ))}
        </div>
      ) : null}
      <Typography.Text type="secondary">{message.sourceUrl}</Typography.Text>
    </Card>
  );
};

export default MessageCard;
