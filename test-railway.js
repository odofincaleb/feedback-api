const https = require('https');

const testRailway = async () => {
  const url = 'https://ai-content-assistant-production.up.railway.app/api/health';
  
  console.log('Testing Railway deployment...');
  console.log(`URL: ${url}`);
  
  const options = {
    hostname: 'ai-content-assistant-production.up.railway.app',
    port: 443,
    path: '/api/health',
    method: 'GET',
    headers: {
      'User-Agent': 'Test-Script'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response:', data);
    });
  });

  req.on('error', (error) => {
    console.error('Error:', error);
  });

  req.end();
};

testRailway();

