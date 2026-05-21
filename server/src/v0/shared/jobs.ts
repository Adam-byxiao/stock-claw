import { V0DigestService } from '../digest/digestService';
import { V0ForumService } from '../forum/forumService';
import { V0ThreadConfigService } from '../forum/threadConfig';
import { V0JobRunStore } from './jobRunStore';
import {
  toBeijingDateParts,
  toBeijingDateString,
  toBeijingISOString,
  toBeijingMinuteString,
} from './time';
import { V0PollPayload, V0PollResponse, V0DailyDigestRecord } from './types';

export interface V0SchedulerRuntimeStatus {
  schedulerEnabled: boolean;
  schedulerRunning: boolean;
  pollJobActive: boolean;
  digestJobActive: boolean;
  nextPollAt: string | null;
  nextDigestAt: string | null;
  lastSchedulerError: string | null;
}

export interface V0SchedulerOptions {
  enabled?: boolean;
  now?: () => Date;
  pollIntervalMsOverride?: number;
  digestCheckIntervalMs?: number;
  jobRunStore?: V0JobRunStore;
}

const isValidCronPart = (value: number, part: string): boolean => {
  if (part === '*') {
    return true;
  }

  if (part.startsWith('*/')) {
    const interval = Number(part.slice(2));
    return Number.isInteger(interval) && interval > 0 && value % interval === 0;
  }

  if (part.includes(',')) {
    return part.split(',').some((item) => isValidCronPart(value, item));
  }

  if (part.includes('-')) {
    const [start, end] = part.split('-').map(Number);
    return Number.isInteger(start) && Number.isInteger(end) && value >= start && value <= end;
  }

  const exact = Number(part);
  return Number.isInteger(exact) && exact === value;
};

const matchesCronExpression = (date: Date, expression: string): boolean => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const beijingParts = toBeijingDateParts(date);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    isValidCronPart(beijingParts.minute, minute) &&
    isValidCronPart(beijingParts.hour, hour) &&
    isValidCronPart(beijingParts.day, dayOfMonth) &&
    isValidCronPart(beijingParts.month, month) &&
    isValidCronPart(beijingParts.dayOfWeek, dayOfWeek)
  );
};

const computeNextCronMatch = (expression: string, fromDate: Date): string | null => {
  const candidate = new Date(fromDate.getTime());
  candidate.setSeconds(0, 0);

  for (let index = 0; index < 60 * 24 * 7; index += 1) {
    candidate.setTime(candidate.getTime() + 60 * 1000);
    if (matchesCronExpression(candidate, expression)) {
      return toBeijingISOString(candidate);
    }
  }

  return null;
};

export class V0Scheduler {
  private pollTimer: NodeJS.Timeout | null = null;
  private digestTimer: NodeJS.Timeout | null = null;
  private lastDigestSlot: string | null = null;
  private pollRunning = false;
  private digestRunning = false;
  private readonly now: () => Date;
  private readonly runtimeStatus: V0SchedulerRuntimeStatus;
  private readonly pollIntervalMsOverride?: number;
  private readonly digestCheckIntervalMs: number;
  private readonly jobRunStore?: V0JobRunStore;

  constructor(
    private readonly configService: V0ThreadConfigService,
    private readonly forumService: V0ForumService,
    private readonly digestService: V0DigestService,
    options: V0SchedulerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.pollIntervalMsOverride = options.pollIntervalMsOverride;
    this.digestCheckIntervalMs = options.digestCheckIntervalMs ?? 60 * 1000;
    this.jobRunStore = options.jobRunStore;
    this.runtimeStatus = {
      schedulerEnabled: options.enabled ?? false,
      schedulerRunning: false,
      pollJobActive: false,
      digestJobActive: false,
      nextPollAt: null,
      nextDigestAt: null,
      lastSchedulerError: null,
    };
  }

  start(): void {
    this.runtimeStatus.schedulerEnabled = true;

    if (this.runtimeStatus.schedulerRunning) {
      return;
    }

    this.runtimeStatus.schedulerRunning = true;
    this.refreshConfig();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }

    this.runtimeStatus.schedulerRunning = false;
    this.runtimeStatus.schedulerEnabled = false;
    this.runtimeStatus.pollJobActive = false;
    this.runtimeStatus.digestJobActive = false;
    this.runtimeStatus.nextPollAt = null;
    this.runtimeStatus.nextDigestAt = null;
  }

  refreshConfig(): void {
    const config = this.configService.getConfig();
    const wasPollJobActive = this.runtimeStatus.pollJobActive;
    const wasDigestJobActive = this.runtimeStatus.digestJobActive;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }

    if (!this.runtimeStatus.schedulerRunning) {
      this.runtimeStatus.pollJobActive = false;
      this.runtimeStatus.digestJobActive = false;
      this.runtimeStatus.nextPollAt = null;
      this.runtimeStatus.nextDigestAt = null;
      return;
    }

    if (config.enabled && config.threadUrl) {
      const pollIntervalMs = this.pollIntervalMsOverride ?? config.pollIntervalSeconds * 1000;
      this.runtimeStatus.pollJobActive = true;
      this.runtimeStatus.nextPollAt = toBeijingISOString(
        new Date(this.now().getTime() + pollIntervalMs)
      );
      this.pollTimer = setInterval(() => {
        void this.safeRunPoll(config.pollIntervalSeconds);
      }, pollIntervalMs);
      if (!wasPollJobActive) {
        void this.safeRunPoll(config.pollIntervalSeconds);
      }
    } else {
      this.runtimeStatus.pollJobActive = false;
      this.runtimeStatus.nextPollAt = null;
    }

    if (config.digestEnabled && config.digestCron) {
      this.runtimeStatus.digestJobActive = true;
      this.runtimeStatus.nextDigestAt = computeNextCronMatch(config.digestCron, this.now());
      this.digestTimer = setInterval(() => {
        void this.safeRunDigest(config.digestCron);
      }, this.digestCheckIntervalMs);
      if (!wasDigestJobActive) {
        void this.safeRunDigest(config.digestCron);
      }
    } else {
      this.runtimeStatus.digestJobActive = false;
      this.runtimeStatus.nextDigestAt = null;
    }
  }

  getRuntimeStatus(): V0SchedulerRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  private async safeRunPoll(intervalSeconds: number): Promise<void> {
    if (this.pollRunning) {
      return;
    }

    this.pollRunning = true;

    try {
      await this.runPollJob('scheduler');
      this.runtimeStatus.lastSchedulerError = null;
      const pollIntervalMs = this.pollIntervalMsOverride ?? intervalSeconds * 1000;
      this.runtimeStatus.nextPollAt = toBeijingISOString(
        new Date(this.now().getTime() + pollIntervalMs)
      );
    } catch (error) {
      this.runtimeStatus.lastSchedulerError =
        error instanceof Error ? error.message : 'unknown poll scheduler error';
    } finally {
      this.pollRunning = false;
    }
  }

  private async safeRunDigest(cronExpression: string): Promise<void> {
    if (this.digestRunning) {
      return;
    }

    const now = this.now();
    const currentSlot = toBeijingMinuteString(now);
    if (this.lastDigestSlot === currentSlot || !matchesCronExpression(now, cronExpression)) {
      return;
    }

    this.digestRunning = true;
    this.lastDigestSlot = currentSlot;

    try {
      await this.runDigestJob('scheduler', toBeijingDateString(now));
      this.runtimeStatus.lastSchedulerError = null;
      this.runtimeStatus.nextDigestAt = computeNextCronMatch(cronExpression, now);
    } catch (error) {
      this.runtimeStatus.lastSchedulerError =
        error instanceof Error ? error.message : 'unknown digest scheduler error';
    } finally {
      this.digestRunning = false;
    }
  }

  async runPollJob(
    triggerSource: 'manual' | 'scheduler',
    payload: V0PollPayload = {}
  ): Promise<V0PollResponse> {
    if (!this.jobRunStore) {
      return this.forumService.pollThread(payload);
    }

    return this.jobRunStore.executeJob('poll_thread', triggerSource, async () => {
      const result = await this.forumService.pollThread(payload);
      return {
        result,
        summaryText: `新增 ${result.newMessageCount} 条，重复 ${result.duplicateMessageCount} 条，推送成功 ${result.pushedMessageCount} 条`,
        metadata: {
          newMessageCount: result.newMessageCount,
          duplicateMessageCount: result.duplicateMessageCount,
          pushedMessageCount: result.pushedMessageCount,
          pushFailureCount: result.pushFailureCount,
        },
      };
    });
  }

  async runDigestJob(
    triggerSource: 'manual' | 'scheduler',
    digestDate?: string
  ): Promise<V0DailyDigestRecord> {
    if (!this.jobRunStore) {
      return this.digestService.buildDailyDigest(digestDate);
    }

    return this.jobRunStore.executeJob('build_digest', triggerSource, async () => {
      const result = this.digestService.buildDailyDigest(digestDate);
      return {
        result,
        summaryText: `日报 ${result.digestDate} 已生成，覆盖 ${result.messageCount} 条消息`,
        metadata: {
          digestDate: result.digestDate,
          messageCount: result.messageCount,
          status: result.status,
        },
      };
    });
  }
}
