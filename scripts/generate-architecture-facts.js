#!/usr/bin/env node
/**
 * Generate the volatile architecture facts for JobHunter from code.
 *
 * The prose in the architecture docs is maintained by hand; counts, model
 * names, adapter inventories, route lists and test counts are not. They are
 * derived here and written into marker-delimited blocks so they cannot drift
 * silently.
 *
 * Usage:
 *   node scripts/generate-architecture-facts.js           # write
 *   node scripts/generate-architecture-facts.js --check   # verify, exit 1 if stale
 *
 * Files written:
 *   docs/architecture-facts.json
 *   docs/architecture-facts.md
 *   marker block in docs/architecture-overview.md
 *   marker block in docs/traceability.md
 *   marker block in README.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'coverage', '.turbo', 'uploads', 'backups',
]);

function walk(relDir, filter, out = []) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(relDir, entry.name), filter, out);
    } else if (filter(entry.name, path.join(relDir, entry.name))) {
      out.push(path.join(relDir, entry.name).replace(/\\/g, '/'));
    }
  }
  return out;
}

function shortVersion(range) {
  if (!range) return 'unknown';
  return String(range).replace(/^[^0-9]*/, '').split('.').slice(0, 2).join('.');
}

function countTestDeclarations(text) {
  return (text.match(/^\s*(it|test)(\.each)?\s*\(/gm) || []).length;
}

function parseCiJobs() {
  const lines = read('.github/workflows/ci.yml').split(/\r?\n/);
  const jobs = [];
  let inJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(line)) break; // next top-level key
    const match = inJobs && line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) jobs.push(match[1]);
  }
  return jobs;
}

function collect() {
  const schema = read('backend/prisma/schema.prisma');
  const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  const provider = (schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/) || [])[1] || 'unknown';

  const moduleFiles = walk('backend/src', (name) => name.endsWith('.module.ts'));
  const featureModules = moduleFiles
    .filter((file) => /^backend\/src\/modules\/[^/]+\/[^/]+\.module\.ts$/.test(file))
    .map((file) => path.basename(path.dirname(file)))
    .sort();

  const specFiles = walk('backend/src', (name) => name.endsWith('.spec.ts')).sort();
  const tests = specFiles
    .map((file) => ({ file: path.basename(file), declarations: countTestDeclarations(read(file)) }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const testDeclarations = tests.reduce((sum, item) => sum + item.declarations, 0);

  const routes = walk('frontend/app', (name) => name === 'page.tsx')
    .map((file) => {
      const rel = file.replace(/^frontend\/app/, '').replace(/\/page\.tsx$/, '');
      return rel === '' ? '/' : rel;
    })
    .sort();

  const sourceConfigs = readJson('backend/src/modules/sources/source-configs.json');
  const webSources = (sourceConfigs.sources || []).map((s) => ({
    id: s.id,
    name: s.name,
    adapter: s.adapter,
    frequencyMinutes: s.frequency,
  }));

  const telegramConfig = read('backend/src/modules/sources/adapters/telegram-channels.config.ts');
  const telegramChannels = [...telegramConfig.matchAll(/sourceId:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)'/g)]
    .map((m) => ({ sourceId: m[1], name: m[2] }));

  const adapterClasses = fs.readdirSync(path.join(ROOT, 'backend/src/modules/sources/adapters'))
    .filter((name) => name.endsWith('.adapter.ts') && name !== 'job-source.adapter.ts')
    .sort();

  const knowledgeBase = readJson('backend/src/modules/matching/knowledge-base.json');
  const matchingEngine = read('backend/src/modules/matching/matching-engine.ts');
  const weights = {};
  for (const m of matchingEngine.matchAll(/\{\s*label:\s*'([^']+)',\s*weight:\s*(\d+)/g)) {
    weights[m[1]] = Number(m[2]);
  }
  const matchCycleDefault = (read('backend/src/modules/lifecycle/lifecycle.tasks.ts')
    .match(/MATCH_CYCLE_INTERVAL[^\n]*default\s+(\d+m)/i) || [])[1] || 'unknown';

  const backendPkg = readJson('backend/package.json');
  const frontendPkg = readJson('frontend/package.json');
  const stack = {
    next: shortVersion(frontendPkg.dependencies.next),
    react: shortVersion(frontendPkg.dependencies.react),
    nestjs: shortVersion(backendPkg.dependencies['@nestjs/core']),
    prisma: shortVersion(backendPkg.dependencies.prisma || backendPkg.devDependencies?.prisma),
    typescript: shortVersion(backendPkg.devDependencies?.typescript || backendPkg.dependencies?.typescript),
  };

  const compose = read('docker-compose.yml');
  const composeDb = (compose.match(/DATABASE_URL=([^\s]+)/) || [])[1] || 'unknown';

  const ciJobs = parseCiJobs();

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/generate-architecture-facts.js',
    stack,
    database: {
      authoritative: 'sqlite',
      prismaProvider: provider,
      dockerDatabaseUrl: composeDb,
      postgresql: 'optional / not the current production target',
    },
    prisma: { modelCount: models.length, models },
    backend: {
      featureModuleCount: featureModules.length,
      featureModules,
      moduleFileCount: moduleFiles.length,
      specFileCount: tests.length,
      testDeclarations,
      tests,
    },
    frontend: { routeCount: routes.length, routes },
    sources: {
      webCount: webSources.length,
      webSources,
      telegramCount: telegramChannels.length,
      telegramChannels,
      adapterClassCount: adapterClasses.length,
      adapterClasses,
      endpointCount: webSources.length + telegramChannels.length,
    },
    knowledgeBase: {
      skills: Object.keys(knowledgeBase.skills || {}).length,
      aliases: Object.keys(knowledgeBase.aliases || {}).length,
      roleProfiles: Object.keys(knowledgeBase.roleProfiles || {}).length,
      roleSynonyms: Object.keys(knowledgeBase.roleSynonyms || {}).length,
      relationships: (knowledgeBase.relationships || []).length,
    },
    matching: { weights, matchCycleDefault },
    ci: { jobCount: ciJobs.length, jobs: ciJobs },
  };
}

const facts = collect();

const overviewRows = [
  ['Stack', `Next.js ${facts.stack.next}, React ${facts.stack.react}, NestJS ${facts.stack.nestjs}, Prisma ${facts.stack.prisma}, TypeScript ${facts.stack.typescript}`],
  ['Production database', `SQLite (Prisma provider: ${facts.database.prismaProvider}; Docker URL: \`${facts.database.dockerDatabaseUrl}\`)`],
  ['Prisma models', `${facts.prisma.modelCount} — ${facts.prisma.models.join(', ')}`],
  ['NestJS feature modules', `${facts.backend.featureModuleCount} — ${facts.backend.featureModules.join(', ')}`],
  ['Frontend page routes', `${facts.frontend.routeCount}`],
  ['Web job sources', `${facts.sources.webCount} — ${facts.sources.webSources.map((s) => s.name).join(', ')}`],
  ['Telegram channels', `${facts.sources.telegramCount} — ${facts.sources.telegramChannels.map((s) => s.name).join(', ')}`],
  ['Adapter classes', `${facts.sources.adapterClassCount} (${facts.sources.webCount} web + 1 parameterized Telegram)`],
  ['Collection endpoints', `${facts.sources.endpointCount} (${facts.sources.webCount} web + ${facts.sources.telegramCount} Telegram)`],
  ['Test spec files', `${facts.backend.specFileCount} (${facts.backend.testDeclarations} \`it\`/\`test\` declarations; parameterized cases expand at runtime)`],
  ['CI jobs', `${facts.ci.jobCount} — ${facts.ci.jobs.join(', ')}`],
];

const overviewBlock = [
  '<!-- BEGIN GENERATED OVERVIEW FACTS -->',
  '<!-- Generated from source by scripts/generate-architecture-facts.js. Do not edit by hand. -->',
  '',
  '| Fact | Current value |',
  '|---|---|',
  ...overviewRows.map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '<!-- END GENERATED OVERVIEW FACTS -->',
].join('\n');

const testBlock = [
  '<!-- BEGIN GENERATED TEST INDEX -->',
  '<!-- Generated from the spec tree. Do not edit by hand. -->',
  '',
  '| File | Declarations |',
  '|---|---:|',
  ...facts.backend.tests.map((t) => `| ${t.file} | ${t.declarations} |`),
  `| **Total** | **${facts.backend.testDeclarations}** |`,
  '',
  '<!-- END GENERATED TEST INDEX -->',
].join('\n');

const projectRows = [
  ['Stack', `Next.js ${facts.stack.next}, React ${facts.stack.react}, NestJS ${facts.stack.nestjs}, Prisma ${facts.stack.prisma}, TypeScript ${facts.stack.typescript}`],
  ['Database', `SQLite (authoritative, single-node)`],
  ['Job sources', `${facts.sources.webCount} web sources + ${facts.sources.telegramCount} Telegram channels (${facts.sources.adapterClassCount} adapter classes)`],
  ['Backend', `${facts.backend.featureModuleCount} feature modules, ${facts.backend.specFileCount} spec files / ${facts.backend.testDeclarations} test declarations`],
  ['Frontend', `${facts.frontend.routeCount} page routes`],
  ['CI', `${facts.ci.jobCount} jobs`],
];

const projectBlock = [
  '<!-- BEGIN GENERATED PROJECT FACTS -->',
  '<!-- Generated from source by scripts/generate-architecture-facts.js. Do not edit by hand. -->',
  '',
  '| Fact | Current value |',
  '|---|---|',
  ...projectRows.map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '<!-- END GENERATED PROJECT FACTS -->',
].join('\n');

const factsMarkdown = [
  '# Architecture Facts (generated)',
  '',
  '> Generated from source by `scripts/generate-architecture-facts.js`. Do not edit by hand.',
  '> Regenerate with `npm run facts:generate`; verify with `npm run facts:check`.',
  '',
  '## Stack',
  '| Component | Version |',
  '|---|---|',
  `| Next.js | ${facts.stack.next} |`,
  `| React | ${facts.stack.react} |`,
  `| NestJS | ${facts.stack.nestjs} |`,
  `| Prisma | ${facts.stack.prisma} |`,
  `| TypeScript | ${facts.stack.typescript} |`,
  '',
  '## Database',
  '',
  `- Authoritative production database: **${facts.database.authoritative}**.`,
  `- Prisma provider in \`schema.prisma\`: \`${facts.database.prismaProvider}\`.`,
  `- Docker \`DATABASE_URL\`: \`${facts.database.dockerDatabaseUrl}\`.`,
  `- PostgreSQL: ${facts.database.postgresql}.`,
  '',
  '## Inventory',
  '| Fact | Value |',
  '|---|---|',
  `| Prisma models | ${facts.prisma.modelCount} |`,
  `| NestJS feature modules | ${facts.backend.featureModuleCount} |`,
  `| Frontend page routes | ${facts.frontend.routeCount} |`,
  `| Web job sources | ${facts.sources.webCount} |`,
  `| Telegram channels | ${facts.sources.telegramCount} |`,
  `| Collection endpoints | ${facts.sources.endpointCount} |`,
  `| Adapter classes | ${facts.sources.adapterClassCount} |`,
  `| Test spec files | ${facts.backend.specFileCount} |`,
  `| Test declarations | ${facts.backend.testDeclarations} |`,
  `| CI jobs | ${facts.ci.jobCount} |`,
  '',
  '## Prisma models',
  '',
  facts.prisma.models.map((m) => `- \`${m}\``).join('\n'),
  '',
  '## Sources and adapters',
  '',
  '| Source | Adapter | Frequency (min) |',
  '|---|---|---:|',
  ...facts.sources.webSources.map((s) => `| ${s.name} (\`${s.id}\`) | \`${s.adapter}\` | ${s.frequencyMinutes} |`),
  '',
  `Telegram channels: ${facts.sources.telegramChannels.map((c) => `\`${c.sourceId}\` (${c.name})`).join(', ')}.`,
  '',
  `Adapter classes (${facts.sources.adapterClassCount}): ${facts.sources.adapterClasses.map((c) => `\`${c}\``).join(', ')}.`,
  '',
  '## Backend feature modules',
  '',
  facts.backend.featureModules.map((m) => `- \`${m}\``).join('\n'),
  '',
  '## Frontend routes',
  '',
  facts.frontend.routes.map((r) => `- \`${r}\``).join('\n'),
  '',
  '## Matching weights',
  '',
  '| Factor | Weight |',
  '|---|---:|',
  ...Object.entries(facts.matching.weights).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  `Match cycle default: \`${facts.matching.matchCycleDefault}\` (override with \`MATCH_CYCLE_INTERVAL\`).`,
  '',
  '## Test inventory',
  '',
  '| File | Declarations |',
  '|---|---:|',
  ...facts.backend.tests.map((t) => `| \`${t.file}\` | ${t.declarations} |`),
  `| **Total** | **${facts.backend.testDeclarations}** |`,
  '',
].join('\n');

const json = JSON.stringify(facts, null, 2) + '\n';

const outputs = [
  { rel: 'docs/architecture-facts.json', content: json },
  { rel: 'docs/architecture-facts.md', content: factsMarkdown },
];

const blocks = [
  {
    rel: 'docs/architecture-overview.md',
    begin: '<!-- BEGIN GENERATED OVERVIEW FACTS -->',
    end: '<!-- END GENERATED OVERVIEW FACTS -->',
    content: overviewBlock,
  },
  {
    rel: 'docs/traceability.md',
    begin: '<!-- BEGIN GENERATED TEST INDEX -->',
    end: '<!-- END GENERATED TEST INDEX -->',
    content: testBlock,
  },
  {
    rel: 'README.md',
    begin: '<!-- BEGIN GENERATED PROJECT FACTS -->',
    end: '<!-- END GENERATED PROJECT FACTS -->',
    content: projectBlock,
  },
];

function replaceBlock(text, begin, end, content) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    throw new Error(`missing markers ${begin} ... ${end}`);
  }
  return text.slice(0, start) + content + text.slice(stop + end.length);
}

const stale = [];
for (const output of outputs) {
  const current = exists(output.rel) ? read(output.rel) : '';
  if (current !== output.content) {
    stale.push(output.rel);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, output.rel), output.content);
  }
}
for (const block of blocks) {
  let current;
  try {
    current = read(block.rel);
  } catch {
    throw new Error(`cannot read ${block.rel}`);
  }
  let next;
  try {
    next = replaceBlock(current, block.begin, block.end, block.content);
  } catch (e) {
    throw new Error(`${block.rel}: ${e.message}`);
  }
  if (current !== next) {
    stale.push(block.rel);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, block.rel), next);
  }
}

// Hand-written counts in prose drift the moment a test is added — the marker blocks
// above only cover what this script owns. The sentence below is maintained here so
// check-architecture-health's traceability.proseCounts gate can never go stale.
{
  const rel = 'README.md';
  const before = read(rel);
  const wanted = `${facts.backend.testDeclarations} test declarations across ${facts.backend.specFileCount} spec files`;
  const after = before.replace(/\d+ test declarations across \d+ spec files/, () => wanted);
  if (before !== after) {
    stale.push(`${rel} (prose count)`);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, rel), after);
  }
}
if (CHECK) {
  if (stale.length) {
    console.error('Architecture facts are stale. Run: node scripts/generate-architecture-facts.js');
    for (const file of stale) console.error(`  - ${file}`);
    process.exit(1);
  }
  console.log('Architecture facts are up to date.');
} else {
  console.log(stale.length ? `Updated: ${stale.join(', ')}` : 'Architecture facts are up to date.');
}
