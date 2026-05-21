import React from 'react';
import { Alert, Button, Card, Collapse, Space, Tag, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { V0DailyDigestRecord } from '../types';

interface DigestCardProps {
  digests: V0DailyDigestRecord[] | undefined;
  isLoading: boolean;
  building: boolean;
  errorMessage?: string;
  onBuild: () => void;
}

const DigestCard: React.FC<DigestCardProps> = ({
  digests,
  isLoading,
  building,
  errorMessage,
  onBuild,
}) => {
  return (
    <Card
      title="V0 日报"
      loading={isLoading}
      extra={
        <Button type="primary" onClick={onBuild} loading={building}>
          生成今日日报
        </Button>
      }
    >
      {errorMessage ? <Alert type="error" showIcon message={errorMessage} style={{ marginBottom: 12 }} /> : null}
      {!digests || digests.length === 0 ? (
        <Alert type="info" showIcon message="还没有日报记录，先生成一份今日日报。" />
      ) : (
        <Collapse
          items={digests.map((digest) => ({
            key: String(digest.id),
            label: (
              <Space>
                <span>{digest.digestDate}</span>
                <Tag color={digest.status === 'success' ? 'green' : 'red'}>
                  {digest.status === 'success' ? '已生成' : '失败'}
                </Tag>
                <Typography.Text type="secondary">{`${digest.messageCount} 条消息`}</Typography.Text>
              </Space>
            ),
            children: (
              <div>
                <Typography.Paragraph type="secondary">
                  {digest.sentAt || digest.updatedAt}
                </Typography.Paragraph>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{digest.contentMarkdown}</ReactMarkdown>
              </div>
            ),
          }))}
        />
      )}
    </Card>
  );
};

export default DigestCard;
