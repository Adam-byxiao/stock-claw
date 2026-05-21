import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const resolveDatabasePath = (explicitPath?: string): string => {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (process.env.STOCK_CLAW_DB_PATH) {
    return path.resolve(process.env.STOCK_CLAW_DB_PATH);
  }

  return path.resolve(__dirname, '../../data/stock.db');
};

export const ensureDatabaseDirectory = (databasePath: string): void => {
  const dataDir = path.dirname(databasePath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

export const initCoreTables = (database: Database.Database): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      code TEXT PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS kline_day (
      code TEXT,
      date TEXT,
      open REAL,
      close REAL,
      high REAL,
      low REAL,
      volume REAL,
      PRIMARY KEY (code, date)
    );

    CREATE INDEX IF NOT EXISTS idx_kline_code ON kline_day(code);
    CREATE INDEX IF NOT EXISTS idx_kline_date ON kline_day(date);
  `);
};

export const createAppDatabase = (explicitPath?: string): Database.Database => {
  const databasePath = resolveDatabasePath(explicitPath);
  ensureDatabaseDirectory(databasePath);

  const database = new Database(databasePath);
  initCoreTables(database);

  return database;
};

let defaultDatabase: Database.Database | null = null;

export const getDefaultDatabase = (): Database.Database => {
  if (!defaultDatabase) {
    defaultDatabase = createAppDatabase();
  }

  return defaultDatabase;
};

const db = new Proxy({} as Database.Database, {
  get(_target, property, receiver) {
    const database = getDefaultDatabase() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(database, property, receiver);

    if (typeof value === 'function') {
      return (value as Function).bind(database);
    }

    return value;
  },
}) as Database.Database;

export default db;
