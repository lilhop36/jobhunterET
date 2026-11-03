'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { RequireAuth, ErrorBox, Loading } from '../../../lib/ui';
import { SubmissionPanel } from '../../../components/submission-panel';

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

interface DocumentRow {
  id: string;
  fileId: string;
  kind: string;
  label: string | null;
  originalName: string;
  sizeBytes: number;
}

interface AvailableDocument {
  id: string;
  kind: string;
  label: string | null;
  originalName: string;
  uploadedAt: string;
}

interface DraftView {
  id: string;
  status: 'NEEDS_ATTENTION' | 'READY_FOR_APPROVAL' | 'APPROVED';
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentHash: string;
  content: { cv: string; coverLetter: string; screeningAnswers: ScreeningAnswer[] };
  generated: { cv: string; coverLetter: string; screeningAnswers: ScreeningAnswer[] };
  edited: boolean;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    deadline: string | null;
    status: string;
    eligibility: string;
  };
  package: { id: string; version: number; generatorVersion: string; createdAt: string };
  latestPackageVersion: number;
  requirementMapping: RequirementEvidence[];
  artifacts: DocumentRow[];
  availableDocuments: AvailableDocument[];
  attestation: { hash: string | null; at: string | null; current: boolean };
  validation: { valid: boolean; errors: string[]; warnings: string[]; editedFields: string[] };
  approval: {
    approved: boolean;
    invalidated: boolean;
    latestAt: string | null;
    latestHash: string | null;
    latestNote: string | null;
  };
}

interface AuditRow {
  id: string;
  action: string;
  detail: any;
  createdAt: string;
}

const STATUS_LABEL: Record<DraftView['status'], string> = {
  NEEDS_ATTENTION: 'Needs attention',
  READY_FOR_APPROVAL: 'Ready for approval',
  APPROVED: 'Approved',
};

const STATUS_CHIP: Record<DraftView['status'], string> = {
  NEEDS_ATTENTION: 'chip miss',
  READY_FOR_APPROVAL: 'chip',
  APPROVED: 'chip match',
};

const REQUIREMENT_CHIP: Record<string, string> = {
  MET: 'chip match',
  PARTIAL: 'chip miss',
  MISSING: 'chip miss',
  UNKNOWN: 'chip',
};

const sameAnswers = (a: ScreeningAnswer[], b: ScreeningAnswer[]) =>
  a.length === b.length &&
  a.every((x, i) => x.question === b[i].question && x.answer === b[i].answer && x.basis === b[i].basis);

const sameDocs = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * Edits one application draft and records human approval.
 *
 * The generated package is never modified. Every save appends an immutable
 * revision, so the original stays retrievable and an approval made earlier
 * stops applying the moment the content changes.
 */
export default function ApplicationDraftPage() {
  const params = useParams<{ id: string }>();
  const { api } = useAuth();

  const [draft, setDraft] = useState<DraftView | null>(null);
  const [cv, setCv] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [answers, setAnswers] = useState<ScreeningAnswer[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [attestation, setAttestation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'save' | 'validate' | 'approve'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [note, setNote] = useState('');

  const apply = useCallback((d: DraftView) => {
    setDraft(d);
    setCv(d.content.cv);
    setCoverLetter(d.content.coverLetter);
    setAnswers(d.content.screeningAnswers);
    setDocumentIds(d.artifacts.map((a) => a.fileId));
    setAttestation(d.attestation.current);
    setNote(d.approval.latestNote ?? '');
  }, []);

  const load = useCallback(async () => {
    const d = (await api(`/api/application-drafts/${params.id}`)) as DraftView;
    apply(d);
  }, [api, params.id, apply]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = (await api(`/api/application-drafts/${params.id}`)) as DraftView;
        if (!cancelled) apply(d);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Could not load the application draft');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, params.id, apply]);

  const contentDirty = useMemo(() => {
    if (!draft) return false;
    return (
      cv !== draft.content.cv ||
      coverLetter !== draft.content.coverLetter ||
      !sameAnswers(answers, draft.content.screeningAnswers) ||
      !sameDocs(documentIds, draft.artifacts.map((a) => a.fileId))
    );
  }, [draft, cv, coverLetter, answers, documentIds]);

  const attestationDirty = useMemo(
    () => !!draft && attestation !== draft.attestation.current,
    [draft, attestation],
  );

  // Saving an edit and confirming it are separate acts, so "dirty" means any
  // unsaved local change at all (text, document selection, or confirmation).
  const dirty = contentDirty || attestationDirty;

  const run = async (kind: 'save' | 'validate' | 'approve') => {
    setBusy(kind);
    setErr(null);
    setFlash(null);
    try {
      if (kind === 'save') {
        // Never attest in the same request that changes the content or the
        // attached documents; the server rejects that combination anyway.
        const payload: Record<string, unknown> = contentDirty
          ? { cv, coverLetter, screeningAnswers: answers, documentIds }
          : { attestation };
        const d = (await api(`/api/application-drafts/${params.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })) as DraftView;
        apply(d);
        setFlash(
          contentDirty
            ? `Saved as revision ${d.revision}. Review it, then confirm the saved version.`
            : attestation
              ? 'Confirmed. Your approval now binds to this exact revision.'
              : 'Confirmation withdrawn.',
        );
      } else if (kind === 'validate') {
        const result = (await api(`/api/application-drafts/${params.id}/validate`, {
          method: 'POST',
        })) as { valid: boolean; errors: string[]; contentHash: string };
        await load();
        setFlash(
          result.valid
            ? 'All checks pass for this revision.'
            : `${result.errors.length} check(s) still need attention.`,
        );
      } else {
        const d = (await api(`/api/application-drafts/${params.id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ contentHash: draft?.contentHash, note: note.trim() || undefined }),
        })) as DraftView;
        apply(d);
        setFlash('Approved. This approval is bound to the exact content shown below.');
      }
    } catch (e: any) {
      setErr(e?.message ?? 'That action failed');
    } finally {
      setBusy(null);
    }
  };

  const resetToGenerated = () => {
    if (!draft) return;
    setCv(draft.generated.cv);
    setCoverLetter(draft.generated.coverLetter);
    setAnswers(draft.generated.screeningAnswers);
    setAttestation(false);
  };

  const toggleDocument = (id: string) => {
    setDocumentIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const loadAudit = async () => {
    if (audit) {
      setAudit(null);
      return;
    }
    try {
      setAudit((await api(`/api/application-drafts/${params.id}/audit`)) as AuditRow[]);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the audit trail');
    }
  };

  if (loading) {
    return (
      <RequireAuth>
        <Loading />
      </RequireAuth>
    );
  }

  if (!draft) {
    return (
      <RequireAuth>
        <ErrorBox msg={err ?? 'Application draft not found'} />
      </RequireAuth>
    );
  }

  const canApprove = !dirty && draft.validation.valid && !draft.approval.approved;
  const hasCv = documentIds.some((id) => {
    const doc = draft.availableDocuments.find((d) => d.id === id);
    return doc?.kind === 'CV';
  });

  return (
    <RequireAuth>
      <p className="muted" style={{ marginBottom: 4 }}>
        <Link href={`/jobs/${draft.job.id}`}>← Back to the vacancy</Link>
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>{draft.job.title}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {draft.job.company} · {draft.job.location}
              {draft.job.deadline && ` · deadline ${new Date(draft.job.deadline).toLocaleDateString()}`}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={STATUS_CHIP[draft.status]}>{STATUS_LABEL[draft.status]}</span>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              Package v{draft.package.version} · revision {draft.revision}
              {draft.latestPackageVersion > draft.package.version &&
                ` · newer package v${draft.latestPackageVersion} available`}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              content hash {draft.contentHash.slice(0, 12)}…
            </p>
          </div>
        </div>

        {draft.approval.approved && (
          <div className="notice" style={{ marginTop: 12 }}>
            <strong>Approved.</strong> A human confirmed this exact content on{' '}
            {fmt(draft.approval.latestAt)}. Editing anything below withdraws this approval.
            {draft.approval.latestNote && (
              <div className="muted" style={{ marginTop: 4 }}>
                Note: {draft.approval.latestNote}
              </div>
            )}
          </div>
        )}
        {draft.approval.invalidated && (
          <div className="notice-amber" style={{ marginTop: 12 }}>
            <strong>Approval no longer applies.</strong> The content changed after it was approved
            ({fmt(draft.approval.latestAt)}). Review the new revision and approve again.
          </div>
        )}
      </div>

      {err && <ErrorBox msg={err} />}
      {flash && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {flash}
        </div>
      )}

      {/* ── Validation ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Pre-approval checks</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Deterministic checks against your verified profile, the documents you attach and the
              live state of the vacancy.
            </p>
          </div>
          <button className="btn ghost" onClick={() => run('validate')} disabled={busy !== null || dirty}>
            {busy === 'validate' ? <Loader2 size={16} className="animate-spin" /> : null}
            Re-run checks
          </button>
        </div>

        {dirty && (
          <p className="notice-amber" style={{ marginTop: 12 }}>
            You have unsaved edits. Save them before running the checks or approving.
          </p>
        )}

        {draft.validation.errors.length > 0 && (
          <div className="notice-amber" style={{ marginTop: 12 }}>
            <strong>Must fix before approval</strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {draft.validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {draft.validation.warnings.length > 0 && (
          <div className="notice-amber" style={{ marginTop: 12 }}>
            <strong>Review these</strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {draft.validation.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {draft.validation.valid && draft.validation.warnings.length === 0 && (
          <p style={{ marginTop: 12, color: 'hsl(var(--primary))' }}>
            <CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom' }} /> No blocking issues.
          </p>
        )}
      </div>

      {/* ── Editable content ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Your application</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Edit freely — the generated package stays untouched as version {draft.package.version}.
              {draft.edited && ' This draft already differs from the generated content.'}
            </p>
          </div>
          <button className="btn ghost small" onClick={resetToGenerated} disabled={busy !== null}>
            Reset to generated
          </button>
        </div>

        <label htmlFor="draft-cv">CV</label>
        <textarea
          id="draft-cv"
          rows={18}
          value={cv}
          onChange={(e) => setCv(e.target.value)}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        />

        <label htmlFor="draft-cover">Cover letter</label>
        <textarea
          id="draft-cover"
          rows={12}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        />

        <h3 style={{ marginTop: 20 }}>Screening answers</h3>
        {answers.length === 0 && (
          <p className="muted">
            This vacancy produced no screening questions. Add your own if the posting asks for them.
          </p>
        )}
        {answers.map((answer, index) => (
          <div
            key={index}
            style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid hsl(var(--border))' }}
          >
            <label htmlFor={`q-${index}`}>Question {index + 1}</label>
            <input
              id={`q-${index}`}
              value={answer.question}
              onChange={(e) => {
                const next = [...answers];
                next[index] = { ...next[index], question: e.target.value };
                setAnswers(next);
              }}
            />
            <label htmlFor={`a-${index}`}>Answer</label>
            <textarea
              id={`a-${index}`}
              rows={3}
              value={answer.answer}
              onChange={(e) => {
                const next = [...answers];
                next[index] = { ...next[index], answer: e.target.value };
                setAnswers(next);
              }}
            />
            <label htmlFor={`b-${index}`}>Evidence basis (what in your profile supports this)</label>
            <input
              id={`b-${index}`}
              value={answer.basis}
              onChange={(e) => {
                const next = [...answers];
                next[index] = { ...next[index], basis: e.target.value };
                setAnswers(next);
              }}
            />
            <button
              className="btn danger small"
              style={{ marginTop: 8 }}
              onClick={() => setAnswers(answers.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="btn ghost small"
          onClick={() => setAnswers([...answers, { question: '', answer: '', basis: '' }])}
        >
          Add screening answer
        </button>

        <h3 style={{ marginTop: 20 }}>Documents</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          At least one CV must be attached. Only documents you uploaded are selectable.
        </p>
        {draft.availableDocuments.length === 0 && (
          <p className="notice-amber">
            You have no uploaded documents. Upload a CV from your profile before approving.
          </p>
        )}
        {draft.availableDocuments.map((doc) => (
          <label
            key={doc.id}
            className="checkbox-line"
            style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}
          >
            <input
              type="checkbox"
              checked={documentIds.includes(doc.id)}
              onChange={() => toggleDocument(doc.id)}
              style={{ width: 'auto', minHeight: 'auto' }}
            />
            <span>
              {doc.originalName}{' '}
              <span className="muted">
                · {doc.kind.toLowerCase()}
                {doc.label ? ` · ${doc.label}` : ''}
              </span>
            </span>
          </label>
        ))}
        {!hasCv && <p className="notice-amber">No CV document is selected.</p>}

        {draft.edited && contentDirty && (
          <p className="notice-amber" style={{ marginTop: 18 }}>
            You changed this application. Save first, review the saved revision, then confirm it.
          </p>
        )}

        {draft.edited && !contentDirty && !draft.approval.approved && (
          <div style={{ marginTop: 18 }}>
            <label className="checkbox-line" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={attestation}
                onChange={(e) => setAttestation(e.target.checked)}
                style={{ width: 'auto', minHeight: 'auto' }}
              />
              <span>
                I confirm this saved revision is accurate and that I did not add experience, skills,
                qualifications or achievements I cannot support.
              </span>
            </label>
            {attestation ? (
              <p className="muted" style={{ marginTop: 8 }}>
                New confirmation ready. Choose “Save confirmation” to record it against this revision.
              </p>
            ) : (
              <p className="notice-amber" style={{ marginTop: 8 }}>
                Your edits are not confirmed yet. Approval stays blocked until you confirm the saved
                revision.
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => run('save')} disabled={!dirty || busy !== null}>
            {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {contentDirty ? 'Save changes' : 'Save confirmation'}
          </button>
          <button className="btn" onClick={() => run('approve')} disabled={!canApprove || busy !== null}>
            {busy === 'approve' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ShieldCheck size={16} />
            )}
            {draft.approval.approved ? 'Approved' : 'Approve this exact content'}
          </button>
        </div>
        {!draft.validation.valid && !dirty && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Approval is blocked while any check above is unresolved.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Approval never submits anything. Sending the approved version is a separate step below.
        </p>

        <label htmlFor="approval-note">Approval note (optional)</label>
        <input
          id="approval-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. reviewed wording with a mentor"
        />
      </div>

      {/* ── Submission (controlled, approved-revision only) ────── */}
      <SubmissionPanel draftId={draft.id} contentHash={draft.contentHash} approved={draft.approval.approved} />

      {/* ── Requirement evidence ───────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Requirement → evidence</h2>
        {draft.requirementMapping.length ? (
          <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
            {draft.requirementMapping.map((r) => (
              <li
                key={`${r.importance}-${r.name}`}
                style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid hsl(var(--border))' }}
              >
                <span className={REQUIREMENT_CHIP[r.status] ?? 'chip'}>{r.status}</span>{' '}
                <strong>{r.name}</strong>
                <div className="muted">{r.evidence}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No requirement verdicts are stored on this package. Unverified requirements can never be
            claimed in the text.
          </p>
        )}
      </div>

      {/* ── Audit trail ────────────────────────────────────────── */}
      <div className="card">
        <button className="btn ghost small" onClick={loadAudit}>
          {audit ? 'Hide audit trail' : 'Show audit trail'}
        </button>
        {audit && (
          <ul style={{ paddingLeft: 18, marginTop: 10 }}>
            {audit.map((row) => (
              <li key={row.id} style={{ marginBottom: 6, fontSize: 13 }}>
                <strong>{row.action.replace(/_/g, ' ').toLowerCase()}</strong>{' '}
                <span className="muted">· {fmt(row.createdAt)}</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  {JSON.stringify(row.detail)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RequireAuth>
  );
}