import Database from 'better-sqlite3';
import crypto from 'crypto';
import { V0ParsedForumMessage, V0StoredForumMessage } from '../shared/types';
import { sameAuthor } from '../shared/authorIdentity';
import { toBeijingISOString } from '../shared/time';
import { V0MessageInsightStore } from './messageInsightStore';

type SaveState = 'inserted' | 'updated' | 'retry' | 'duplicate';

interface SavedMessageRef {
  id: number;
  message: V0ParsedForumMessage;
  state: SaveState;
}

interface SaveMessagesResult {
  newMessageCount: number;
  duplicateMessageCount: number;
  savedMessages: SavedMessageRef[];
}

export class V0MessageStore {
  constructor(
    private readonly database: Database.Database,
    private readonly insightStore?: V0MessageInsightStore
  ) {}

  saveMessages(threadKey: string, messages: V0ParsedForumMessage[]): SaveMessagesResult {
    const now = toBeijingISOString();
    let newMessageCount = 0;
    let duplicateMessageCount = 0;
    const savedMessages: SavedMessageRef[] = [];

    const selectExisting = this.database.prepare(`
      SELECT id, content_hash AS contentHash, insight_status AS insightStatus
      FROM v0_forum_messages
      WHERE thread_key = ?
        AND floor_id = ?
    `);

    const insertMessage = this.database.prepare(`
      INSERT INTO v0_forum_messages (
        thread_key,
        floor_id,
        author_name,
        posted_at,
        raw_content,
        normalized_content,
        content_hash,
        source_url,
        is_new,
        insight_status,
        insight_error,
        enriched_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', '', NULL, ?)
    `);

    const updateExistingMessage = this.database.prepare(`
      UPDATE v0_forum_messages
      SET
        author_name = ?,
        posted_at = ?,
        raw_content = ?,
        normalized_content = ?,
        content_hash = ?,
        source_url = ?,
        is_new = 1,
        insight_status = 'pending',
        insight_error = '',
        enriched_at = NULL
      WHERE id = ?
    `);

    const saveTransaction = this.database.transaction(() => {
      for (const message of messages) {
        const contentHash = this.buildContentHash(message);
        const existing = selectExisting.get(threadKey, message.floorId) as
          | { id: number; contentHash: string; insightStatus: string }
          | undefined;

        if (existing) {
          if (existing.contentHash !== contentHash) {
            updateExistingMessage.run(
              message.authorName,
              message.postedAt,
              message.rawContent,
              message.normalizedContent,
              contentHash,
              message.sourceUrl,
              existing.id
            );
            savedMessages.push({
              id: existing.id,
              message,
              state: 'updated',
            });
          } else {
            savedMessages.push({
              id: existing.id,
              message,
              state: existing.insightStatus === 'success' ? 'duplicate' : 'retry',
            });
          }
          duplicateMessageCount += 1;
          continue;
        }

        const insertResult = insertMessage.run(
          threadKey,
          message.floorId,
          message.authorName,
          message.postedAt,
          message.rawContent,
          message.normalizedContent,
          contentHash,
          message.sourceUrl,
          now
        );
        savedMessages.push({
          id: Number(insertResult.lastInsertRowid),
          message,
          state: 'inserted',
        });
        newMessageCount += 1;
      }
    });

    saveTransaction();

    return {
      newMessageCount,
      duplicateMessageCount,
      savedMessages,
    };
  }

  saveThreadSnapshot(
    threadKey: string,
    threadUrl: string,
    htmlContent: string,
    parsedMessageCount: number
  ): void {
    const now = toBeijingISOString();
    const htmlHash = crypto.createHash('sha256').update(htmlContent).digest('hex');

    this.database
      .prepare(
        `INSERT INTO v0_thread_snapshots (
          thread_key,
          thread_url,
          fetched_at,
          html_content,
          html_hash,
          parsed_message_count
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(threadKey, threadUrl, now, htmlContent, htmlHash, parsedMessageCount);
  }

  isWatchedAuthor(authorName: string, watchedAuthors: string[]): boolean {
    if (watchedAuthors.length === 0) {
      return true;
    }

    return watchedAuthors.some((watchedAuthor) => sameAuthor(watchedAuthor, authorName));
  }

  updateCursor(threadKey: string, latestMessage: V0ParsedForumMessage | null): void {
    if (!latestMessage) {
      return;
    }

    const upsertCursor = this.database.prepare(`
      INSERT INTO v0_thread_cursors (
        thread_key,
        last_floor_id,
        last_posted_at,
        last_content_hash,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(thread_key) DO UPDATE SET
        last_floor_id = excluded.last_floor_id,
        last_posted_at = excluded.last_posted_at,
        last_content_hash = excluded.last_content_hash,
        updated_at = excluded.updated_at
    `);

    const now = toBeijingISOString();
    upsertCursor.run(
      threadKey,
      latestMessage.floorId,
      latestMessage.postedAt,
      this.buildContentHash(latestMessage),
      now
    );
  }

  updateInsightStatus(messageId: number, status: 'success' | 'failed', errorMessage?: string): void {
    const statement = this.database.prepare(`
      UPDATE v0_forum_messages
      SET
        insight_status = ?,
        insight_error = ?,
        enriched_at = ?
      WHERE id = ?
    `);

    statement.run(
      status,
      status === 'failed' ? errorMessage ?? '' : '',
      status === 'success' ? toBeijingISOString() : null,
      messageId
    );
  }

  getRecentMessages(limit = 50): V0StoredForumMessage[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    type StoredMessageRow = {
      id: number;
      threadKey: string;
      floorId: string;
      authorName: string;
      postedAt: string;
      rawContent: string;
      normalizedContent: string;
      contentHash: string;
      sourceUrl: string;
      isNew: number;
      insightStatus: 'pending' | 'success' | 'failed';
      insightError: string;
      enrichedAt: string | null;
      createdAt: string;
    };
    const rows = this.database
      .prepare(
        `SELECT
          id,
          thread_key AS threadKey,
          floor_id AS floorId,
          author_name AS authorName,
          posted_at AS postedAt,
          raw_content AS rawContent,
          normalized_content AS normalizedContent,
          content_hash AS contentHash,
          source_url AS sourceUrl,
          is_new AS isNew,
          insight_status AS insightStatus,
          insight_error AS insightError,
          enriched_at AS enrichedAt,
          created_at AS createdAt
        FROM v0_forum_messages
        ORDER BY posted_at DESC, id DESC
        LIMIT ?`
      )
      .all(safeLimit) as StoredMessageRow[];

    if (rows.length > 0) {
      const markAsSeen = this.database.prepare(
        `UPDATE v0_forum_messages
         SET is_new = 0
         WHERE id = ?`
      );
      const transaction = this.database.transaction((messageIds: number[]) => {
        for (const messageId of messageIds) {
          markAsSeen.run(messageId);
        }
      });
      transaction(rows.map((row) => row.id));
    }

    const insights = this.insightStore
      ? this.insightStore.getInsightsForMessageIds(rows.map((row) => row.id))
      : {};

    return rows.map((row) => ({
      ...row,
      isNew: Boolean(row.isNew),
      mentions: insights[row.id]?.mentions ?? [],
      marketStates: insights[row.id]?.marketStates ?? [],
    }));
  }

  getMessageById(messageId: number): V0StoredForumMessage | null {
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return null;
    }

    type StoredMessageRow = {
      id: number;
      threadKey: string;
      floorId: string;
      authorName: string;
      postedAt: string;
      rawContent: string;
      normalizedContent: string;
      contentHash: string;
      sourceUrl: string;
      isNew: number;
      insightStatus: 'pending' | 'success' | 'failed';
      insightError: string;
      enrichedAt: string | null;
      createdAt: string;
    };

    const row = this.database
      .prepare(
        `SELECT
          id,
          thread_key AS threadKey,
          floor_id AS floorId,
          author_name AS authorName,
          posted_at AS postedAt,
          raw_content AS rawContent,
          normalized_content AS normalizedContent,
          content_hash AS contentHash,
          source_url AS sourceUrl,
          is_new AS isNew,
          insight_status AS insightStatus,
          insight_error AS insightError,
          enriched_at AS enrichedAt,
          created_at AS createdAt
        FROM v0_forum_messages
        WHERE id = ?`
      )
      .get(messageId) as StoredMessageRow | undefined;

    if (!row) {
      return null;
    }

    const insights = this.insightStore ? this.insightStore.getInsightsForMessageIds([row.id]) : {};

    return {
      ...row,
      isNew: Boolean(row.isNew),
      mentions: insights[row.id]?.mentions ?? [],
      marketStates: insights[row.id]?.marketStates ?? [],
    };
  }

  private buildContentHash(message: V0ParsedForumMessage): string {
    return crypto
      .createHash('sha256')
      .update(
        [message.floorId, message.authorName, message.postedAt, message.normalizedContent].join('|')
      )
      .digest('hex');
  }
}
