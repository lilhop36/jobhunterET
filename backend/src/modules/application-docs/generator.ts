/**
 * Deterministic application-package generator (Abdi JobPilot ET, Phase 7).
 *
 * Produces a tailored CV, cover letter, screening answers, a requirement →
 * evidence map and warnings from *verified* profile data and one vacancy.
 *
 * Hard rule: nothing is invented. Every sentence is either copied from a
 * verified profile section, a computed fact (e.g. years from dated roles), or
 * an explicit "not provided" statement. There is no language model here, so a
 * generated package can never add an employer, degree, certificate or skill the
 * candidate did not enter.
 */
import { buildSkillEvidence, normalizeSkill, ProfileInput } from '../matching/matching-engine';

export const GENERATOR_VERSION = 'v1.0-deterministic';

export interface PackageProfile {
  personal: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    country: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
  };
  title: string | null;
  summary: string | null;
  years: number;
  skills: string[];
  education: {
    institution: string;
    degree: string | null;
    field: string | null;
    startYear: number | null;
    endYear: number | null;
    grade: string | null;
  }[];
  experiences: {
    title: string;
    company: string;
    location: string | null;
    startYear: number | null;
    endYear: number | null;
    current: boolean;
    description: string | null;
  }[];
  projects: { name: string; description: string | null; url: string | null; year: number | null }[];
  certifications: { name: string; issuer: string | null; year: number | null; credentialUrl: string | null }[];
  languages: { language: string; proficiency: string }[];
  documents: { kind: string; originalName: string }[];
}

export interface PackageJob {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string | null;
  skills: string[];
  experienceLevel: string;
  deadline: Date | string | null;
}

export interface PackageMatch {
  requiredRequirements: { name: string; kind: string; importance: string; status: string; evidence: string }[];
  preferredRequirements: { name: string; kind: string; importance: string; status: string; evidence: string }[];
  missingRequirements: string[];
  unknownRequirements: string[];
}

export interface ScreeningAnswer {
  question: string;
  answer: string;
  /** The verified profile fact the answer rests on, or why it is unknown. */
  basis: string;
}

export interface RequirementEvidence {
  name: string;
  kind: string;
  importance: string;
  status: string;
  evidence: string;
}

export interface ApplicationPackageContent {
  cv: string;
  coverLetter: string;
  screeningAnswers: ScreeningAnswer[];
  requirementMapping: RequirementEvidence[];
  warnings: string[];
  generatorVersion: string;
}

const line = (value?: string | null): string => (value ?? '').toString().trim();
const has = (value?: string | null): boolean => line(value).length > 0;

function toProfileInput(profile: PackageProfile): ProfileInput {
  return {
    skills: profile.skills,
    targetRoles: profile.title ? [{ role: profile.title, priority: 'HIGH' }] : [],
    locationTiers: {},
    remote: false,
    employmentTypes: [],
    years: profile.years,
    minSalary: 0,
    excludeOnsite: false,
    excludeEntryLevel: false,
    education: profile.education.map((e) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      endYear: e.endYear,
    })),
    experience: profile.experiences.map((e) => ({
      title: e.title,
      company: e.company,
      startYear: e.startYear,
      endYear: e.endYear,
      current: e.current,
      description: e.description,
    })),
    projects: profile.projects.map((p) => ({ name: p.name, description: p.description, year: p.year })),
    certifications: profile.certifications.map((c) => ({ name: c.name, issuer: c.issuer, year: c.year })),
    languages: profile.languages.map((l) => ({ language: l.language, proficiency: l.proficiency })),
  };
}

function highestEducation(profile: PackageProfile): string | null {
  if (!profile.education.length) return null;
  const sorted = [...profile.education].sort((a, b) => (b.endYear ?? 0) - (a.endYear ?? 0));
  const e = sorted[0];
  const bits = [e.degree, e.field].filter(has);
  return bits.length ? `${bits.join(' in ')} — ${e.institution}` : e.institution;
}

function yearRange(value: { startYear: number | null; endYear: number | null; current?: boolean }): string {
  const start = value.startYear ? String(value.startYear) : '';
  const end = value.current ? 'Present' : value.endYear ? String(value.endYear) : '';
  if (start && end) return `${start}–${end}`;
  return start || end || '';
}

function requirementStatus(match: PackageMatch | null, skill: string): RequirementEvidence | null {
  if (!match) return null;
  const key = normalizeSkill(skill);
  const all = [...match.requiredRequirements, ...match.preferredRequirements];
  return all.find((r) => normalizeSkill(r.name) === key) ?? null;
}

/**
 * Skills the application may claim: the verified skills list plus anything
 * proven by certifications, projects, education, experience or languages.
 */
function verifiedSkillSet(profile: PackageProfile): Map<string, string[]> {
  return buildSkillEvidence(toProfileInput(profile));
}

function matchedJobSkills(job: PackageJob, match: PackageMatch | null, evidence: Map<string, string[]>): string[] {
  if (match) {
    const met = match.requiredRequirements
      .filter((r) => r.kind === 'SKILL' && (r.status === 'MET' || r.status === 'PARTIAL'))
      .map((r) => r.name);
    if (met.length) return met;
  }
  return job.skills.filter((s) => evidence.has(normalizeSkill(s)));
}

/** Assemble the CV. Only verified sections appear; empty sections are omitted. */
function buildCv(profile: PackageProfile, job: PackageJob): string {
  const contact = [
    profile.personal.fullName,
    profile.personal.email,
    profile.personal.phone,
    [profile.personal.city, profile.personal.country].filter(has).join(', '),
    profile.personal.linkedinUrl,
    profile.personal.githubUrl,
    profile.personal.portfolioUrl,
  ].filter(has) as string[];

  const blocks: string[] = [];
  blocks.push(`# ${profile.personal.fullName || 'Candidate'}`);
  if (contact.length) blocks.push(contact.join(' · '));
  blocks.push(`Target role: ${job.title} — ${job.company}`);

  const summary = line(profile.summary);
  if (summary) {
    blocks.push(`## Professional summary\n${summary}`);
  } else {
    const facts: string[] = [];
    if (profile.title) facts.push(profile.title);
    if (profile.years > 0) facts.push(`${profile.years} year${profile.years === 1 ? '' : 's'} of verified experience`);
    if (profile.skills.length) facts.push(`skills in ${profile.skills.slice(0, 6).join(', ')}`);
    if (facts.length) {
      blocks.push(
        `## Professional summary\nAuto-composed from your verified profile: ${facts.join('; ')}. ` +
          `Add a written summary in your profile to replace this text.`,
      );
    } else {
      blocks.push(
        `## Professional summary\nNo summary on your profile yet. Add one in the profile editor — it is never generated for you.`,
      );
    }
  }

  if (profile.skills.length) blocks.push(`## Skills\n${profile.skills.join(', ')}`);

  if (profile.experiences.length) {
    const roles = profile.experiences.map((e) => {
      const head = [e.title, e.company].filter(has).join(' — ');
      const meta = [yearRange(e), e.location].filter(has).join(' · ');
      const body = line(e.description);
      return `### ${head}${meta ? `\n${meta}` : ''}${body ? `\n${body}` : ''}`;
    });
    blocks.push(`## Experience\n${roles.join('\n\n')}`);
  }

  if (profile.projects.length) {
    const projects = profile.projects.map((p) => {
      const meta = [p.year ? String(p.year) : '', p.url].filter(has).join(' · ');
      const body = line(p.description);
      return `### ${p.name}${meta ? `\n${meta}` : ''}${body ? `\n${body}` : ''}`;
    });
    blocks.push(`## Projects\n${projects.join('\n\n')}`);
  }

  if (profile.education.length) {
    const education = profile.education.map((e) => {
      const head = [e.degree, e.field].filter(has).join(' in ') || e.institution;
      const meta = [e.institution, yearRange(e), e.grade].filter(has).join(' · ');
      return `- ${head}${meta ? ` — ${meta}` : ''}`;
    });
    blocks.push(`## Education\n${education.join('\n')}`);
  }

  if (profile.certifications.length) {
    const certs = profile.certifications.map((c) => {
      const meta = [c.issuer, c.year ? String(c.year) : ''].filter(has).join(', ');
      return `- ${c.name}${meta ? ` — ${meta}` : ''}`;
    });
    blocks.push(`## Certifications\n${certs.join('\n')}`);
  }

  if (profile.languages.length) {
    const langs = profile.languages.map((l) => `${l.language}${l.proficiency ? ` (${l.proficiency})` : ''}`);
    blocks.push(`## Languages\n${langs.join(', ')}`);
  }

  return blocks.join('\n\n').trim() + '\n';
}

/**
 * Cover letter: every claim points at a verified requirement verdict or a
 * verified profile section. Skills the candidate cannot prove are simply not
 * mentioned (they surface in warnings instead).
 */
function buildCoverLetter(
  profile: PackageProfile,
  job: PackageJob,
  match: PackageMatch | null,
  evidence: Map<string, string[]>,
): string {
  const name = profile.personal.fullName || 'Candidate';
  const matched = matchedJobSkills(job, match, evidence);
  // When the posting lists no structured skills there is nothing to tailor to;
  // cite the verified profile skills instead of leaving the letter empty. When
  // it does list skills, unverified ones stay unmentioned.
  const cited = matched.length || job.skills.length ? matched : profile.skills.slice(0, 4);
  const paragraphs: string[] = [];

  paragraphs.push(
    `Dear ${job.company} Hiring Team,\n\nI am applying for the ${job.title} role at ${job.company}${
      has(job.location) ? ` in ${job.location}` : ''
    }.`,
  );

  const proof: string[] = [];
  if (profile.years > 0) {
    proof.push(`${profile.years} year${profile.years === 1 ? '' : 's'} of verified professional experience`);
  }
  if (cited.length) {
    const sources = cited
      .map((skill) => {
        const found = evidence.get(normalizeSkill(skill));
        return found?.length ? `${skill} (verified in ${found[0]})` : skill;
      })
      .slice(0, 4);
    proof.push(`hands-on work with ${sources.join(', ')}`);
  }
  if (profile.experiences.length) {
    const latest = profile.experiences[0];
    proof.push(`most recently as ${latest.title} at ${latest.company}`);
  }
  if (profile.education.length) {
    const edu = highestEducation(profile);
    if (edu) proof.push(`a ${edu}`);
  }
  if (profile.certifications.length) {
    proof.push(`the ${profile.certifications[0].name} certification`);
  }

  if (proof.length) {
    paragraphs.push(
      `My verified background includes ${proof.join('; ')}. I have not added anything below that I cannot support with my profile.`,
    );
  } else {
    paragraphs.push(
      `My profile does not yet contain verified experience, education or skills. Please review the attached profile and add any missing detail before submitting.`,
    );
  }

  const missing = match?.missingRequirements ?? [];
  if (missing.length) {
    paragraphs.push(
      `The posting asks for ${missing.join(', ')}, which I have not recorded as verified in my profile. If I gain or confirm that experience, I will update my application.`,
    );
  }

  paragraphs.push(
    `Thank you for considering my application. I would welcome the chance to discuss how my verified experience fits this role.\n\nSincerely,\n${name}`,
  );

  return paragraphs.join('\n\n');
}

function buildScreeningAnswers(profile: PackageProfile, job: PackageJob, match: PackageMatch | null): ScreeningAnswer[] {
  const answers: ScreeningAnswer[] = [];

  answers.push({
    question: 'How many years of relevant experience do you have?',
    answer: profile.years > 0 ? `${profile.years} year${profile.years === 1 ? '' : 's'}` : 'Not provided in your profile.',
    basis: profile.years > 0 ? 'Verified profile years (stated or derived from dated roles)' : 'Your profile has no verified experience yet',
  });

  const location = [profile.personal.city, profile.personal.country].filter(has).join(', ');
  answers.push({
    question: 'Where are you currently based?',
    answer: location || 'Not provided in your profile.',
    basis: location ? 'Verified personal details' : 'Add your city and country in the profile editor',
  });

  const edu = highestEducation(profile);
  answers.push({
    question: 'What is your highest level of education?',
    answer: edu || 'Not provided in your profile.',
    basis: edu ? 'Verified education section' : 'Add your education in the profile editor',
  });

  answers.push({
    question: 'Which languages do you speak?',
    answer: profile.languages.length
      ? profile.languages.map((l) => `${l.language}${l.proficiency ? ` (${l.proficiency})` : ''}`).join(', ')
      : 'Not provided in your profile.',
    basis: profile.languages.length ? 'Verified languages section' : 'Add your languages in the profile editor',
  });

  const topSkills = job.skills.slice(0, 3);
  for (const skill of topSkills) {
    const verdict = requirementStatus(match, skill);
    let answer: string;
    let basis: string;
    if (!verdict) {
      answer = 'Not verified in your profile.';
      basis = 'The posting lists this skill but no verified evidence was found';
    } else if (verdict.status === 'MET') {
      answer = 'Yes.';
      basis = verdict.evidence;
    } else if (verdict.status === 'PARTIAL') {
      answer = 'Partially — through a transferable skill.';
      basis = verdict.evidence;
    } else if (verdict.status === 'UNKNOWN') {
      answer = 'Cannot be determined from the posting or your profile.';
      basis = verdict.evidence;
    } else {
      answer = 'Not verified in your profile.';
      basis = verdict.evidence;
    }
    answers.push({ question: `Do you have experience with ${skill}?`, answer, basis });
  }

  answers.push({
    question: 'Do you require visa sponsorship?',
    answer: 'Not provided in your profile.',
    basis: 'This field is not stored yet — add it before submitting any application',
  });

  return answers;
}

function buildWarnings(
  profile: PackageProfile,
  job: PackageJob,
  match: PackageMatch | null,
): string[] {
  const warnings: string[] = [];

  if (!has(profile.personal.fullName)) warnings.push('Your full name is missing from the profile.');
  if (!has(profile.personal.email)) warnings.push('Your email address is missing from the profile.');
  if (!has(profile.personal.phone)) warnings.push('Your phone number is missing from the profile.');
  if (!profile.experiences.length) warnings.push('No verified work experience — the CV will omit the experience section.');
  if (!profile.education.length) warnings.push('No verified education — the CV will omit the education section.');
  if (!profile.skills.length) warnings.push('No verified skills — the skills section will be empty.');
  if (!profile.documents.some((d) => d.kind === 'CV')) {
    warnings.push('No CV document is stored in your profile documents.');
  }

  for (const name of match?.missingRequirements ?? []) {
    warnings.push(`Missing required qualification: ${name}. Do not claim it until it is verified.`);
  }
  for (const name of match?.unknownRequirements ?? []) {
    warnings.push(`Could not verify "${name}" — the posting or your profile lacks the detail.`);
  }

  if (job.deadline) {
    const deadline = new Date(job.deadline).getTime();
    if (Number.isFinite(deadline) && deadline < Date.now()) {
      warnings.push('The application deadline has passed.');
    }
  }

  return warnings;
}

export function generateApplicationPackage(
  profile: PackageProfile,
  job: PackageJob,
  match: PackageMatch | null,
): ApplicationPackageContent {
  const evidence = verifiedSkillSet(profile);
  const requirementMapping: RequirementEvidence[] = [
    ...(match?.requiredRequirements ?? []).map((r) => ({
      name: r.name,
      kind: r.kind,
      importance: r.importance,
      status: r.status,
      evidence: r.evidence,
    })),
    ...(match?.preferredRequirements ?? []).map((r) => ({
      name: r.name,
      kind: r.kind,
      importance: r.importance,
      status: r.status,
      evidence: r.evidence,
    })),
  ];

  return {
    cv: buildCv(profile, job),
    coverLetter: buildCoverLetter(profile, job, match, evidence),
    screeningAnswers: buildScreeningAnswers(profile, job, match),
    requirementMapping,
    warnings: buildWarnings(profile, job, match),
    generatorVersion: GENERATOR_VERSION,
  };
}
