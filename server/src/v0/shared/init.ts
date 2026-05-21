import Database from 'better-sqlite3';

const ensureColumn = (
  database: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
): void => {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
};

const normalizeUtcColumnToBeijing = (
  database: Database.Database,
  tableName: string,
  columnName: string
): void => {
  database
    .prepare(
      `UPDATE ${tableName}
       SET ${columnName} = strftime('%Y-%m-%dT%H:%M:%f', ${columnName}, '+8 hours') || '+08:00'
       WHERE ${columnName} LIKE '%Z'`
    )
    .run();
};

export const initV0Tables = (database: Database.Database): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS v0_thread_configs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      thread_url TEXT NOT NULL DEFAULT '',
      thread_title TEXT NOT NULL DEFAULT '',
      nga_cookie TEXT NOT NULL DEFAULT '',
      poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      push_enabled INTEGER NOT NULL DEFAULT 1,
      push_channel TEXT NOT NULL DEFAULT 'console',
      push_webhook_url TEXT NOT NULL DEFAULT '',
      push_secret TEXT NOT NULL DEFAULT '',
      digest_enabled INTEGER NOT NULL DEFAULT 0,
      digest_cron TEXT NOT NULL DEFAULT '0 18 * * *',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v0_author_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL UNIQUE,
      alias TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v0_thread_cursors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_key TEXT NOT NULL UNIQUE,
      last_floor_id TEXT NOT NULL DEFAULT '',
      last_posted_at TEXT NOT NULL DEFAULT '',
      last_content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v0_thread_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_key TEXT NOT NULL,
      thread_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      html_content TEXT NOT NULL,
      html_hash TEXT NOT NULL,
      parsed_message_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_v0_thread_snapshots_thread_key
      ON v0_thread_snapshots(thread_key);

    CREATE INDEX IF NOT EXISTS idx_v0_thread_snapshots_fetched_at
      ON v0_thread_snapshots(fetched_at);

    CREATE TABLE IF NOT EXISTS v0_forum_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_key TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      posted_at TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL,
      normalized_content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_url TEXT NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 1,
      insight_status TEXT NOT NULL DEFAULT 'pending',
      insight_error TEXT NOT NULL DEFAULT '',
      enriched_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_v0_messages_unique
      ON v0_forum_messages(thread_key, floor_id);

    CREATE INDEX IF NOT EXISTS idx_v0_messages_created_at
      ON v0_forum_messages(created_at);

    CREATE INDEX IF NOT EXISTS idx_v0_messages_posted_at
      ON v0_forum_messages(posted_at);

    CREATE TABLE IF NOT EXISTS v0_message_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      thread_key TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_hash TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_posted_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_v0_message_chunks_unique
      ON v0_message_chunks(message_id, chunk_index);

    CREATE INDEX IF NOT EXISTS idx_v0_message_chunks_author
      ON v0_message_chunks(author_name, created_at);

    CREATE INDEX IF NOT EXISTS idx_v0_message_chunks_thread
      ON v0_message_chunks(thread_key, created_at);

    CREATE TABLE IF NOT EXISTS v0_message_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id INTEGER NOT NULL UNIQUE,
      model_name TEXT NOT NULL,
      embedding_json TEXT NOT NULL DEFAULT '[]',
      embedding_dim INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v0_message_embeddings_status
      ON v0_message_embeddings(status);

    CREATE INDEX IF NOT EXISTS idx_v0_message_embeddings_model
      ON v0_message_embeddings(model_name);

    CREATE TABLE IF NOT EXISTS v0_author_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL UNIQUE,
      profile_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      summary_text TEXT NOT NULL DEFAULT '',
      profile_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      source_message_count INTEGER NOT NULL DEFAULT 0,
      source_chunk_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT '',
      last_built_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v0_author_profiles_status
      ON v0_author_profiles(status);

    CREATE TABLE IF NOT EXISTS v0_profile_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary_text TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_v0_profile_runs_author
      ON v0_profile_runs(author_name);

    CREATE INDEX IF NOT EXISTS idx_v0_profile_runs_started_at
      ON v0_profile_runs(started_at);

    CREATE TABLE IF NOT EXISTS v0_message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      normalized_code TEXT,
      confidence REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_v0_mentions_message_id
      ON v0_message_mentions(message_id);

    CREATE TABLE IF NOT EXISTS v0_message_market_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      subject_type TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      advice_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v0_market_state_message_id
      ON v0_message_market_state(message_id);

    CREATE TABLE IF NOT EXISTS v0_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      sent_at TEXT,
      payload_json TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v0_notifications_message_id
      ON v0_notifications(message_id);

    CREATE INDEX IF NOT EXISTS idx_v0_notifications_created_at
      ON v0_notifications(created_at);

    CREATE TABLE IF NOT EXISTS v0_daily_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_date TEXT NOT NULL UNIQUE,
      content_markdown TEXT NOT NULL,
      status TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_v0_daily_digests_digest_date
      ON v0_daily_digests(digest_date);

    CREATE TABLE IF NOT EXISTS v0_job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary_text TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_v0_job_runs_job_type
      ON v0_job_runs(job_type);

    CREATE INDEX IF NOT EXISTS idx_v0_job_runs_started_at
      ON v0_job_runs(started_at);
  `);

  ensureColumn(database, 'v0_thread_configs', 'push_channel', "TEXT NOT NULL DEFAULT 'console'");
  ensureColumn(database, 'v0_thread_configs', 'push_webhook_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'v0_thread_configs', 'push_secret', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'v0_thread_configs', 'nga_cookie', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'v0_thread_configs', 'digest_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'v0_thread_configs', 'digest_cron', "TEXT NOT NULL DEFAULT '0 18 * * *'");

  for (const [tableName, columnName] of [
    ['v0_thread_configs', 'created_at'],
    ['v0_thread_configs', 'updated_at'],
    ['v0_author_watchlist', 'created_at'],
    ['v0_thread_cursors', 'updated_at'],
    ['v0_thread_snapshots', 'fetched_at'],
    ['v0_forum_messages', 'created_at'],
    ['v0_forum_messages', 'enriched_at'],
    ['v0_message_chunks', 'created_at'],
    ['v0_message_chunks', 'updated_at'],
    ['v0_message_embeddings', 'created_at'],
    ['v0_message_embeddings', 'updated_at'],
    ['v0_author_profiles', 'last_built_at'],
    ['v0_author_profiles', 'created_at'],
    ['v0_author_profiles', 'updated_at'],
    ['v0_profile_runs', 'started_at'],
    ['v0_profile_runs', 'finished_at'],
    ['v0_message_market_state', 'created_at'],
    ['v0_notifications', 'sent_at'],
    ['v0_notifications', 'created_at'],
    ['v0_daily_digests', 'sent_at'],
    ['v0_daily_digests', 'created_at'],
    ['v0_daily_digests', 'updated_at'],
    ['v0_job_runs', 'started_at'],
    ['v0_job_runs', 'finished_at'],
  ] as const) {
    normalizeUtcColumnToBeijing(database, tableName, columnName);
  }
};
