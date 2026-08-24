'use client';

import {
  BadgeDollarSign,
  CalendarDays,
  Briefcase,
  Building2,
  Link2,
} from 'lucide-react';
import { fmtDeadline } from '../../lib/ui';
import { fmtSalary } from './utils';
import { ApplyCTA } from './apply-cta';
import type { JobDetail } from './types';

/** Structured metadata card with salary, deadline, experience, source, and apply CTA. */
export function JobMetadata({ job }: { job: JobDetail }) {
  const dl = fmtDeadline(job.deadline);
  const salaryStr = fmtSalary(job.salary, job.salaryMax ?? null, job.currency);

  return (
    <div className="card kv-card">
      <h2 style={{ marginTop: 0 }}>Details</h2>
      <div className="kv">
        {salaryStr !== '—' && (
          <>
            <span className="k">
              <BadgeDollarSign className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
              Salary
            </span>
            <span className="v">{salaryStr}</span>
          </>
        )}

        {dl.band && (
          <>
            <span className="k">
              <CalendarDays className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
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
          <Briefcase className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
          Experience
        </span>
        <span className="v">{job.experienceLevel || '—'}</span>

        <span className="k">
          <Building2 className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
          Source
        </span>
        <span className="v">
          {job.source.name}{' '}
          <span className="muted">
            ({job.source.tier}) · {job.parseConfidence}% parse confidence
          </span>
        </span>

        {job.urlStatus && (
          <>
            <span className="k">
              <Link2 className="h-3.5 w-3.5" style={{ display: 'inline', marginRight: 4 }} />
              Link status
            </span>
            <span
              className="v"
              style={{
                color:
                  job.urlStatus === 'OK'
                    ? 'hsl(var(--success))'
                    : job.urlStatus === 'NOT_FOUND' || job.urlStatus === 'ERROR'
                    ? 'hsl(var(--destructive))'
                    : undefined,
              }}
            >
              {job.urlStatus}
            </span>
          </>
        )}

        {job.descriptionQuality != null && (
          <>
            <span className="k">Description quality</span>
            <span className="v">{job.descriptionQuality}%</span>
          </>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="apply-cta-bar">
          <ApplyCTA job={job} />
        </div>
      </div>
    </div>
  );
}
