import Database from 'better-sqlite3';
import { toBeijingISOString } from './time';
import { V0JobRunRecord } from './types';

type JobType = V0JobRunRecord['jobType'];
type TriggerSource = V0JobRunRecord['triggerSource'];
type JobStatus = V0JobRunRecord['status'];

interface CompleteJobRunPayload {
  status: Extract<JobStatus, 'success' | 'failed'>;
  summaryText?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export class V0JobRunStore {
  constructor(private readonly database: Database.Database) {}

  startJobRun(jobType: JobType, triggerSource: TriggerSource): number {
    const startedAt = toBeijingISOString();
    const result = this.database
      .prepare(
        `INSERT INTO v0_job_runs (
          job_type,
          trigger_source,
          status,
          started_at,
          finished_at,
          summary_text,
          error_message,
          metadata_json
        ) VALUES (?, ?, 'running', ?, NULL, '', '', '{}')`
      )
      .run(jobType, triggerSource, startedAt);

    return Number(result.lastInsertRowid);
  }

  completeJobRun(jobRunId: number, payload: CompleteJobRunPayload): void {
    this.database
      .prepare(
        `UPDATE v0_job_runs
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
        jobRunId
      );
  }

  async executeJob<T>(
    jobType: JobType,
    triggerSource: TriggerSource,
    executor: () => Promise<{
      result: T;
      summaryText?: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<T> {
    const jobRunId = this.startJobRun(jobType, triggerSource);

    try {
      const { result, summaryText, metadata } = await executor();
      this.completeJobRun(jobRunId, {
        status: 'success',
        summaryText,
        metadata,
      });
      return result;
    } catch (error) {
      this.completeJobRun(jobRunId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'unknown job error',
      });
      throw error;
    }
  }

  getRecentRuns(limit = 20): V0JobRunRecord[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

    return this.database
      .prepare(
        `SELECT
          id,
          job_type AS jobType,
          trigger_source AS triggerSource,
          status,
          started_at AS startedAt,
          finished_at AS finishedAt,
          summary_text AS summaryText,
          error_message AS errorMessage,
          metadata_json AS metadataJson
        FROM v0_job_runs
        ORDER BY id DESC
        LIMIT ?`
      )
      .all(safeLimit) as V0JobRunRecord[];
  }

  getLatestRun(jobType: JobType): V0JobRunRecord | null {
    const row = this.database
      .prepare(
        `SELECT
          id,
          job_type AS jobType,
          trigger_source AS triggerSource,
          status,
          started_at AS startedAt,
          finished_at AS finishedAt,
          summary_text AS summaryText,
          error_message AS errorMessage,
          metadata_json AS metadataJson
        FROM v0_job_runs
        WHERE job_type = ?
        ORDER BY id DESC
        LIMIT 1`
      )
      .get(jobType) as V0JobRunRecord | undefined;

    return row ?? null;
  }
}
