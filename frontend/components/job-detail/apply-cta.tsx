'use client';

import { useState } from 'react';
import {
  ExternalLink,
  Copy,
  MapPin,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { buttonVariants } from '../ui/button';
import { cleanEmail } from './utils';
import type { JobDetail } from './types';

/**
 * Adaptive apply CTA based on applyMethod.
 * Shows different UI for ONLINE_URL, EMAIL, IN_PERSON, SOURCE_ACCOUNT, PDF_FORM.
 */
export function ApplyCTA({ job }: { job: JobDetail }) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  const copyEmail = () => {
    if (job.applyEmail) {
      navigator.clipboard.writeText(cleanEmail(job.applyEmail));
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const method = job.applyMethod || 'ONLINE_URL';
  const isDead = job.urlStatus === 'NOT_FOUND' || job.urlStatus === 'ERROR';

  if (isDead) {
    return (
      <div className="notice-amber" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle className="h-4 w-4" />
        <span>This apply link may be dead (status: {job.urlStatus}). Check the source site directly.</span>
      </div>
    );
  }

  switch (method) {
    case 'EMAIL':
      return (
        <>
          <button className="btn" onClick={copyEmail}>
            <Copy className="h-4 w-4" />
            {copiedEmail ? 'Copied!' : `Copy email: ${cleanEmail(job.applyEmail) ?? ''}`}
          </button>
          {(job.applyUrl || job.url) && (
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={job.applyUrl || job.url}
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
          href={job.applyUrl || job.url}
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
            href={job.applyUrl || job.url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            Apply on source site
          </a>
          {cleanEmail(job.applyEmail) && (
            <button className={buttonVariants({ variant: 'outline' })} onClick={copyEmail}>
              <Copy className="h-4 w-4" />
              {copiedEmail ? 'Copied!' : `Email: ${cleanEmail(job.applyEmail)}`}
            </button>
          )}
        </>
      );
  }
}
