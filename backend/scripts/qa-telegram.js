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

  // Get bot info
  const me = await callApi('getMe');
  console.log('Bot info:', JSON.stringify(me.result, null, 2));

  // Get updates
  const updates = await callApi('getUpdates', { offset: 0, limit: 10, timeout: 1 });
  console.log('\nRecent updates:', JSON.stringify(updates.result, null, 2));

  // Check if bot is polling
  const webhook = await callApi('getWebhookInfo');
  console.log('\nWebhook info:', JSON.stringify(webhook.result, null, 2));

  await Promise.resolve();
}

main().catch(e => console.error(e));
