'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, X, Send, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface JobApplicationState {
  stage: string;
  stageSince: string;
}

const STAGE_LABELS: Record<string, string> = {
  APPLIED: 'Applied',
  ASSESSMENT: 'Assessment',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

type Action = 'save' | 'reject' | 'apply';

interface Props {
  jobId: string;
  saved: boolean;
  application: JobApplicationState | null;
}

/**
 * Save / Reject / Apply for a single job (FR-025b parity with the Telegram
 * inline buttons). Every action is optimistic — the UI updates instantly and
 * rolls back on failure. Reject and Apply use a two-step arming confirmation:
 * the first click arms the button ("Confirm …?"), the second commits it, and
 * it disarms itself after 4s or on mouse leave.
 */
export function JobActions({ jobId, saved: initialSaved, application: initialApp }: Props) {
  const { api } = useAuth();

  const [saved, setSaved] = useState(initialSaved);
  const [stage, setStage] = useState<string | null>(initialApp?.stage ?? null);
  const [pending, setPending] = useState<Action | null>(null);
  const [armed, setArmed] = useState<'reject' | 'apply' | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const flashMsg = (kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  };

  const arm = (which: 'reject' | 'apply') => {
    setArmed(which);
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmed(null), 4000);
  };

  const onSave = async () => {
    if (pending) return;
    const prev = saved;
    setSaved(!prev); // optimistic
    setPending('save');
    setFlash(null);
    try {
      const r = await api(`/api/saved-jobs/${jobId}`, { method: 'POST' });
      setSaved(r.saved);
      flashMsg('ok', r.saved ? 'Saved to your list.' : 'Removed from saved.');
    } catch (e: any) {
      setSaved(prev); // rollback
      flashMsg('err', e.message);
    } finally {
      setPending(null);
    }
  };

  const onReject = async () => {
    if (pending) return;
    if (armed !== 'reject') {
      arm('reject');
      return;
    }
    const prev = stage;
    setStage('REJECTED'); // optimistic
    setArmed(null);
    setPending('reject');
    setFlash(null);
    try {
      await api(`/api/applications/${jobId}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage: 'REJECTED' }),
      });
      flashMsg('ok', 'Noted as rejected.');
    } catch (e: any) {
      setStage(prev); // rollback
      flashMsg('err', e.message);
    } finally {
      setPending(null);
    }
  };

  const onApply = async () => {
    if (pending) return;
    if (armed !== 'apply') {
      arm('apply');
      return;
    }
    const prev = stage;
    setStage('APPLIED'); // optimistic
    setArmed(null);
    setPending('apply');
    setFlash(null);
    try {
      await api(`/api/applications/${jobId}`, { method: 'POST' });
      flashMsg('ok', 'Application tracked — good luck!');
    } catch (e: any) {
      setStage(prev); // rollback
      flashMsg('err', e.message);
    } finally {
      setPending(null);
    }
  };

  const activeStage = stage && stage !== 'REJECTED' && stage !== 'WITHDRAWN' ? stage : null;
  const rejected = stage === 'REJECTED';

  return (
    <div className="flex flex-wrap items-center gap-2" onMouseLeave={() => setArmed(null)}>
      <Button
        variant={saved ? 'default' : 'outline'}
        disabled={pending === 'save'}
        aria-pressed={saved}
        onClick={onSave}
        title={saved ? 'Remove from saved' : 'Save this job'}
      >
        {pending === 'save' ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Bookmark className={cn(saved && 'fill-current')} />
        )}
        {saved ? 'Saved' : 'Save'}
      </Button>

      <Button
        variant={rejected ? 'destructive' : armed === 'reject' ? 'destructive' : 'outline'}
        disabled={rejected || pending === 'reject'}
        onClick={onReject}
        title={rejected ? 'Already rejected' : 'Mark as not interested'}
        className={cn(armed === 'reject' && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
      >
        {pending === 'reject' ? (
          <Loader2 className="animate-spin" />
        ) : rejected ? (
          <Check />
        ) : (
          <X />
        )}
        {rejected ? 'Rejected' : armed === 'reject' ? 'Confirm reject?' : 'Reject'}
      </Button>

      <Button
        variant="default"
        disabled={!!activeStage || pending === 'apply'}
        onClick={onApply}
        title={activeStage ? 'Already applied' : 'Track this application'}
        className={cn(armed === 'apply' && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
      >
        {pending === 'apply' ? (
          <Loader2 className="animate-spin" />
        ) : activeStage ? (
          <Check />
        ) : (
          <Send />
        )}
        {activeStage ? STAGE_LABELS[activeStage] ?? 'Applied' : armed === 'apply' ? 'Confirm apply?' : 'Apply'}
      </Button>

      <div className="flex w-full flex-wrap items-center gap-1.5" aria-live="polite">
        {saved && (
          <Badge variant="secondary">
            <Bookmark className="mr-1 h-3 w-3 fill-current" /> Saved
          </Badge>
        )}
        {activeStage && <Badge variant="info">{STAGE_LABELS[activeStage] ?? activeStage}</Badge>}
        {rejected && <Badge variant="destructive">Rejected</Badge>}
        {flash && (
          <span className={cn('text-sm', flash.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
            {flash.text}
          </span>
        )}
      </div>
    </div>
  );
}
