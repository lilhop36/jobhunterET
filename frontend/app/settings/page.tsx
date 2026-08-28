'use client';

import { FormEvent, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, ErrorBox } from '../../lib/ui';

interface Settings {
  matchThreshold: number;
  notificationsPaused: boolean;
  digestEnabled: boolean;
}

interface TelegramStatus {
  linked: boolean;
  linkedAt: string | null;
}

export default function SettingsPage() {
  const { api } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; deepLink: string; expiresAt: string } | null>(null);
  const [projected, setProjected] = useState<number | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    try {
      const [s, t] = await Promise.all([api('/api/settings'), api('/api/telegram/status')]);
      setSettings(s);
      setTg(t);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = async (threshold: number) => {
    try {
      const r = await api(`/api/settings/notifications-preview?threshold=${threshold}`);
      setProjected(r.projected);
    } catch {
      /* non-blocking */
    }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    const updated = await api('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    setSettings(updated);
    setOk('Settings saved.');
  };

  const getCode = async () => {
    setErr(null);
    try {
      setLinkCode(await api('/api/telegram/link-code', { method: 'POST' }));
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const unlink = async () => {
    await api('/api/telegram/link', { method: 'DELETE' });
    setTg({ linked: false, linkedAt: null });
    setOk('Telegram unlinked.');
  };


  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) {
      setPwMsg({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      });
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ kind: 'ok', text: 'Password updated.' });
    } catch (e: any) {
      setPwMsg({ kind: 'err', text: e.message });
    }
  };

  return (
    <RequireAuth>
      <h1>Settings</h1>
      <p className="subtitle">Control when and how you get notified.</p>
      {err && <ErrorBox msg={err} />}
      {ok && <div className="ok-box">{ok}</div>}

      {settings && (
        <>
        <div className="grid grid-2">
          <div className="card">
            <h2>Match threshold</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              You only get notified when a match hits this score or higher.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={settings.matchThreshold}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  setSettings({ ...settings, matchThreshold: v });
                  preview(v);
                }}
                onMouseUp={() => saveSettings({ matchThreshold: settings.matchThreshold })}
                onTouchEnd={() => saveSettings({ matchThreshold: settings.matchThreshold })}
              />
              <strong>{settings.matchThreshold}</strong>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {projected !== null
                ? `Projected weekly alerts at this threshold: ${projected}`
                : 'Drag the slider to project alert volume.'}
            </p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={settings.notificationsPaused}
                onChange={(e) => saveSettings({ notificationsPaused: e.target.checked })}
              />
              Pause notifications
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={settings.digestEnabled}
                onChange={(e) => saveSettings({ digestEnabled: e.target.checked })}
              />
              Daily digest — a summary of new jobs, strong matches, and your saved searches, delivered
              once a day
            </label>
          </div>

          <div className="card">
            <h2>Telegram</h2>
            {tg?.linked ? (
              <>
                <div className="ok-box" style={{ marginBottom: 10 }}>
                  ✅ Linked since {tg.linkedAt ? new Date(tg.linkedAt).toLocaleString() : '—'}
                </div>
                <p className="muted" style={{ fontSize: 13 }}>
                  Commands in the bot: <code>/status</code> <code>/saved</code> <code>/pause</code>{' '}
                  <code>/resume</code> <code>/help</code>
                </p>
                <button className="btn danger" onClick={unlink}>
                  Unlink Telegram
                </button>
              </>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Link your Telegram so matches arrive instantly. Until then, they land in your{' '}
                  <a href="/inbox">Inbox</a>.
                </p>
                {!linkCode ? (
                  <button className="btn" onClick={getCode}>
                    Get link code
                  </button>
                ) : (
                  <div className="notice">
                    <p style={{ marginTop: 0 }}>
                      1. Tap to open the bot:{' '}
                      <a href={linkCode.deepLink} target="_blank" rel="noreferrer">
                        {linkCode.deepLink}
                      </a>
                    </p>
                    <p>2. Send <code>/start {linkCode.code}</code> to the bot (code expires{' '}
                    {new Date(linkCode.expiresAt).toLocaleTimeString()}).</p>
                    <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                      The code is single-use and expires after 10 minutes.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Change password</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            Enter your current password to change it.
          </p>
          <form onSubmit={changePassword} style={{ maxWidth: 420 }}>
            <label>Current password</label>
            <input
              type="password"
              required
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <label>New password (min 8 characters)</label>
            <input
              type="password"
              required
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <label>Confirm new password</label>
            <input
              type="password"
              required
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
            {pwMsg && (
              <div className={pwMsg.kind === 'ok' ? 'ok-box' : 'error-box'} style={{ marginTop: 12 }}>
                {pwMsg.text}
              </div>
            )}
            <button className="btn ghost" type="submit" style={{ marginTop: 14 }}>
              <KeyRound className="h-4 w-4" /> Update password
            </button>
          </form>
        </div>
        </>
      )}
    </RequireAuth>
  );
}
