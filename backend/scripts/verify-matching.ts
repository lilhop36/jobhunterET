/**
 * Verification script for matching engine fixes.
 * Tests the REAL scoring logic with concrete scenarios and asserts expected outcomes.
 * 
 * Run: cd backend && npx ts-node --transpile-only scripts/verify-matching.ts
 */

import { scoreJob, JobInput, ProfileInput } from '../src/modules/matching/matching-engine';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function assertRange(actual: number, min: number, max: number, msg: string) {
  assert(actual >= min && actual <= max, `${msg} — got ${actual}, expected [${min}, ${max}]`);
}

// ── Default test fixtures ────────────────────────────────────────────

function makeJob(overrides: Partial<JobInput> = {}): JobInput {
  return {
    title: 'Backend Developer',
    skills: ['JavaScript', 'TypeScript', 'Node.js'],
    locationClass: 'ETHIOPIA_LOCAL',
    location: 'Addis Ababa, Ethiopia',
    country: 'Ethiopia',
    employmentType: 'FULL_TIME',
    experienceLevel: 'MID',
    salary: 500,
    workPlace: 'ONSITE',
    parseConfidence: 80,
    postedAt: new Date(),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    skills: ['JavaScript', 'TypeScript', 'Node.js', 'React'],
    targetRoles: [{ role: 'backend developer', priority: 'HIGH' }],
    locationTiers: { Ethiopia: 'HIGH', Remote: 'MEDIUM' },
    remote: false,
    employmentTypes: ['FULL_TIME', 'PART_TIME'],
    years: 2,
    minSalary: 400,
    excludeOnsite: false,
    ...overrides,
  };
}

// ── Test 1: Basic matching — score should exceed 65 ──────────────────

console.log('\n=== Test 1: Basic matching — score should exceed 65 ===');
{
  const result = scoreJob(makeJob(), makeProfile());
  console.log(`  Score: ${result.score}`);
  console.log(`  Reasons: ${result.reasons.join('; ')}`);
  assertRange(result.score, 65, 100, 'Score should be >= 65');
  assert(result.reasons.some(r => r.includes('Matches your "backend developer" goal')), 'Should mention role match');
  assert(result.matchedSkills.length > 0, 'Should have direct skill matches');
}

// ── Test 2: Entry-level job gives full experience credit ──────────────

console.log('\n=== Test 2: Entry-level job gives full experience credit ===');
{
  const entryJob = makeJob({ experienceLevel: 'ENTRY', title: 'Junior Backend Developer' });
  const zeroProfile = makeProfile({ years: 0 });
  const result = scoreJob(entryJob, zeroProfile);
  console.log(`  Score: ${result.score} (0-year profile vs ENTRY job)`);
  // The experience factor should be 1.0, not penalized
  const expPart = result.parts.find(p => p.label === 'Experience')!;
  assert(expPart.fraction === 1.0, `Experience fraction should be 1.0 for ENTRY, got ${expPart.fraction}`);
}

// ── Test 3: Intern job gives full experience credit ───────────────────

console.log('\n=== Test 3: Intern job gives full experience credit ===');
{
  const internJob = makeJob({ experienceLevel: 'INTERN', title: 'Software Engineering Intern' });
  const zeroProfile = makeProfile({ years: 0, targetRoles: [{ role: 'software engineer', priority: 'HIGH' }] });
  const result = scoreJob(internJob, zeroProfile);
  console.log(`  Score: ${result.score}`);
  const expPart = result.parts.find(p => p.label === 'Experience')!;
  assert(expPart.fraction === 1.0, `Experience fraction should be 1.0 for INTERN, got ${expPart.fraction}`);
}

// ── Test 4: Empty skill array gives neutral 0.65 ─────────────────────

console.log('\n=== Test 4: Empty skill array gives neutral 0.65 ===');
{
  const noSkillJob = makeJob({ skills: [] });
  const result = scoreJob(noSkillJob, makeProfile());
  const skillPart = result.parts.find(p => p.label === 'Skills')!;
  console.log(`  Skill fraction: ${skillPart.fraction}`);
  assert(skillPart.fraction === 0.65, `Empty skill neutral should be 0.65, got ${skillPart.fraction}`);
}

// ── Test 5: Seniority penalty is -5 (not -8) ─────────────────────────

console.log('\n=== Test 5: Seniority penalty is -5 ===');
{
  const seniorJob = makeJob({ title: 'Senior Backend Developer' });
  const juniorProfile = makeProfile({ years: 2 });
  const normalJob = makeJob({ title: 'Backend Developer' });
  const normalResult = scoreJob(normalJob, juniorProfile);
  const seniorResult = scoreJob(seniorJob, juniorProfile);
  console.log(`  Normal score: ${normalResult.score}, Senior score: ${seniorResult.score}`);
  const diff = normalResult.score - seniorResult.score;
  assert(diff === 5, `Seniority penalty should be exactly 5, got diff ${diff}`);
  assert(seniorResult.reasons.some(r => r.includes('(−5)')), 'Should mention −5 penalty');
}

// ── Test 6: Role normalization — underscores and quotes ───────────────

console.log('\n=== Test 6: Role normalization — underscores and quotes ===');
{
  // Profile with underscored role (as stored in DB)
  const profUnderscore = makeProfile({
    targetRoles: [{ role: 'backend_developer', priority: 'HIGH' }],
  });
  const profQuoted = makeProfile({
    targetRoles: [{ role: '"backend_developer"', priority: 'HIGH' }],
  });
  const profNormal = makeProfile({
    targetRoles: [{ role: 'backend developer', priority: 'HIGH' }],
  });
  const job = makeJob({ title: 'Backend Developer' });
  
  const scoreUnderscore = scoreJob(job, profUnderscore);
  const scoreQuoted = scoreJob(job, profQuoted);
  const scoreNormal = scoreJob(job, profNormal);
  
  console.log(`  Underscore role: ${scoreUnderscore.score}`);
  console.log(`  Quoted role: ${scoreQuoted.score}`);
  console.log(`  Normal role: ${scoreNormal.score}`);
  
  assert(scoreUnderscore.score === scoreNormal.score, 
    `Underscore role should score same as normal: ${scoreUnderscore.score} vs ${scoreNormal.score}`);
  assert(scoreQuoted.score === scoreNormal.score, 
    `Quoted role should score same as normal: ${scoreQuoted.score} vs ${scoreNormal.score}`);
}

// ── Test 7: Ethiopian city resolves to Ethiopia tier ──────────────────

console.log('\n=== Test 7: Ethiopian city resolves to Ethiopia tier ===');
{
  // User has "addis_ababa" at HIGH but no explicit "Ethiopia"
  const profCity = makeProfile({
    locationTiers: { addis_ababa: 'HIGH', Remote: 'MEDIUM' },
  });
  const ethioLocalJob = makeJob({ locationClass: 'ETHIOPIA_LOCAL', location: 'Addis Ababa, Ethiopia' });
  const result = scoreJob(ethioLocalJob, profCity);
  const locPart = result.parts.find(p => p.label === 'Location')!;
  console.log(`  Location fraction: ${locPart.fraction}`);
  assert(locPart.fraction >= 0.9, `Ethiopian city should resolve to HIGH tier (≥0.9), got ${locPart.fraction}`);
}

// ── Test 8: International remote with Remote tier ─────────────────────

console.log('\n=== Test 8: International remote with Remote tier ===');
{
  const prof = makeProfile({ locationTiers: { Remote: 'HIGH' } });
  const remoteJob = makeJob({ locationClass: 'INTERNATIONAL_REMOTE', location: 'Remote' });
  const result = scoreJob(remoteJob, prof);
  const locPart = result.parts.find(p => p.label === 'Location')!;
  console.log(`  Location fraction: ${locPart.fraction}`);
  assert(locPart.fraction >= 0.9, `Remote job with HIGH Remote tier should be ≥0.9, got ${locPart.fraction}`);
}

// ── Test 9: Mid-level job with 0 years gets floor of 0.3 ─────────────

console.log('\n=== Test 9: Mid-level job with 0 years gets floor of 0.3 ===');
{
  const midJob = makeJob({ experienceLevel: 'MID' });
  const zeroProfile = makeProfile({ years: 0 });
  const result = scoreJob(midJob, zeroProfile);
  const expPart = result.parts.find(p => p.label === 'Experience')!;
  console.log(`  Experience fraction: ${expPart.fraction}`);
  assert(expPart.fraction === 0.3, `0-year MID should get floor 0.3, got ${expPart.fraction}`);
}

// ── Test 10: Transferable skills scored correctly ─────────────────────

console.log('\n=== Test 10: Transferable skills scored correctly ===');
{
  // User knows React, job needs Next.js (React → Next.js = 0.70 transferability)
  const prof = makeProfile({
    skills: ['React', 'TypeScript', 'JavaScript'],
    targetRoles: [{ role: 'frontend developer', priority: 'HIGH' }],
  });
  const job = makeJob({
    title: 'Frontend Developer',
    skills: ['Next.js', 'React', 'TypeScript'],
    locationClass: 'INTERNATIONAL_REMOTE',
  });
  const result = scoreJob(job, prof);
  console.log(`  Score: ${result.score}`);
  console.log(`  Transferable: ${result.transferableSkills}`);
  assert(result.transferableSkills.includes('Next.js'), 'Next.js should be transferable from React');
  assert(result.matchedSkills.includes('React'), 'React should be a direct match');
}

// ── Test 11: Transferable skills scored correctly (backend) ───────────

console.log('\n=== Test 11: Backend transferable — Express → NestJS ===');
{
  const prof = makeProfile({
    skills: ['Express', 'Node.js', 'TypeScript', 'JavaScript'],
    targetRoles: [{ role: 'backend developer', priority: 'HIGH' }],
  });
  const job = makeJob({
    title: 'Backend Developer',
    skills: ['NestJS', 'TypeScript', 'PostgreSQL'],
    locationClass: 'ETHIOPIA_LOCAL',
  });
  const result = scoreJob(job, prof);
  console.log(`  Score: ${result.score}`);
  console.log(`  Transferable: ${result.transferableSkills}`);
  console.log(`  Related: ${result.relatedSkills}`);
  assert(result.transferableSkills.includes('NestJS'), 'NestJS should be transferable from Express');
  assert(result.matchedSkills.includes('TypeScript'), 'TypeScript should be a direct match');
}

// ── Test 12: Cross-validation — underscored role from DB ──────────────

console.log('\n=== Test 12: Cross-validation — DB-style role with underscore ===');
{
  // Simulate real DB scenario: role stored as "backend_developer" with quotes
  const prof = makeProfile({
    targetRoles: [{ role: '"backend_developer"', priority: 'HIGH' }],
    skills: ['Node.js', 'TypeScript', 'JavaScript'],
    locationTiers: { Ethiopia: 'HIGH', Remote: 'MEDIUM' },
    years: 1,
  });
  const job = makeJob({
    title: 'Backend Developer',
    skills: ['Node.js', 'TypeScript', 'JavaScript'],
    locationClass: 'ETHIOPIA_LOCAL',
    experienceLevel: 'ENTRY',
    salary: 300,
  });
  const result = scoreJob(job, prof);
  console.log(`  Score: ${result.score}`);
  console.log(`  Parts: ${result.parts.map(p => `${p.label}=${(p.fraction * p.weight).toFixed(1)}`).join(', ')}`);
  console.log(`  Reasons: ${result.reasons.join('; ')}`);
  assertRange(result.score, 70, 100, 'Realistic DB scenario should score ≥ 70');
  assert(result.reasons.some(r => r.includes('backend developer')), 'Should recognize role match');
}

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(60)}`);

if (failed > 0) {
  process.exit(1);
}
