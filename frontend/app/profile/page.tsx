'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, History, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, ErrorBox, Loading } from '../../lib/ui';

interface Profile {
  title: string | null;
  summary: string | null;
  years: number;
  remote: boolean;
  minSalary: number;
  excludeOnsite: boolean;
  employmentTypes: string[];
  onboardDone: boolean;
  skills: string[];
  targetRoles: { role: string; priority: string }[];
  locationTiers: { region: string; tier: string }[];
  completion: number;
}

/** Parse a "Role, PRIORITY" or "Region, TIER" line — last comma-separated part is the priority/tier. */
function parsePrioLine(line: string, fallback: string): { value: string; priority: string } {
  const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const priority = parts.pop()!.toUpperCase();
    return { value: parts.join(', ') || line, priority };
  }
  return { value: parts[0] || line, priority: fallback };
}

export default function ProfilePage() {
  const { api, user, token } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cv, setCv] = useState<{ id: string; originalName: string; sizeBytes: number; uploadedAt: string; downloadUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingCv, setDeletingCv] = useState(false);
  const [cvMsg, setCvMsg] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Cleanup XHR on unmount
  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  const load = async () => {
    try {
      const [p, c] = await Promise.all([api('/api/profile'), api('/api/profile/cv')]);
      // SQLite compat: employmentTypes may be a JSON string, booleans may be 0/1
      if (p) {
        if (typeof p.employmentTypes === 'string') {
          try { p.employmentTypes = JSON.parse(p.employmentTypes); } catch { p.employmentTypes = []; }
        }
        p.remote = !!p.remote;
        p.excludeOnsite = !!p.excludeOnsite;
        p.onboardDone = !!p.onboardDone;
      }
      setProfile(p);
      setCv(c);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const dto: any = {
        title: profile.title || undefined,
        summary: profile.summary || undefined,
        years: Number(profile.years) || 0,
        remote: profile.remote,
        minSalary: Number(profile.minSalary) || 0,
        excludeOnsite: profile.excludeOnsite,
        employmentTypes: profile.employmentTypes.filter(Boolean),
        skills: profile.skills,
        targetRoles: profile.targetRoles.map((t) => ({ role: t.role, priority: t.priority })),
        locationTiers: profile.locationTiers.map((l) => ({ region: l.region, tier: l.tier })),
      };
      setProfile(await api('/api/profile', { method: 'PATCH', body: JSON.stringify(dto) }));
      setOk('Profile saved.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile((p) => (p ? { ...p, [k]: v } : p));

  /* Client-side type/size validation + progress via XHR upload */
  const uploadCv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCvMsg(null);
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setCvMsg('Only .pdf or .docx files are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCvMsg('File exceeds the 5 MB limit.');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    const fd = new FormData();
    fd.append('file', file);
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
      xhr.open('POST', API_BASE ? `${API_BASE.replace(/\/$/, '')}/api/profile/cv` : '/api/profile/cv');
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setCv(JSON.parse(xhr.responseText));
          setCvMsg(`Uploaded ${file.name}.`);
        } else {
          try {
            setCvMsg(JSON.parse(xhr.responseText).message || 'Upload failed.');
          } catch {
            setCvMsg('Upload failed.');
          }
        }
        xhrRef.current = null;
        resolve();
      };
      xhr.onerror = () => {
        setCvMsg('Upload failed — network error.');
        xhrRef.current = null;
        resolve();
      };
      xhr.send(fd);
    });
    setUploading(false);
  };

  const deleteCv = async () => {
    if (!window.confirm('Are you sure you want to remove your CV? This will lower your profile completion score.')) return;
    setDeletingCv(true);
    setCvMsg(null);
    try {
      await api('/api/profile/cv', { method: 'DELETE' });
      setCv(null);
      setCvMsg('CV removed.');
    } catch (e: any) {
      setCvMsg(`Error removing CV: ${e.message}`);
    } finally {
      setDeletingCv(false);
    }
  };

  return (
    <RequireAuth>
      <h1>Profile</h1>
      <p className="subtitle">Your profile shapes every match.</p>
      {err && !loading && !saving && !uploading && !deletingCv && <ErrorBox msg={err} />}
      {ok && !loading && !saving && !uploading && <div className="ok-box">{ok}</div>}
      {loading && <Loading />}

      {profile && (
        <>
          <div className="card">
            <h2>
              Completion{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                {profile.completion}%
              </span>
            </h2>
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={profile.completion}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Profile completion: ${profile.completion}%`}
            >
              <div style={{ width: `${profile.completion}%` }} />
            </div>
            {!profile.onboardDone && profile.completion < 100 && (
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                New here? <Link href="/onboarding" style={{ fontWeight: 600 }}>Run through the onboarding</Link>{' '}
                to get better matches.
              </p>
            )}
          </div>

          <div className="card">
            <h2>CV / Resume</h2>
            {cv ? (
              <div className="flex flex-wrap items-center gap-3">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ wordBreak: 'break-all' }}>{cv.originalName}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {(cv.sizeBytes / 1024).toFixed(0)} KB · uploaded{' '}
                    {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(cv.uploadedAt))}
                  </div>
                </div>
                <a className="btn ghost small" href={cv.downloadUrl}>
                  <Download className="h-4 w-4" /> Download
                </a>
                <button className="btn danger small" onClick={deleteCv} disabled={deletingCv}>
                  <Trash2 className="h-4 w-4" /> {deletingCv ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                No CV yet — upload one to raise your profile completion (+15%) and help the matcher.
              </p>
            )}
            <div className="mt-2">
              <input
                id="cv-file"
                type="file"
                accept=".pdf,.docx"
                style={{ display: 'none' }}
                onChange={uploadCv}
                disabled={uploading}
              />
              <label htmlFor="cv-file" className="btn ghost small" style={{ display: 'inline-flex', cursor: 'pointer' }}>
                {uploading ? `Uploading… ${uploadProgress}%` : cv ? 'Replace CV' : 'Upload CV'}
              </label>
              <span className="muted" style={{ fontSize: 12.5, marginLeft: 10 }}>
                .pdf or .docx, max 5 MB
              </span>
            </div>
            {uploading && (
              <div className="progress" style={{ marginTop: 10 }}>
                <div style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
            {cvMsg && (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                {cvMsg}
              </p>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid grid-2">
              <div className="card">
                <h2>Basics</h2>
                <label htmlFor="profile-title">Professional title</label>
                <input id="profile-title" name="title" value={profile.title ?? ''} onChange={(e) => set('title', e.target.value)} />
                <label htmlFor="profile-summary">Summary</label>
                <textarea id="profile-summary" name="summary" rows={3} value={profile.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
                <div className="grid grid-2">
                  <div>
                    <label htmlFor="profile-years">Years of experience</label>
                    <input
                      id="profile-years"
                      name="years"
                      type="number"
                      value={profile.years}
                      onChange={(e) => set('years', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-salary">Min salary (USD)</label>
                    <input
                      id="profile-salary"
                      name="minSalary"
                      type="number"
                      value={profile.minSalary}
                      onChange={(e) => set('minSalary', Number(e.target.value))}
                    />
                  </div>
                </div>
                <label className="checkbox-line">
                  <input type="checkbox" checked={profile.remote} onChange={(e) => set('remote', e.target.checked)} />
                  Open to remote work
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={profile.excludeOnsite}
                    onChange={(e) => set('excludeOnsite', e.target.checked)}
                  />
                  Exclude on-site roles outside Ethiopia
                </label>
              </div>

              <div className="card">
                <h2>Skills, roles & locations</h2>
                <label htmlFor="profile-skills">Skills (comma separated)</label>
                <input
                  id="profile-skills"
                  name="skills"
                  value={profile.skills.join(', ')}
                  onChange={(e) =>
                    set('skills', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
                  }
                />
                <label htmlFor="profile-roles">Target roles — one per line: Role, PRIORITY</label>
                <textarea
                  id="profile-roles"
                  name="targetRoles"
                  rows={3}
                  value={profile.targetRoles.map((t) => `${t.role}, ${t.priority}`).join('\n')}
                  onChange={(e) =>
                    set(
                      'targetRoles',
                      e.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line) => {
                          const { value: role, priority } = parsePrioLine(line, 'MEDIUM');
                          return { role, priority };
                        }),
                    )
                  }
                />
                <label htmlFor="profile-locations">Location tiers — one per line: Region, PRIORITY</label>
                <textarea
                  id="profile-locations"
                  name="locationTiers"
                  rows={2}
                  value={profile.locationTiers.map((l) => `${l.region}, ${l.tier}`).join('\n')}
                  onChange={(e) =>
                    set(
                      'locationTiers',
                      e.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line) => {
                          const { value: region, priority: tier } = parsePrioLine(line, 'MEDIUM');
                          return { region, tier };
                        }),
                    )
                  }
                />
                <label htmlFor="profile-employment">Employment types (comma separated)</label>
                <input
                  id="profile-employment"
                  name="employmentTypes"
                  value={profile.employmentTypes.join(', ')}
                  onChange={(e) =>
                    set('employmentTypes', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
                  }
                />
              </div>
            </div>

            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </form>

          <div className="card mt-4">
            <h2>More</h2>
            <div className="flex flex-wrap gap-2">
              <Link className="btn ghost small" href="/settings">
                <Settings className="h-4 w-4" /> Settings
              </Link>
              <Link className="btn ghost small" href="/searches">
                <History className="h-4 w-4" /> Saved searches
              </Link>
              {user?.role === 'ADMIN' && (
                <Link className="btn ghost small" href="/sources">
                  <ShieldCheck className="h-4 w-4" /> Sources
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </RequireAuth>
  );
}
