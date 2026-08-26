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
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
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
  const login = await api('POST', '/auth/login', { email: 'abdigaboma@gmail.com', password: 'demo1234' });
  console.log('Login status:', login.status);
  if (login.status === 201 && login.body.accessToken) {
    token = login.body.accessToken;
    console.log('JWT obtained: YES');
  } else {
    console.log('JWT obtained: NO');
    console.log('Response:', JSON.stringify(login.body).slice(0, 200));
  }

  // Test sources
  console.log('\n--- SOURCES ---');
  const sources = await api('GET', '/sources');
  console.log('GET /sources status:', sources.status);
  if (sources.status === 200) {
    const srcs = sources.body.data || sources.body;
    console.log('Sources count:', Array.isArray(srcs) ? srcs.length : '?');
  }

  const health = await api('GET', '/sources/health');
  console.log('GET /sources/health status:', health.status);
  if (health.status === 200) {
    const h = health.body.data || health.body;
    if (Array.isArray(h)) {
      for (const s of h) {
        console.log(`  ${s.id}: status=${s.status} health=${s.healthScore} lastOK=${s.lastSuccessfulRun ? 'YES' : 'NO'}`);
      }
    }
  }

  const queueStats = await api('GET', '/sources/queue/stats');
  console.log('GET /sources/queue/stats status:', queueStats.status);
  if (queueStats.status === 200) {
    console.log('Queue:', JSON.stringify(queueStats.body).slice(0, 300));
  }

  // Test jobs
  console.log('\n--- JOBS ---');
  const jobs = await api('GET', '/jobs?limit=5');
  console.log('GET /jobs status:', jobs.status);
  if (jobs.status === 200) {
    const jb = jobs.body.data || jobs.body;
    console.log('Jobs returned:', Array.isArray(jb) ? jb.length : '?');
    if (Array.isArray(jb) && jb[0]) {
      console.log('Sample:', jb[0].title, '|', jb[0].company, '|', jb[0].location, '|', jb[0].workPlace, '|', jb[0].employmentType);
    }
  }

  // Test matches
  console.log('\n--- MATCHES ---');
  const matches = await api('GET', '/matches?limit=5');
  console.log('GET /matches status:', matches.status);
  if (matches.status === 200) {
    const mb = matches.body.data || matches.body;
    console.log('Matches returned:', Array.isArray(mb) ? mb.length : '?');
    if (Array.isArray(mb) && mb[0]) {
      console.log('Sample: score=' + mb[0].score + ' role=' + mb[0].roleScore + ' skill=' + mb[0].skillScore);
    }
  }

  const recalc = await api('POST', '/matches/recalculate');
  console.log('POST /matches/recalculate status:', recalc.status);
  if (recalc.status === 200) {
    console.log('Recalc result:', JSON.stringify(recalc.body).slice(0, 300));
  }

  // Test notifications
  console.log('\n--- NOTIFICATIONS ---');
  const notifs = await api('GET', '/notifications');
  console.log('GET /notifications status:', notifs.status);
  const inbox = await api('GET', '/inbox');
  console.log('GET /inbox status:', inbox.status);
  if (inbox.status === 200) {
    const ib = inbox.body.data || inbox.body;
    console.log('Inbox count:', Array.isArray(ib) ? ib.length : '?');
  }

  const preview = await api('GET', '/settings/notifications-preview?threshold=70');
  console.log('GET /settings/notifications-preview status:', preview.status);
  if (preview.status === 200) {
    console.log('Preview:', JSON.stringify(preview.body).slice(0, 200));
  }

  // Trigger a collection
  console.log('\n--- COLLECTION ---');
  const collect = await api('POST', '/sources/collect-all');
  console.log('POST /sources/collect-all status:', collect.status);
  if (collect.status === 200) {
    console.log('Collect result:', JSON.stringify(collect.body).slice(0, 300));
  }

  // Wait a bit for collection
  await new Promise(r => setTimeout(r, 5000));

  const queueAfter = await api('GET', '/sources/queue/stats');
  console.log('Queue after 5s:', queueAfter.status === 200 ? JSON.stringify(queueAfter.body).slice(0, 300) : queueAfter.status);

  // Database stats after
  console.log('\n--- DATABASE STATS ---');
  const jobCount = await prisma.job.count();
  const activeJobCount = await prisma.job.count({ where: { status: 'ACTIVE' } });
  const removedJobCount = await prisma.job.count({ where: { status: 'REMOVED' } });
  const matchCount = await prisma.jobMatch.count();
  const notifCount = await prisma.notification.count();
  const sourceRunCount = await prisma.sourceRun.count();
  
  console.log('Jobs total:', jobCount);
  console.log('Jobs ACTIVE:', activeJobCount);
  console.log('Jobs REMOVED:', removedJobCount);
  console.log('JobMatches:', matchCount);
  console.log('Notifications:', notifCount);
  console.log('SourceRuns:', sourceRunCount);

  // Check recent source runs
  console.log('\n--- RECENT SOURCE RUNS ---');
  const recentRuns = await prisma.sourceRun.findMany({
    take: 10,
    orderBy: { startedAt: 'desc' },
    select: { sourceId: true, status: true, jobsFetched: true, jobsCreated: true, duplicates: true, errors: true, startedAt: true, errorMessage: true },
  });
  for (const r of recentRuns) {
    console.log(`${r.sourceId} | ${r.status} | fetched=${r.jobsFetched} created=${r.jobsCreated} dupes=${r.duplicates} err=${r.errors} | ${r.startedAt} | ${r.errorMessage || ''}`);
  }

  // Check recent matches
  console.log('\n--- RECENT MATCHES (sample) ---');
  const recentMatches = await prisma.jobMatch.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { job: { select: { title: true, company: true, location: true } } },
  });
  for (const m of recentMatches) {
    console.log(`score=${m.score} | ${m.job.title} | ${m.job.company} | ${m.job.location}`);
  }

  // Check for notifications
  console.log('\n--- NOTIFICATIONS ---');
  const allNotifs = await prisma.notification.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { job: { select: { title: true, company: true } } },
  });
  console.log('Total notifications:', await prisma.notification.count());
  for (const n of allNotifs) {
    console.log(`${n.channel} | ${n.status} | score=${n.score} | ${n.job.title} | ${n.sentAt}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
