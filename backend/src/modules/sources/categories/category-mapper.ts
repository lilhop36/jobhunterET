import taxonomy from './category-taxonomy.json';
import sourceCatalog from './source-categories.json';

export interface SourceCategoryEntry {
  id: string;
  label: string;
  canonical: string[];
}

export interface SourceCategoryCatalog {
  urlTemplate?: string;
  categories: SourceCategoryEntry[];
}

export interface CategoryCollectionStat {
  category: string;
  categoryLabel?: string;
  pagesFetched: number;
  jobsFetched: number;
  errors: number;
  stoppedReason: string;
}

const TAXONOMY_MAP: Record<string, { id: string; aliases: string[]; keywords: string[] }> = taxonomy as any;
const SOURCE_CATALOG: Record<string, SourceCategoryCatalog> = sourceCatalog as any;

function normalise(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
}

function aliasMatches(label: string): string[] {
  const norm = normalise(label);
  const hits = new Set<string>();
  for (const [catId, meta] of Object.entries(TAXONOMY_MAP)) {
    for (const alias of meta.aliases) {
      if (norm === normalise(alias) || norm.includes(normalise(alias)) || normalise(alias).includes(norm)) {
        hits.add(catId);
      }
    }
  }
  return [...hits];
}

function keywordMatches(label: string, skills: string[] = []): string[] {
  const text = `${label} ${skills.join(' ')}`.toLowerCase();
  const hits = new Set<string>();
  for (const [catId, meta] of Object.entries(TAXONOMY_MAP)) {
    for (const kw of meta.keywords) {
      if (text.includes(kw.toLowerCase())) {
        hits.add(catId);
      }
    }
  }
  return [...hits];
}

export function getTaxonomy(): Record<string, { id: string; aliases: string[]; keywords: string[] }> {
  return TAXONOMY_MAP;
}

export function flattenTaxonomy(): { id: string; label: string }[] {
  return Object.values(TAXONOMY_MAP).map((t) => ({ id: t.id, label: t.id }));
}

export function validateSourceCategoryIds(sourceId: string, ids: string[]): { valid: string[]; invalid: string[] } {
  const catalog = SOURCE_CATALOG[sourceId];
  if (!catalog) return { valid: [], invalid: ids };
  const validIds = new Set(catalog.categories.map((c) => c.id));
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of ids) {
    if (validIds.has(id)) valid.push(id);
    else invalid.push(id);
  }
  return { valid, invalid };
}

export function mapSourceCategories(
  sourceId: string,
  labels: string[],
  job: { title?: string; skills?: string[] } = {},
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const add = (catId: string) => {
    if (!seen.has(catId)) {
      seen.add(catId);
      result.push(catId);
    }
  };

  const catalog = SOURCE_CATALOG[sourceId];

  // 1. Exact source-category id/label match
  if (catalog) {
    for (const label of labels) {
      const norm = normalise(label);
      for (const entry of catalog.categories) {
        if (norm === normalise(entry.id) || norm === normalise(entry.label)) {
          for (const c of entry.canonical) add(c);
        }
      }
    }
  }

  // 2. Alias match against taxonomy aliases
  for (const label of labels) {
    for (const catId of aliasMatches(label)) add(catId);
  }

  // 3. Keyword inference from source category label
  for (const label of labels) {
    for (const catId of keywordMatches(label)) add(catId);
  }

  // 4. Keyword inference from job title + declared skills
  const title = job.title ?? '';
  const skills = job.skills ?? [];
  for (const catId of keywordMatches(title, skills)) add(catId);

  return result;
}
