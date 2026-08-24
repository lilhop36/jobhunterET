/** Shared types for the job detail page decomposition. */

export interface JobDetail {
  id: string;
  title: string;
  company: string;
  location: string;
  locationClass: string;
  workPlace: string;
  employmentType: string;
  experienceLevel: string;
  salary: number | null;
  salaryMax: number | null;
  currency: string;
  url: string;
  description: string | null;
  skills: string[];
  source: { name: string; tier: string };
  postedDate: string;
  deadline: string | null;
  status: string;
  parseConfidence: number;
  applyMethod: string;
  applyUrl: string | null;
  applyEmail: string | null;
  urlStatus: string | null;
  descriptionQuality: number | null;
  descriptionSource: string | null;
  saved: boolean;
  application: { stage: string; stageSince: string } | null;
  match: {
    score: number;
    matchedSkills: string[];
    relatedSkills: string[];
    missingSkills: string[];
    reasons: string[];
    summary: string;
    parts: {
      role: number;
      skill: number;
      experience: number;
      location: number;
      employment: number;
      freshness: number;
      salary: number;
    };
  } | null;
  salaryBenchmark: {
    hasSalary: boolean;
    salary?: number;
    currency?: string;
    benchmark?: {
      role: string;
      level: string;
      etb: { min: number; median: number; max: number; currency: string };
      usd: { min: number; median: number; max: number; currency: string };
      notes?: string;
    } | null;
    percentile?: number | null;
    comparison?: string | null;
    percentAboveMedian?: number;
  } | null;
}

export type PartKey = 'role' | 'skill' | 'experience' | 'location' | 'employment' | 'freshness' | 'salary';

export const PARTS: { key: PartKey; label: string; max: number }[] = [
  { key: 'role',       label: 'Role',       max: 25 },
  { key: 'skill',      label: 'Skills',     max: 30 },
  { key: 'experience', label: 'Experience', max: 15 },
  { key: 'location',   label: 'Location',   max: 15 },
  { key: 'employment', label: 'Employment', max: 5  },
  { key: 'freshness',  label: 'Freshness',  max: 5  },
  { key: 'salary',     label: 'Salary',     max: 5  },
];
