import Database from 'better-sqlite3';
import {
  V0ConfigResponse,
  V0MessageMarketState,
  V0MessageMention,
  V0NotificationRecord,
  V0ParsedForumMessage,
} from '../shared/types';
import { toBeijingISOString } from '../shared/time';
import { FeishuBotMessagePayload, FeishuBotPushChannel } from './feishuBotChannel';

export interface V0PushPayload extends FeishuBotMessagePayload {
  authorName: string;
  postedAt: string;
  sourceUrl: string;
  rawContent: string;
  mentions: string[];
  marketSummaries: string[];
}

export interface V0PushChannel {
  channelName: string;
  send(payload: V0PushPayload): Promise<void>;
}

export interface V0PushChannelFactory {
  createChannel(config: Pick<V0ConfigResponse, 'pushChannel' | 'pushWebhookUrl' | 'pushSecret'>): V0PushChannel;
}

class ConsoleV0PushChannel implements V0PushChannel {
  channelName = 'console';

  async send(payload: V0PushPayload): Promise<void> {
    console.log('[V0Push]', JSON.stringify(payload));
  }
}

class DefaultV0PushChannelFactory implements V0PushChannelFactory {
  createChannel(config: Pick<V0ConfigResponse, 'pushChannel' | 'pushWebhookUrl' | 'pushSecret'>): V0PushChannel {
    if (config.pushChannel === 'feishu_bot') {
      if (!config.pushWebhookUrl) {
        throw new Error('feishu webhook url is required');
      }

      return new FeishuBotPushChannel({
        webhookUrl: config.pushWebhookUrl,
        secret: config.pushSecret,
      });
    }

    return new ConsoleV0PushChannel();
  }
}

export class V0PushService {
  constructor(
    private readonly database: Database.Database,
    private readonly channelFactory: V0PushChannelFactory = new DefaultV0PushChannelFactory()
  ) {}

  async sendMessageNotification(
    config: Pick<V0ConfigResponse, 'pushChannel' | 'pushWebhookUrl' | 'pushSecret'>,
    messageId: number,
    message: V0ParsedForumMessage,
    mentions: V0MessageMention[],
    marketStates: V0MessageMarketState[]
  ): Promise<'success' | 'failed'> {
    const payload = this.buildPayload(message, mentions, marketStates);
    const now = toBeijingISOString();
    const insertNotification = this.database.prepare(`
      INSERT INTO v0_notifications (
        message_id,
        channel,
        status,
        sent_at,
        payload_json,
        error_message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const channel = this.channelFactory.createChannel(config);
      await channel.send(payload);
      insertNotification.run(
        messageId,
        channel.channelName,
        'success',
        now,
        JSON.stringify(payload),
        '',
        now
      );
      return 'success';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown push error';
      insertNotification.run(
        messageId,
        config.pushChannel,
        'failed',
        null,
        JSON.stringify(payload),
        errorMessage,
        now
      );
      return 'failed';
    }
  }

  getRecentNotifications(limit = 20): V0NotificationRecord[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

    return this.database
      .prepare(
        `SELECT
          id,
          message_id AS messageId,
          channel,
          status,
          sent_at AS sentAt,
          payload_json AS payloadJson,
          error_message AS errorMessage,
          created_at AS createdAt
        FROM v0_notifications
        ORDER BY id DESC
        LIMIT ?`
      )
      .all(safeLimit) as V0NotificationRecord[];
  }

  private buildPayload(
    message: V0ParsedForumMessage,
    mentions: V0MessageMention[],
    marketStates: V0MessageMarketState[]
  ): V0PushPayload {
    return {
      authorName: message.authorName,
      postedAt: message.postedAt,
      sourceUrl: message.sourceUrl,
      rawContent: message.rawContent,
      mentions: mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
      marketSummaries: marketStates.map((state) => state.summaryText),
    };
  }
}
