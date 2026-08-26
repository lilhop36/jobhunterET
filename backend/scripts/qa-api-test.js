const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function api(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3210' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== API ENDPOINTS ===');
  
  // Try common endpoints
  const endpoints = [
    '/health',
    '/api/health',
    '/sources',
    '/api/sources',
    '/jobs',
    '/api/jobs',
    '/users',
    '/api/users',
    '/matches',
    '/api/matches',
    '/notifications',
    '/api/notifications',
    '/dashboard',
    '/api/dashboard',
  ];
  
  for (const ep of endpoints) {
    try {
      const r = await api(ep);
      if (r.status < 400) {
        console.log(`GET ${ep} -> ${r.status}`);
        if (r.body && typeof r.body === 'object') {
          if (r.body.data) console.log('  data keys:', Object.keys(r.body.data).slice(0, 10).join(', '));
          else if (Array.isArray(r.body)) console.log('  array length:', r.body.length);
          else console.log('  keys:', Object.keys(r.body).slice(0, 10).join(', '));
        }
      }
    } catch (e) {
      console.log(`GET ${ep} -> ERROR: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
