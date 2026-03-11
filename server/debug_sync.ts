import db from './src/core/db';
import { SyncService } from './src/core/sync';
import { StockService } from './src/core/stock';

const run = async () => {
    const code = 'sz002261';
    
    console.log('=== STEP 1: Check Current DB Data ===');
    const rows = db.prepare('SELECT * FROM kline_day WHERE code = ? ORDER BY date DESC LIMIT 5').all(code);
    console.table(rows);
    
    console.log('\n=== STEP 2: Fetch Live Data from EastMoney ===');
    const stockService = new StockService();
    const klines = await stockService.getKlineData(code, 'day');
    console.log(`Fetched ${klines.length} records.`);
    if (klines.length > 0) {
        console.log('Latest 5 records from API:');
        console.table(klines.slice(-5));
    }
    
    console.log('\n=== STEP 3: Trigger Sync for this stock ===');
    // Manually insert into DB using same logic as SyncService
    const stmtInsertKline = db.prepare('INSERT OR REPLACE INTO kline_day (code, date, open, close, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)');
    
    const insertMany = db.transaction((data: any[]) => {
        for (const k of data) {
            stmtInsertKline.run(code, k.time, k.open, k.close, k.high, k.low, k.volume);
        }
    });
    
    insertMany(klines);
    console.log('Sync executed.');
    
    console.log('\n=== STEP 4: Check DB Data After Sync ===');
    const newRows = db.prepare('SELECT * FROM kline_day WHERE code = ? ORDER BY date DESC LIMIT 5').all(code);
    console.table(newRows);
};

run();
