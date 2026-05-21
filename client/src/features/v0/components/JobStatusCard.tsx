import React from 'react';
import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Space, Tag } from 'antd';
import type { V0JobStatus, V0PollResult } from '../types';

interface JobStatusCardProps {
  pollResult: V0PollResult | null;
  jobStatus?: V0JobStatus;
  schedulerToggling?: boolean;
  onStartScheduler?: () => void;
  onStopScheduler?: () => void;
}

const JobStatusCard: React.FC<JobStatusCardProps> = ({
  pollResult,
  jobStatus,
  schedulerToggling = false,
  onStartScheduler,
  onStopScheduler,
}) => {
  const schedulerControls = jobStatus ? (
    <Space size={8}>
      <Button
        size="small"
        icon={<PlayCircleOutlined />}
        loading={schedulerToggling && !jobStatus.schedulerRunning}
        disabled={schedulerToggling || jobStatus.schedulerRunning || !onStartScheduler}
        onClick={onStartScheduler}
      >
        启动调度
      </Button>
      <Button
        size="small"
        icon={<PauseCircleOutlined />}
        loading={schedulerToggling && jobStatus.schedulerRunning}
        disabled={schedulerToggling || !jobStatus.schedulerEnabled || !onStopScheduler}
        onClick={onStopScheduler}
      >
        停止
      </Button>
    </Space>
  ) : null;

  return (
    <Card title="最近一次抓取结果" extra={schedulerControls}>
      {pollResult ? (
        <>
          <Descriptions column={1} size="small" style={{ marginBottom: jobStatus ? 16 : 0 }}>
            <Descriptions.Item label="抓取时间">{pollResult.fetchedAt}</Descriptions.Item>
            <Descriptions.Item label="帖子">{pollResult.threadTitle || pollResult.threadUrl}</Descriptions.Item>
            <Descriptions.Item label="总解析消息数">{pollResult.totalMessages}</Descriptions.Item>
            <Descriptions.Item label="命中作者数">{pollResult.matchedAuthorCount}</Descriptions.Item>
            <Descriptions.Item label="新增消息">
              <Tag color="green">{pollResult.newMessageCount}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="重复消息">
              <Tag color="default">{pollResult.duplicateMessageCount}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="推送成功">
              <Tag color="blue">{pollResult.pushedMessageCount}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="推送失败">
              <Tag color={pollResult.pushFailureCount > 0 ? 'red' : 'default'}>
                {pollResult.pushFailureCount}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          {jobStatus ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="累计消息">{jobStatus.totalStoredMessages}</Descriptions.Item>
              <Descriptions.Item label="未读消息">
                <Tag color={jobStatus.unreadMessageCount > 0 ? 'green' : 'default'}>
                  {jobStatus.unreadMessageCount}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="待处理洞察">
                <Tag color={jobStatus.pendingInsightCount > 0 ? 'gold' : 'default'}>
                  {jobStatus.pendingInsightCount}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="失败洞察">
                <Tag color={jobStatus.failedInsightCount > 0 ? 'red' : 'default'}>
                  {jobStatus.failedInsightCount}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="最近消息时间">
                {jobStatus.lastMessageAt || '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="最近推送">
                {jobStatus.lastNotificationAt
                  ? `${jobStatus.lastNotificationStatus} @ ${jobStatus.lastNotificationAt}`
                  : '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="推送渠道">{jobStatus.pushChannel}</Descriptions.Item>
              <Descriptions.Item label="最近日报">
                {jobStatus.lastDigestDate
                  ? `${jobStatus.lastDigestDate} @ ${jobStatus.lastDigestAt ?? '未知时间'}`
                  : '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="调度器">
                <Tag color={jobStatus.schedulerRunning ? 'green' : jobStatus.schedulerEnabled ? 'gold' : 'default'}>
                  {jobStatus.schedulerRunning
                    ? '运行中'
                    : jobStatus.schedulerEnabled
                      ? '已启用未运行'
                      : '未启用'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="轮询任务">
                {jobStatus.pollJobActive ? jobStatus.nextPollAt || '已启用' : '未启用'}
              </Descriptions.Item>
              <Descriptions.Item label="最近轮询执行">
                {jobStatus.lastPollRun
                  ? `${jobStatus.lastPollRun.status} @ ${jobStatus.lastPollRun.finishedAt || jobStatus.lastPollRun.startedAt}`
                  : '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="日报任务">
                {jobStatus.digestJobActive ? jobStatus.nextDigestAt || '已启用' : '未启用'}
              </Descriptions.Item>
              <Descriptions.Item label="最近日报执行">
                {jobStatus.lastDigestRun
                  ? `${jobStatus.lastDigestRun.status} @ ${jobStatus.lastDigestRun.finishedAt || jobStatus.lastDigestRun.startedAt}`
                  : '暂无'}
              </Descriptions.Item>
              {jobStatus.lastSchedulerError ? (
                <Descriptions.Item label="调度错误">{jobStatus.lastSchedulerError}</Descriptions.Item>
              ) : null}
            </Descriptions>
          ) : null}
        </>
      ) : jobStatus ? (
        <Descriptions column={1} size="small">
          <Descriptions.Item label="监听状态">
            <Tag color={jobStatus.enabled ? 'green' : 'default'}>
              {jobStatus.enabled ? '已启用' : '已关闭'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="推送状态">
            <Tag color={jobStatus.pushEnabled ? 'blue' : 'default'}>
              {jobStatus.pushEnabled ? '已启用' : '已关闭'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="推送渠道">{jobStatus.pushChannel}</Descriptions.Item>
          <Descriptions.Item label="轮询间隔">{jobStatus.pollIntervalSeconds} 秒</Descriptions.Item>
          <Descriptions.Item label="日报 Cron">{jobStatus.digestCron}</Descriptions.Item>
          <Descriptions.Item label="累计消息">{jobStatus.totalStoredMessages}</Descriptions.Item>
          <Descriptions.Item label="调度器">
            <Tag color={jobStatus.schedulerRunning ? 'green' : jobStatus.schedulerEnabled ? 'gold' : 'default'}>
              {jobStatus.schedulerRunning
                ? '运行中'
                : jobStatus.schedulerEnabled
                  ? '已启用未运行'
                  : '未启用'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="轮询任务">
            {jobStatus.pollJobActive ? jobStatus.nextPollAt || '已启用' : '未启用'}
          </Descriptions.Item>
          <Descriptions.Item label="日报任务">
            {jobStatus.digestJobActive ? jobStatus.nextDigestAt || '已启用' : '未启用'}
          </Descriptions.Item>
          <Descriptions.Item label="最近轮询执行">
            {jobStatus.lastPollRun
              ? `${jobStatus.lastPollRun.status} @ ${jobStatus.lastPollRun.finishedAt || jobStatus.lastPollRun.startedAt}`
              : '暂无'}
          </Descriptions.Item>
          <Descriptions.Item label="最近日报执行">
            {jobStatus.lastDigestRun
              ? `${jobStatus.lastDigestRun.status} @ ${jobStatus.lastDigestRun.finishedAt || jobStatus.lastDigestRun.startedAt}`
              : '暂无'}
          </Descriptions.Item>
          <Descriptions.Item label="最近消息时间">
            {jobStatus.lastMessageAt || '暂无'}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Alert type="info" showIcon message="还没有抓取记录，先保存配置并手动抓取一次。" />
      )}
    </Card>
  );
};

export default JobStatusCard;
