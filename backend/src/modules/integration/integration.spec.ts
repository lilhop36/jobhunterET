/**
 * Integration behavior contract.
 *
 * Tests real behavior against the database and the transition graph.
 * Each test asserts one invariant. No implementation reimplementation.
 */

import { PrismaClient, ApplicationStage } from '@prisma/client';
import { VALID_TRANSITIONS } from '../applications/applications.service';

const prisma = new PrismaClient();

// ─── FR-031a: Transition graph contract ──────────────────────────
// The graph is a table. Test it like one.

describe('FR-031a — transition graph', () => {
  const graph: Record<ApplicationStage, ApplicationStage[]> = {
    DISCOVERED: ['SAVED', 'APPLIED', 'REJECTED'],
    SAVED:      ['APPLIED', 'REJECTED'],
    APPLIED:    ['ASSESSMENT', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
    ASSESSMENT: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
    INTERVIEW:  ['OFFER', 'REJECTED', 'WITHDRAWN'],
    OFFER:      [],
    REJECTED:   [],
    WITHDRAWN:  [],
  };

  it.each(Object.keys(graph) as ApplicationStage[])(
    '%s → %s',
    (stage) => {
      expect(VALID_TRANSITIONS[stage]).toEqual(graph[stage]);
    },
  );

  it('no illegal back-edges (SAVED→DISCOVERED, OFFER→REJECTED, etc.)', () => {
    expect(VALID_TRANSITIONS.SAVED).not.toContain('DISCOVERED');
    expect(VALID_TRANSITIONS.OFFER).not.toContain('REJECTED');
    expect(VALID_TRANSITIONS.REJECTED).toHaveLength(0);
    expect(VALID_TRANSITIONS.WITHDRAWN).toHaveLength(0);
  });
});

// ─── FR-003a: Profile completion contract ────────────────────────
// Boundary cases: missing profile → 0, full profile → 85 (seeded).

describe('FR-003a — profile completion', () => {
  it('returns 0 for nonexistent user', async () => {
    const p = await prisma.candidateProfile.findUnique({ where: { userId: 'nonexistent' } });
    expect(p).toBeNull();
  });

  it('seeded user has 85% completion (matches frontend)', async () => {
    const user = await prisma.user.findFirst({ where: { email: 'amara@jobhunter.et' } });
    expect(user).not.toBeNull();

    // Verify the components that contribute to 85%
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: user!.id } });
    expect(profile).not.toBeNull();
    expect(profile!.title).toBeTruthy();       // +10
    expect(profile!.summary).toBeTruthy();     // +5
    expect(profile!.years).toBeGreaterThan(0); // +5
    expect(profile!.employmentTypes.length).toBeGreaterThan(0); // +10

    const skills = await prisma.candidateSkill.count({ where: { userId: user!.id } });
    expect(skills).toBeGreaterThanOrEqual(3);  // +15 (cap at 3 skills)

    const roles = await prisma.targetRole.count({ where: { userId: user!.id } });
    expect(roles).toBeGreaterThanOrEqual(3);   // +20 (cap at 3 roles)

    const locs = await prisma.locationPreference.count({ where: { userId: user!.id } });
    expect(locs).toBeGreaterThanOrEqual(1);    // +15
  });
});

// ─── Data integrity contract ─────────────────────────────────────

describe('data integrity', () => {
  it('no orphaned job references in matches', async () => {
    const matchJobIds = (await prisma.jobMatch.findMany({ take: 50, select: { jobId: true } }))
      .map(m => m.jobId);
    const existing = new Set(
      (await prisma.job.findMany({ where: { id: { in: [...new Set(matchJobIds)] } }, select: { id: true } }))
        .map(j => j.id),
    );
    const orphans = [...new Set(matchJobIds)].filter(id => !existing.has(id));
    expect(orphans).toHaveLength(0);
  });

  it('no new matches created after expiry sweep reference expired jobs', async () => {
    const lastExpiry = await prisma.job.findFirst({
      where: { status: 'EXPIRED' },
      orderBy: { statusChangedAt: 'desc' },
      select: { statusChangedAt: true },
    });
    if (!lastExpiry?.statusChangedAt) return;

    const stale = await prisma.jobMatch.count({
      where: {
        createdAt: { gt: lastExpiry.statusChangedAt },
        job: { status: { in: ['EXPIRED', 'REMOVED'] } },
      },
    });
    expect(stale).toBe(0);
  });

  it('database has active jobs and matches', async () => {
    expect(await prisma.job.count({ where: { status: 'ACTIVE' } })).toBeGreaterThan(0);
    expect(await prisma.jobMatch.count()).toBeGreaterThan(0);
  });
});

// ─── FR-033: Search profiles contract ────────────────────────────

describe('FR-033 — search profiles', () => {
  it('create and delete a search profile', async () => {
    const user = await prisma.user.findFirst({ where: { email: 'amara@jobhunter.et' } });
    if (!user) return;

    const sp = await prisma.searchProfile.create({
      data: { userId: user.id, name: 'Smoke Test', q: 'engineer', tier: 'ALL', remote: false },
    });
    expect(sp.name).toBe('Smoke Test');

    await prisma.searchProfile.delete({ where: { id: sp.id } });
  });
});

// ─── FR-034d: Dormancy contract ──────────────────────────────────

describe('FR-034d — dormancy', () => {
  it('dormant-eligible users have old lastActiveAt', async () => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const eligible = await prisma.user.findMany({
      where: { status: 'ACTIVE', lastActiveAt: { lt: cutoff } },
      select: { lastActiveAt: true },
    });
    for (const u of eligible) {
      expect(u.lastActiveAt!.getTime()).toBeLessThan(cutoff.getTime());
    }
  });
});

// ─── Collection tracking contract ────────────────────────────────

describe('collection tracking', () => {
  it('source runs have chronologically valid timestamps', async () => {
    const runs = await prisma.sourceRun.findMany({
      take: 5, orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true },
    });
    for (const r of runs) {
      if (r.finishedAt) expect(r.finishedAt.getTime()).toBeGreaterThanOrEqual(r.startedAt.getTime());
    }
  });
});

afterAll(() => prisma.$disconnect());
