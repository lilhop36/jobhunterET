/**
 * Recalculate all user matches with the updated scoring engine.
 * Run: npx ts-node scripts/recalc-all.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Import the matching engine (clear cache to ensure latest source)
Object.keys(require.cache).filter((k) => k.includes('matching-engine')).forEach((k) => delete require.cache[k]);
const { scoreJob } = require('../src/modules/matching/matching-engine');

async function main() {
  // Get all active users with skills or target roles
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ skills: { some: {} } }, { targetRoles: { some: {} } }],
    },
    select: { id: true, email: true, matchThreshold: true },
  });

  console.log(`Found ${users.length} active users to recalculate`);

  // Get all active jobs (limit to 500 for performance)
  const jobs = await prisma.job.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { firstSeenAt: 'desc' },
    take: 500,
    include: { skills: { include: { skill: true } } },
  });

  console.log(`Found ${jobs.length} active jobs to score`);

  let totalMatches = 0;
  let totalAbove = 0;
  let totalNotifications = 0;

  for (const user of users) {
    console.log(`Processing ${user.email}...`);

    // Build profile
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: user.id },
    });
    const [skills, roles, locations] = await Promise.all([
      prisma.candidateSkill.findMany({
        where: { userId: user.id },
        include: { skill: true },
      }),
      prisma.targetRole.findMany({ where: { userId: user.id } }),
      prisma.locationPreference.findMany({ where: { userId: user.id } }),
    ]);

    const locationTiers: Record<string, string> = {};
    for (const l of locations) locationTiers[l.region] = l.tier;

    const prof = {
      skills: skills.map((s) => s.skill.name),
      targetRoles: roles.map((r) => ({ role: r.role, priority: r.priority as 'HIGH' | 'MEDIUM' | 'LOW' })),
      locationTiers,
      remote: !!profile?.remote,
      employmentTypes: (() => {
        try { return JSON.parse(profile?.employmentTypes || '[]'); } catch { return []; }
      })(),
      years: profile?.years ?? 0,
      minSalary: profile?.minSalary ?? 0,
      excludeOnsite: !!profile?.excludeOnsite,
    };

    const threshold = user.matchThreshold ?? 65;

    // Delete old matches for this user
    await prisma.jobMatch.deleteMany({ where: { userId: user.id } });

    let userCreated = 0;
    let userAbove = 0;
    let userNotified = 0;
    const batch: any[] = [];

    for (const job of jobs) {
      const jobInput = {
        title: job.title,
        skills: job.skills.map((s: any) => s.skill.name),
        locationClass: job.locationClass,
        location: job.location,
        country: job.country ?? undefined,
        employmentType: job.employmentType,
        experienceLevel: job.experienceLevel,
        salary: job.salary,
        workPlace: job.workPlace,
        parseConfidence: job.parseConfidence,
        postedAt: job.postedDate,
      };

      const result = scoreJob(jobInput, prof);

      batch.push({
        userId: user.id,
        jobId: job.id,
        score: result.score,
        roleScore: result.parts.find((p: any) => p.label === 'Role')!.weight * result.parts.find((p: any) => p.label === 'Role')!.fraction,
        skillScore: result.parts.find((p: any) => p.label === 'Skills')!.weight * result.parts.find((p: any) => p.label === 'Skills')!.fraction,
        experienceScore: result.parts.find((p: any) => p.label === 'Experience')!.weight * result.parts.find((p: any) => p.label === 'Experience')!.fraction,
        locationScore: result.parts.find((p: any) => p.label === 'Location')!.weight * result.parts.find((p: any) => p.label === 'Location')!.fraction,
        employmentScore: result.parts.find((p: any) => p.label === 'Employment')!.weight * result.parts.find((p: any) => p.label === 'Employment')!.fraction,
        freshnessScore: result.parts.find((p: any) => p.label === 'Freshness')!.weight * result.parts.find((p: any) => p.label === 'Freshness')!.fraction,
        salaryScore: result.parts.find((p: any) => p.label === 'Salary')!.weight * result.parts.find((p: any) => p.label === 'Salary')!.fraction,
        matchedSkills: JSON.stringify(result.matchedSkills),
        relatedSkills: JSON.stringify(result.relatedSkills),
        missingSkills: JSON.stringify(result.missingSkills),
        reasons: JSON.stringify(result.reasons),
        summary: result.summary,
      });

      if (result.score >= threshold) {
        userAbove++;

        // Create notification if not already notified
        const existing = await prisma.notification.findFirst({
          where: { userId: user.id, jobId: job.id },
        });
        if (!existing) {
          try {
            await prisma.notification.create({
              data: {
                userId: user.id,
                jobId: job.id,
                channel: 'WEB',
                status: 'UNREAD_WEB',
                score: result.score,
                summary: result.summary,
              },
            });
            userNotified++;
          } catch { /* skip */ }
        }
      }

      // Batch insert every 50 jobs
      if (batch.length >= 50) {
        try {
          await (prisma.jobMatch as any).createMany({ data: [...batch], skipDuplicates: true });
          userCreated += batch.length;
        } catch {
          for (const row of batch) {
            try { await prisma.jobMatch.create({ data: row }); userCreated++; } catch { /* skip */ }
          }
        }
        batch.length = 0;
      }
    }

    // Insert remaining
    if (batch.length > 0) {
      try {
        await (prisma.jobMatch as any).createMany({ data: [...batch], skipDuplicates: true });
        userCreated += batch.length;
      } catch {
        for (const row of batch) {
          try { await prisma.jobMatch.create({ data: row }); userCreated++; } catch { /* skip */ }
        }
      }
    }

    totalMatches += userCreated;
    totalAbove += userAbove;
    totalNotifications += userNotified;

    console.log(`  ${user.email}: ${userCreated} matches, ${userAbove} above ${threshold}, ${userNotified} notifications`);
  }

  // Mark all jobs as matched
  await prisma.job.updateMany({
    where: { status: 'ACTIVE', matchedAt: null },
    data: { matchedAt: new Date() },
  });

  console.log(`\nDone! Total: ${totalMatches} matches, ${totalAbove} above threshold, ${totalNotifications} notifications`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
