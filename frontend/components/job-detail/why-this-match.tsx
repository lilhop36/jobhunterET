'use client';

import { SkillChips } from './skill-chips';
import type { JobDetail } from './types';

/** "Why this match" section: summary, requirement verdicts, and evidence. */
export function WhyThisMatch({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return null;

  const preferredMet = (m.preferredRequirements ?? []).filter((r) => r.status === 'MET');
  const preferredMissing = (m.preferredRequirements ?? []).filter((r) => r.status === 'MISSING');

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Why this match</h2>
      <p>{m.summary}</p>
      <ul className="clean">
        {m.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>

      {m.missingRequirements?.length > 0 && (
        <p>
          <strong>Missing requirements:</strong> {m.missingRequirements.join(', ')}
        </p>
      )}
      {m.unknownRequirements?.length > 0 && (
        <p className="muted">
          <strong>Unknown requirements (not counted as met):</strong>{' '}
          {m.unknownRequirements.join(', ')}
        </p>
      )}
      {preferredMet.length > 0 && (
        <p>
          <strong>Preferred qualifications you already have:</strong>{' '}
          {preferredMet.map((r) => r.name).join(', ')}
        </p>
      )}
      {preferredMissing.length > 0 && (
        <p className="muted">
          <strong>Preferred, not verified:</strong>{' '}
          {preferredMissing.map((r) => r.name).join(', ')}
        </p>
      )}
      {m.vacancyRisk && m.vacancyRisk !== 'OK' && (
        <p className="notice-amber">
          Vacancy risk: {m.vacancyRisk.toLowerCase()} — verify the posting before applying.
        </p>
      )}

      <h3 style={{ marginTop: 14 }}>Skill coverage</h3>
      <SkillChips
        matchedSkills={m.matchedSkills}
        relatedSkills={m.relatedSkills}
        missingSkills={m.missingSkills}
      />

      {m.evidence?.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary>How this score was calculated</summary>
          <ul className="clean">
            {m.evidence.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
