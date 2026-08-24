'use client';

/** Renders matched (✓), related (~), and missing (✗) skill chips. */
export function SkillChips({
  matchedSkills,
  relatedSkills,
  missingSkills,
}: {
  matchedSkills: string[];
  relatedSkills: string[];
  missingSkills: string[];
}) {
  const hasAny = matchedSkills.length > 0 || relatedSkills.length > 0 || missingSkills.length > 0;

  return (
    <div>
      {matchedSkills.map((s) => (
        <span key={s} className="chip match" title="Matched skill">
          ✓ {s}
        </span>
      ))}
      {relatedSkills.map((s) => (
        <span key={s} className="chip related" title="Related via skill graph">
          ~ {s}
        </span>
      ))}
      {missingSkills.map((s) => (
        <span key={s} className="chip miss" title="Missing skill">
          ✗ {s}
        </span>
      ))}
      {!hasAny && (
        <span className="muted" style={{ fontSize: 13 }}>
          No skill data available.
        </span>
      )}
    </div>
  );
}
