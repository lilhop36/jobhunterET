/* CV import heuristics (Phase 5).
 *
 * Pure text in, draft profile out — no database, no HTTP, so the rules are
 * testable on saved CV text. Nothing here is authoritative: the draft is shown
 * to the candidate, who edits and confirms it before anything is saved.
 *
 * Design rule: prefer missing an entry over inventing one. Every extractor is
 * conservative and every gap becomes a warning the user can act on.
 */
import { SKILL_DICT, SKILL_ALIAS, normalizeSkill } from '../../matching/matching-engine';

export interface DraftEducation {
  institution: string;
  degree?: string;
  field?: string;
  startYear?: number;
  endYear?: number;
}

export interface DraftExperience {
  title: string;
  company: string;
  location?: string;
  startYear?: number;
  endYear?: number;
  current?: boolean;
  description?: string;
}

export interface DraftProject {
  name: string;
  description?: string;
  url?: string;
  year?: number;
}

export interface DraftCertification {
  name: string;
  issuer?: string;
  year?: number;
  credentialUrl?: string;
}

export interface DraftLanguage {
  language: string;
  proficiency: 'NATIVE' | 'FLUENT' | 'INTERMEDIATE' | 'BASIC';
}

export interface CvDraft {
  personal: {
    fullName?: string;
    email?: string;
    phone?: string;
    city?: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
  };
  title?: string;
  summary?: string;
  years?: number;
  skills: string[];
  targetRoles: string[];
  education: DraftEducation[];
  experiences: DraftExperience[];
  projects: DraftProject[];
  certifications: DraftCertification[];
  languages: DraftLanguage[];
  warnings: string[];
}

interface Section {
  name: string;
  lines: string[];
}

const HEADERS: [string, RegExp][] = [
  ['summary', /^(professional\s+)?(summary|profile|objective|about\s*me)\b/i],
  ['experience', /^(work\s+|professional\s+|employment\s+)?(experience|history)\b/i],
  ['education', /^education(\s+and\s+training)?\b/i],
  ['skills', /^(technical\s+|core\s+|professional\s+)?(skills|competencies|expertise)\b/i],
  ['projects', /^(personal\s+|selected\s+|key\s+)?projects\b/i],
  ['certifications', /^(certifications?|certificates?|licen[cs]es?)\b/i],
  ['languages', /^languages?\b/i],
  ['references', /^references?\b/i],
];

const DATE_RANGE =
  /((?:19|20)\d{2})\s*(?:[-–—]|to|until|through)\s*((?:19|20)\d{2}|present|current|now|date)/i;

const DEGREE =
  /\b(b\.?\s?sc|b\.?\s?a\.?|m\.?\s?sc|m\.?\s?a\.?|mba|ph\.?\s?d|bachelor|master|doctor|diploma|advanced diploma|certificate in)\b/i;

const COMPANY_HINT =
  /\b(plc|p\.l\.c|ltd|limited|inc|llc|s\.c|sc|corp|corporation|company|co\.|bank|university|college|hospital|institute|group|foundation|ngo|agency|bureau|ministry|authority|association|consult|technolog|solutions|systems)\b/i;

const ROLE_HINT =
  /\b(engineer|developer|programmer|manager|analyst|officer|accountant|auditor|nurse|teacher|lecturer|coordinator|specialist|consultant|designer|administrator|technician|supervisor|director|assistant|advisor|architect|scientist|marketer|sales|officer|clerk|secretary|pharmacist|driver|receptionist|intern|associate|lead|head|chief|founder|researcher|writer|editor|trainer|planner|inspector|surveyor|accountant|banker|agent)\b/i;

const LANGUAGES = [
  'English', 'Amharic', 'Afaan Oromo', 'Oromo', 'Tigrinya', 'Somali', 'Arabic',
  'French', 'Swahili', 'Chinese', 'Spanish', 'German', 'Italian', 'Hindi',
  'Portuguese', 'Russian', 'Korean', 'Japanese', 'Hebrew', 'Turkish',
];

const KNOWN_SKILLS = new Map<string, string>([
  ...SKILL_DICT.map((s): [string, string] => [s.toLowerCase(), s]),
  ...Object.entries(SKILL_ALIAS).map(([alias, canonical]): [string, string] => [alias.toLowerCase(), canonical]),
]);

const clean = (line: string): string =>
  line
    .replace(/^[\s•·▪◦*\-–—|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const isBullet = (line: string): boolean => /^\s*[•·▪◦*\-–—]/.test(line);

const isHeader = (line: string): boolean =>
  line.length <= 45 && HEADERS.some(([, rx]) => rx.test(line));

const yearIn = (line: string): number | undefined => {
  const m = /(19|20)\d{2}/.exec(line);
  return m ? Number(m[0]) : undefined;
};

function splitSections(lines: string[]): Section[] {
  const sections: Section[] = [{ name: 'header', lines: [] }];
  for (const line of lines) {
    if (isHeader(line)) {
      sections.push({ name: HEADERS.find(([, rx]) => rx.test(line))![0], lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  return sections;
}

const sectionOf = (sections: Section[], name: string): string[] =>
  sections.find((s) => s.name === name)?.lines ?? [];

function parseContact(text: string): CvDraft['personal'] {
  const personal: CvDraft['personal'] = {};
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text);
  if (email) personal.email = email[0];

  for (const candidate of text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) {
      personal.phone = candidate.trim();
      break;
    }
  }

  const linkedin = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i.exec(text);
  if (linkedin) personal.linkedinUrl = `https://${linkedin[0].replace(/^https?:\/\//i, '')}`;
  const github = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i.exec(text);
  if (github) personal.githubUrl = `https://${github[0].replace(/^https?:\/\//i, '')}`;
  const other = /https?:\/\/(?!.*(?:linkedin|github)\.com)[^\s)>"']+/i.exec(text);
  if (other) personal.portfolioUrl = other[0];
  return personal;
}

/** First plausible human name in the header block. */
function parseName(headerLines: string[]): string | undefined {
  for (const raw of headerLines.slice(0, 8)) {
    const line = clean(raw);
    if (!line || line.length < 3 || line.length > 60) continue;
    if (/[@\d]|https?:|linkedin|github/i.test(line)) continue;
    if (isHeader(line)) continue;
    const words = line.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!/^[A-Za-z][A-Za-z.'’\- ]+$/.test(line)) continue;
    return line;
  }
  return undefined;
}

function parseSkills(lines: string[], warnings: string[]): string[] {
  if (!lines.length) return [];
  const tokens = lines
    .join(',')
    .split(/[,;|•·\n]/)
    .map((t) => clean(t).replace(/^(and|&)\s+/i, ''))
    .filter((t) => t.length >= 2 && t.length <= 40);

  const found = new Set<string>();
  const unknown: string[] = [];
  for (const token of tokens) {
    const known = KNOWN_SKILLS.get(token.toLowerCase()) ?? KNOWN_SKILLS.get(normalizeSkill(token).toLowerCase());
    if (known) found.add(known);
    else if (/^[A-Za-z][A-Za-z0-9+#./ -]+$/.test(token)) unknown.push(token);
  }
  if (!found.size && unknown.length) {
    warnings.push('Skills section found, but none matched the skill catalogue — check them before saving.');
    return [];
  }
  return [...found].slice(0, 40);
}

function parseExperiences(lines: string[], warnings: string[]): DraftExperience[] {
  if (!lines.length) return [];
  const out: DraftExperience[] = [];
  let pending: string[] = [];
  let last: DraftExperience | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (!line) continue;

    const range = DATE_RANGE.exec(line);
    if (!range) {
      if (last && isBullet(lines[i]) && line.length > 20) {
        last.description = last.description ? `${last.description} ${line}` : line;
      } else {
        pending.push(line);
      }
      continue;
    }

    const startYear = Number(range[1]);
    const endRaw = range[2].toLowerCase();
    const current = /present|current|now|date/.test(endRaw);
    const endYear = current ? undefined : Number(endRaw);

    let title = '';
    let company = '';
    if (pending.length >= 2) {
      const [a, b] = pending.slice(-2);
      // "Acme PLC" then "Senior Engineer" is as common as the reverse.
      const aIsCompany = COMPANY_HINT.test(a) && !COMPANY_HINT.test(b);
      title = aIsCompany ? b : a;
      company = aIsCompany ? a : b;
    } else if (pending.length === 1) {
      const parts = pending[0].split(/\s+(?:at|@|—|–|\|)\s+/i).map(clean).filter(Boolean);
      if (parts.length >= 2) {
        title = parts[0];
        company = parts[1];
      } else {
        title = pending[0];
        const after = clean(lines[i + 1] ?? '');
        if (after && !isBullet(lines[i + 1]) && !DATE_RANGE.test(after)) company = after;
      }
    }

    if (!title || !company) {
      pending = [];
      last = null;
      continue;
    }

    const location = /,\s*(Addis Ababa|Adama|Hawassa|Bahir Dar|Mekelle|Dire Dawa|Gondar|Jimma|Bishoftu|Remote)\b/i.exec(company);
    const entry: DraftExperience = {
      title: title.replace(/\s*[—–-]\s*$/, ''),
      company: company.split(/\s+[—–]\s+/)[0].replace(/\s*,\s*[A-Z][a-z]+.*$/, '').trim(),
      startYear,
      endYear,
      current,
    };
    if (location) entry.location = location[1];
    out.push(entry);
    last = entry;
    pending = [];
  }

  if (!out.length) warnings.push('Work experience section found, but no entries could be split — add them manually.');
  return out;
}

function parseEducation(lines: string[], warnings: string[]): DraftEducation[] {
  if (!lines.length) return [];

  const out: DraftEducation[] = [];
  let pending: string[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    const range = DATE_RANGE.exec(line);
    if (!range && !/\b(19|20)\d{2}\b/.test(line)) {
      pending.push(line);
      continue;
    }

    const startYear = range ? Number(range[1]) : undefined;
    const current = range ? /present|current|now|date/i.test(range[2]) : false;
    const endYear = range && !current ? Number(range[2]) : undefined;

    const block = pending.length ? pending : [line];
    const degreeLine = block.find((l) => DEGREE.test(l));
    const institutionLine = block.find((l) => l !== degreeLine);

    if (!degreeLine && !institutionLine) {
      pending = [];
      continue;
    }

    // "BSc in Computer Science, Addis Ababa University"
    let degree = degreeLine;
    let institution = institutionLine;
    if (degreeLine && degreeLine.includes(',')) {
      const [first, ...rest] = degreeLine.split(',');
      degree = first.trim();
      if (!institution) institution = rest.join(',').trim();
    }

    out.push({
      institution: institution?.replace(/\s*[—–|]\s*.*$/, '').trim() || 'Unknown institution',
      degree: degree?.replace(/\s*[—–|]\s*.*$/, '').trim(),
      startYear,
      endYear,
    });
    pending = [];
  }

  if (!out.length && pending.length) {
    warnings.push('Education section found, but no dated qualifications could be read.');
  }
  return out;
}

function parseProjects(lines: string[]): DraftProject[] {
  const out: DraftProject[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    // A bare link belongs to the project above it.
    if (/^https?:\/\//i.test(line) && out.length) {
      const last = out[out.length - 1];
      if (!last.url) last.url = line;
      continue;
    }
    if (isBullet(raw) && out.length) {
      const last = out[out.length - 1];
      last.description = last.description ? `${last.description} ${line}` : line;
      continue;
    }
    const split = /^([^:—–]{2,80})[:—–]\s*(.+)$/.exec(line);
    const project: DraftProject = split
      ? { name: split[1].trim(), description: split[2].trim() }
      : { name: line.slice(0, 80) };
    const url = /https?:\/\/[^\s)>"']+/.exec(line);
    if (url) project.url = url[0];
    const year = yearIn(line);
    if (year) project.year = year;
    out.push(project);
  }
  return out.slice(0, 12);
}

function parseCertifications(lines: string[]): DraftCertification[] {
  return lines
    .map(clean)
    .filter((line) => line.length >= 3)
    .slice(0, 15)
    .map((line) => {
      const year = yearIn(line);
      const withoutYear = line.replace(/(19|20)\d{2}/g, '').replace(/[()]+/g, ' ').replace(/\s+/g, ' ').trim();
      const parts = withoutYear
        .split(/\s*(?:,|\bby\b|\bfrom\b|—|–|\|)\s*/i)
        .map((p) => p.trim())
        .filter(Boolean);
      return {
        name: parts[0] ?? withoutYear,
        issuer: parts[1],
        year,
      } as DraftCertification;
    });
}

function parseLanguages(lines: string[]): DraftLanguage[] {
  const out: DraftLanguage[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    for (const known of LANGUAGES) {
      if (!new RegExp(`\\b${known.replace(' ', '\\s+')}\\b`, 'i').test(line)) continue;
      const key = known.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const proficiency: DraftLanguage['proficiency'] = /\b(native|mother\s*tongue)\b/i.test(line)
        ? 'NATIVE'
        : /\b(fluent|advanced|proficient|excellent)\b/i.test(line)
        ? 'FLUENT'
        : /\b(basic|beginner|elementary)\b/i.test(line)
        ? 'BASIC'
        : 'INTERMEDIATE';
      out.push({ language: known, proficiency });
    }
  }
  return out;
}

function inferYears(experiences: DraftExperience[], text: string): number | undefined {
  const stated = /\b(\d{1,2})\+?\s*years?\s+(?:of\s+)?(?:professional\s+)?experience\b/i.exec(text);
  if (stated) return Math.min(50, Number(stated[1]));
  if (!experiences.length) return undefined;
  const start = Math.min(...experiences.map((e) => e.startYear ?? Infinity));
  if (!Number.isFinite(start)) return undefined;
  const ends = experiences.map((e) => (e.current ? new Date().getFullYear() : e.endYear ?? e.startYear ?? 0));
  const end = Math.max(...ends);
  return Math.max(0, Math.min(50, end - start));
}

/** Parse plain CV text into a draft the candidate reviews before saving. */
export function parseCv(text: string): CvDraft {
  const warnings: string[] = [];
  const lines = (text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .filter((l) => l.trim().length > 0);

  const sections = splitSections(lines);
  const headerLines = sections[0]?.lines ?? [];
  const personal = parseContact(text);
  const fullName = parseName(headerLines);
  if (fullName) personal.fullName = fullName;

  const cityLine = headerLines.map(clean).find((l) => /,\s*Ethiopia\b/i.test(l));
  if (cityLine) personal.city = cityLine.split(',')[0].trim();

  const summary = sectionOf(sections, 'summary').map(clean).filter(Boolean).join(' ');
  const experiences = parseExperiences(sectionOf(sections, 'experience'), warnings);
  const education = parseEducation(sectionOf(sections, 'education'), warnings);
  const skills = parseSkills(sectionOf(sections, 'skills'), warnings);
  const projects = parseProjects(sectionOf(sections, 'projects'));
  const certifications = parseCertifications(sectionOf(sections, 'certifications'));
  const languages = parseLanguages(sectionOf(sections, 'languages'));

  // Job title: a header line containing a role word (never a city or contact line).
  const title = headerLines
    .map(clean)
    .find((l) => l !== fullName && l.length <= 70 && ROLE_HINT.test(l) && !/[@\d]/.test(l));

  const targetRoles = [...new Set([title, experiences[0]?.title].filter(Boolean) as string[])]
    .filter((r) => ROLE_HINT.test(r))
    .slice(0, 3);

  if (!personal.email) warnings.push('No email address found in the CV.');
  if (!personal.phone) warnings.push('No phone number found in the CV.');
  if (!experiences.length && !education.length && !skills.length) {
    warnings.push('Almost nothing could be read — this PDF may be a scan. Add your details manually.');
  }

  return {
    personal,
    title,
    summary: summary || undefined,
    years: inferYears(experiences, text),
    skills,
    targetRoles,
    education,
    experiences,
    projects,
    certifications,
    languages,
    warnings,
  };
}
