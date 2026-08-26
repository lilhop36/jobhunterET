const https = require('https');

const BOT_TOKEN = '8956215588:AAGzpc4IuhCXURDmbKZiUAXwLmPZq5gWSZI';

function callApi(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`Raw response (${res.statusCode}): ${body.slice(0, 200)}`);
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== TELEGRAM BOT TEST ===\n');

  const me = await callApi('getMe', {});
  console.log('getMe result:', JSON.stringify(me).slice(0, 300));

  await Promise.resolve();
}

main().catch(e => console.error(e));
