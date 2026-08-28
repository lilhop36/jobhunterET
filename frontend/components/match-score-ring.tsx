'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

function bandFor(score: number) {
  if (score >= 90) return { stroke: '#10b981', label: 'Excellent', text: 'text-emerald-600 dark:text-emerald-400' };
  if (score >= 80) return { stroke: '#3b82f6', label: 'Strong', text: 'text-blue-600 dark:text-blue-400' };
  if (score >= 70) return { stroke: '#f59e0b', label: 'Good', text: 'text-amber-600 dark:text-amber-400' };
  if (score >= 60) return { stroke: '#64748b', label: 'Possible', text: 'text-slate-600 dark:text-slate-400' };
  return { stroke: '#ef4444', label: 'Low', text: 'text-red-600 dark:text-red-400' };
}

export interface BestMatch {
  score: number;
  jobId: string;
  title: string;
  company: string;
}

export function MatchScoreRing({
  match,
  stats,
}: {
  match: BestMatch | null;
  stats?: { new24h: number; saved: number; inFlight: number };
}) {
  const score = match?.score ?? 0;
  const band = bandFor(score);

  const size = 160;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="match-hero">
      <div className="match-hero__ring-wrap">
        <div
          className="match-hero__ring"
          role="img"
          aria-label={`Best match score: ${score}%`}
        >
          <svg
            className="match-hero__svg"
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
          >
            {/* Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={stroke}
              className="stroke-muted"
            />
            {/* Fill */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              className="match-hero__fill"
              style={{
                stroke: band.stroke,
                strokeDasharray: circumference,
                strokeDashoffset: offset,
              }}
            />
          </svg>
          <div className="match-hero__center">
            <span className={cn('match-hero__score', band.text)}>{score}</span>
            <span className="match-hero__label">%</span>
          </div>
        </div>
      </div>

      <div className="match-hero__info">
        <div className="match-hero__band">{band.label} match</div>
        {match ? (
          <Link href={`/jobs/${match.jobId}`} className="match-hero__job">
            <span className="match-hero__title">{match.title}</span>
            <span className="match-hero__company">{match.company}</span>
          </Link>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Complete your profile to get matches.
          </p>
        )}
        {stats && (
          <div className="match-hero__stats">
            <div className="match-hero__stat">
              <span className="match-hero__stat-num">{stats.new24h}</span>
              <span className="match-hero__stat-lbl">new 24h</span>
            </div>
            <div className="match-hero__stat">
              <span className="match-hero__stat-num">{stats.saved}</span>
              <span className="match-hero__stat-lbl">saved</span>
            </div>
            <div className="match-hero__stat">
              <span className="match-hero__stat-num">{stats.inFlight}</span>
              <span className="match-hero__stat-lbl">in progress</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
