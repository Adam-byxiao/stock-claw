import Database from 'better-sqlite3';
import { V0AuthorProfileRecord, V0PersonaChunkRecord, V0PersonaEmbeddingRecord, V0ProfileRunRecord } from '../shared/types';
import { normalizeAuthorName } from '../shared/authorIdentity';
import { toBeijingISOString } from '../shared/time';

export interface V0PersonaChunkSeed {
  messageId: number;
  threadKey: string;
  floorId: string;
  authorName: string;
  chunkIndex: number;
  chunkText: string;
  chunkHash: string;
  sourceUrl: string;
  sourcePostedAt: string;
}

export interface V0PersonaChunkView extends V0PersonaChunkRecord {
  embeddingStatus: V0PersonaEmbeddingRecord['status'] | 'missing';
  embeddingModel: string;
  embeddingJson: string;
  embeddingError: string;
}

export interface V0PersonaProfileSeed {
  authorName: string;
  status: V0AuthorProfileRecord['status'];
  summaryText: string;
  profileJson: string;
  evidenceJson: string;
  sourceMessageCount: number;
  sourceChunkCount: number;
  lastMessageAt: string;
  lastBuiltAt: string | null;
  profileVersion: number;
}

export interface V0PersonaRunSeed {
  authorName: string;
  triggerSource: V0ProfileRunRecord['triggerSource'];
}

export class V0PersonaStore {
  constructor(private readonly database: Database.Database) {}

  upsertMessageChunk(seed: V0PersonaChunkSeed): V0PersonaChunkView {
    const now = toBeijingISOString();
    const selectExisting = this.database.prepare(
      `SELECT
        c.id AS id,
        c.message_id AS messageId,
        c.thread_key AS threadKey,
        c.floor_id AS floorId,
        c.author_name AS authorName,
        c.chunk_index AS chunkIndex,
        c.chunk_text AS chunkText,
        c.chunk_hash AS chunkHash,
        c.source_url AS sourceUrl,
        c.source_posted_at AS sourcePostedAt,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        COALESCE(e.status, 'missing') AS embeddingStatus,
        COALESCE(e.model_name, '') AS embeddingModel,
        COALESCE(e.embedding_json, '[]') AS embeddingJson,
        COALESCE(e.error_message, '') AS embeddingError
       FROM v0_message_chunks c
       LEFT JOIN v0_message_embeddings e ON e.chunk_id = c.id
       WHERE c.message_id = ? AND c.chunk_index = ?`
    );

    const insertChunk = this.database.prepare(
      `INSERT INTO v0_message_chunks (
        message_id,
        thread_key,
        floor_id,
        author_name,
        chunk_index,
        chunk_text,
        chunk_hash,
        source_url,
        source_posted_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const updateChunk = this.database.prepare(
      `UPDATE v0_message_chunks
       SET thread_key = ?,
           floor_id = ?,
           author_name = ?,
           chunk_text = ?,
           chunk_hash = ?,
           source_url = ?,
           source_posted_at = ?,
           updated_at = ?
       WHERE id = ?`
    );

    const insertEmbedding = this.database.prepare(
      `INSERT INTO v0_message_embeddings (
        chunk_id,
        model_name,
        embedding_json,
        embedding_dim,
        status,
        error_message,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const updateEmbedding = this.database.prepare(
      `UPDATE v0_message_embeddings
       SET model_name = ?,
           embedding_json = ?,
           embedding_dim = ?,
           status = ?,
           error_message = ?,
           updated_at = ?
       WHERE chunk_id = ?`
    );

    const transaction = this.database.transaction(() => {
      const existing = selectExisting.get(seed.messageId, seed.chunkIndex) as
        | V0PersonaChunkView
        | undefined;
      const chunkChanged =
        existing !== undefined &&
        (existing.chunkHash !== seed.chunkHash || existing.chunkText !== seed.chunkText);

      if (!existing) {
        insertChunk.run(
          seed.messageId,
          seed.threadKey,
          seed.floorId,
          seed.authorName,
          seed.chunkIndex,
          seed.chunkText,
          seed.chunkHash,
          seed.sourceUrl,
          seed.sourcePostedAt,
          now,
          now
        );

        const chunkRow = selectExisting.get(seed.messageId, seed.chunkIndex) as
          | V0PersonaChunkView
          | undefined;
        if (!chunkRow) {
          throw new Error('failed to create persona chunk');
        }

        insertEmbedding.run(
          chunkRow.id,
          'pending',
          '[]',
          0,
          'pending',
          '',
          now,
          now
        );
        return;
      }

      if (chunkChanged) {
        updateChunk.run(
          seed.threadKey,
          seed.floorId,
          seed.authorName,
          seed.chunkText,
          seed.chunkHash,
          seed.sourceUrl,
          seed.sourcePostedAt,
          now,
          existing.id
        );
      }

      if (existing.embeddingStatus === 'missing') {
        insertEmbedding.run(existing.id, 'pending', '[]', 0, 'pending', '', now, now);
      } else {
        updateEmbedding.run(
          chunkChanged ? 'pending' : existing.embeddingModel || 'pending',
          chunkChanged ? '[]' : existing.embeddingJson || '[]',
          chunkChanged ? 0 : this.safeEmbeddingDim(existing.embeddingJson),
          chunkChanged ? 'pending' : existing.embeddingStatus === 'success' ? 'success' : 'pending',
          chunkChanged ? '' : existing.embeddingError || '',
          now,
          existing.id
        );
      }
    });

    transaction();

    return this.getChunkView(seed.messageId, seed.chunkIndex) as V0PersonaChunkView;
  }

  upsertChunkEmbedding(
    chunkId: number,
    modelName: string,
    embedding: number[],
    status: V0PersonaEmbeddingRecord['status'],
    errorMessage = ''
  ): void {
    const now = toBeijingISOString();
    const payload = JSON.stringify(embedding);
    const upsertEmbedding = this.database.prepare(
      `INSERT INTO v0_message_embeddings (
        chunk_id,
        model_name,
        embedding_json,
        embedding_dim,
        status,
        error_message,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        model_name = excluded.model_name,
        embedding_json = excluded.embedding_json,
        embedding_dim = excluded.embedding_dim,
        status = excluded.status,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at`
    );

    upsertEmbedding.run(
      chunkId,
      modelName,
      payload,
      embedding.length,
      status,
      errorMessage,
      now,
      now
    );
  }

  getAuthorChunks(authorName: string, limit?: number): V0PersonaChunkView[] {
    const hasLimit = Number.isInteger(limit) && (limit as number) > 0;
    const normalizedAuthorName = normalizeAuthorName(authorName);
    const sql = `
        SELECT
          c.id AS id,
          c.message_id AS messageId,
          c.thread_key AS threadKey,
          c.floor_id AS floorId,
          c.author_name AS authorName,
          c.chunk_index AS chunkIndex,
          c.chunk_text AS chunkText,
          c.chunk_hash AS chunkHash,
          c.source_url AS sourceUrl,
          c.source_posted_at AS sourcePostedAt,
          c.created_at AS createdAt,
          c.updated_at AS updatedAt,
          COALESCE(e.status, 'missing') AS embeddingStatus,
          COALESCE(e.model_name, '') AS embeddingModel,
          COALESCE(e.embedding_json, '[]') AS embeddingJson,
          COALESCE(e.error_message, '') AS embeddingError
        FROM v0_message_chunks c
        LEFT JOIN v0_message_embeddings e ON e.chunk_id = c.id
        WHERE LOWER(REPLACE(c.author_name, 'UID:', '')) = ?
        ORDER BY CASE WHEN c.source_posted_at <> '' THEN c.source_posted_at ELSE c.created_at END DESC,
          c.id DESC
        ${hasLimit ? 'LIMIT ?' : ''}`;

    const statement = this.database.prepare(sql);
    return (hasLimit ? statement.all(normalizedAuthorName, limit) : statement.all(normalizedAuthorName)) as V0PersonaChunkView[];
  }

  getChunkView(messageId: number, chunkIndex: number): V0PersonaChunkView | null {
    const row = this.database
      .prepare(
        `SELECT
          c.id AS id,
          c.message_id AS messageId,
          c.thread_key AS threadKey,
          c.floor_id AS floorId,
          c.author_name AS authorName,
          c.chunk_index AS chunkIndex,
          c.chunk_text AS chunkText,
          c.chunk_hash AS chunkHash,
          c.source_url AS sourceUrl,
          c.source_posted_at AS sourcePostedAt,
          c.created_at AS createdAt,
          c.updated_at AS updatedAt,
          COALESCE(e.status, 'missing') AS embeddingStatus,
          COALESCE(e.model_name, '') AS embeddingModel,
          COALESCE(e.embedding_json, '[]') AS embeddingJson,
          COALESCE(e.error_message, '') AS embeddingError
         FROM v0_message_chunks c
         LEFT JOIN v0_message_embeddings e ON e.chunk_id = c.id
         WHERE c.message_id = ? AND c.chunk_index = ?`
      )
      .get(messageId, chunkIndex) as V0PersonaChunkView | undefined;

    return row ?? null;
  }

  getChunkById(chunkId: number): V0PersonaChunkView | null {
    const row = this.database
      .prepare(
        `SELECT
          c.id AS id,
          c.message_id AS messageId,
          c.thread_key AS threadKey,
          c.floor_id AS floorId,
          c.author_name AS authorName,
          c.chunk_index AS chunkIndex,
          c.chunk_text AS chunkText,
          c.chunk_hash AS chunkHash,
          c.source_url AS sourceUrl,
          c.source_posted_at AS sourcePostedAt,
          c.created_at AS createdAt,
          c.updated_at AS updatedAt,
          COALESCE(e.status, 'missing') AS embeddingStatus,
          COALESCE(e.model_name, '') AS embeddingModel,
          COALESCE(e.embedding_json, '[]') AS embeddingJson,
          COALESCE(e.error_message, '') AS embeddingError
         FROM v0_message_chunks c
         LEFT JOIN v0_message_embeddings e ON e.chunk_id = c.id
         WHERE c.id = ?`
      )
      .get(chunkId) as V0PersonaChunkView | undefined;

    return row ?? null;
  }

  getAuthorMessageStats(authorName: string): {
    messageCount: number;
    chunkCount: number;
    lastMessageAt: string;
  } {
    const normalizedAuthorName = normalizeAuthorName(authorName);
    const row = this.database
      .prepare(
        `SELECT
          COUNT(DISTINCT message_id) AS messageCount,
          COUNT(*) AS chunkCount,
          COALESCE(MAX(CASE WHEN source_posted_at <> '' THEN source_posted_at ELSE created_at END), '') AS lastMessageAt
        FROM v0_message_chunks
        WHERE LOWER(REPLACE(author_name, 'UID:', '')) = ?`
      )
      .get(normalizedAuthorName) as
      | { messageCount: number; chunkCount: number; lastMessageAt: string }
      | undefined;

    return {
      messageCount: row?.messageCount ?? 0,
      chunkCount: row?.chunkCount ?? 0,
      lastMessageAt: row?.lastMessageAt ?? '',
    };
  }

  upsertAuthorProfile(seed: V0PersonaProfileSeed): V0AuthorProfileRecord {
    const now = toBeijingISOString();
    const statement = this.database.prepare(
      `INSERT INTO v0_author_profiles (
        author_name,
        profile_version,
        status,
        summary_text,
        profile_json,
        evidence_json,
        source_message_count,
        source_chunk_count,
        last_message_at,
        last_built_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(author_name) DO UPDATE SET
        profile_version = excluded.profile_version,
        status = excluded.status,
        summary_text = excluded.summary_text,
        profile_json = excluded.profile_json,
        evidence_json = excluded.evidence_json,
        source_message_count = excluded.source_message_count,
        source_chunk_count = excluded.source_chunk_count,
        last_message_at = excluded.last_message_at,
        last_built_at = excluded.last_built_at,
        updated_at = excluded.updated_at`
    );

    statement.run(
      seed.authorName,
      seed.profileVersion,
      seed.status,
      seed.summaryText,
      seed.profileJson,
      seed.evidenceJson,
      seed.sourceMessageCount,
      seed.sourceChunkCount,
      seed.lastMessageAt,
      seed.lastBuiltAt,
      now,
      now
    );

    return this.getAuthorProfile(seed.authorName) as V0AuthorProfileRecord;
  }

  getAuthorProfile(authorName: string): V0AuthorProfileRecord | null {
    const normalizedAuthorName = normalizeAuthorName(authorName);
    const row = this.database
      .prepare(
        `SELECT
          id,
          author_name AS authorName,
          profile_version AS profileVersion,
          status,
          summary_text AS summaryText,
          profile_json AS profileJson,
          evidence_json AS evidenceJson,
          source_message_count AS sourceMessageCount,
          source_chunk_count AS sourceChunkCount,
          last_message_at AS lastMessageAt,
          last_built_at AS lastBuiltAt,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM v0_author_profiles
         WHERE LOWER(REPLACE(author_name, 'UID:', '')) = ?`
      )
      .get(normalizedAuthorName) as V0AuthorProfileRecord | undefined;

    return row ?? null;
  }

  createProfileRun(seed: V0PersonaRunSeed): number {
    const startedAt = toBeijingISOString();
    const result = this.database
      .prepare(
        `INSERT INTO v0_profile_runs (
          author_name,
          trigger_source,
          status,
          started_at,
          finished_at,
          summary_text,
          error_message,
          metadata_json
        ) VALUES (?, ?, 'running', ?, NULL, '', '', '{}')`
      )
      .run(seed.authorName, seed.triggerSource, startedAt);

    return Number(result.lastInsertRowid);
  }

  completeProfileRun(
    profileRunId: number,
    payload: {
      status: 'success' | 'failed';
      summaryText?: string;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    this.database
      .prepare(
        `UPDATE v0_profile_runs
         SET status = ?,
             finished_at = ?,
             summary_text = ?,
             error_message = ?,
             metadata_json = ?
         WHERE id = ?`
      )
      .run(
        payload.status,
        toBeijingISOString(),
        payload.summaryText ?? '',
        payload.errorMessage ?? '',
        JSON.stringify(payload.metadata ?? {}),
        profileRunId
      );
  }

  getLatestProfileRun(authorName: string): V0ProfileRunRecord | null {
    const row = this.database
      .prepare(
        `SELECT
          id,
          author_name AS authorName,
          trigger_source AS triggerSource,
          status,
          started_at AS startedAt,
          finished_at AS finishedAt,
          summary_text AS summaryText,
          error_message AS errorMessage,
          metadata_json AS metadataJson
         FROM v0_profile_runs
         WHERE author_name = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(authorName) as V0ProfileRunRecord | undefined;

    return row ?? null;
  }

  private safeEmbeddingDim(value: string): number {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
}
