import { LLMService } from '../src/core/llm';
import dotenv from 'dotenv';
import path from 'path';

// Load env from server root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function testLLM() {
  console.log('--- Starting LLM Connectivity Test ---');
  console.log(`API Key: ${process.env.LLM_API_KEY ? '******' + process.env.LLM_API_KEY.slice(-4) : 'Not Set'}`);
  console.log(`Base URL: ${process.env.LLM_BASE_URL}`);
  console.log(`Model: ${process.env.LLM_MODEL}`);

  const llm = new LLMService();

  try {
    console.log('\n1. Testing simple chat completion...');
    const startTime = Date.now();
    const response = await llm.chat([
        { role: 'user', content: 'Hello, are you working? Reply with "Yes, I am online."' }
    ]);
    const duration = Date.now() - startTime;
    
    console.log(`Response received in ${duration}ms:`);
    console.log(`>> "${response}"`);
    
    if (response && response.length > 0) {
        console.log('✅ Chat test passed.');
    } else {
        console.error('❌ Chat test failed: Empty response.');
    }

  } catch (error) {
    console.error('❌ LLM Test Error:', error);
  }
}

testLLM();
