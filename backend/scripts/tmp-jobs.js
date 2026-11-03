const BASE = 'http://localhost:3210';
(async () => {
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'phase8-e2e-1793691031681@jobhunter.et', password: 'password123' }) }).then(r => r.json());
  const t = login.accessToken;
  const jobs = await fetch(BASE + '/api/jobs?limit=6', { headers: { authorization: `Bearer ${t}` } }).then(r => r.json());
  console.log(JSON.stringify((jobs.items || []).map(j => ({ id: j.id, title: j.title.slice(0, 40), company: j.company })), null, 1));
})();
