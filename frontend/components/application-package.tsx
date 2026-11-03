'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, PencilLine } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

interface ScreeningAnswer {
  question: string;
  answer: string;
  basis: string;
}

interface RequirementEvidence {
  name: string;
  kind: string;
  importance: string;
  status: string;
  evidence: string;
}

interface PackageSummary {
  version: number;
  createdAt: string;
  generatorVersion: string;
  warnings: string[];
}

interface PackageView extends PackageSummary {
  jobId: string;
  cv: string;
  coverLetter: string;
  screeningAnswers: ScreeningAnswer[];
  requirementMapping: RequirementEvidence[];
}

const STATUS_CHIP: Record<string, string> = {
  MET: 'chip match',
  PARTIAL: 'chip miss',
  MISSING: 'chip miss',
  UNKNOWN: 'chip',
};

const documentStyle = {
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.55,
  background: 'hsl(var(--muted))',
  padding: 14,
  borderRadius: 8,
  overflowX: 'auto' as const,
  maxHeight: 420,
  overflowY: 'auto' as const,
};

/**
 * Generates and renders the tailored application package for one job.
 *
 * The package is produced deterministically from verified profile rows — this
 * card cannot add experience, education, certifications or skills. Every
 * warning is shown before the candidate copies anything into a real
 * application.
 */
export function ApplicationPackageCard({ jobId }: { jobId: string }) {
  const { api } = useAuth();
  const router = useRouter();
  const [history, setHistory] = useState<PackageSummary[]>([]);
  const [selected, setSelected] = useState<PackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; status: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadVersion = useCallback(
    async (version: number) => {
      const pkg = (await api(`/api/applications/${jobId}/packages/${version}`)) as PackageView;
      setSelected(pkg);
    },
    [api, jobId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = (await api(`/api/applications/${jobId}/packages`)) as PackageSummary[];
        if (cancelled) return;
        setHistory(rows);
        if (rows.length) await loadVersion(rows[0].version);
        const drafts = (await api('/api/application-drafts')) as {
          id: string;
          status: string;
          job: { id: string };
        }[];
        const mine = drafts.find((d) => d.job.id === jobId);
        if (!cancelled && mine) setDraft({ id: mine.id, status: mine.status });
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Could not load application packages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, jobId, loadVersion]);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const pkg = (await api(`/api/applications/${jobId}/package`, { method: 'POST' })) as PackageView;
      const rows = (await api(`/api/applications/${jobId}/packages`)) as PackageSummary[];
      setHistory(rows);
      setSelected(pkg);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not generate the package');
    } finally {
      setBusy(false);
    }
  };

  /** Start the editable draft for the version currently shown. */
  const prepareDraft = async () => {
    if (!selected) return;
    setDraftBusy(true);
    setErr(null);
    try {
      const created = (await api('/api/application-drafts', {
        method: 'POST',
        body: JSON.stringify({ jobId, packageVersion: selected.version }),
      })) as { id: string; status: string };
      setDraft({ id: created.id, status: created.status });
      router.push(`/application-drafts/${created.id}`);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not prepare an application draft');
    } finally {
      setDraftBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Application package</h2>
        <p className="muted">Loading generated documents…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Application package</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Built only from your verified profile. Nothing is invented or submitted automatically.
          </p>
        </div>
        <Button onClick={generate} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
          {busy ? 'Generating…' : selected ? 'Generate new version' : 'Generate package'}
        </Button>
      </div>

      {err && <p className="notice-amber">{err}</p>}

      {!selected && !err && (
        <p className="muted">
          No package yet. Generate one to get a tailored CV, cover letter, screening answers and a
          requirement-to-evidence map for this vacancy.
        </p>
      )}

      {history.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <span className="muted">Versions: </span>
          {history.map((h) => (
            <button
              key={h.version}
              className="chip"
              style={{ cursor: 'pointer', opacity: h.version === selected?.version ? 1 : 0.65 }}
              onClick={() => loadVersion(h.version)}
            >
              v{h.version} · {new Date(h.createdAt).toLocaleDateString()}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            Version {selected.version} · {selected.generatorVersion} ·{' '}
            {new Date(selected.createdAt).toLocaleString()}
          </p>

          {draft ? (
            <div className="notice">
              <strong>Application draft in progress.</strong>{' '}
              <Link href={`/application-drafts/${draft.id}`}>Open the draft</Link> to edit, check
              and approve exactly what will be sent.
            </div>
          ) : (
            <div style={{ margin: '12px 0' }}>
              <Button onClick={prepareDraft} disabled={draftBusy || busy}>
                {draftBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <PencilLine size={16} />
                )}
                {draftBusy ? 'Preparing...' : `Prepare application draft from v${selected.version}`}
              </Button>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Creates an editable copy. The generated package above is never modified.
              </p>
            </div>
          )}

          {selected.warnings.length > 0 && (
            <div className="notice-amber">
              <strong>Check before applying</strong>
              <ul style={{ margin: '6px 0 0 18px' }}>
                {selected.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <h3>Tailored CV</h3>
          <pre style={documentStyle}>{selected.cv}</pre>

          <h3>Cover letter</h3>
          <pre style={documentStyle}>{selected.coverLetter}</pre>

          <h3>Screening answers</h3>
          {selected.screeningAnswers.length ? (
            <ul style={{ paddingLeft: 18 }}>
              {selected.screeningAnswers.map((a) => (
                <li key={a.question} style={{ marginBottom: 10 }}>
                  <strong>{a.question}</strong>
                  <div>{a.answer}</div>
                  <div className="muted">Basis: {a.basis}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No screening questions were generated.</p>
          )}

          <h3>Requirement → evidence</h3>
          {selected.requirementMapping.length ? (
            <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
              {selected.requirementMapping.map((r) => (
                <li
                  key={`${r.importance}-${r.name}`}
                  style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid hsl(var(--border))' }}
                >
                  <span className={STATUS_CHIP[r.status] ?? 'chip'}>{r.status}</span>{' '}
                  <strong>{r.name}</strong>
                  <span className="muted">
                    {' '}
                    · {r.kind.toLowerCase()}
                    {r.importance === 'PREFERRED' ? ' · preferred' : ''}
                  </span>
                  <div className="muted">{r.evidence}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No requirement verdicts stored yet. Recalculate matches from the Matches page, then
              generate again.
            </p>
          )}
        </>
      )}
    </div>
  );
}
