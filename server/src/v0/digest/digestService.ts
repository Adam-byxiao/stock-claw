import Database from 'better-sqlite3';
import { V0DailyDigestRecord } from '../shared/types';
import { toBeijingDateString, toBeijingISOString } from '../shared/time';

interface DigestMessageRow {
  id: number;
  authorName: string;
  postedAt: string;
  rawContent: string;
  createdAt: string;
}

interface DigestMentionRow {
  messageId: number;
  entityType: string;
  entityName: string;
}

export class V0DigestService {
  constructor(private readonly database: Database.Database) {}

  buildDailyDigest(digestDate?: string): V0DailyDigestRecord {
    const normalizedDate = digestDate ?? toBeijingDateString();
    const messages = this.getMessagesForDate(normalizedDate);
    const mentions = this.getMentionsForMessageIds(messages.map((message) => message.id));
    const contentMarkdown = this.buildMarkdown(normalizedDate, messages, mentions);
    const now = toBeijingISOString();

    const upsertDigest = this.database.prepare(`
      INSERT INTO v0_daily_digests (
        digest_date,
        content_markdown,
        status,
        message_count,
        sent_at,
        created_at,
        updated_at
      ) VALUES (?, ?, 'success', ?, ?, ?, ?)
      ON CONFLICT(digest_date) DO UPDATE SET
        content_markdown = excluded.content_markdown,
        status = excluded.status,
        message_count = excluded.message_count,
        sent_at = excluded.sent_at,
        updated_at = excluded.updated_at
    `);

    upsertDigest.run(normalizedDate, contentMarkdown, messages.length, now, now, now);

    return this.database
      .prepare(
        `SELECT
          id,
          digest_date AS digestDate,
          content_markdown AS contentMarkdown,
          status,
          message_count AS messageCount,
          sent_at AS sentAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM v0_daily_digests
        WHERE digest_date = ?`
      )
      .get(normalizedDate) as V0DailyDigestRecord;
  }

  getRecentDigests(limit = 10): V0DailyDigestRecord[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;

    return this.database
      .prepare(
        `SELECT
          id,
          digest_date AS digestDate,
          content_markdown AS contentMarkdown,
          status,
          message_count AS messageCount,
          sent_at AS sentAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM v0_daily_digests
        ORDER BY digest_date DESC, id DESC
        LIMIT ?`
      )
      .all(safeLimit) as V0DailyDigestRecord[];
  }

  private getMessagesForDate(digestDate: string): DigestMessageRow[] {
    return this.database
      .prepare(
        `SELECT
          id,
          author_name AS authorName,
          posted_at AS postedAt,
          raw_content AS rawContent,
          created_at AS createdAt
        FROM v0_forum_messages
        WHERE substr(CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END, 1, 10) = ?
        ORDER BY CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END ASC, id ASC`
      )
      .all(digestDate) as DigestMessageRow[];
  }

  private getMentionsForMessageIds(messageIds: number[]): Record<number, DigestMentionRow[]> {
    if (messageIds.length === 0) {
      return {};
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT
          message_id AS messageId,
          entity_type AS entityType,
          entity_name AS entityName
        FROM v0_message_mentions
        WHERE message_id IN (${placeholders})
        ORDER BY id ASC`
      )
      .all(...messageIds) as DigestMentionRow[];

    return rows.reduce<Record<number, DigestMentionRow[]>>((accumulator, row) => {
      if (!accumulator[row.messageId]) {
        accumulator[row.messageId] = [];
      }

      accumulator[row.messageId].push(row);
      return accumulator;
    }, {});
  }

  private buildMarkdown(
    digestDate: string,
    messages: DigestMessageRow[],
    mentionMap: Record<number, DigestMentionRow[]>
  ): string {
    const lines: string[] = [];
    const messagesByAuthor = new Map<string, DigestMessageRow[]>();
    const mentionCounts = new Map<string, number>();

    for (const message of messages) {
      const authorMessages = messagesByAuthor.get(message.authorName) ?? [];
      authorMessages.push(message);
      messagesByAuthor.set(message.authorName, authorMessages);

      for (const mention of mentionMap[message.id] ?? []) {
        const key = `${mention.entityType}:${mention.entityName}`;
        mentionCounts.set(key, (mentionCounts.get(key) ?? 0) + 1);
      }
    }

    lines.push(`# V0 日报 ${digestDate}`);
    lines.push('');
    lines.push(`- 命中消息数：${messages.length}`);
    lines.push(`- 覆盖作者数：${messagesByAuthor.size}`);
    lines.push(`- 提及对象数：${mentionCounts.size}`);
    lines.push('');

    if (messages.length === 0) {
      lines.push('## 今日概览');
      lines.push('');
      lines.push('今日没有新增命中消息。');
      return lines.join('\n');
    }

    lines.push('## 按作者汇总');
    lines.push('');
    for (const [authorName, authorMessages] of messagesByAuthor.entries()) {
      lines.push(`### ${authorName}`);
      lines.push('');
      lines.push(`- 发言数：${authorMessages.length}`);
      for (const message of authorMessages.slice(0, 5)) {
        const messageTime = message.postedAt || message.createdAt;
        lines.push(`- ${messageTime} ${message.rawContent}`);
      }
      lines.push('');
    }

    lines.push('## 按对象汇总');
    lines.push('');
    if (mentionCounts.size === 0) {
      lines.push('- 今日消息未识别出可追踪对象。');
    } else {
      const sortedMentions = Array.from(mentionCounts.entries()).sort((left, right) => right[1] - left[1]);
      for (const [mentionKey, count] of sortedMentions) {
        lines.push(`- ${mentionKey}：${count} 次`);
      }
    }
    lines.push('');

    lines.push('## 最新消息');
    lines.push('');
    for (const message of messages.slice(-10)) {
      const messageTime = message.postedAt || message.createdAt;
      lines.push(`- [${messageTime}] ${message.authorName}: ${message.rawContent}`);
    }

    return lines.join('\n');
  }
}
