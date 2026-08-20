'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  ExternalLink,
  Copy,
  MapPin,
  FileText,
  AlertTriangle,
  Building2,
  Clock,
  Briefcase,
  CalendarDays,
  BadgeDollarSign,
  Link2,
} from 'lucide-react';
import {
  RequireAuth,
  useApi,
  ErrorBox,
  Loading,
  ScoreBadge,
  fmtDate,
  fmtDeadline,
} from '../../../lib/ui';
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
  salaryMax: number | null;
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
    parts: {
      role: number;
      skill: number;
      experience: number;
      location: number;
      employment: number;
      freshness: number;
      salary: number;
    };
  } | null;
}

type PartKey = 'role' | 'skill' | 'experience' | 'location' | 'employment' | 'freshness' | 'salary';

const PARTS: { key: PartKey; label: string; max: number }[] = [
  { key: 'role',       label: 'Role',       max: 25 },
  { key: 'skill',      label: 'Skills',     max: 30 },
  { key: 'experience', label: 'Experience', max: 15 },
  { key: 'location',   label: 'Location',   max: 15 },
  { key: 'employment', label: 'Employment', max: 5  },
  { key: 'freshness',  label: 'Freshness',  max: 5  },
  { key: 'salary',     label: 'Salary',     max: 5  },
];

/** Sanitise HTML: strip scripts/iframes and dangerous attributes. */
function sanitiseHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Strip all HTML tags and decode common entities from a string.
 * Used to sanitise fields like applyEmail that may contain raw HTML from scraping.
 */
function cleanEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  // Strip anything that looks like an HTML tag or leftover attribute fragments
  const stripped = raw
    .replace(/<[^>]*>/g, '')          // remove <tags>
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Remove leftover attribute garbage like `">` or `'>` that appears after stripping
    .replace(/["'>]+/g, ' ')
    .trim();
  // Extract the first email-shaped token
  const match = stripped.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : stripped;
}

/**
 * Plain-text → HTML.
 * - Double newlines become paragraph breaks.
 * - Single newlines become <br/>.
 * - Lines that look like pipe-table rows (│col│col│ or |col|col|) become a <table>.
 */
function plainToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      // Detect a pipe-table block: majority of lines contain | with at least 2 cells
      const tableLines = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2);
      if (tableLines.length >= 2 && tableLines.length >= lines.length * 0.6) {
        const rows = lines
          .filter((l) => l.trim() && !/^[\s|\-]+$/.test(l)) // skip separator lines
          .map((l) => {
            const cells = l.split('|').map((c) => c.trim()).filter(Boolean);
            return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
          });
        return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0">${rows.join('')}</table>`;
      }
      return `<p>${lines.join('<br/>')}</p>`;
    })
    .join('');
}

function RichDescription({ text }: { text: string }) {
  const html = useMemo(() => {
    const isHtml = /<[a-z][\s\S]*>/i.test(text);
    return isHtml ? sanitiseHtml(text) : plainToHtml(text);
  }, [text]);

  return (
    <div
      className="prose"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Company initials from name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Colour band for a score percentage. */
function scoreBand(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 75) return 'high';
  if (pct >= 45) return 'mid';
  return 'low';
}

/** Format salary range. */
function fmtSalary(
  salary: number | null,
  salaryMax: number | null,
  currency: string,
): string {
  if (salary == null) return '—';
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (salaryMax != null && salaryMax > salary)
    return `${currency} ${fmt(salary)} – ${fmt(salaryMax)}`;
  return `${currency} ${fmt(salary)}`;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, err, loading, reload } = useApi<JobDetail>(`/api/jobs/${params.id}`);
  const m = data?.match ?? null;
  const [copiedEmail, setCopiedEmail] = useState(false);

  const copyEmail = () => {
    if (data?.applyEmail) {
      navigator.clipboard.writeText(cleanEmail(data.applyEmail));
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
          <>
            <button className="btn" onClick={copyEmail}>
              <Copy className="h-4 w-4" />
              {copiedEmail ? 'Copied!' : `Copy email: ${cleanEmail(data.applyEmail) ?? ''}`}
            </button>
            {(data.applyUrl || data.url) && (
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={data.applyUrl || data.url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                View on source site
              </a>
            )}
          </>
        );
      case 'IN_PERSON':
        return (
          <div className="notice">
            <MapPin className="h-4 w-4" style={{ marginRight: 6, display: 'inline' }} />
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
          <>
            <a
              className="btn"
              href={data.applyUrl || data.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              Apply on source site
            </a>
            {cleanEmail(data.applyEmail) && (
              <button className={buttonVariants({ variant: 'outline' })} onClick={copyEmail}>
                <Copy className="h-4 w-4" />
                {copiedEmail ? 'Copied!' : `Email: ${cleanEmail(data.applyEmail)}`}
              </button>
            )}
          </>
        );
    }
  };

  return (
    <RequireAuth>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}
      {data && (() => {
        const dl = fmtDeadline(data.deadline);
        const salaryStr = fmtSalary(data.salary, (data as any).salaryMax ?? null, data.currency);

        return (
          <>
            {/* ── Hero header ───────────────────────────────────────── */}
            <div className="detail-hero">
              <div className="company-avatar" aria-hidden="true">
                {initials(data.company) || '?'}
              </div>
              <div className="hero-text">
                <h1>{data.title}</h1>
                <div className="hero-company">{data.company}</div>
                <div className="hero-pills">
                  <span className="meta-pill primary">
                    <MapPin className="h-3 w-3" /> {data.location}
                  </span>
                  <span className="meta-pill">{data.workPlace}</span>
                  <span className="meta-pill">{data.employmentType}</span>
                  {data.experienceLevel && (
                    <span className="meta-pill">{data.experienceLevel}</span>
                  )}
                  <span className="meta-pill">
                    <Clock className="h-3 w-3" /> posted {fmtDate(data.postedDate)}
                  </span>
                </div>
              </div>
              {m && (
                <div className="hero-score">
                  <ScoreBadge score={m.score} />
                </div>
              )}
            </div>

            {/* ── Low-confidence warning (FR-012c) ─────────────────── */}
            {data.parseConfidence < 40 && (
              <div className="notice-amber">
                ⚠️ Low parse confidence ({data.parseConfidence}%) — details may be unreliable.
              </div>
            )}

            {/* ── Quick actions ─────────────────────────────────────── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Quick actions</h2>
              <JobActions jobId={data.id} saved={data.saved} application={data.application} />
            </div>

            {/* ── Metadata + score breakdown (2-col grid) ───────────── */}
            <div className="grid grid-2">
              {/* Structured metadata */}
              <div className="card kv-card">
                <h2 style={{ marginTop: 0 }}>Details</h2>
                <div className="kv">
                  {salaryStr !== '—' && (
                    <>
                      <span className="k">
                        <BadgeDollarSign
                          className="h-3.5 w-3.5"
                          style={{ display: 'inline', marginRight: 4 }}
                        />
                        Salary
                      </span>
                      <span className="v">{salaryStr}</span>
                    </>
                  )}

                  {dl.band && (
                    <>
                      <span className="k">
                        <CalendarDays
                          className="h-3.5 w-3.5"
                          style={{ display: 'inline', marginRight: 4 }}
                        />
                        Deadline
                      </span>
                      <span className="v deadline-soon">
                        {dl.label}
                        {dl.daysLeft !== null && dl.daysLeft > 0 && (
                          <span className={`deadline-badge ${dl.band}`}>
                            {dl.daysLeft === 1 ? '1 day left' : `${dl.daysLeft} days left`}
                          </span>
                        )}
                        {dl.daysLeft !== null && dl.daysLeft <= 0 && (
                          <span className="deadline-badge urgent">Expired</span>
                        )}
                      </span>
                    </>
                  )}

                  <span className="k">
                    <Briefcase
                      className="h-3.5 w-3.5"
                      style={{ display: 'inline', marginRight: 4 }}
                    />
                    Experience
                  </span>
                  <span className="v">{data.experienceLevel || '—'}</span>

                  <span className="k">
                    <Building2
                      className="h-3.5 w-3.5"
                      style={{ display: 'inline', marginRight: 4 }}
                    />
                    Source
                  </span>
                  <span className="v">
                    {data.source.name}{' '}
                    <span className="muted">
                      ({data.source.tier}) · {data.parseConfidence}% parse confidence
                    </span>
                  </span>

                  {data.urlStatus && (
                    <>
                      <span className="k">
                        <Link2
                          className="h-3.5 w-3.5"
                          style={{ display: 'inline', marginRight: 4 }}
                        />
                        Link status
                      </span>
                      <span
                        className="v"
                        style={{
                          color:
                            data.urlStatus === 'OK'
                              ? 'hsl(var(--success))'
                              : data.urlStatus === 'NOT_FOUND' || data.urlStatus === 'ERROR'
                              ? 'hsl(var(--destructive))'
                              : undefined,
                        }}
                      >
                        {data.urlStatus}
                      </span>
                    </>
                  )}

                  {data.descriptionQuality != null && (
                    <>
                      <span className="k">Description quality</span>
                      <span className="v">{data.descriptionQuality}%</span>
                    </>
                  )}
                </div>

                {/* Apply CTA inside this card on desktop */}
                <div style={{ marginTop: 18 }}>
                  <div className="apply-cta-bar">{renderApplyCTA()}</div>
                </div>
              </div>

              {/* Score breakdown */}
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
                  <p className="muted">No breakdown available.</p>
                )}

                <h3 style={{ marginTop: 16 }}>Skills required</h3>
                <div>
                  {data.skills.length > 0 ? (
                    data.skills.map((s) => (
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
            </div>

            {/* ── Why this match ────────────────────────────────────── */}
            {m && (
              <div className="card">
                <h2 style={{ marginTop: 0 }}>Why this match</h2>
                <p>{m.summary}</p>
                <ul className="clean">
                  {m.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <h3 style={{ marginTop: 14 }}>Skill coverage</h3>
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
                  {m.matchedSkills.length === 0 &&
                    m.relatedSkills.length === 0 &&
                    m.missingSkills.length === 0 && (
                      <span className="muted" style={{ fontSize: 13 }}>
                        No skill data available.
                      </span>
                    )}
                </div>
              </div>
            )}

            {/* ── Job description ───────────────────────────────────── */}
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Job description</h2>
              {data.description ? (
                <RichDescription text={data.description} />
              ) : (
                <p className="muted">No description provided.</p>
              )}
            </div>
          </>
        );
      })()}
    </RequireAuth>
  );
}
