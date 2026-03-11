
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, 'data', 'stock.db');
const db = new Database(dbPath);

const code = 'sz002261';
console.log(`Dumping data for ${code}...`);

// Get all data
const rows = db.prepare('SELECT * FROM kline_day WHERE code = ? ORDER BY date ASC').all(code);

const outputPath = path.join(__dirname, 'sz002261_full_dump.json');
fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));

console.log(`Total records: ${rows.length}`);
console.log(`Data saved to ${outputPath}`);

// Show first 3 and last 3
if (rows.length > 0) {
    console.log('First 3 records:', rows.slice(0, 3));
    console.log('Last 3 records:', rows.slice(-3));
}
