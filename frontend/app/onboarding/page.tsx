'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Plus, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { RequireAuth, ErrorBox } from '../../lib/ui';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
interface RoleRow {
  role: string;
  priority: Priority;
}
interface LocRow {
  region: string;
  tier: Priority;
}

const ROLE_SUGGESTIONS = [
  'Backend Developer',
  'Frontend Developer',
  'Full Stack Developer',
  'Software Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Data Analyst',
  'QA Engineer',
  'Mobile Developer',
  'Project Manager',
];

const SKILL_SUGGESTIONS = [
  'Node.js',
  'TypeScript',
  'JavaScript',
  'PostgreSQL',
  'NestJS',
  'React',
  'Next.js',
  'Express',
  'Python',
  'Git',
  'Docker',
  'REST API',
  'GraphQL',
  'AWS',
  'Redis',
  'SQL',
  'MongoDB',
  'Tailwind CSS',
];

const LOCATION_SUGGESTIONS: { region: string; tier: Priority }[] = [
  { region: 'Ethiopia', tier: 'HIGH' },
  { region: 'Remote', tier: 'HIGH' },
  { region: 'USA', tier: 'MEDIUM' },
  { region: 'Canada', tier: 'MEDIUM' },
  { region: 'UK', tier: 'MEDIUM' },
  { region: 'Netherlands', tier: 'MEDIUM' },
  { region: 'Kenya', tier: 'LOW' },
  { region: 'UAE', tier: 'MEDIUM' },
];

const EMPLOYMENT_TYPES = ['FULL_TIME', 'CONTRACT', 'PART_TIME', 'INTERNSHIP'];

const NEXT_PRIORITY: Record<Priority, Priority> = { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'HIGH' };
const TIER_COLOR: Record<Priority, React.CSSProperties> = {
  HIGH: { background: 'hsl(var(--success) / 0.15)', color: 'hsl(var(--success))' },
  MEDIUM: { background: 'hsl(var(--info) / 0.15)', color: 'hsl(var(--info))' },
  LOW: { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' },
};

const STEPS = ['Roles', 'Skills', 'Locations'];

export default function OnboardingPage() {
  const { api } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [locTiers, setLocTiers] = useState<LocRow[]>([]);
  const [remote, setRemote] = useState(true);
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(['FULL_TIME']);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resume: prefill from the existing profile so the wizard is resumable (FR-003d).
  useEffect(() => {
    api('/api/profile')
      .then((p: any) => {
        setTitle(p.title ?? '');
        setRoles(p.targetRoles ?? []);
        setSkills(p.skills ?? []);
        setLocTiers(p.locationTiers ?? []);
        setRemote(!!p.remote);
        if (p.employmentTypes?.length) setEmploymentTypes(p.employmentTypes);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRole = (role: string) => {
    setRoles((rs) => {
      const hit = rs.find((r) => r.role === role);
      if (!hit) return [...rs, { role, priority: 'HIGH' }];
      return rs.map((r) =>
        r.role === role ? { ...r, priority: NEXT_PRIORITY[r.priority] } : r,
      );
    });
  };

  const toggleSkill = (s: string) =>
    setSkills((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  const toggleLoc = (region: string) => {
    setLocTiers((ls) => {
      const hit = ls.find((l) => l.region === region);
      if (!hit) return [...ls, { region, tier: 'MEDIUM' }];
      return ls.map((l) => (l.region === region ? { ...l, tier: NEXT_PRIORITY[l.tier] } : l));
    });
  };

  const toggleEmployment = (t: string) =>
    setEmploymentTypes((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim() || undefined,
          targetRoles: roles,
          skills,
          locationTiers: locTiers,
          remote,
          employmentTypes,
          onboardDone: true,
        }),
      });
      router.push('/dashboard');
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  const canNext = step === 1 ? roles.length > 0 : step === 2 ? skills.length > 0 : locTiers.length > 0;

  return (
    <RequireAuth>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1>Onboarding wizard</h1>
        <p className="subtitle">
          Three quick steps — skippable and resumable. Each step sharpens your matches (FR-003d).
        </p>

        {/* Step indicator */}
        <div className="card" style={{ padding: '12px 18px', marginBottom: 16 }}>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const active = n === step;
              const done = n < step;
              return (
                <div key={label} className="flex items-center gap-2" style={{ flex: 1 }}>
                  <button
                    onClick={() => setStep(n)}
                    className="btn ghost small"
                    style={{
                      minWidth: 34,
                      borderRadius: 999,
                      padding: '6px 0',
                      background: done || active ? 'hsl(var(--primary))' : undefined,
                      color: done || active ? 'hsl(var(--primary-foreground))' : undefined,
                    }}
                    aria-label={`Step ${n}: ${label}${done ? ' (done)' : ''}`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : n}
                  </button>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {label}
                  </span>
                  {n < STEPS.length && <div style={{ flex: 1, height: 2, background: 'hsl(var(--border))' }} />}
                </div>
              );
            })}
          </div>
        </div>

        {err && <ErrorBox msg={err} />}

        {/* Step 1 — Roles */}
        {step === 1 && (
          <div className="card">
            <h2>1. Your target roles</h2>
            <label>Professional title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Software Engineer" />
            <label>Target roles — tap a chip to add; tap again to cycle priority</label>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <button key={r.role} className="chip" style={TIER_COLOR[r.priority]} onClick={() => toggleRole(r.role)}>
                  {r.role} · {r.priority}
                  <X className="ml-1 h-3 w-3" />
                </button>
              ))}
              {roles.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing added yet.</span>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 6px' }}>
              Suggestions:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_SUGGESTIONS.filter((r) => !roles.some((x) => x.role === r)).map((r) => (
                <button key={r} className="btn ghost small" style={{ minHeight: 32 }} onClick={() => toggleRole(r)}>
                  <Plus className="h-3.5 w-3.5" /> {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Skills */}
        {step === 2 && (
          <div className="card">
            <h2>2. Your skills</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              Tap skills you have — aliases are normalized centrally (FR-004).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <button key={s} className="chip" style={{ background: 'hsl(var(--success) / 0.15)', color: 'hsl(var(--success))' }} onClick={() => toggleSkill(s)}>
                  ✓ {s}
                  <X className="ml-1 h-3 w-3" />
                </button>
              ))}
              {skills.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing selected yet.</span>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 6px' }}>
              Suggestions:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_SUGGESTIONS.filter((s) => !skills.includes(s)).map((s) => (
                <button key={s} className="btn ghost small" style={{ minHeight: 32 }} onClick={() => toggleSkill(s)}>
                  <Plus className="h-3.5 w-3.5" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Locations & preferences */}
        {step === 3 && (
          <div className="card">
            <h2>3. Locations & preferences</h2>
            <label>Location priority tiers — tap a chip to cycle its priority</label>
            <div className="flex flex-wrap gap-1.5">
              {locTiers.map((l) => (
                <button key={l.region} className="chip" style={TIER_COLOR[l.tier]} onClick={() => toggleLoc(l.region)}>
                  {l.region} · {l.tier}
                  <X className="ml-1 h-3 w-3" />
                </button>
              ))}
              {locTiers.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing added yet.</span>}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 6px' }}>
              Suggestions:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LOCATION_SUGGESTIONS.filter((l) => !locTiers.some((x) => x.region === l.region)).map((l) => (
                <button key={l.region} className="btn ghost small" style={{ minHeight: 32 }} onClick={() => toggleLoc(l.region)}>
                  <Plus className="h-3.5 w-3.5" /> {l.region}
                </button>
              ))}
            </div>
            <label className="checkbox-line">
              <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
              Open to remote work
            </label>
            <label>Employment types</label>
            <div className="flex flex-wrap gap-1.5">
              {EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t}
                  className="chip"
                  style={
                    employmentTypes.includes(t)
                      ? { background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }
                      : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }
                  }
                  onClick={() => toggleEmployment(t)}
                >
                  {employmentTypes.includes(t) ? '✓ ' : ''}
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button className="btn ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="btn ghost small">
              Skip for now
            </Link>
            {step < 3 ? (
              <button className="btn" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                Next <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button className="btn" onClick={save} disabled={saving || !canNext}>
                {saving ? 'Saving…' : 'Finish'} <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
