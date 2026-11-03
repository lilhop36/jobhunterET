#!/usr/bin/env node
/**
 * Requirement → test traceability, derived from source.
 *
 * Reads the SRS (JobHunter_SRS_v2.3.md) for the authoritative requirement list, reads the
 * spec tree for the test titles that cite those requirement IDs, and writes the result into
 * marker blocks in docs/traceability.md. Coverage percentages are computed, never typed.
 *
 *   node scripts/generate-traceability.js          # write
 *   node scripts/generate-traceability.js --check  # verify only (CI)
 *
 * Why this exists: the matrix used to be hand-maintained. Its totals (41/53 = 77%), its
 * per-requirement rows and its "Untested Requirements" list had drifted from the specs —
 * FR-024c and FR-034d were listed as untested while tests citing them were in the tree, and
 * FR-003a was described as the completion meter when the SRS defines it as CV upload.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRS_FILE = 'JobHunter_SRS_v2.3.md';
const TRACE_FILE = 'docs/traceability.md';

const REQ_ID = /\b((?:FR|NFR)-\d+[a-z]?\d?)\b/g;
const SEC_ID = /\bSEC-\d{3}\b/g;
// Shorthand chains inside one title: "(FR-013/014/036)" cites three requirements.
const REQ_CHAIN = /\b(FR|NFR)-(\d+[a-z]?\d?(?:\s*\/\s*\d+[a-z]?\d?)*)/g;

const ids = (text) => {
  const found = new Set(text.match(REQ_ID) || []);
  for (const [, prefix, chain] of text.matchAll(REQ_CHAIN)) {
    for (const part of chain.split('/')) {
      const trimmed = part.trim();
      if (trimmed) found.add(`${prefix}-${trimmed}`);
    }
  }
  return [...found];
};

/**
 * Requirements the SRS itself places outside the MVP. Each entry quotes the SRS wording so
 * the drift check fails if that sentence is edited away and the exemption is no longer real.
 */
const DEFERRED = {
  'FR-002c': 'Full email-based password reset is deferred.',
  'FR-003f': 'CV-Assisted Pre-fill (Phase 2)',
  'FR-021': 'AI Job Analysis (optional, post-MVP)',
  'FR-022': 'AI Job Analysis (optional, post-MVP)',
};

/**
 * Requirements that are tested for part of their clause — the code and the tests
 * are real, but one sentence of the SRS is not implemented yet. They count as
 * tested (the evidence exists) and are listed separately so the percentage cannot
 * hide the shortfall. A note attached to a requirement with no evidence at all is
 * stale and fails the run.
 */
const PARTIAL = {
  'FR-030':
    'the rejection is recorded per user and is terminal in the transition graph; the clause "feeds future ranking" is not implemented — the matcher never reads Application.stage',
  'NFR-006':
    'payload, page-weight and no-autoplay budgets pass on every route sampled, and LCP passes on / /login /dashboard /matches — measured by frontend/e2e/low-bandwidth.spec.ts on a production build over CDP network emulation at Lighthouse\'s simulated-3G profile. Two shortfalls: LCP on /jobs measures 3.0-3.4s against the 3s budget because the list paints only after a gzipped 57 KB first page of 50 jobs crosses the link, and the skeleton-loader/no-layout-shift, next/image and statically-rendered-job-list clauses are measured by nothing.',
};

/**
 * Requirements whose evidence is not a jest title, and the honest reason why not.
 * These stay in the gap list — a note here is an explanation, never an exemption from
 * coverage. A row that later gains a citing test makes its note stale and fails the run,
 * so the section cannot quietly accumulate requirements that are actually tested.
 */
const OPERATIONAL = {
  'NFR-001': 'Measured against the running stack by backend/scripts/nfr-test.ts (npm run nfr:check), which samples p95 per endpoint, login latency, and dashboard latency during five concurrent logins, plus the single-user recalculation. A unit-test title cannot prove a millisecond budget. Every sampled request including login is inside 500ms on the current stack; the login figure depends on PASSWORD_COST, which the security spec test pins at or above the OWASP bcrypt floor.',
  'NFR-002': 'No automated evidence. The claim is structural — a source is added by registering an adapter, and keyset pagination bounds each cycle — reviewed in docs/architecture-overview.md rather than measured.',
  'NFR-003': 'No automated evidence. The MVP serves while the host runs; continuous availability is the cloud phase the SRS defers.',
  'NFR-007': 'No automated evidence. Controls are driven by accessible name in the e2e suite, but contrast, touch-target and i18n clauses are unmeasured.',
};



/**
 * Curated evidence for tests that cover a requirement without naming its ID in the title.
 * `requirement: 'file token token…'` — the file must exist and its test titles must contain
 * every token, so an alias cannot rot into a claim about a test that was renamed or deleted.
 * These are audited supplements to title citations, not a way to pad the percentage.
 */
const ALIASES = {
  'FR-001a': [
    'backend/src/modules/account/account.service.spec.ts :: sets status DISABLED',
    'backend/src/modules/account/account.service.spec.ts :: sets status DELETED',
  ],
  'FR-002a': [
    'frontend/e2e/runtime-verification.spec.ts :: rejects anonymous callers',
    'frontend/e2e/runtime-verification.spec.ts :: issues a session',
  ],
  'FR-002b': ['frontend/e2e/shell.spec.ts :: logout returns login'],
  'FR-002d': [
    'frontend/e2e/phase5.spec.ts :: 403 message non-admin',
    'backend/src/modules/admin/admin.service.spec.ts :: change user role',
  ],
  'FR-002g': [
    'backend/src/modules/auth/auth.controller.spec.ts :: per-email budget',
    'backend/src/modules/auth/auth.controller.spec.ts :: rate limits register',
  ],
  'FR-002h': [
    'backend/src/modules/account/account.service.spec.ts :: invalidates token',
    'backend/src/modules/admin/admin.service.spec.ts :: invalidates token disabling',
  ],
  'FR-002': ['frontend/e2e/runtime-verification.spec.ts :: sign-in issues a session'],
  'FR-003': ['backend/src/modules/integration/integration.spec.ts :: profile completion'],
  'FR-003a': [
    'backend/src/common/security/security.spec.ts :: magic-byte validation',
    'frontend/e2e/persistence.spec.ts :: upload CV',
  ],
  'FR-004': ['backend/src/modules/matching/matching-engine.spec.ts :: normalizeSkill'],
  'FR-005': ['backend/src/modules/matching/matching-engine.spec.ts :: roleSimilarity'],
  'FR-006b': ['backend/src/modules/matching/matching-engine.spec.ts :: scores location from the user tier map'],
  'FR-007': ['frontend/e2e/phase5.spec.ts :: 403 message non-admin'],
  'FR-008': ['backend/src/modules/sources/adapters/adapters.spec.ts :: parses'],
  'FR-011': ['backend/src/modules/jobs/job-fidelity.spec.ts :: normalizeSalary'],
  'FR-017': ['backend/src/modules/jobs/jobs.service.spec.ts :: filters q tier'],
  'FR-019a': ['frontend/e2e/phase5.spec.ts :: explainable panel equals stored JobMatch'],
  'FR-019c': ['backend/src/modules/matching/matching-engine.spec.ts :: overall math'],
  'FR-034c': ['backend/src/modules/lifecycle/lifecycle.service.spec.ts :: rechecks NOT_FOUND'],
  'FR-003e2': ['backend/src/modules/auth/auth.service.spec.ts :: reactivates dormant enqueues recalculation'],
  'FR-006a': ['backend/src/modules/sources/adapters/adapters.spec.ts :: location class'],
  'FR-009': ['backend/src/modules/sources/sources.service.spec.ts :: validation dedup counting isolation'],
  'FR-012a': ['backend/src/modules/sources/adapters/adapters.spec.ts :: skill extraction'],
  'FR-016': [
    'backend/src/modules/jobs/jobs.service.spec.ts :: filters q tier',
    'frontend/e2e/shell.spec.ts :: global search filters jobs',
  ],
  'FR-024a': [
    'backend/src/modules/notifications/notifications.service.spec.ts :: Web Inbox',
    'backend/src/modules/notifications/notifications.service.spec.ts :: Telegram message containing summary',
  ],
  'FR-024b': [
    'backend/src/modules/telegram/telegram.service.spec.ts :: global rate cap',
    'backend/src/common/utils/rate-limiter.spec.ts :: allows max requests then rejects',
  ],
  'FR-025c': ['backend/src/modules/notifications/notifications.service.spec.ts :: containing summary'],
  'FR-026': [
    'backend/src/modules/notifications/notifications.service.spec.ts :: paused user never notified',
    'frontend/e2e/phase5.spec.ts :: threshold slider',
  ],
  'FR-029': [
    'backend/src/modules/telegram/telegram.service.spec.ts :: [Save] stores',
    'frontend/e2e/persistence.spec.ts :: save job',
  ],
  'FR-031': ['backend/src/modules/applications/applications.service.spec.ts :: APPLIED lifecycle record'],
  'FR-032': ['frontend/e2e/phase5.spec.ts :: move stage persists after reload'],
  'FR-035': ['backend/src/common/utils/exclusive.spec.ts :: skips an overlapping call'],
  'FR-037': [
    'backend/src/modules/sources/sources.service.spec.ts :: computeHealthScore',
    'backend/src/modules/sources/sources.service.spec.ts :: auto-disables source consecutive failures',
  ],
  'NFR-004': [
    'backend/src/modules/sources/sources.service.spec.ts :: without a registered adapter',
    'backend/src/modules/sources/sources.service.spec.ts :: keeps the source ACTIVE for retry',
  ],
  'NFR-005': [
    'backend/src/common/security/security.spec.ts :: magic-byte validation',
    'backend/src/common/utils/url-safety.spec.ts :: rejects loopback private metadata',
  ],
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(relDir, pattern, out = []) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const child = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(child, pattern, out);
    else if (pattern.test(entry.name)) out.push(child);
  }
  return out;
}

// ─── SRS parsing ───────────────────────────────────────────────

/**
 * Definitions come from `##`–`####` headings and from bold bullet labels. Returns the
 * requirement list in document order with the section each was defined under.
 */
function parseRequirements() {
  const lines = read(SRS_FILE).split(/\r?\n/);
  const reqs = new Map();
  let category = 'Front matter';

  const addDefinition = (label, line) => {
    // "FR-016 Search / FR-017 Filters" → one title per ID when every segment leads with an ID;
    // "FR-031 / FR-032 Application Tracking" → both IDs share the trailing title.
    const segments = label.split('/').map((s) => s.trim()).filter(Boolean);
    const perSegment = segments.length > 1 && segments.every((s) => ids(s).length > 0);
    const assign = (text) => {
      const found = ids(text);
      if (!found.length) return;
      const title = text
        .replace(REQ_ID, '')
        .replace(/^[*\s/–—-]+/, '')
        .replace(/[*]+/g, '')
        .trim();
      for (const id of found) {
        if (reqs.has(id)) continue;
        REQ_ID.lastIndex = 0;
        reqs.set(id, { id, title: title || category, category, line });
      }
    };
    if (perSegment) segments.forEach(assign);
    else assign(label);
  };

  lines.forEach((line, index) => {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (!heading) {
      const bullet = /^[-*]\s+\*\*(.*)\*\*/.exec(line);
      if (bullet && ids(bullet[1]).length) addDefinition(bullet[1], index + 1);
      return;
    }
    const level = heading[1].length;
    const text = heading[2].trim();
    if (level === 1) {
      category = text.replace(/^\d+\.\s*/, '').replace(/^(Functional|Non-Functional)\s+Requirements\s*[—-]\s*/, '');
      return;
    }
    if (ids(text).length) addDefinition(text, index + 1);
  });

  return [...reqs.values()];
}

// ─── Spec parsing ──────────────────────────────────────────────

/** First argument of a describe/it/test declaration, when it is a plain string literal. */
function testTitle(line) {
  const m = /^\s*(?:describe|it|test)(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(line);
  return m ? m[2] : null;
}

function collectEvidence() {
  const specs = [
    ...walk('backend/src', /\.spec\.ts$/),
    ...walk('frontend/e2e', /\.spec\.(ts|js)$/),
  ];
  const evidence = new Map();
  const testTitles = [];

  for (const rel of specs) {
    read(rel).split(/\r?\n/).forEach((line) => {
      const title = testTitle(line);
      if (!title) return;
      testTitles.push({ file: rel, title });
      const label = rel.replace(/^backend\/src\/modules\//, '').replace(/^backend\/src\//, '');
      for (const id of ids(title)) {
        if (!evidence.has(id)) evidence.set(id, []);
        evidence.get(id).push({ file: label, title, via: 'citation' });
      }
    });
  }
  return { evidence, testTitles, specs };
}

/**
 * Resolve the curated aliases against the real test titles. Every clause must match, or the
 * alias is reported as unmatched — an alias that points at nothing is worse than no alias,
 * because it manufactures coverage.
 */
function resolveAliases(testTitles) {
  const matched = new Map();
  const unmatched = [];
  for (const [id, clauses] of Object.entries(ALIASES)) {
    for (const clause of clauses) {
      const [file, tokenText = ''] = clause.split('::').map((s) => s.trim());
      const tokens = tokenText.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = testTitles
        .filter((t) => t.file === file && tokens.every((tok) => t.title.toLowerCase().includes(tok)))
        .slice(0, 3)
        .map((t) => ({
          file: t.file.replace(/^backend\/src\/modules\//, '').replace(/^backend\/src\//, ''),
          title: t.title,
          via: 'mapping',
        }));
      if (hits.length) {
        if (!matched.has(id)) matched.set(id, []);
        matched.get(id).push(...hits);
      } else {
        unmatched.push(`${id} → ${clause}`);
      }
    }
  }
  return { matched, unmatched };
}

/** SEC-xxx labels are code-level control ids, not SRS requirements; pair definition with test. */
function collectSecurityControls() {
  const sources = walk('backend/src', /\.ts$/).filter((f) => !f.endsWith('.spec.ts'));
  const controls = new Map();
  const note = (rel, text, kind) => {
    for (const id of text.match(SEC_ID) || []) {
      if (!controls.has(id)) controls.set(id, { id, definitions: [], tests: [] });
      const clean = text.replace(/^[\s/*]*|[,.;]$/, '').trim();
      if (kind === 'def' && !controls.get(id).definitions.some((d) => d.text === clean)) {
        controls.get(id).definitions.push({ file: rel.replace(/^backend\/src\//, ''), text: clean });
      }
      if (kind === 'test') controls.get(id).tests.push({ file: rel.replace(/^backend\/src\//, ''), text: clean });
    }
  };
  for (const rel of walk('backend/src', /\.spec\.ts$/)) {
    read(rel).split(/\r?\n/).forEach((line) => {
      const title = testTitle(line);
      if (title) note(rel, title, 'test');
    });
  }
  for (const rel of sources) {
    read(rel).split(/\r?\n/).forEach((line) => {
      if (/^\s*(\/\/|\/?\*)/.test(line) && SEC_ID.test(line)) {
        SEC_ID.lastIndex = 0;
        note(rel, line, 'def');
      }
      SEC_ID.lastIndex = 0;
    });
  }
  return [...controls.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Model ─────────────────────────────────────────────────────

function build() {
  const reqs = parseRequirements();
  const { evidence, testTitles, specs } = collectEvidence();
  const { matched: mapped, unmatched: unmatchedAliases } = resolveAliases(testTitles);
  const srsText = read(SRS_FILE);

  const rows = reqs.map((req) => {
    const cites = evidence.get(req.id) || [];
    const maps = mapped.get(req.id) || [];
    const hits = [...cites, ...maps];
    const deferReason = DEFERRED[req.id];
    let status;
    if (cites.length) status = 'Tested';
    else if (maps.length) status = 'Tested (mapping)';
    else if (deferReason) status = 'Deferred';
    else status = 'No test evidence';
    if (PARTIAL[req.id] && status.startsWith('Tested')) status = 'Tested (partial)';
    return {
      ...req,
      status,
      hits,
      deferReason,
      partialNote: PARTIAL[req.id],
      operationalNote: OPERATIONAL[req.id],
      citedByTitle: cites.length > 0,
      viaMapping: cites.length === 0 && maps.length > 0,
    };
  });

  // A partial note is a promise about the code: if its requirement has no test
  // evidence at all, the note is describing something that was never covered.
  const stalePartials = Object.keys(PARTIAL).filter((id) => {
    const row = rows.find((r) => r.id === id);
    return !row || !row.status.startsWith('Tested');
  });

  // An operational note explains an absent test. It goes stale in two directions:
  // the requirement stopped existing, or somebody finally wrote the test.
  const staleOperational = Object.keys(OPERATIONAL).filter((id) => {
    const row = rows.find((r) => r.id === id);
    return !row || row.status !== 'No test evidence';
  });

  // A curated exemption is only honest while the SRS still says so.
  const staleDeferrals = Object.entries(DEFERRED)
    .filter(([, reason]) => !srsText.includes(reason))
    .map(([id]) => id);

  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) last.rows.push(row);
    else groups.push({ category: row.category, rows: [row] });
  }

  const scored = rows.filter((r) => r.status !== 'Deferred');
  const tested = scored.filter((r) => r.status.startsWith('Tested'));
  const cited = scored.filter((r) => r.citedByTitle);
  const partial = scored.filter((r) => r.status === 'Tested (partial)');
  const gaps = scored.filter((r) => r.status === 'No test evidence');
  const notedGaps = gaps.filter((r) => r.operationalNote);
  const hardGaps = gaps.filter((r) => !r.operationalNote);

  const categoryStats = groups.map((g) => {
    const inScope = g.rows.filter((r) => r.status !== 'Deferred');
    const withTest = inScope.filter((r) => r.status.startsWith('Tested'));
    return {
      category: g.category,
      total: g.rows.length,
      tested: withTest.length,
      deferred: g.rows.length - inScope.length,
      pct: inScope.length ? Math.round((withTest.length / inScope.length) * 100) : null,
    };
  });

  return {
    rows,
    groups,
    categoryStats,
    stats: {
      requirements: rows.length,
      tested: tested.length,
      cited: cited.length,
      partial: partial.length,
      gaps: gaps.length,
      hardGaps: hardGaps.length,
      notedGaps: notedGaps.length,
      deferred: rows.length - scored.length,
      pct: Math.round((tested.length / scored.length) * 100),
      specFiles: specs.length,
      testTitles: testTitles.length,
    },
    security: collectSecurityControls(),
    staleDeferrals,
    stalePartials,
    staleOperational,
    unmatchedAliases,
  };
}

// ─── Rendering ─────────────────────────────────────────────────

const B = (name) => `<!-- BEGIN GENERATED ${name} -->`;
const EN = (name) => `<!-- END GENERATED ${name} -->`;
const stamp = '<!-- Generated from JobHunter_SRS_v2.3.md and the spec tree by scripts/generate-traceability.js. Do not edit by hand. -->';

const esc = (s) => String(s).replace(/\|/g, '\\|');

function coverageBlock(model) {
  const s = model.stats;
  return [
    B('COVERAGE'),
    stamp,
    '',
    `| Category | Requirements | Tested | Deferred | Coverage |`,
    `|---|---:|---:|---:|---:|`,
    ...model.categoryStats.map((c) => `| ${esc(c.category)} | ${c.total} | ${c.tested} | ${c.deferred} | ${c.pct === null ? 'n/a' : c.pct + '%'} |`),
    `| **Total** | **${s.requirements}** | **${s.tested}** | **${s.deferred}** | **${s.pct}%** |`,
    '',
    `Derived from ${s.requirements} requirement headings in \`${SRS_FILE}\` and ${s.testTitles} test titles across ${s.specFiles} spec files (backend + frontend e2e).`,
    `**${s.cited}** are cited by a \`describe\`/\`it\` title that names the ID; the remaining **${s.tested - s.cited}** are credited through the audited mapping in \`scripts/generate-traceability.js\`, whose clauses are re-resolved against real test titles on every run — a clause that matches nothing fails the check.`,
    `Coverage = ${s.tested} tested ÷ ${s.requirements - s.deferred} in-scope = ${s.pct}%. Deferred items are excluded from the denominator and each carries a quoted SRS line; if that line changes the generator fails.`,
    s.partial ? `Of those, **${s.partial}** counted toward coverage are marked **Tested (partial)**: their tests are real but one SRS clause is unimplemented — each shortfall is named in the matrix and in the gaps list.` : '',
    '',
    EN('COVERAGE'),
  ].join('\n');
}

function matrixBlock(model) {
  const out = [B('MATRIX'), stamp, '',
    'Status legend: **Tested** = a test title cites the ID · **Tested (mapping)** = evidence comes only from the',
    'audited alias mapping · **Tested (partial)** = tests and code are real, but one clause of the SRS',
    'sentence is unimplemented (the missing clause is quoted in the Evidence cell and listed under "Partially',
    'implemented") · **No test evidence** = implemented scope with no citing test · **Deferred** = the SRS',
    'places it outside the MVP.', ''];
  for (const group of model.groups) {
    out.push(`### ${group.category}`, '', '| Req | Title | Status | Evidence |', '|---|---|---|---|');
    for (const row of group.rows) {
      let evidence = '—';
      if (row.hits.length) {
        const files = [...new Set(row.hits.map((h) => h.file))];
        const first = row.hits[0];
        evidence = `${files.join(', ')} · \`${esc(first.title)}\`${row.hits.length > 1 ? ` (+${row.hits.length - 1} more)` : ''}`;
      } else if (row.deferReason) {
        evidence = `SRS: “${esc(row.deferReason)}”`;
      }
      if (row.partialNote) evidence += ` — partial: ${esc(row.partialNote)}`;
      out.push(`| ${row.id} | ${esc(row.title)} | ${row.status} | ${evidence} |`);
    }
    out.push('');
  }
  out.push(EN('MATRIX'));
  return out.join('\n');
}

function gapsBlock(model) {
  const gaps = model.rows.filter((r) => r.status === 'No test evidence');
  const partial = model.rows.filter((r) => r.status === 'Tested (partial)');
  const hard = gaps.filter((r) => !r.operationalNote);
  const noted = gaps.filter((r) => r.operationalNote);
  const byCategory = new Map();
  for (const g of hard) {
    if (!byCategory.has(g.category)) byCategory.set(g.category, []);
    byCategory.get(g.category).push(g);
  }
  return [
    B('GAPS'),
    stamp,
    '',
    hard.length
      ? `**${hard.length} in-scope requirements have no test that cites their ID and no stated reason.** This is the release-blocking list; the hand-written "untested" table it replaced was stale in both directions.`
      : 'Every in-scope requirement is either cited by a test or explained below.',
    '',
    ...[...byCategory.entries()].map(([category, rows]) => [
      `### ${category} (${rows.length})`,
      '',
      ...rows.map((r) => `- **${r.id}** — ${esc(r.title)} *(SRS line ${r.line})*`),
      '',
    ].join('\n')),
    noted.length
      ? [
          `### No citing test — reason stated (${noted.length})`,
          '',
          'These stay in the gap list: an explanation is not coverage. The note says what measures them',
          'today, or says plainly that nothing does. A note goes stale the moment the requirement gains a',
          'test, which fails the check.',
          '',
          ...noted.map((r) => `- **${r.id}** — ${esc(r.title)} *(SRS line ${r.line})*: ${esc(r.operationalNote)}`),
          '',
        ].join('\n')
      : '',
    partial.length
      ? [
          `### Partially implemented (${partial.length})`,
          '',
          'These count toward coverage because the tests and the code are real; the shortfall is the SRS',
          'clause still unimplemented, so it is stated here rather than hidden inside a percentage.',
          '',
          ...partial.map((r) => `- **${r.id}** — ${esc(r.title)} *(SRS line ${r.line})*: ${esc(r.partialNote)}`),
          '',
        ].join('\n')
      : '',
    EN('GAPS'),
  ].join('\n');
}

function securityBlock(model) {
  return [
    B('SECURITY'),
    stamp,
    '',
    '`SEC-xxx` are code-level security-control labels (not SRS requirement IDs). Each row pairs the',
    'comment that names the control with the test that exercises it.',
    '',
    '| Control | Declared in | Test evidence |',
    '|---|---|---|',
    ...model.security.map((c) => {
      const defs = c.definitions.length
        ? [...new Set(c.definitions.map((d) => d.file))].join(', ')
        : '—';
      const tests = c.tests.length ? [...new Set(c.tests.map((t) => `${t.file} · \`${esc(t.text)}\``))].join('<br>') : '**none**';
      return `| ${c.id} | ${defs} | ${tests} |`;
    }),
    '',
    EN('SECURITY'),
  ].join('\n');
}

function render(model) {
  return {
    coverage: coverageBlock(model),
    matrix: matrixBlock(model),
    gaps: gapsBlock(model),
    security: securityBlock(model),
  };
}

const TARGETS = [
  { key: 'coverage', begin: B('COVERAGE'), end: EN('COVERAGE') },
  { key: 'matrix', begin: B('MATRIX'), end: EN('MATRIX') },
  { key: 'gaps', begin: B('GAPS'), end: EN('GAPS') },
  { key: 'security', begin: B('SECURITY'), end: EN('SECURITY') },
];

function replaceBlock(text, begin, end, content) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) throw new Error(`missing markers ${begin}`);
  return text.slice(0, start) + content + text.slice(stop + end.length);
}

function apply({ check = false } = {}) {
  const model = build();
  if (model.staleDeferrals.length) {
    console.error(`Deferred exemptions no longer quoted in the SRS: ${model.staleDeferrals.join(', ')}`);
    process.exitCode = 1;
  }
  if (model.stalePartials.length) {
    console.error(`Partial notes have no test evidence to be partial about: ${model.stalePartials.join(', ')}`);
    process.exitCode = 1;
  }
  if (model.staleOperational.length) {
    console.error(
      'Operational notes are out of date (the requirement vanished or now has test evidence) — delete or fix them: ' +
        model.staleOperational.join(', '),
    );
    process.exitCode = 1;
  }
  if (model.unmatchedAliases.length) {
    console.error('Mapping clauses match no test title (fix ALIASES or add the test):');
    for (const a of model.unmatchedAliases) console.error(`  - ${a}`);
    process.exitCode = 1;
  }
  const rendered = render(model);
  let current = read(TRACE_FILE);
  const changed = [];
  for (const target of TARGETS) {
    const next = replaceBlock(current, target.begin, target.end, rendered[target.key]);
    if (next !== current) changed.push(`${TRACE_FILE} ${target.key}`);
    current = next;
  }
  if (!check) {
    if (current !== read(TRACE_FILE)) fs.writeFileSync(path.join(ROOT, TRACE_FILE), current);
  } else if (changed.length) {
    console.error('Traceability is stale. Run: node scripts/generate-traceability.js');
    for (const c of changed) console.error(`  - ${c}`);
    process.exitCode = 1;
  }
  return { model, changed };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  if (!exists(TRACE_FILE)) {
    console.error(`${TRACE_FILE} is missing — it must contain the GENERATED markers.`);
    process.exit(1);
  }
  const { model, changed } = apply({ check });
  const s = model.stats;
  if (check) {
    console.log(changed.length
      ? `Traceability drift: ${changed.length} block(s) out of date.`
      : `Traceability is up to date (${s.tested}/${s.requirements - s.deferred} requirements = ${s.pct}%, ${s.partial} partial).`);
  } else {
    console.log(`${changed.length ? 'Updated' : 'Up to date'}: ${s.requirements} requirements, ${s.tested} tested (${s.partial} partial), ${s.hardGaps} unexplained and ${s.notedGaps} explained gaps, ${s.deferred} deferred → ${s.pct}% coverage.`);
  }
}

module.exports = { build, apply, render, parseRequirements, collectEvidence, DEFERRED, PARTIAL, OPERATIONAL };
