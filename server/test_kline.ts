import { StockService } from './src/core/stock';

const run = async () => {
    const service = new StockService();
    const code = 'sz002261'; // 拓维信息
    
    console.log(`Fetching K-line for ${code}...`);
    const kline = await service.getKlineData(code, 'day');
    
    if (kline.length > 0) {
        console.log('Last 5 days data:');
        console.table(kline.slice(-5));
    } else {
        console.log('No data returned.');
    }
};

run();
