'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, History, Plus, Settings, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, ErrorBox, Loading } from '../../lib/ui';

interface Personal {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
}

interface EducationRow {
  institution: string;
  degree: string;
  field: string;
  startYear: string;
  endYear: string;
  grade: string;
}

interface ExperienceRow {
  title: string;
  company: string;
  location: string;
  startYear: string;
  endYear: string;
  current: boolean;
  description: string;
}

interface ProjectRow {
  name: string;
  description: string;
  url: string;
  year: string;
}

interface CertificationRow {
  name: string;
  issuer: string;
  year: string;
  credentialUrl: string;
}

interface LanguageRow {
  language: string;
  proficiency: string;
}

interface DocumentRow {
  id: string;
  kind: string;
  label: string | null;
  originalName: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface CvDraft {
  personal: Partial<Personal> & { email?: string };
  title?: string;
  summary?: string;
  years?: number;
  skills: string[];
  targetRoles: string[];
  education: EducationRow[];
  experiences: (Omit<ExperienceRow, 'startYear' | 'endYear'> & { startYear?: number; endYear?: number })[];
  projects: (Omit<ProjectRow, 'year'> & { year?: number })[];
  certifications: (Omit<CertificationRow, 'year'> & { year?: number })[];
  languages: LanguageRow[];
  warnings: string[];
}

interface Profile {
  personal: Personal;
  title: string | null;
  summary: string | null;
  years: number;
  remote: boolean;
  minSalary: number;
  excludeOnsite: boolean;
  excludeEntryLevel: boolean;
  employmentTypes: string[];
  onboardDone: boolean;
  skills: string[];
  targetRoles: { role: string; priority: string }[];
  locationTiers: { region: string; tier: string }[];
  education: EducationRow[];
  experiences: ExperienceRow[];
  projects: ProjectRow[];
  certifications: CertificationRow[];
  languages: LanguageRow[];
  documents: DocumentRow[];
  completion: number;
}

const DOC_KINDS: { value: string; label: string }[] = [
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
  { value: 'OTHER', label: 'Other' },
];

const PROFICIENCIES = ['NATIVE', 'FLUENT', 'INTERMEDIATE', 'BASIC'];

const emptyEducation = (): EducationRow => ({
  institution: '',
  degree: '',
  field: '',
  startYear: '',
  endYear: '',
  grade: '',
});
const emptyExperience = (): ExperienceRow => ({
  title: '',
  company: '',
  location: '',
  startYear: '',
  endYear: '',
  current: false,
  description: '',
});
const emptyProject = (): ProjectRow => ({ name: '', description: '', url: '', year: '' });
const emptyCertification = (): CertificationRow => ({ name: '', issuer: '', year: '', credentialUrl: '' });
const emptyLanguage = (): LanguageRow => ({ language: '', proficiency: 'INTERMEDIATE' });

/** Parse a "Role, PRIORITY" or "Region, TIER" line — last comma-separated part is the priority/tier. */
function parsePrioLine(line: string, fallback: string): { value: string; priority: string } {
  const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const priority = parts.pop()!.toUpperCase();
    return { value: parts.join(', ') || line, priority };
  }
  return { value: parts[0] || line, priority: fallback };
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const numOrUndef = (v: string): number | undefined => {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** API rows have ids and nulls; the editor wants plain strings. */
function normalizeProfile(raw: any): Profile {
  if (raw && typeof raw.employmentTypes === 'string') {
    try {
      raw.employmentTypes = JSON.parse(raw.employmentTypes);
    } catch {
      raw.employmentTypes = [];
    }
  }
  const p = raw ?? {};
  return {
    ...p,
    remote: !!p.remote,
    excludeOnsite: !!p.excludeOnsite,
    excludeEntryLevel: !!p.excludeEntryLevel,
    onboardDone: !!p.onboardDone,
    personal: {
      fullName: p.personal?.fullName ?? null,
      email: p.personal?.email ?? null,
      phone: p.personal?.phone ?? null,
      city: p.personal?.city ?? null,
      country: p.personal?.country ?? null,
      linkedinUrl: p.personal?.linkedinUrl ?? null,
      githubUrl: p.personal?.githubUrl ?? null,
      portfolioUrl: p.personal?.portfolioUrl ?? null,
    },
    education: (p.education ?? []).map((e: any) => ({
      institution: str(e.institution),
      degree: str(e.degree),
      field: str(e.field),
      startYear: str(e.startYear),
      endYear: str(e.endYear),
      grade: str(e.grade),
    })),
    experiences: (p.experiences ?? []).map((e: any) => ({
      title: str(e.title),
      company: str(e.company),
      location: str(e.location),
      startYear: str(e.startYear),
      endYear: str(e.endYear),
      current: !!e.current,
      description: str(e.description),
    })),
    projects: (p.projects ?? []).map((e: any) => ({
      name: str(e.name),
      description: str(e.description),
      url: str(e.url),
      year: str(e.year),
    })),
    certifications: (p.certifications ?? []).map((e: any) => ({
      name: str(e.name),
      issuer: str(e.issuer),
      year: str(e.year),
      credentialUrl: str(e.credentialUrl),
    })),
    languages: (p.languages ?? []).map((e: any) => ({
      language: str(e.language),
      proficiency: str(e.proficiency) || 'INTERMEDIATE',
    })),
    documents: p.documents ?? [],
  };
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
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<CvDraft | null>(null);
  const [docKind, setDocKind] = useState('CERTIFICATE');
  const [docLabel, setDocLabel] = useState('');
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
      setProfile(normalizeProfile(p));
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
        excludeEntryLevel: profile.excludeEntryLevel,
        employmentTypes: profile.employmentTypes.filter(Boolean),
        skills: profile.skills,
        targetRoles: profile.targetRoles.map((t) => ({ role: t.role, priority: t.priority })),
        locationTiers: profile.locationTiers.map((l) => ({ region: l.region, tier: l.tier })),
        ...profile.personal,
        education: profile.education.map((e) => ({
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startYear: numOrUndef(e.startYear),
          endYear: numOrUndef(e.endYear),
          grade: e.grade,
        })),
        experiences: profile.experiences.map((e) => ({
          title: e.title,
          company: e.company,
          location: e.location,
          startYear: numOrUndef(e.startYear),
          endYear: e.current ? undefined : numOrUndef(e.endYear),
          current: e.current,
          description: e.description,
        })),
        projects: profile.projects.map((e) => ({
          name: e.name,
          description: e.description,
          url: e.url,
          year: numOrUndef(e.year),
        })),
        certifications: profile.certifications.map((e) => ({
          name: e.name,
          issuer: e.issuer,
          year: numOrUndef(e.year),
          credentialUrl: e.credentialUrl,
        })),
        languages: profile.languages.filter((l) => l.language.trim()),
      };
      setProfile(normalizeProfile(await api('/api/profile', { method: 'PATCH', body: JSON.stringify(dto) })));
      setOk('Profile saved.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile((p) => (p ? { ...p, [k]: v } : p));
  const setPersonal = (k: keyof Personal, v: string) =>
    setProfile((p) => (p ? { ...p, personal: { ...p.personal, [k]: v } } : p));

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
      xhr.open('POST', API_BASE ? `${API_BASE}/api/profile/cv` : '/api/profile/cv');
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setCv(JSON.parse(xhr.responseText));
          setCvMsg(`Uploaded ${file.name}. You can now import its details.`);
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
      setDraft(null);
      setCvMsg('CV removed.');
      await load();
    } catch (e: any) {
      setCvMsg(`Error removing CV: ${e.message}`);
    } finally {
      setDeletingCv(false);
    }
  };

  /** Read the active CV into a draft. Nothing is saved until the user says so. */
  const importFromCv = async () => {
    setImporting(true);
    setCvMsg(null);
    setDraft(null);
    try {
      const res = await api('/api/profile/cv/import', { method: 'POST' });
      setDraft(res.draft);
    } catch (e: any) {
      setCvMsg(e.message);
    } finally {
      setImporting(false);
    }
  };

  /**
   * Merge the reviewed draft into the form. Existing values win only where the
   * CV had nothing, so pressing save cannot silently erase typed data.
   */
  const applyDraft = () => {
    if (!draft || !profile) return;
    setProfile((p) => {
      if (!p) return p;
      const next: Profile = { ...p, personal: { ...p.personal } };
      for (const [k, v] of Object.entries(draft.personal)) {
        if (v && String(v).trim()) (next.personal as any)[k] = String(v).trim();
      }
      if (draft.title) next.title = draft.title;
      if (draft.summary) next.summary = draft.summary;
      if (draft.years) next.years = draft.years;
      if (draft.skills.length) next.skills = draft.skills;
      if (draft.targetRoles.length) {
        next.targetRoles = draft.targetRoles.map((role) => ({ role, priority: 'MEDIUM' }));
      }
      if (draft.education.length) {
        next.education = draft.education.map((e) => ({
          institution: str(e.institution),
          degree: str(e.degree),
          field: str(e.field),
          startYear: str(e.startYear),
          endYear: str(e.endYear),
          grade: str(e.grade),
        }));
      }
      if (draft.experiences.length) {
        next.experiences = draft.experiences.map((e) => ({
          title: str(e.title),
          company: str(e.company),
          location: str(e.location),
          startYear: str(e.startYear),
          endYear: str(e.endYear),
          current: !!e.current,
          description: str(e.description),
        }));
      }
      if (draft.projects.length) {
        next.projects = draft.projects.map((e) => ({
          name: str(e.name),
          description: str(e.description),
          url: str(e.url),
          year: str(e.year),
        }));
      }
      if (draft.certifications.length) {
        next.certifications = draft.certifications.map((e) => ({
          name: str(e.name),
          issuer: str(e.issuer),
          year: str(e.year),
          credentialUrl: str(e.credentialUrl),
        }));
      }
      if (draft.languages.length) next.languages = draft.languages;
      return next;
    });
    setDraft(null);
    setOk('Imported details added below. Review them, then click Save profile.');
  };

  const uploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCvMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', docKind);
    if (docLabel.trim()) fd.append('label', docLabel.trim());
    try {
      await api('/api/profile/documents', { method: 'POST', body: fd });
      setDocLabel('');
      setCvMsg(`Uploaded ${file.name}.`);
      await load();
    } catch (e: any) {
      setCvMsg(`Upload failed: ${e.message}`);
    }
  };

  const deleteDocument = async (id: string) => {
    if (!window.confirm('Remove this document?')) return;
    try {
      await api(`/api/profile/documents/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setCvMsg(`Error removing document: ${e.message}`);
    }
  };

  /** Downloads need the bearer token, so a plain <a href> would 401. */
  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      setCvMsg(e.message);
    }
  };

  const otherDocuments = profile?.documents.filter((d) => d.kind !== 'CV') ?? [];

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
                <button className="btn ghost small" onClick={() => download(cv.downloadUrl, cv.originalName)}>
                  <Download className="h-4 w-4" /> Download
                </button>
                <button className="btn danger small" onClick={deleteCv} disabled={deletingCv}>
                  <Trash2 className="h-4 w-4" /> {deletingCv ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                No CV yet — upload one to raise your profile completion (+10%) and help the matcher.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
              <button className="btn small" onClick={importFromCv} disabled={!cv || importing}>
                <Sparkles className="h-4 w-4" /> {importing ? 'Reading…' : 'Import from CV'}
              </button>
              <span className="muted" style={{ fontSize: 12.5 }}>
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

            {draft && (
              <div className="card" style={{ marginTop: 14, border: '1px solid var(--border, #ddd)' }}>
                <h3 style={{ marginTop: 0 }}>Review imported details</h3>
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  Nothing has been saved yet. Check what was read from your CV, then apply it to the form and save.
                </p>
                <ul style={{ margin: '0 0 10px 18px', fontSize: 13.5 }}>
                  <li>Name: {draft.personal.fullName || '—'}</li>
                  <li>Email: {draft.personal.email || '—'} · Phone: {draft.personal.phone || '—'}</li>
                  <li>
                    {draft.education.length} education, {draft.experiences.length} experience, {draft.projects.length} project,
                    {' '}{draft.certifications.length} certification, {draft.languages.length} language, {draft.skills.length} skill
                  </li>
                </ul>
                {draft.warnings.length > 0 && (
                  <div style={{ fontSize: 13, color: '#8a6d00' }}>
                    <strong>Check these:</strong>
                    <ul style={{ margin: '4px 0 10px 18px' }}>
                      {draft.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="btn small" onClick={applyDraft}>
                    Apply to form
                  </button>
                  <button className="btn ghost small" onClick={() => setDraft(null)}>
                    <X className="h-4 w-4" /> Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid grid-2">
              <div className="card">
                <h2>Personal information</h2>
                <div className="grid grid-2">
                  <div>
                    <label htmlFor="personal-name">Full name</label>
                    <input
                      id="personal-name"
                      value={str(profile.personal.fullName)}
                      onChange={(e) => setPersonal('fullName', e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="personal-email">Email</label>
                    <input id="personal-email" value={str(profile.personal.email)} readOnly disabled />
                  </div>
                  <div>
                    <label htmlFor="personal-phone">Phone</label>
                    <input
                      id="personal-phone"
                      type="tel"
                      value={str(profile.personal.phone)}
                      onChange={(e) => setPersonal('phone', e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="personal-city">City</label>
                    <input
                      id="personal-city"
                      value={str(profile.personal.city)}
                      onChange={(e) => setPersonal('city', e.target.value)}
                    />
                  </div>
                </div>
                <label htmlFor="personal-country">Country</label>
                <input
                  id="personal-country"
                  value={str(profile.personal.country)}
                  onChange={(e) => setPersonal('country', e.target.value)}
                />
                <label htmlFor="personal-linkedin">LinkedIn</label>
                <input
                  id="personal-linkedin"
                  value={str(profile.personal.linkedinUrl)}
                  onChange={(e) => setPersonal('linkedinUrl', e.target.value)}
                />
                <label htmlFor="personal-github">GitHub</label>
                <input
                  id="personal-github"
                  value={str(profile.personal.githubUrl)}
                  onChange={(e) => setPersonal('githubUrl', e.target.value)}
                />
                <label htmlFor="personal-portfolio">Portfolio / website</label>
                <input
                  id="personal-portfolio"
                  value={str(profile.personal.portfolioUrl)}
                  onChange={(e) => setPersonal('portfolioUrl', e.target.value)}
                />
              </div>

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
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={profile.excludeEntryLevel}
                    onChange={(e) => set('excludeEntryLevel', e.target.checked)}
                  />
                  Hide entry-level and internship roles
                </label>
              </div>
            </div>

            <div className="card mt-4">
              <h2>Skills, roles & locations</h2>
              <label htmlFor="profile-skills">Skills (comma separated)</label>
              <input
                id="profile-skills"
                name="skills"
                value={profile.skills.join(', ')}
                onChange={(e) => set('skills', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
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
                onChange={(e) => set('employmentTypes', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </div>

            {/* ── Education ────────────────────────────────────────────── */}
            <div className="card mt-4">
              <h2>Education</h2>
              {profile.education.length === 0 && <p className="muted">No education added yet.</p>}
              {profile.education.map((row, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--border, #eee)' : undefined, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                  <div className="grid grid-2">
                    <div>
                      <label htmlFor={`edu-institution-${i}`}>Institution</label>
                      <input
                        id={`edu-institution-${i}`}
                        value={row.institution}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, institution: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-degree-${i}`}>Degree</label>
                      <input
                        id={`edu-degree-${i}`}
                        value={row.degree}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, degree: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-field-${i}`}>Field of study</label>
                      <input
                        id={`edu-field-${i}`}
                        value={row.field}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-grade-${i}`}>Grade / result</label>
                      <input
                        id={`edu-grade-${i}`}
                        value={row.grade}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, grade: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-start-${i}`}>Start year</label>
                      <input
                        id={`edu-start-${i}`}
                        type="number"
                        value={row.startYear}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, startYear: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-end-${i}`}>End year</label>
                      <input
                        id={`edu-end-${i}`}
                        type="number"
                        value={row.endYear}
                        onChange={(e) => set('education', profile.education.map((r, j) => (j === i ? { ...r, endYear: e.target.value } : r)))}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => set('education', profile.education.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn ghost small mt-2" onClick={() => set('education', [...profile.education, emptyEducation()])}>
                <Plus className="h-4 w-4" /> Add education
              </button>
            </div>

            {/* ── Experience ───────────────────────────────────────────── */}
            <div className="card mt-4">
              <h2>Work experience</h2>
              {profile.experiences.length === 0 && <p className="muted">No experience added yet.</p>}
              {profile.experiences.map((row, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--border, #eee)' : undefined, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                  <div className="grid grid-2">
                    <div>
                      <label htmlFor={`exp-title-${i}`}>Job title</label>
                      <input
                        id={`exp-title-${i}`}
                        value={row.title}
                        onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`exp-company-${i}`}>Company</label>
                      <input
                        id={`exp-company-${i}`}
                        value={row.company}
                        onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, company: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`exp-location-${i}`}>Location</label>
                      <input
                        id={`exp-location-${i}`}
                        value={row.location}
                        onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, location: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`exp-start-${i}`}>Start year</label>
                      <input
                        id={`exp-start-${i}`}
                        type="number"
                        value={row.startYear}
                        onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, startYear: e.target.value } : r)))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`exp-end-${i}`}>End year</label>
                      <input
                        id={`exp-end-${i}`}
                        type="number"
                        value={row.endYear}
                        disabled={row.current}
                        onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, endYear: e.target.value } : r)))}
                      />
                    </div>
                  </div>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={row.current}
                      onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, current: e.target.checked } : r)))}
                    />
                    I currently work here
                  </label>
                  <label htmlFor={`exp-desc-${i}`}>What you did</label>
                  <textarea
                    id={`exp-desc-${i}`}
                    rows={2}
                    value={row.description}
                    onChange={(e) => set('experiences', profile.experiences.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                  />
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => set('experiences', profile.experiences.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn ghost small mt-2" onClick={() => set('experiences', [...profile.experiences, emptyExperience()])}>
                <Plus className="h-4 w-4" /> Add experience
              </button>
            </div>

            {/* ── Projects & certifications ────────────────────────────── */}
            <div className="grid grid-2 mt-4">
              <div className="card">
                <h2>Projects</h2>
                {profile.projects.length === 0 && <p className="muted">No projects added yet.</p>}
                {profile.projects.map((row, i) => (
                  <div key={i} style={{ borderTop: i ? '1px solid var(--border, #eee)' : undefined, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                    <label htmlFor={`proj-name-${i}`}>Name</label>
                    <input
                      id={`proj-name-${i}`}
                      value={row.name}
                      onChange={(e) => set('projects', profile.projects.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    />
                    <label htmlFor={`proj-desc-${i}`}>Description</label>
                    <textarea
                      id={`proj-desc-${i}`}
                      rows={2}
                      value={row.description}
                      onChange={(e) => set('projects', profile.projects.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                    />
                    <div className="grid grid-2">
                      <div>
                        <label htmlFor={`proj-url-${i}`}>Link</label>
                        <input
                          id={`proj-url-${i}`}
                          value={row.url}
                          onChange={(e) => set('projects', profile.projects.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))}
                        />
                      </div>
                      <div>
                        <label htmlFor={`proj-year-${i}`}>Year</label>
                        <input
                          id={`proj-year-${i}`}
                          type="number"
                          value={row.year}
                          onChange={(e) => set('projects', profile.projects.map((r, j) => (j === i ? { ...r, year: e.target.value } : r)))}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => set('projects', profile.projects.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="btn ghost small mt-2" onClick={() => set('projects', [...profile.projects, emptyProject()])}>
                  <Plus className="h-4 w-4" /> Add project
                </button>
              </div>

              <div className="card">
                <h2>Certifications</h2>
                {profile.certifications.length === 0 && <p className="muted">No certifications added yet.</p>}
                {profile.certifications.map((row, i) => (
                  <div key={i} style={{ borderTop: i ? '1px solid var(--border, #eee)' : undefined, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                    <label htmlFor={`cert-name-${i}`}>Name</label>
                    <input
                      id={`cert-name-${i}`}
                      value={row.name}
                      onChange={(e) => set('certifications', profile.certifications.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    />
                    <div className="grid grid-2">
                      <div>
                        <label htmlFor={`cert-issuer-${i}`}>Issuer</label>
                        <input
                          id={`cert-issuer-${i}`}
                          value={row.issuer}
                          onChange={(e) => set('certifications', profile.certifications.map((r, j) => (j === i ? { ...r, issuer: e.target.value } : r)))}
                        />
                      </div>
                      <div>
                        <label htmlFor={`cert-year-${i}`}>Year</label>
                        <input
                          id={`cert-year-${i}`}
                          type="number"
                          value={row.year}
                          onChange={(e) => set('certifications', profile.certifications.map((r, j) => (j === i ? { ...r, year: e.target.value } : r)))}
                        />
                      </div>
                    </div>
                    <label htmlFor={`cert-url-${i}`}>Credential link</label>
                    <input
                      id={`cert-url-${i}`}
                      value={row.credentialUrl}
                      onChange={(e) => set('certifications', profile.certifications.map((r, j) => (j === i ? { ...r, credentialUrl: e.target.value } : r)))}
                    />
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => set('certifications', profile.certifications.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn ghost small mt-2"
                  onClick={() => set('certifications', [...profile.certifications, emptyCertification()])}
                >
                  <Plus className="h-4 w-4" /> Add certification
                </button>
              </div>
            </div>

            {/* ── Languages ────────────────────────────────────────────── */}
            <div className="card mt-4">
              <h2>Languages</h2>
              {profile.languages.length === 0 && <p className="muted">No languages added yet.</p>}
              {profile.languages.map((row, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2" style={{ marginTop: i ? 8 : 0 }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label htmlFor={`lang-name-${i}`}>Language</label>
                    <input
                      id={`lang-name-${i}`}
                      value={row.language}
                      onChange={(e) => set('languages', profile.languages.map((r, j) => (j === i ? { ...r, language: e.target.value } : r)))}
                    />
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <label htmlFor={`lang-level-${i}`}>Proficiency</label>
                    <select
                      id={`lang-level-${i}`}
                      value={row.proficiency}
                      onChange={(e) => set('languages', profile.languages.map((r, j) => (j === i ? { ...r, proficiency: e.target.value } : r)))}
                    >
                      {PROFICIENCIES.map((p) => (
                        <option key={p} value={p}>
                          {p.charAt(0) + p.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => set('languages', profile.languages.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn ghost small mt-2" onClick={() => set('languages', [...profile.languages, emptyLanguage()])}>
                <Plus className="h-4 w-4" /> Add language
              </button>
            </div>

            <button type="submit" className="btn mt-4" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </form>

          {/* ── Supporting documents ──────────────────────────────────── */}
          <div className="card mt-4">
            <h2>Supporting documents</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Certificates, portfolio exports and other files you want to keep with your profile.
            </p>
            {otherDocuments.length === 0 && <p className="muted">No documents yet.</p>}
            {otherDocuments.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3" style={{ marginTop: 8 }}>
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ wordBreak: 'break-all' }}>{d.label || d.originalName}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {d.kind.charAt(0) + d.kind.slice(1).toLowerCase()} · {d.originalName} · {(d.sizeBytes / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button className="btn ghost small" onClick={() => download(`/api/profile/documents/${d.id}/download`, d.originalName)}>
                  <Download className="h-4 w-4" /> Download
                </button>
                <button className="btn danger small" onClick={() => deleteDocument(d.id)}>
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="doc-kind">Type</label>
                <select id="doc-kind" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  {DOC_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="doc-label">Label (optional)</label>
                <input id="doc-label" value={docLabel} onChange={(e) => setDocLabel(e.target.value)} placeholder="e.g. AWS certificate" />
              </div>
              <input
                id="doc-file"
                type="file"
                accept=".pdf,.docx"
                style={{ display: 'none' }}
                onChange={uploadDocument}
              />
              <label htmlFor="doc-file" className="btn ghost small" style={{ display: 'inline-flex', cursor: 'pointer' }}>
                <Plus className="h-4 w-4" /> Add document
              </label>
            </div>
          </div>

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
