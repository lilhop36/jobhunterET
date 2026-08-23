'use client';

import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface SalaryBenchmark {
  hasSalary: boolean;
  salary?: number;
  currency?: string;
  benchmark?: {
    role: string;
    level: string;
    etb: { min: number; median: number; max: number; currency: string };
    usd: { min: number; median: number; max: number; currency: string };
    notes?: string;
  } | null;
  percentile?: number | null;
  comparison?: string | null;
  percentAboveMedian?: number;
}

interface Props {
  benchmark: SalaryBenchmark | null;
  jobSalary: number | null;
  jobCurrency: string;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function PercentileBar({ percentile }: { percentile: number }) {
  const color =
    percentile >= 80
      ? 'hsl(var(--success))'
      : percentile >= 50
        ? 'hsl(var(--info))'
        : percentile >= 20
          ? 'hsl(35, 90%, 55%)'
          : 'hsl(var(--destructive))';

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span className="muted">Below market</span>
        <span style={{ fontWeight: 600, color }}>Top {100 - percentile}%</span>
        <span className="muted">Above market</span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'hsl(var(--muted))',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${percentile}%`,
            background: color,
            borderRadius: 3,
            transition: 'width 0.5s ease',
          }}
        />
        {/* Median marker */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: -2,
            width: 2,
            height: 10,
            background: 'hsl(var(--foreground))',
            opacity: 0.4,
          }}
        />
      </div>
    </div>
  );
}

export function SalaryBenchmarkCard({ benchmark, jobSalary, jobCurrency }: Props) {
  if (!benchmark) return null;

  const { hasSalary, percentile, comparison, percentAboveMedian, benchmark: bench } = benchmark;

  if (!bench) {
    return (
      <div className="card" style={{ borderLeft: '3px solid hsl(var(--info))' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info className="h-4 w-4" /> Salary benchmark
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          No benchmark data available for this role yet. We&apos;re building the Ethiopian tech salary database.
        </p>
      </div>
    );
  }

  const ref = bench.etb; // Always show ETB for Ethiopia-first

  return (
    <div className="card" style={{ borderLeft: '3px solid hsl(var(--primary))' }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <TrendingUp className="h-4 w-4" /> Ethiopian market benchmark
      </h3>

      <div style={{ fontSize: 13.5, marginBottom: 8 }}>
        <span className="muted">
          {bench.role} · {bench.level} level · Ethiopia
        </span>
        {bench.notes && (
          <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
            💡 {bench.notes}
          </span>
        )}
      </div>

      {/* Market range */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 11 }}>Low</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>ETB {fmt(ref.min)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 11 }}>Median</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'hsl(var(--primary))' }}>
            ETB {fmt(ref.median)}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 11 }}>High</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>ETB {fmt(ref.max)}</div>
        </div>
      </div>

      {/* Percentile bar */}
      {hasSalary && percentile != null && <PercentileBar percentile={percentile} />}

      {/* Comparison text */}
      {comparison && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 8,
            background:
              percentile != null && percentile >= 50
                ? 'hsl(var(--success) / 0.08)'
                : 'hsl(35, 90%, 55%, 0.08)',
            fontSize: 13,
          }}
        >
          {percentile != null && percentile >= 50 ? (
            <TrendingUp className="h-4 w-4" style={{ color: 'hsl(var(--success))' }} />
          ) : percentile != null && percentile >= 20 ? (
            <Minus className="h-4 w-4" style={{ color: 'hsl(35, 90%, 55%)' }} />
          ) : (
            <TrendingDown className="h-4 w-4" style={{ color: 'hsl(var(--destructive))' }} />
          )}
          <span>{comparison}</span>
        </div>
      )}

      {/* No salary on job */}
      {!hasSalary && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'hsl(var(--muted) / 0.4)', fontSize: 13 }}>
          <span className="muted">
            This posting doesn&apos;t list a salary. Market range above is for reference.
          </span>
        </div>
      )}

      {/* USD equivalent */}
      {bench.usd && (
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          USD equivalent: ${fmt(bench.usd.min)} – ${fmt(bench.usd.max)} (median ${fmt(bench.usd.median)})
        </div>
      )}
    </div>
  );
}
