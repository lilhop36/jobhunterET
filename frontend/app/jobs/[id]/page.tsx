'use client';

import { useParams } from 'next/navigation';
import { RequireAuth, useApi, ErrorBox, Loading } from '../../../lib/ui';
import { SalaryBenchmarkCard } from '../../../components/salary-benchmark';
import {
  JobHero,
  JobMetadata,
  ScoreBreakdown,
  WhyThisMatch,
  RichDescription,
  type JobDetail,
} from '../../../components/job-detail';
import { JobActions } from '../../../components/job-actions';

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, err, loading, reload } = useApi<JobDetail>(`/api/jobs/${params.id}`);

  return (
    <RequireAuth>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}
      {data && (
        <>
          {/* ── Hero header ───────────────────────────────────────── */}
          <JobHero job={data} />

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
            <JobMetadata job={data} />
            <ScoreBreakdown job={data} />
          </div>

          {/* ── Why this match ────────────────────────────────────── */}
          <WhyThisMatch job={data} />

          {/* ── Salary benchmark ──────────────────────────────────── */}
          <SalaryBenchmarkCard
            benchmark={data.salaryBenchmark ?? null}
            jobSalary={data.salary}
            jobCurrency={data.currency}
          />

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
      )}
    </RequireAuth>
  );
}
