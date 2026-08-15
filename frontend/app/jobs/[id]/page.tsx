'use client';

import { useParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { RequireAuth, useApi, ErrorBox, Loading, ScoreBadge, fmtDate } from '../../../lib/ui';
import { buttonVariants } from '../../../components/ui/button';
import { JobActions } from '../../../components/job-actions';

interface JobDetail {
  id: string;
  title: string;
  company: string;
  location: string;
  locationClass: string;
  workPlace: string;
  employmentType: string;
  experienceLevel: string;
  salary: number | null;
  currency: string;
  url: string;
  description: string | null;
  skills: string[];
  source: { name: string; tier: string };
  postedDate: string;
  deadline: string | null;
  status: string;
  parseConfidence: number;
  saved: boolean;
  application: { stage: string; stageSince: string } | null;
  match: {
    score: number;
    matchedSkills: string[];
    relatedSkills: string[];
    missingSkills: string[];
    reasons: string[];
    summary: string;
    parts: { role: number; skill: number; experience: number; location: number; employment: number; freshness: number; salary: number };
  } | null;
}

type PartKey = 'role' | 'skill' | 'experience' | 'location' | 'employment' | 'freshness' | 'salary';

const PARTS: { key: PartKey; label: string; max: number }[] = [
  { key: 'role', label: 'Role', max: 25 },
  { key: 'skill', label: 'Skills', max: 30 },
  { key: 'experience', label: 'Experience', max: 15 },
  { key: 'location', label: 'Location', max: 15 },
  { key: 'employment', label: 'Employment', max: 5 },
  { key: 'freshness', label: 'Freshness', max: 5 },
  { key: 'salary', label: 'Salary', max: 5 },
];

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, err, loading, reload } = useApi<JobDetail>(`/api/jobs/${params.id}`);
  const m = data?.match ?? null;

  return (
    <RequireAuth>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}
      {data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <h1 style={{ flex: 1 }}>{data.title}</h1>
            {m && <ScoreBadge score={m.score} />}
          </div>
          <p className="subtitle">
            {data.company} · {data.location} · {data.workPlace} · {data.employmentType} ·{' '}
            {data.experienceLevel} · posted {fmtDate(data.postedDate)}
            {data.deadline && ` · deadline ${fmtDate(data.deadline)}`}
          </p>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Quick actions</h2>
            <JobActions jobId={data.id} saved={data.saved} application={data.application} />
          </div>

          <div className="grid grid-2">
            <div className="card">
              <h2>Why this match</h2>
              {m ? (
                <>
                  <p>{m.summary}</p>
                  <ul className="clean">
                    {m.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <h3 style={{ marginTop: 14 }}>Matched skills</h3>
                  <div>
                    {m.matchedSkills.map((s) => (
                      <span key={s} className="chip match" title="Matched skill">
                        ✓ {s}
                      </span>
                    ))}
                    {m.relatedSkills.map((s) => (
                      <span key={s} className="chip related" title="Related via skill graph">
                        ~ {s}
                      </span>
                    ))}
                    {m.missingSkills.map((s) => (
                      <span key={s} className="chip miss" title="Missing skill">
                        ✗ {s}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">No match computed yet — recalculate from the Matches page.</p>
              )}
            </div>

            <div className="card">
              <h2>Score breakdown</h2>
              {m ? (
                PARTS.map((p) => (
                  <div key={p.key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{p.label}</span>
                      <span className="muted">{Math.round((m.parts[p.key] / p.max) * 100)}%</span>
                    </div>
                    <div className="bar">
                      <div style={{ width: `${(m.parts[p.key] / p.max) * 100}%` }} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No breakdown available.</p>
              )}
              <h3 style={{ marginTop: 14 }}>Skills required</h3>
              <div>
                {data.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Details</h2>
            <p>{data.description || 'No description provided.'}</p>
            <p className="muted" style={{ fontSize: 13 }}>
              Source: {data.source.name} ({data.source.tier}) · parse confidence {data.parseConfidence}% · status{' '}
              {data.status}
              {data.salary != null && ` · salary ${data.salary} ${data.currency}`}
            </p>
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={data.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              Apply on source site
            </a>
          </div>
        </>
      )}
    </RequireAuth>
  );
}
