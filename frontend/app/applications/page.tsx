'use client';

import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading } from '../../lib/ui';
import { ChevronDown } from 'lucide-react';

interface Board {
  applications: {
    jobId: string;
    title: string;
    company: string;
    location: string;
    stage: string;
    stageSince: string;
    followUp: string | null;
  }[];
  savedCount: number;
  discovered: { jobId: string; title: string; company: string }[];
}

const STAGES = ['DISCOVERED', 'SAVED', 'APPLIED', 'ASSESSMENT', 'INTERVIEW', 'OFFER'];
const TERMINAL = ['REJECTED', 'WITHDRAWN'];

export default function ApplicationsPage() {
  const { api } = useAuth();
  const { data, err, loading, reload } = useApi<Board>('/api/applications');
  const [showTerminal, setShowTerminal] = useState(false);

  const setStage = async (jobId: string, stage: string) => {
    await api(`/api/applications/${jobId}/stage`, { method: 'POST', body: JSON.stringify({ stage }) });
    reload();
  };

  return (
    <RequireAuth>
      <h1>Applications</h1>
      <p className="subtitle">Your pipeline: Discovered → Saved → Applied → … → Offer (FR-031).</p>
      {err && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}

      {data && (
        <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {STAGES.map((stage) => {
            const apps = data.applications.filter((a) => a.stage === stage);
            return (
              <div key={stage} className="card">
                <h3>
                  {stage} <span className="muted">({apps.length})</span>
                </h3>
                {apps.length === 0 && <p className="muted" style={{ fontSize: 13 }}>—</p>}
                {apps.map((a) => {
                  const days = Math.max(0, Math.floor((Date.now() - new Date(a.stageSince).getTime()) / 86_400_000));
                  return (
                  <div key={a.jobId} style={{ marginBottom: 10, fontSize: 13.5 }}>
                    <strong>{a.title}</strong>
                    <div className="muted">{a.company}</div>
                    <div className="muted">
                      {days}d in stage
                      {a.followUp && ` · follow-up ${new Date(a.followUp).toLocaleDateString()}`}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {STAGES.filter((s) => s !== stage && s !== 'OFFER')
                        .filter((s) => STAGES.indexOf(s) === STAGES.indexOf(stage) + 1 || STAGES.indexOf(s) === STAGES.indexOf(stage) - 1)
                        .map((s) => (
                          <button key={s} className="btn ghost small" onClick={() => setStage(a.jobId, s)}>
                            {s}
                          </button>
                        ))}
                      {!TERMINAL.includes(stage) && (
                        <button className="btn danger small" onClick={() => setStage(a.jobId, 'REJECTED')}>
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* §32.6: rejected/withdrawn in a collapsible section */}
      {data && (
        <div className="card" style={{ marginTop: 14 }}>
          <button
            className="ghost"
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }}
            onClick={() => setShowTerminal((v) => !v)}
            aria-expanded={showTerminal}
          >
            <strong>Rejected / withdrawn ({data.applications.filter((a) => TERMINAL.includes(a.stage)).length})</strong>
            <ChevronDown className="h-4 w-4" style={{ transform: showTerminal ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
          </button>
          {showTerminal && (
            <div className="grid grid-2" style={{ padding: '0 12px 12px' }}>
              {TERMINAL.map((stage) => {
                const apps = data.applications.filter((a) => a.stage === stage);
                return (
                  <div key={stage}>
                    <h3>
                      {stage} <span className="muted">({apps.length})</span>
                    </h3>
                    {apps.length === 0 && <p className="muted" style={{ fontSize: 13 }}>—</p>}
                    {apps.map((a) => (
                      <div key={a.jobId} style={{ marginBottom: 10, fontSize: 13.5 }}>
                        <strong>{a.title}</strong>
                        <div className="muted">{a.company}</div>
                        <button className="btn ghost small" onClick={() => setStage(a.jobId, 'DISCOVERED')}>
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </RequireAuth>
  );
}
