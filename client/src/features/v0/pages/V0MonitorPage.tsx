import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Col, message, Row } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../../api';
import DigestCard from '../components/DigestCard';
import JobRunListCard from '../components/JobRunListCard';
import ThreadConfigCard from '../components/ThreadConfigCard';
import JobStatusCard from '../components/JobStatusCard';
import NotificationListCard from '../components/NotificationListCard';
import {
  buildV0Digest,
  getV0Config,
  getV0Digests,
  getV0JobStatus,
  getV0JobRuns,
  getV0Notifications,
  pollV0Thread,
  saveV0Config,
  startV0Scheduler,
  stopV0Scheduler,
} from '../api';
import type { V0Config, V0PollResult } from '../types';

const normalizeAuthorsText = (authorsText: string): string[] => {
  return Array.from(
    new Set(
      authorsText
        .split(/[\n,]/)
        .map((author) => author.trim())
        .filter((author) => author.length > 0)
    )
  );
};

const buildComparableConfig = (config: V0Config, authorsText: string): V0Config => {
  return {
    ...config,
    threadUrl: config.threadUrl.trim(),
    threadTitle: config.threadTitle.trim(),
    ngaCookie: config.ngaCookie.trim(),
    pushWebhookUrl: config.pushWebhookUrl.trim(),
    pushSecret: config.pushSecret.trim(),
    digestCron: config.digestCron.trim(),
    authors: normalizeAuthorsText(authorsText),
  };
};

const areConfigsEqual = (left: V0Config, right: V0Config): boolean => {
  return JSON.stringify(left) === JSON.stringify(right);
};

const V0MonitorPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [buildingDigest, setBuildingDigest] = useState(false);
  const [schedulerToggling, setSchedulerToggling] = useState(false);
  const [lastPollResult, setLastPollResult] = useState<V0PollResult | null>(null);
  const [draftConfig, setDraftConfig] = useState<V0Config>({
    threadUrl: '',
    threadTitle: '',
    ngaCookie: '',
    pollIntervalSeconds: 60,
    enabled: true,
    pushEnabled: true,
    pushChannel: 'console',
    pushWebhookUrl: '',
    pushSecret: '',
    digestEnabled: false,
    digestCron: '0 18 * * *',
    authors: [],
  });
  const [authorsText, setAuthorsText] = useState('');

  const {
    data: config,
    isLoading: isConfigLoading,
    error: configError,
  } = useQuery({
    queryKey: ['v0Config'],
    queryFn: getV0Config,
  });

  const {
    data: notifications,
    isLoading: isNotificationsLoading,
    error: notificationsError,
  } = useQuery({
    queryKey: ['v0Notifications'],
    queryFn: getV0Notifications,
    refetchInterval: 5000,
  });

  const {
    data: jobStatus,
    error: jobStatusError,
  } = useQuery({
    queryKey: ['v0JobStatus'],
    queryFn: getV0JobStatus,
    refetchInterval: 5000,
  });

  const {
    data: jobRuns,
    isLoading: isJobRunsLoading,
    error: jobRunsError,
  } = useQuery({
    queryKey: ['v0JobRuns'],
    queryFn: getV0JobRuns,
    refetchInterval: 5000,
  });

  const {
    data: digests,
    isLoading: isDigestsLoading,
    error: digestsError,
  } = useQuery({
    queryKey: ['v0Digests'],
    queryFn: getV0Digests,
  });

  useEffect(() => {
    if (config) {
      setDraftConfig(config);
      setAuthorsText(config.authors.join('\n'));
    }
  }, [config]);

  const canPoll = useMemo(() => draftConfig.threadUrl.trim().length > 0, [draftConfig.threadUrl]);
  const isConfigReady = !isConfigLoading;
  const isPollDisabled = isConfigLoading || !draftConfig.enabled || !canPoll;

  const handleSave = async () => {
    if (isConfigLoading) {
      message.warning('配置尚未加载完成，暂时不能保存');
      return;
    }

    setSaving(true);
    try {
      const nextConfig = buildComparableConfig(draftConfig, authorsText);
      const saved = await saveV0Config(nextConfig);
      setDraftConfig(saved);
      setAuthorsText(saved.authors.join('\n'));
      await queryClient.invalidateQueries({ queryKey: ['v0Config'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
      message.success('V0 配置已保存');
    } catch (error) {
      console.error(error);
      message.error(getApiErrorMessage(error, '保存配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const persistDraftConfigIfNeeded = async () => {
    const nextConfig = buildComparableConfig(draftConfig, authorsText);
    const savedConfig = config ? buildComparableConfig(config, config.authors.join('\n')) : null;

    if (!savedConfig || !areConfigsEqual(nextConfig, savedConfig)) {
      const saved = await saveV0Config(nextConfig);
      setDraftConfig(saved);
      setAuthorsText(saved.authors.join('\n'));
      await queryClient.invalidateQueries({ queryKey: ['v0Config'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
    }
  };

  const handleStartScheduler = async () => {
    if (isConfigLoading) {
      message.warning('配置尚未加载完成，暂时不能启动调度');
      return;
    }

    if (!canPoll) {
      message.warning('请先填写帖子 URL');
      return;
    }

    if (!draftConfig.enabled) {
      message.warning('请先启用轮询配置');
      return;
    }

    setSchedulerToggling(true);
    try {
      await persistDraftConfigIfNeeded();
      const status = await startV0Scheduler();
      queryClient.setQueryData(['v0JobStatus'], status);
      await queryClient.invalidateQueries({ queryKey: ['v0JobStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
      message.success(status.pollJobActive ? '轮询调度已启动' : '调度器已启动，等待有效轮询配置');
    } catch (error) {
      console.error(error);
      message.error(getApiErrorMessage(error, '启动调度失败'));
    } finally {
      setSchedulerToggling(false);
    }
  };

  const handleStopScheduler = async () => {
    setSchedulerToggling(true);
    try {
      const status = await stopV0Scheduler();
      queryClient.setQueryData(['v0JobStatus'], status);
      await queryClient.invalidateQueries({ queryKey: ['v0JobStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
      message.success('轮询调度已停止');
    } catch (error) {
      console.error(error);
      message.error(getApiErrorMessage(error, '停止调度失败'));
    } finally {
      setSchedulerToggling(false);
    }
  };

  const handlePoll = async () => {
    if (isConfigLoading) {
      message.warning('配置尚未加载完成，暂时不能抓取');
      return;
    }

    if (!canPoll) {
      message.warning('请先填写帖子 URL');
      return;
    }

    if (!draftConfig.enabled) {
      message.warning('当前已关闭轮询，请先启用轮询');
      return;
    }

    setPolling(true);
    try {
      await persistDraftConfigIfNeeded();

      const result = await pollV0Thread();
      setLastPollResult(result);
      await queryClient.invalidateQueries({ queryKey: ['v0Messages'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
      await queryClient.invalidateQueries({ queryKey: ['v0Notifications'] });
      message.success(`抓取完成，新增 ${result.newMessageCount} 条`);
    } catch (error) {
      console.error(error);
      message.error(getApiErrorMessage(error, '抓取失败'));
    } finally {
      setPolling(false);
    }
  };

  const handleBuildDigest = async () => {
    setBuildingDigest(true);
    try {
      const digest = await buildV0Digest();
      await queryClient.invalidateQueries({ queryKey: ['v0Digests'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobStatus'] });
      await queryClient.invalidateQueries({ queryKey: ['v0JobRuns'] });
      message.success(`日报已生成：${digest.digestDate}`);
    } catch (error) {
      console.error(error);
      message.error(getApiErrorMessage(error, '生成日报失败'));
    } finally {
      setBuildingDigest(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      {configError ? (
        <Col span={24}>
          <Alert type="error" showIcon message="V0 配置加载失败，请稍后重试。" />
        </Col>
      ) : null}
      <Col xs={24} lg={14}>
        <ThreadConfigCard
          threadUrl={draftConfig.threadUrl}
          threadTitle={draftConfig.threadTitle}
          ngaCookie={draftConfig.ngaCookie}
          pollIntervalSeconds={draftConfig.pollIntervalSeconds}
          enabled={draftConfig.enabled}
          pushEnabled={draftConfig.pushEnabled}
          pushChannel={draftConfig.pushChannel}
          pushWebhookUrl={draftConfig.pushWebhookUrl}
          pushSecret={draftConfig.pushSecret}
          digestEnabled={draftConfig.digestEnabled}
          digestCron={draftConfig.digestCron}
          authorsText={authorsText}
          saving={saving}
          polling={polling}
          disabled={!isConfigReady}
          pollDisabled={isPollDisabled}
          onThreadUrlChange={(value) => setDraftConfig((prev) => ({ ...prev, threadUrl: value }))}
          onThreadTitleChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, threadTitle: value }))
          }
          onNgaCookieChange={(value) => setDraftConfig((prev) => ({ ...prev, ngaCookie: value }))}
          onPollIntervalChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, pollIntervalSeconds: value }))
          }
          onEnabledChange={(value) => setDraftConfig((prev) => ({ ...prev, enabled: value }))}
          onPushEnabledChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, pushEnabled: value }))
          }
          onPushChannelChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, pushChannel: value }))
          }
          onPushWebhookUrlChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, pushWebhookUrl: value }))
          }
          onPushSecretChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, pushSecret: value }))
          }
          onDigestEnabledChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, digestEnabled: value }))
          }
          onDigestCronChange={(value) =>
            setDraftConfig((prev) => ({ ...prev, digestCron: value }))
          }
          onAuthorsTextChange={setAuthorsText}
          onSave={handleSave}
          onPoll={handlePoll}
        />
      </Col>
      <Col xs={24} lg={10}>
        <JobStatusCard
          pollResult={lastPollResult}
          jobStatus={jobStatus}
          schedulerToggling={schedulerToggling}
          onStartScheduler={handleStartScheduler}
          onStopScheduler={handleStopScheduler}
        />
      </Col>
      {jobStatusError ? (
        <Col span={24}>
          <Alert type="error" showIcon message="任务运行态加载失败，请稍后重试。" />
        </Col>
      ) : null}
      <Col xs={24} lg={12}>
        <NotificationListCard
          notifications={notifications}
          isLoading={isNotificationsLoading}
          errorMessage={
            notificationsError ? getApiErrorMessage(notificationsError, '获取推送记录失败') : undefined
          }
        />
      </Col>
      <Col xs={24} lg={12}>
        <DigestCard
          digests={digests}
          isLoading={isDigestsLoading}
          building={buildingDigest}
          errorMessage={digestsError ? getApiErrorMessage(digestsError, '获取日报失败') : undefined}
          onBuild={handleBuildDigest}
        />
      </Col>
      <Col xs={24}>
        <JobRunListCard
          runs={jobRuns}
          isLoading={isJobRunsLoading}
          errorMessage={jobRunsError ? getApiErrorMessage(jobRunsError, '获取执行历史失败') : undefined}
        />
      </Col>
    </Row>
  );
};

export default V0MonitorPage;
