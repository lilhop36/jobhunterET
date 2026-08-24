/**
 * Source Classifier — auto-tags jobs with browsable categories.
 *
 * Classification is two-layer:
 * 1. Source-level defaults (from source-configs.json): every job from ReliefWeb gets "ethiopian", "ngo"
 * 2. Per-job enrichment: analyze location, title, workplace to refine tags
 *
 * Tags are stored on the Job as a JSON string array in SQLite.
 * The frontend uses tags for category filtering: "🇪🇹 Ethiopian", "🌍 Remote", etc.
 */

export interface SourceConfig {
  id: string;
  defaultTags: string[];
  defaultLocationClass: string;
}

export interface ClassificationResult {
  tags: string[];
  locationClass: string;
}

// Ethiopian cities/regions for location detection
const ETHIOPIA_LOCATIONS = [
  'addis ababa', 'addis', 'mekelle', 'mekelle', 'adama', 'nazret',
  'bahir dar', 'hawassa', 'hawari', 'dire dawa', 'jimma', 'gondar',
  'dessie', 'debre markos', 'harar', 'arba minch', 'bolda',
  ' Ethiopia', 'ethiopian', 'ethiopia',
];

// International remote indicators
const REMOTE_INDICATORS = [
  'remote', 'work from home', 'wfh', 'anywhere', 'global',
  'distributed', 'telecommute', 'home-based',
];

// NGO/humanitarian indicators
const NGO_INDICATORS = [
  'ngo', 'non-profit', 'nonprofit', 'humanitarian', 'un ', 'unicef',
  'who', 'undp', 'world bank', 'red cross', 'msf', 'care ',
  'save the children', 'plan international', 'relief',
  'charity', 'foundation', 'civil society',
];

// Tech role indicators
const TECH_INDICATORS = [
  'developer', 'engineer', 'architect', 'devops', 'sre', 'data scien',
  'machine learning', 'ai ', 'ml ', 'frontend', 'backend', 'full stack',
  'fullstack', 'full-stack', 'software', 'programmer', 'typescript',
  'javascript', 'python', 'react', 'node', 'angular', 'vue',
  'cloud', 'infrastructure', 'cybersecurity', 'security engineer',
  'qa', 'test engineer', 'mobile developer', 'ios', 'android',
];

// Experience level indicators
const SENIOR_INDICATORS = [
  'senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', 'director',
  'vp ', 'chief', 'head of', 'architect',
];

const ENTRY_INDICATORS = [
  'junior', 'jr.', 'jr ', 'intern', 'trainee', 'apprentice',
  'graduate', 'entry level', 'entry-level', 'associate',
];

/**
 * Classify a job based on source config + job attributes.
 * Returns the final tag list and refined locationClass.
 */
export function classifyJob(
  sourceConfig: SourceConfig,
  job: {
    title: string;
    location: string;
    locationClass: string;
    workPlace: string;
    company?: string;
  },
): ClassificationResult {
  const tags = new Set(sourceConfig.defaultTags);
  let locationClass = job.locationClass || sourceConfig.defaultLocationClass;

  const locationLower = (job.location || '').toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const companyLower = (job.company || '').toLowerCase();
  const combined = `${locationLower} ${titleLower} ${companyLower}`;

  // ── Location-based classification ──

  // Detect Ethiopia presence
  const isEthiopia = ETHIOPIA_LOCATIONS.some((loc) => combined.includes(loc));
  if (isEthiopia) {
    tags.add('ethiopian');
    // Refine location class if source default was wrong
    if (locationClass === 'INTERNATIONAL_REMOTE' || locationClass === 'INTERNATIONAL_ONSITE') {
      // Ethiopian company but remote — it's ETHIOPIA_REMOTE
      if (job.workPlace === 'REMOTE' || /remote/i.test(job.location)) {
        locationClass = 'ETHIOPIA_REMOTE';
      } else {
        locationClass = 'ETHIOPIA_LOCAL';
      }
    }
  }

  // Detect remote
  const isRemote = REMOTE_INDICATORS.some((r) => combined.includes(r))
    || job.workPlace === 'REMOTE'
    || /remote/i.test(job.location);
  if (isRemote) {
    tags.add('remote');
    // Refine: if it's Ethiopia-based but remote
    if (isEthiopia && locationClass.includes('ETHIOPIA')) {
      locationClass = 'ETHIOPIA_REMOTE';
    } else if (!isEthiopia) {
      locationClass = locationClass.includes('LOCAL') ? 'INTERNATIONAL_REMOTE' : locationClass;
    }
  }

  // International (not Ethiopia)
  if (!isEthiopia && (isRemote || /remote/i.test(locationClass))) {
    tags.add('international');
  } else if (!isEthiopia && !isRemote) {
    tags.add('international');
  }

  // ── Content-based classification ──

  // NGO/humanitarian
  if (NGO_INDICATORS.some((n) => combined.includes(n))) {
    tags.add('ngo');
  }

  // Tech role
  if (TECH_INDICATORS.some((t) => titleLower.includes(t))) {
    tags.add('tech');
  }

  // Senior/Entry level
  if (SENIOR_INDICATORS.some((s) => titleLower.includes(s))) {
    tags.add('senior');
  }
  if (ENTRY_INDICATORS.some((e) => titleLower.includes(e))) {
    tags.add('entry_level');
  }

  // Freelance/contract
  if (/freelance|contract|gig|consultant/i.test(combined)) {
    tags.add('freelance');
  }

  return {
    tags: [...tags].sort(),
    locationClass,
  };
}

/**
 * Format tags for display in the UI.
 */
export const TAG_LABELS: Record<string, { emoji: string; label: string; color: string }> = {
  ethiopian: { emoji: '🇪🇹', label: 'Ethiopian', color: '#22c55e' },
  remote: { emoji: '🌍', label: 'Remote', color: '#3b82f6' },
  international: { emoji: '🌐', label: 'International', color: '#8b5cf6' },
  ngo: { emoji: '🏥', label: 'NGO/Humanitarian', color: '#f59e0b' },
  tech: { emoji: '💻', label: 'Tech', color: '#06b6d4' },
  entry_level: { emoji: '🌱', label: 'Entry Level', color: '#10b981' },
  senior: { emoji: '⭐', label: 'Senior', color: '#ef4444' },
  freelance: { emoji: '📋', label: 'Freelance/Contract', color: '#f97316' },
};

/**
 * Get all available tags for the frontend category filter.
 */
export function getAllTags(): { id: string; emoji: string; label: string; color: string; description: string }[] {
  return Object.entries(TAG_LABELS).map(([id, meta]) => ({
    id,
    ...meta,
    description: (() => {
      const descriptions: Record<string, string> = {
        ethiopian: 'Jobs based in Ethiopia',
        remote: 'Work-from-anywhere positions',
        international: 'Opportunities outside Ethiopia',
        ngo: 'Non-profit, humanitarian, or UN organizations',
        tech: 'Software engineering, data, or IT roles',
        entry_level: 'Junior, intern, or graduate positions',
        senior: 'Senior, lead, or principal positions',
        freelance: 'Contract, freelance, or gig work',
      };
      return descriptions[id] || '';
    })(),
  }));
}
