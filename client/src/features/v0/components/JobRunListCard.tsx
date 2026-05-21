import React from 'react';
import { Alert, Card, List, Tag, Typography } from 'antd';
import type { V0JobRunRecord } from '../types';

interface JobRunListCardProps {
  runs: V0JobRunRecord[] | undefined;
  isLoading: boolean;
  errorMessage?: string;
}

const jobTypeLabelMap: Record<V0JobRunRecord['jobType'], string> = {
  poll_thread: '轮询抓取',
  build_digest: '日报生成',
};

const JobRunListCard: React.FC<JobRunListCardProps> = ({ runs, isLoading, errorMessage }) => {
  return (
    <Card title="最近执行历史" loading={isLoading}>
      {errorMessage ? <Alert type="error" showIcon message={errorMessage} style={{ marginBottom: 12 }} /> : null}
      {!runs || runs.length === 0 ? (
        <Alert type="info" showIcon message="还没有任务执行历史。" />
      ) : (
        <List
          dataSource={runs}
          renderItem={(run) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <>
                    {jobTypeLabelMap[run.jobType]}
                    <Tag
                      color={
                        run.status === 'success'
                          ? 'green'
                          : run.status === 'failed'
                            ? 'red'
                            : 'gold'
                      }
                      style={{ marginLeft: 8 }}
                    >
                      {run.status}
                    </Tag>
                    <Tag>{run.triggerSource}</Tag>
                  </>
                }
                description={
                  <>
                    <Typography.Paragraph style={{ marginBottom: 4 }}>
                      {run.summaryText || '暂无摘要'}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary">
                      {`${run.startedAt}${run.finishedAt ? ` -> ${run.finishedAt}` : ''}`}
                    </Typography.Text>
                    {run.errorMessage ? (
                      <>
                        <br />
                        <Typography.Text type="danger">{run.errorMessage}</Typography.Text>
                      </>
                    ) : null}
                  </>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
};

export default JobRunListCard;
