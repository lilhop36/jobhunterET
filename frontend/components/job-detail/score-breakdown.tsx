'use client';

import { PARTS } from './types';
import { scoreBand } from './utils';
import type { JobDetail } from './types';

/** Score breakdown bars for each matching dimension + skills required chips. */
export function ScoreBreakdown({ job }: { job: JobDetail }) {
  const m = job.match;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Score breakdown</h2>
      {m ? (
        <>
          {PARTS.map((p) => {
            const pct = Math.round((m.parts[p.key] / p.max) * 100);
            const band = scoreBand(pct);
            return (
              <div key={p.key} className="score-row">
                <div className="score-row-header">
                  <span>{p.label}</span>
                  <span className={`score-pct ${band}`}>{pct}%</span>
                </div>
                <div className={`bar ${band}`}>
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <p className="muted">No match data yet.</p>
      )}

      <h3 style={{ marginTop: 16 }}>Skills required</h3>
      <div>
        {job.skills.length > 0 ? (
          job.skills.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            No skills listed.
          </span>
        )}
      </div>
    </div>
  );
}
