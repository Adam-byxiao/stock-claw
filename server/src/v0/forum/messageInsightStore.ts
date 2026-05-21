import Database from 'better-sqlite3';
import { V0MessageMarketState, V0MessageMention } from '../shared/types';
import { toBeijingISOString } from '../shared/time';

interface MessageInsights {
  mentions: V0MessageMention[];
  marketStates: V0MessageMarketState[];
}

export class V0MessageInsightStore {
  constructor(private readonly database: Database.Database) {}

  replaceMessageInsights(
    messageId: number,
    mentions: V0MessageMention[],
    marketStates: V0MessageMarketState[]
  ): void {
    const deleteMentions = this.database.prepare('DELETE FROM v0_message_mentions WHERE message_id = ?');
    const deleteMarketStates = this.database.prepare(
      'DELETE FROM v0_message_market_state WHERE message_id = ?'
    );

    const insertMention = this.database.prepare(`
      INSERT INTO v0_message_mentions (
        message_id,
        entity_type,
        entity_name,
        normalized_code,
        confidence
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const insertMarketState = this.database.prepare(`
      INSERT INTO v0_message_market_state (
        message_id,
        subject_type,
        subject_key,
        snapshot_json,
        summary_text,
        advice_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = toBeijingISOString();

    const transaction = this.database.transaction(() => {
      deleteMentions.run(messageId);
      deleteMarketStates.run(messageId);

      for (const mention of mentions) {
        insertMention.run(
          messageId,
          mention.entityType,
          mention.entityName,
          mention.normalizedCode,
          mention.confidence
        );
      }

      for (const marketState of marketStates) {
        insertMarketState.run(
          messageId,
          marketState.subjectType,
          marketState.subjectKey,
          marketState.snapshotJson,
          marketState.summaryText,
          marketState.adviceText,
          now
        );
      }
    });

    transaction();
  }

  getInsightsForMessageIds(messageIds: number[]): Record<number, MessageInsights> {
    if (messageIds.length === 0) {
      return {};
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const mentions = this.database
      .prepare(
        `SELECT
          id,
          message_id AS messageId,
          entity_type AS entityType,
          entity_name AS entityName,
          normalized_code AS normalizedCode,
          confidence
        FROM v0_message_mentions
        WHERE message_id IN (${placeholders})
        ORDER BY id ASC`
      )
      .all(...messageIds) as V0MessageMention[];

    const marketStates = this.database
      .prepare(
        `SELECT
          id,
          message_id AS messageId,
          subject_type AS subjectType,
          subject_key AS subjectKey,
          snapshot_json AS snapshotJson,
          summary_text AS summaryText,
          advice_text AS adviceText,
          created_at AS createdAt
        FROM v0_message_market_state
        WHERE message_id IN (${placeholders})
        ORDER BY id ASC`
      )
      .all(...messageIds) as V0MessageMarketState[];

    const result: Record<number, MessageInsights> = {};

    for (const messageId of messageIds) {
      result[messageId] = {
        mentions: [],
        marketStates: [],
      };
    }

    for (const mention of mentions) {
      if (mention.messageId !== undefined) {
        result[mention.messageId].mentions.push(mention);
      }
    }

    for (const marketState of marketStates) {
      if (marketState.messageId !== undefined) {
        result[marketState.messageId].marketStates.push(marketState);
      }
    }

    return result;
  }
}
