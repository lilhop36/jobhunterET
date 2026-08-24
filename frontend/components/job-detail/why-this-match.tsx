'use client';

import { SkillChips } from './skill-chips';
import type { JobDetail } from './types';

/** "Why this match" section: summary, reasons, and skill coverage. */
export function WhyThisMatch({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return null;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Why this match</h2>
      <p>{m.summary}</p>
      <ul className="clean">
        {m.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <h3 style={{ marginTop: 14 }}>Skill coverage</h3>
      <SkillChips
        matchedSkills={m.matchedSkills}
        relatedSkills={m.relatedSkills}
        missingSkills={m.missingSkills}
      />
    </div>
  );
}
