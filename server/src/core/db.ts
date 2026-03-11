import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(__dirname, '../../data/stock.db');
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize Tables
db.exec(`
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

export default db;
