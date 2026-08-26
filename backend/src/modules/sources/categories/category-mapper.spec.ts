import { mapSourceCategories, validateSourceCategoryIds, flattenTaxonomy } from './category-mapper';

describe('category-mapper', () => {
  describe('alias and keyword resolution', () => {
    it('maps frontend variants to software-engineering.frontend', () => {
      expect(mapSourceCategories('ethiojobs', ['Frontend Engineer'], { title: 'Frontend Engineer' })).toContain('software-engineering.frontend');
      expect(mapSourceCategories('ethiojobs', ['Web Developer'], { title: 'Web Developer' })).toContain('software-engineering.frontend');
      expect(mapSourceCategories('ethiojobs', ['UI Developer'], { title: 'UI Developer' })).toContain('software-engineering.frontend');
      expect(mapSourceCategories('ethiojobs', ['React Developer'], { title: 'React Developer' })).toContain('software-engineering.frontend');
    });

    it('maps Node.js title to software-engineering.backend', () => {
      expect(mapSourceCategories('ethiojobs', [], { title: 'Senior Node.js Engineer' })).toContain('software-engineering.backend');
    });

    it('maps EthioJobs IT category to software-engineering', () => {
      expect(mapSourceCategories('ethiojobs', ['IT, Computer Science & Software Engineering'])).toContain('software-engineering');
    });

    it('maps EthioJobs Health Care to health-medical', () => {
      expect(mapSourceCategories('ethiojobs', ['Health Care'])).toContain('health-medical');
    });

    it('maps ETCareers IT category label (with suffix stripping)', () => {
      expect(mapSourceCategories('etcareers', ['IT & Software Development Jobs in Ethiopia'])).toContain('software-engineering');
    });

    it('returns empty array for unknown labels', () => {
      expect(mapSourceCategories('ethiojobs', ['XYZZY_12345'])).toEqual([]);
    });
  });

  describe('validateSourceCategoryIds', () => {
    it('splits valid and invalid ids against a source catalogue', () => {
      const { valid, invalid } = validateSourceCategoryIds('ethiojobs', ['it-computer-science-and-software-engineering', 'nonexistent']);
      expect(valid).toContain('it-computer-science-and-software-engineering');
      expect(invalid).toContain('nonexistent');
    });
  });

  describe('guard: all catalogue ids resolve to real taxonomy nodes', () => {
    it('every source-categories entry with canonical targets maps correctly', () => {
      const catalog: any = require('./source-categories.json');
      const failures: string[] = [];
      for (const [sourceId, src] of Object.entries(catalog) as [string, any][]) {
        for (const entry of src.categories) {
          if (!entry.canonical.length) continue;
          const canonical = mapSourceCategories(sourceId, [entry.label, entry.id]);
          const hasHit = entry.canonical.some((c: string) => canonical.includes(c));
          if (!hasHit) failures.push(`${sourceId}|${entry.id}|${entry.label} => mapped:${JSON.stringify(canonical)} expected:${JSON.stringify(entry.canonical)}`);
        }
      }
      expect(failures).toHaveLength(0);
    });
  });

  describe('flattenTaxonomy', () => {
    it('returns every taxonomy node', () => {
      const flat = flattenTaxonomy();
      expect(flat.length).toBeGreaterThan(10);
      expect(flat.some((n) => n.id === 'software-engineering')).toBe(true);
    });
  });
});
