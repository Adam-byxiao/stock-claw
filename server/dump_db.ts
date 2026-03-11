import db from './src/core/db';
import fs from 'fs';

const code = 'sz002261';
const rows = db.prepare('SELECT * FROM kline_day WHERE code = ? ORDER BY date ASC').all(code);

const output = JSON.stringify(rows, null, 2);
fs.writeFileSync('sz002261_dump.json', output);

console.log(`Dumped ${rows.length} records to sz002261_dump.json`);
