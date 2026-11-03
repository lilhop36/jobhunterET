'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ErrorBox } from '../lib/ui';

type ChannelType = 'WEB' | 'EMAIL' | 'TELEGRAM' | 'UNKNOWN';
type SubmissionStatus = 'AWAITING_MANUAL' | 'SUBMITTED' | 'FAILED' | 'BLOCKED';

interface SubmissionView {
  id: string;
  draftId: string;
  jobId: string;
  contentHash: string;
  channel: { type: ChannelType; url: string | null; email: string | null };
  mode: 'AUTOMATED' | 'MANUAL';
  status: SubmissionStatus;
  receipt: any;
  note: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  job?: { id: string; title: string; company: string; location?: string };
}

interface SubmissionPlan {
  draftId: string;
  jobId: string;
  revision: number;
  contentHash: string;
  approved: boolean;
  channel: { type: ChannelType; url: string | null; email: string | null; reason: string };
  mode: 'AUTOMATED' | 'MANUAL';
  canSubmit: boolean;
  blockers: string[];
  warnings: string[];
  existing: SubmissionView | null;
}

interface AuditRow {
  id: string;
  action: string;
  detail: any;
  createdAt: string;
}

const STATUS: Record<SubmissionStatus, { label: string; chip: string }> = {
  AWAITING_MANUAL: { label: 'Awaiting your send', chip: 'chip' },
  SUBMITTED: { label: 'Submitted', chip: 'chip match' },
  FAILED: { label: 'Automated attempt failed', chip: 'chip miss' },
  BLOCKED: { label: 'Blocked', chip: 'chip miss' },
};

const CHANNEL_LABEL: Record<ChannelType, string> = {
  WEB: 'Official application page',
  EMAIL: 'Email application',
  TELEGRAM: 'Telegram post',
  UNKNOWN: 'No official channel found',
};

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * Controlled submission of one approved draft (Phase 9).
 *
 * JobPilot only ever submits the exact revision a human approved, and only
 * through the official channel recorded on the vacancy. When automation is not
 * available (the production default), the candidate sends the application
 * themselves and confirms it here; the confirmation is refused if the approved
 * content changed in the meantime.
 */
export function SubmissionPanel({
  draftId,
  contentHash,
  approved,
}: {
  draftId: string;
  contentHash: string;
  approved: boolean;
}) {
  const { api } = useAuth();
  const [plan, setPlan] = useState<SubmissionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'submit' | 'confirm'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [confirmNote, setConfirmNote] = useState('');
  const [audit, setAudit] = useState<AuditRow[] | null>(null);

  const loadPlan = useCallback(async () => {
    const p = (await api(`/api/submissions/draft/${draftId}/plan`)) as SubmissionPlan;
    setPlan(p);
    return p;
  }, [api, draftId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPlan()
      .catch((e: any) => {
        if (!cancelled) setErr(e?.message ?? 'Could not load the submission plan');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPlan, contentHash, approved]);

  const submit = async () => {
    if (!plan) return;
    setBusy('submit');
    setErr(null);
    setFlash(null);
    try {
      const view = (await api(`/api/submissions/draft/${draftId}`, {
        method: 'POST',
        body: JSON.stringify({ contentHash: plan.contentHash }),
      })) as SubmissionView;
      await loadPlan();
      setFlash(
        view.status === 'SUBMITTED'
          ? 'Submitted through the official channel.'
          : 'Ready to send. Follow the official link or email, then confirm below.',
      );
    } catch (e: any) {
      setErr(e?.message ?? 'Submission failed');
      await loadPlan().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (id: string) => {
    setBusy('confirm');
    setErr(null);
    setFlash(null);
    try {
      await api(`/api/submissions/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ reference: reference.trim() || undefined, note: confirmNote.trim() || undefined }),
      });
      await loadPlan();
      setReference('');
      setConfirmNote('');
      setFlash('Confirmed. JobPilot recorded that you sent this application yourself.');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not confirm the submission');
      await loadPlan().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const loadAudit = async (id: string) => {
    if (audit) {
      setAudit(null);
      return;
    }
    try {
      setAudit((await api(`/api/submissions/${id}/audit`)) as AuditRow[]);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load the submission audit trail');
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Submission</h2>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Submission</h2>
        {err && <ErrorBox msg={err} />}
      </div>
    );
  }

  const existing = plan.existing;
  const submitted = existing?.status === 'SUBMITTED';

  return (
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
          <h2 style={{ margin: 0 }}>Submission</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            JobPilot submits only the exact version you approved. It never sends anything you have not
            confirmed, and it never works around a CAPTCHA or an access restriction.
          </p>
        </div>
        {existing && <span className={STATUS[existing.status].chip}>{STATUS[existing.status].label}</span>}
      </div>

      {err && <ErrorBox msg={err} />}
      {flash && (
        <div className="notice" style={{ marginTop: 12 }}>
          {flash}
        </div>
      )}

      {/* Channel */}
      <div style={{ marginTop: 12, fontSize: 14 }}>
        <strong>{CHANNEL_LABEL[plan.channel.type]}</strong>
        <div className="muted">{plan.channel.reason}</div>
        {plan.channel.url && (
          <a href={plan.channel.url} target="_blank" rel="noreferrer noopener" style={{ marginTop: 4, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            Open the official application page <ExternalLink size={14} />
          </a>
        )}
        {plan.channel.email && (
          <div style={{ marginTop: 4 }}>
            Apply by email to <strong>{plan.channel.email}</strong>
          </div>
        )}
      </div>

      {/* Blockers / warnings */}
      {plan.blockers.length > 0 && (
        <div className="notice-amber" style={{ marginTop: 12 }}>
          <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertTriangle size={15} /> Cannot submit yet
          </strong>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div className="notice-amber" style={{ marginTop: 12 }}>
          <ul style={{ margin: '0 0 0 18px' }}>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Submitted */}
      {submitted && existing && (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>
            <CheckCircle2 size={15} style={{ verticalAlign: 'text-bottom' }} /> Submitted
          </strong>{' '}
          {existing.mode === 'AUTOMATED'
            ? 'through a registered official channel'
            : 'and confirmed by you'}{' '}
          on {fmt(existing.confirmedAt ?? existing.submittedAt)}.
          {existing.receipt?.reference && (
            <div className="muted" style={{ marginTop: 4 }}>
              Reference: {existing.receipt.reference}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost small" onClick={() => loadAudit(existing.id)}>
              {audit ? 'Hide submission audit' : 'Show submission audit'}
            </button>
          </div>
        </div>
      )}

      {/* Prepared manual submission awaiting confirmation */}
      {existing && existing.status === 'AWAITING_MANUAL' && (
        <div style={{ marginTop: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Send the application now using the official channel above, then record it here.
          </p>
          <label htmlFor="sub-ref">Employer reference (optional)</label>
          <input
            id="sub-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="confirmation number or message id"
          />
          <label htmlFor="sub-note">Note (optional)</label>
          <input
            id="sub-note"
            value={confirmNote}
            onChange={(e) => setConfirmNote(e.target.value)}
            placeholder="e.g. sent from my inbox"
          />
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => confirm(existing.id)}
            disabled={busy !== null}
          >
            {busy === 'confirm' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            I sent this application
          </button>
        </div>
      )}

      {/* Not yet submitted */}
      {!submitted && (!existing || existing.status === 'FAILED') && (
        <div style={{ marginTop: 14 }}>
          {existing?.status === 'FAILED' && (
            <p className="notice-amber" style={{ marginTop: 0 }}>
              The automated attempt failed. You can still send the application yourself using the
              official channel above and confirm it as a manual submission.
            </p>
          )}
          <button className="btn" onClick={submit} disabled={!plan.canSubmit || busy !== null}>
            {busy === 'submit' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {plan.mode === 'AUTOMATED' ? 'Submit approved application' : 'Prepare submission'}
          </button>
          {!plan.canSubmit && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Resolve the blockers above first.
            </p>
          )}
        </div>
      )}

      {/* Audit trail for any existing submission */}
      {existing && !submitted && audit && (
        <ul style={{ paddingLeft: 18, marginTop: 12 }}>
          {audit.map((row) => (
            <li key={row.id} style={{ marginBottom: 6, fontSize: 13 }}>
              <strong>{row.action.replace(/_/g, ' ').toLowerCase()}</strong>{' '}
              <span className="muted">· {fmt(row.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}