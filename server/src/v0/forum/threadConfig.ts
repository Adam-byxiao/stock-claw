import Database from 'better-sqlite3';
import { V0ConfigPayload, V0ConfigResponse } from '../shared/types';
import { toBeijingISOString } from '../shared/time';

const DEFAULT_DIGEST_CRON = '0 18 * * *';

const DEFAULT_CONFIG: V0ConfigResponse = {
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
  digestCron: DEFAULT_DIGEST_CRON,
  authors: [],
};

const isValidCronExpression = (value: string): boolean => {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  return parts.every((part) => /^(\*|\d+|\*\/\d+|\d+(,\d+)*|\d+-\d+)$/.test(part));
};

export class V0ThreadConfigService {
  constructor(private readonly database: Database.Database) {}

  getConfig(): V0ConfigResponse {
    const configRow = this.database
      .prepare(
        `SELECT
          thread_url AS threadUrl,
          thread_title AS threadTitle,
          nga_cookie AS ngaCookie,
          poll_interval_seconds AS pollIntervalSeconds,
          enabled,
          push_enabled AS pushEnabled,
          push_channel AS pushChannel,
          push_webhook_url AS pushWebhookUrl,
          push_secret AS pushSecret,
          digest_enabled AS digestEnabled,
          digest_cron AS digestCron
        FROM v0_thread_configs
        WHERE id = 1`
      )
      .get() as
      | {
          threadUrl: string;
          threadTitle: string;
          ngaCookie: string;
          pollIntervalSeconds: number;
          enabled: number;
          pushEnabled: number;
          pushChannel: 'console' | 'feishu_bot';
          pushWebhookUrl: string;
          pushSecret: string;
          digestEnabled: number;
          digestCron: string;
        }
      | undefined;

    const authors = this.database
      .prepare(
        `SELECT author_name AS authorName
         FROM v0_author_watchlist
         WHERE enabled = 1
         ORDER BY id ASC`
      )
      .all() as Array<{ authorName: string }>;

    if (!configRow) {
      return {
        ...DEFAULT_CONFIG,
        authors: authors.map((author) => author.authorName),
      };
    }

    return {
      threadUrl: configRow.threadUrl,
      threadTitle: configRow.threadTitle,
      ngaCookie: configRow.ngaCookie,
      pollIntervalSeconds: configRow.pollIntervalSeconds,
      enabled: Boolean(configRow.enabled),
      pushEnabled: Boolean(configRow.pushEnabled),
      pushChannel: configRow.pushChannel,
      pushWebhookUrl: configRow.pushWebhookUrl,
      pushSecret: configRow.pushSecret,
      digestEnabled: Boolean(configRow.digestEnabled),
      digestCron: configRow.digestCron || DEFAULT_DIGEST_CRON,
      authors: authors.map((author) => author.authorName),
    };
  }

  saveConfig(payload: V0ConfigPayload): V0ConfigResponse {
    const nextConfig = this.normalizePayload(payload, this.getConfig());
    const now = toBeijingISOString();

    const upsertConfig = this.database.prepare(`
      INSERT INTO v0_thread_configs (
        id,
        thread_url,
        thread_title,
        nga_cookie,
        poll_interval_seconds,
        enabled,
        push_enabled,
        push_channel,
        push_webhook_url,
        push_secret,
        digest_enabled,
        digest_cron,
        created_at,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_url = excluded.thread_url,
        thread_title = excluded.thread_title,
        nga_cookie = excluded.nga_cookie,
        poll_interval_seconds = excluded.poll_interval_seconds,
        enabled = excluded.enabled,
        push_enabled = excluded.push_enabled,
        push_channel = excluded.push_channel,
        push_webhook_url = excluded.push_webhook_url,
        push_secret = excluded.push_secret,
        digest_enabled = excluded.digest_enabled,
        digest_cron = excluded.digest_cron,
        updated_at = excluded.updated_at
    `);

    const clearAuthors = this.database.prepare('DELETE FROM v0_author_watchlist');
    const insertAuthor = this.database.prepare(`
      INSERT INTO v0_author_watchlist (author_name, alias, enabled, created_at)
      VALUES (?, NULL, 1, ?)
    `);

    const saveTransaction = this.database.transaction(() => {
      upsertConfig.run(
        nextConfig.threadUrl,
        nextConfig.threadTitle,
        nextConfig.ngaCookie,
        nextConfig.pollIntervalSeconds,
        nextConfig.enabled ? 1 : 0,
        nextConfig.pushEnabled ? 1 : 0,
        nextConfig.pushChannel,
        nextConfig.pushWebhookUrl,
        nextConfig.pushSecret,
        nextConfig.digestEnabled ? 1 : 0,
        nextConfig.digestCron,
        now,
        now
      );

      clearAuthors.run();
      for (const author of nextConfig.authors) {
        insertAuthor.run(author, now);
      }
    });

    saveTransaction();

    return this.getConfig();
  }

  private normalizePayload(
    payload: V0ConfigPayload,
    currentConfig: V0ConfigResponse
  ): V0ConfigResponse {
    const authors = Array.isArray(payload.authors)
      ? payload.authors
          .map((author) => author.trim())
          .filter((author) => author.length > 0)
      : currentConfig.authors;

    const uniqueAuthors = Array.from(new Set(authors));

    return {
      threadUrl: payload.threadUrl !== undefined ? payload.threadUrl.trim() : currentConfig.threadUrl,
      threadTitle:
        payload.threadTitle !== undefined ? payload.threadTitle.trim() : currentConfig.threadTitle,
      ngaCookie:
        payload.ngaCookie !== undefined ? payload.ngaCookie.trim() : currentConfig.ngaCookie,
      pollIntervalSeconds:
        typeof payload.pollIntervalSeconds === 'number' &&
        Number.isFinite(payload.pollIntervalSeconds) &&
        Number.isInteger(payload.pollIntervalSeconds) &&
        payload.pollIntervalSeconds > 0
          ? Math.floor(payload.pollIntervalSeconds)
          : currentConfig.pollIntervalSeconds,
      enabled: payload.enabled ?? currentConfig.enabled,
      pushEnabled: payload.pushEnabled ?? currentConfig.pushEnabled,
      pushChannel: payload.pushChannel ?? currentConfig.pushChannel,
      pushWebhookUrl:
        payload.pushWebhookUrl !== undefined
          ? payload.pushWebhookUrl.trim()
          : currentConfig.pushWebhookUrl,
      pushSecret:
        payload.pushSecret !== undefined ? payload.pushSecret.trim() : currentConfig.pushSecret,
      digestEnabled: payload.digestEnabled ?? currentConfig.digestEnabled,
      digestCron:
        payload.digestCron !== undefined && isValidCronExpression(payload.digestCron)
          ? payload.digestCron.trim()
          : currentConfig.digestCron,
      authors: uniqueAuthors,
    };
  }
}
