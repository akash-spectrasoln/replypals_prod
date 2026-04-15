const http = require('http');

console.log('Testing ReplyPals API...');

const API_BASE = 'http://localhost:8150';

function post(endpoint, data) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const req = http.request(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': json.length }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

async function runTests() {
  try {
    console.log('[TEST] Checking Rewrite Endpoint...');
    const rwStart = Date.now();
    const rw = await post('/rewrite', { 
      text: 'I am writing to see if we can maybe meet tomorrow if you are not busy.',
      tone: 'Confident',
      language: 'en'
    });
    console.log(`✅ Rewrite Pass (${Date.now() - rwStart}ms). Output:`, rw.rewritten);
    
    console.log('[TEST] Checking Generate Endpoint...');
    const genStart = Date.now();
    const gen = await post('/generate', {
      prompt: 'Write a leave request email for 26th and 7th to my manager',
      tone: 'Formal'
    });
    console.log(`✅ Generate Pass (${Date.now() - genStart}ms). Score:`, gen.score);
    
    console.log('✅ ALL API TESTS COMPLETED!');
  } catch (err) {
    if (err.message.includes('ECONNREFUSED')) {
      console.log('⚠️ API server not running locally. Skipping API integration tests.');
    } else {
      console.error('❌ API TEST FAILED:', err.message);
      process.exit(1);
    }
  }
}

runTests();
