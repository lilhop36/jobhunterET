'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, Copy, MapPin, FileText, AlertTriangle } from 'lucide-react';
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
  applyMethod: string;
  applyUrl: string | null;
  applyEmail: string | null;
  urlStatus: string | null;
  descriptionQuality: number | null;
  descriptionSource: string | null;
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
  const [copiedEmail, setCopiedEmail] = useState(false);

  const copyEmail = () => {
    if (data?.applyEmail) {
      navigator.clipboard.writeText(data.applyEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  /** FR-025: Adaptive apply CTA based on applyMethod. */
  const renderApplyCTA = () => {
    if (!data) return null;
    const method = data.applyMethod || 'ONLINE_URL';
    const isDead = data.urlStatus === 'NOT_FOUND' || data.urlStatus === 'ERROR';

    if (isDead) {
      return (
        <div className="notice-amber" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle className="h-4 w-4" />
          <span>This apply link may be dead (status: {data.urlStatus}). Check the source site directly.</span>
        </div>
      );
    }

    switch (method) {
      case 'EMAIL':
        return (
          <button className="btn" onClick={copyEmail}>
            <Copy className="h-4 w-4" />
            {copiedEmail ? 'Copied!' : `Copy Email: ${data.applyEmail || ''}`}
          </button>
        );
      case 'IN_PERSON':
        return (
          <div className="notice">
            <MapPin className="h-4 w-4" style={{ marginRight: 6 }} />
            Apply in person — see description for address and office hours.
          </div>
        );
      case 'SOURCE_ACCOUNT':
        return (
          <div className="notice-amber">
            This posting requires an account on the source platform. Visit the source site to create one.
          </div>
        );
      case 'PDF_FORM':
        return (
          <a
            className={buttonVariants({ variant: 'outline' })}
            href={data.applyUrl || data.url}
            target="_blank"
            rel="noreferrer"
          >
            <FileText className="h-4 w-4" />
            Open Application Form (PDF)
          </a>
        );
      case 'ONLINE_URL':
      default:
        return (
          <a
            className={buttonVariants({ variant: 'outline' })}
            href={data.applyUrl || data.url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            Apply on source site
          </a>
        );
    }
  };

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

          {/* FR-012c: Low-confidence warning */}
          {data.parseConfidence < 40 && (
            <div className="notice-amber">
              ⚠️ Low parse confidence ({data.parseConfidence}%) — details may be unreliable.
            </div>
          )}

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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
              {renderApplyCTA()}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              Source: {data.source.name} ({data.source.tier}) · parse confidence {data.parseConfidence}% · status{' '}
              {data.status}
              {data.salary != null && ` · salary ${data.salary} ${data.currency}`}
              {data.descriptionQuality != null && ` · description quality ${data.descriptionQuality}%`}
              {data.descriptionSource && ` · via ${data.descriptionSource}`}
              {data.urlStatus && ` · link status: ${data.urlStatus}`}
            </p>
          </div>
        </>
      )}
    </RequireAuth>
  );
}
