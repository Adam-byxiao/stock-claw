import Database from 'better-sqlite3';
import { V0ThreadConfigService } from '../forum/threadConfig';
import { V0JobRunStore } from './jobRunStore';
import { V0Scheduler } from './jobs';
import { V0JobStatusResponse } from './types';

export class V0JobStatusService {
  constructor(
    private readonly database: Database.Database,
    private readonly configService: V0ThreadConfigService,
    private readonly jobRunStore: V0JobRunStore,
    private readonly scheduler?: V0Scheduler
  ) {}

  getStatus(): V0JobStatusResponse {
    const config = this.configService.getConfig();
    const runtimeStatus = this.scheduler?.getRuntimeStatus();
    const messageStats = this.database
      .prepare(
        `SELECT
          COUNT(*) AS totalStoredMessages,
          SUM(CASE WHEN is_new = 1 THEN 1 ELSE 0 END) AS unreadMessageCount,
          SUM(CASE WHEN insight_status = 'pending' THEN 1 ELSE 0 END) AS pendingInsightCount,
          SUM(CASE WHEN insight_status = 'failed' THEN 1 ELSE 0 END) AS failedInsightCount,
          MAX(CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END) AS lastMessageAt
        FROM v0_forum_messages`
      )
      .get() as {
      totalStoredMessages: number | null;
      unreadMessageCount: number | null;
      pendingInsightCount: number | null;
      failedInsightCount: number | null;
      lastMessageAt: string | null;
    };

    const notificationStats = this.database
      .prepare(
        `SELECT
          status,
          COALESCE(sent_at, created_at) AS happenedAt
        FROM v0_notifications
        ORDER BY id DESC
        LIMIT 1`
      )
      .get() as { status: 'success' | 'failed'; happenedAt: string } | undefined;

    const digestStats = this.database
      .prepare(
        `SELECT
          digest_date AS digestDate,
          updated_at AS updatedAt
        FROM v0_daily_digests
        ORDER BY digest_date DESC, id DESC
        LIMIT 1`
      )
      .get() as { digestDate: string; updatedAt: string } | undefined;

    return {
      threadUrl: config.threadUrl,
      threadTitle: config.threadTitle,
      enabled: config.enabled,
      pushEnabled: config.pushEnabled,
      pushChannel: config.pushChannel,
      digestEnabled: config.digestEnabled,
      digestCron: config.digestCron,
      pollIntervalSeconds: config.pollIntervalSeconds,
      totalStoredMessages: messageStats.totalStoredMessages ?? 0,
      unreadMessageCount: messageStats.unreadMessageCount ?? 0,
      pendingInsightCount: messageStats.pendingInsightCount ?? 0,
      failedInsightCount: messageStats.failedInsightCount ?? 0,
      lastMessageAt: messageStats.lastMessageAt ?? null,
      lastNotificationStatus: notificationStats?.status ?? 'idle',
      lastNotificationAt: notificationStats?.happenedAt ?? null,
      lastDigestDate: digestStats?.digestDate ?? null,
      lastDigestAt: digestStats?.updatedAt ?? null,
      schedulerEnabled: runtimeStatus?.schedulerEnabled ?? false,
      schedulerRunning: runtimeStatus?.schedulerRunning ?? false,
      pollJobActive: runtimeStatus?.pollJobActive ?? false,
      digestJobActive: runtimeStatus?.digestJobActive ?? false,
      nextPollAt: runtimeStatus?.nextPollAt ?? null,
      nextDigestAt: runtimeStatus?.nextDigestAt ?? null,
      lastSchedulerError: runtimeStatus?.lastSchedulerError ?? null,
      lastPollRun: this.jobRunStore.getLatestRun('poll_thread'),
      lastDigestRun: this.jobRunStore.getLatestRun('build_digest'),
    };
  }
}
