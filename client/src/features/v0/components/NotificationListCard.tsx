import React from 'react';
import { Alert, Card, List, Tag, Typography } from 'antd';
import type { V0NotificationRecord } from '../types';

interface NotificationListCardProps {
  notifications: V0NotificationRecord[] | undefined;
  isLoading: boolean;
  errorMessage?: string;
}

const NotificationListCard: React.FC<NotificationListCardProps> = ({
  notifications,
  isLoading,
  errorMessage,
}) => {
  return (
    <Card title="最近推送记录" loading={isLoading}>
      {errorMessage ? <Alert type="error" showIcon message={errorMessage} style={{ marginBottom: 12 }} /> : null}
      {!notifications || notifications.length === 0 ? (
        <Alert type="info" showIcon message="还没有推送记录，先抓取一条新消息试试。" />
      ) : (
        <List
          dataSource={notifications}
          renderItem={(notification) => {
            let payload: {
              authorName?: string;
              rawContent?: string;
            } = {};

            try {
              payload = JSON.parse(notification.payloadJson) as {
                authorName?: string;
                rawContent?: string;
              };
            } catch (error) {
              console.error(error);
            }

            return (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Typography.Text>
                      {payload.authorName || `消息 #${notification.messageId}`}
                      <Tag
                        color={notification.status === 'success' ? 'green' : 'red'}
                        style={{ marginLeft: 8 }}
                      >
                        {notification.status === 'success' ? '已推送' : '推送失败'}
                      </Tag>
                    </Typography.Text>
                  }
                  description={
                    <>
                      <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>
                        {payload.rawContent || '无推送内容'}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary">
                        {notification.sentAt || notification.createdAt}
                      </Typography.Text>
                      {notification.errorMessage ? (
                        <>
                          <br />
                          <Typography.Text type="danger">{notification.errorMessage}</Typography.Text>
                        </>
                      ) : null}
                    </>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};

export default NotificationListCard;
