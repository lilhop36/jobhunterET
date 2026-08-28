'use client';

import { cn } from '@/lib/utils';

/**
 * Band-colored circular score badge.
 * 90-100 emerald, 80-89 blue, 70-79 amber, 60-69 slate, <60 red.
 */
export function ScoreCircle({
  score,
  size = 48,
  className,
}: {
  score: number;
  size?: number;
  className?: string;
}) {
  const band =
    score >= 90
      ? { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', ring: 'stroke-emerald-500' }
      : score >= 80
        ? { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', ring: 'stroke-blue-500' }
        : score >= 70
          ? { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', ring: 'stroke-amber-500' }
          : score >= 60
            ? { bg: 'bg-slate-500/15', text: 'text-slate-600 dark:text-slate-400', ring: 'stroke-slate-500' }
            : { bg: 'bg-red-500/15', text: 'text-red-600 dark:text-red-400', ring: 'stroke-red-500' };

  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center rounded-full', band.bg, className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score: ${score}%`}
    >
      <svg
        className="absolute inset-0 -rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={3}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          className={`${band.ring} score-ring-animate`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className={cn('relative z-10 font-bold tabular-nums', band.text)}
        style={{ fontSize: size * 0.28 }}
      >
        {score}
      </span>
    </div>
  );
}
