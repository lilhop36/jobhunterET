'use client';

import { MapPin, Clock } from 'lucide-react';
import { ScoreBadge, fmtDate } from '../../lib/ui';
import { initials } from './utils';
import type { JobDetail } from './types';

/** Hero header: company avatar, title, meta pills, and match score. */
export function JobHero({ job }: { job: JobDetail }) {
  const m = job.match;

  return (
    <div className="detail-hero">
      <div className="company-avatar" aria-hidden="true">
        {initials(job.company) || '?'}
      </div>
      <div className="hero-text">
        <h1>{job.title}</h1>
        <div className="hero-company">{job.company}</div>
        <div className="hero-pills">
          <span className="meta-pill primary">
            <MapPin className="h-3 w-3" /> {job.location}
          </span>
          <span className="meta-pill">{job.workPlace}</span>
          <span className="meta-pill">{job.employmentType}</span>
          {job.experienceLevel && (
            <span className="meta-pill">{job.experienceLevel}</span>
          )}
          <span className="meta-pill">
            <Clock className="h-3 w-3" /> posted {fmtDate(job.postedDate)}
          </span>
        </div>
      </div>
      {m && (
        <div className="hero-score">
          <ScoreBadge score={m.score} />
        </div>
      )}
    </div>
  );
}
