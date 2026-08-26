const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

let token = null;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('http://localhost:3210' + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== JOBHUNTER REAL-DATA QA ===\n');

  // Login
  console.log('--- AUTH ---');
  const login = await api('POST', '/auth/login', { email: 'admin@jobhunter.et', password: 'demo1234' });
  console.log('Login status:', login.status);
  if (login.status === 200 && login.body.access_token) {
    token = login.body.access_token;
    console.log('JWT obtained: YES');
  } else {
    console.log('JWT obtained: NO');
    console.log('Login response:', JSON.stringify(login.body).slice(0, 200));
  }

  // Test sources endpoint
  console.log('\n--- SOURCES ---');
  const sources = await api('GET', '/sources');
  console.log('GET /sources status:', sources.status);
  if (sources.status === 200) {
    console.log('Sources count:', sources.body.data?.length || sources.body.length || '?');
  }

  // Test source health
  const health = await api('GET', '/sources/health');
  console.log('GET /sources/health status:', health.status);

  // Test queue stats
  const queueStats = await api('GET', '/sources/queue/stats');
  console.log('GET /sources/queue/stats status:', queueStats.status);
  if (queueStats.status === 200) {
    console.log('Queue stats:', JSON.stringify(queueStats.body).slice(0, 200));
  }

  // Test jobs listing
  console.log('\n--- JOBS ---');
  const jobs = await api('GET', '/jobs?limit=5');
  console.log('GET /jobs status:', jobs.status);
  if (jobs.status === 200) {
    console.log('Jobs returned:', jobs.body.data?.length || jobs.body.length || '?');
    if (jobs.body.data && jobs.body.data.length > 0) {
      const j = jobs.body.data[0];
      console.log('Sample job:', j.title, '|', j.company, '|', j.location, '|', j.workPlace);
    }
  }

  // Test matches
  console.log('\n--- MATCHES ---');
  const matches = await api('GET', '/matches?limit=5');
  console.log('GET /matches status:', matches.status);
  if (matches.status === 200) {
    console.log('Matches returned:', matches.body.data?.length || matches.body.length || '?');
    if (matches.body.data && matches.body.data.length > 0) {
      const m = matches.body.data[0];
      console.log('Sample match: score=' + m.score + ' | job=' + (m.job?.title || m.jobId));
    }
  }

  // Test notifications
  console.log('\n--- NOTIFICATIONS ---');
  const notifs = await api('GET', '/notifications');
  console.log('GET /notifications status:', notifs.status);
  if (notifs.status === 200) {
    console.log('Notifications returned:', notifs.body.data?.length || notifs.body.length || '?');
  }

  const inbox = await api('GET', '/inbox');
  console.log('GET /inbox status:', inbox.status);
  if (inbox.status === 200) {
    console.log('Inbox returned:', inbox.body.data?.length || inbox.body.length || '?');
  }

  // Database stats
  console.log('\n--- DATABASE STATS ---');
  const jobCount = await prisma.job.count();
  const activeJobCount = await prisma.job.count({ where: { status: 'ACTIVE' } });
  const removedJobCount = await prisma.job.count({ where: { status: 'REMOVED' } });
  const matchCount = await prisma.jobMatch.count();
  const userCount = await prisma.user.count();
  const sourceCount = await prisma.jobSource.count();
  const notifCount = await prisma.notification.count();
  
  console.log('Jobs total:', jobCount);
  console.log('Jobs ACTIVE:', activeJobCount);
  console.log('Jobs REMOVED:', removedJobCount);
  console.log('JobMatches:', matchCount);
  console.log('Users:', userCount);
  console.log('Sources:', sourceCount);
  console.log('Notifications:', notifCount);

  // Source breakdown
  console.log('\n--- SOURCE BREAKDOWN ---');
  const sourcesDb = await prisma.jobSource.findMany({
    include: {
      _count: { select: { jobs: true } },
    },
  });
  for (const s of sourcesDb) {
    const activeCount = await prisma.job.count({ where: { sourceId: s.id, status: 'ACTIVE' } });
    const removedCount = await prisma.job.count({ where: { sourceId: s.id, status: 'REMOVED' } });
    console.log(`${s.id}: ${s.name} | status=${s.status} | health=${s.healthScore} | active=${activeCount} | removed=${removedCount} | lastOK=${s.lastSuccessfulRun}`);
  }

  // Check if Telegram bot is configured
  console.log('\n--- TELEGRAM ---');
  const tgConfigured = process.env.TELEGRAM_BOT_TOKEN ? 'YES' : 'NO';
  console.log('Bot token present:', tgConfigured);
  console.log('Bot username:', process.env.TELEGRAM_BOT_USERNAME || 'NOT SET');
  
  const tgLinks = await prisma.telegramLink.count();
  console.log('Telegram links:', tgLinks);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
