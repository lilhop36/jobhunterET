import * as fs from 'fs';
import * as path from 'path';
import { parseCv } from './cv-parser';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

/**
 * Phase 5 — CV import heuristics. The draft is reviewed before saving, so the
 * parser is judged on "does not invent things" and "flags what it could not
 * read", not on being perfect.
 */
describe('CV parsing (Phase 5)', () => {
  describe('a typical Ethiopian CV', () => {
    const draft = parseCv(fixture('ethiopian-cv.txt'));

    it('reads the person and their contact details', () => {
      expect(draft.personal.fullName).toBe('ABEBE KEBEDE');
      expect(draft.personal.email).toBe('abebe.kebede@gmail.com');
      expect(draft.personal.phone).toMatch(/^\+251/);
      expect(draft.personal.city).toBe('Addis Ababa');
      expect(draft.personal.linkedinUrl).toBe('https://linkedin.com/in/abebek');
      expect(draft.personal.githubUrl).toBe('https://github.com/abebek');
    });

    it('infers the headline and stated years of experience', () => {
      expect(draft.title).toBe('Software Engineer');
      expect(draft.years).toBe(5);
      expect(draft.summary).toContain('Ethiopian fintech');
    });

    it('splits work history into structured entries', () => {
      expect(draft.experiences).toHaveLength(2);
      expect(draft.experiences[0]).toMatchObject({
        title: 'Senior Software Engineer',
        company: 'Commercial Bank of Ethiopia',
        location: 'Addis Ababa',
        startYear: 2021,
        current: true,
      });
      expect(draft.experiences[0].description).toContain('payment dashboards');
      expect(draft.experiences[1]).toMatchObject({
        title: 'Software Developer',
        company: 'Ethio Telecom',
        startYear: 2019,
        endYear: 2021,
      });
    });

    it('keeps education, skills, languages, certifications and projects', () => {
      expect(draft.education[0]).toMatchObject({
        institution: 'Addis Ababa University',
        degree: 'BSc in Computer Science',
        startYear: 2015,
        endYear: 2019,
      });
      expect(draft.skills).toEqual(
        expect.arrayContaining(['JavaScript', 'TypeScript', 'React', 'Node.js', 'PostgreSQL']),
      );
      expect(draft.languages).toEqual(
        expect.arrayContaining([
          { language: 'Amharic', proficiency: 'NATIVE' },
          { language: 'English', proficiency: 'FLUENT' },
        ]),
      );
      expect(draft.certifications[0]).toMatchObject({
        name: 'AWS Certified Cloud Practitioner',
        issuer: 'Amazon',
        year: 2022,
      });
      expect(draft.projects[0]).toMatchObject({
        name: 'JobPilot - A job aggregation platform for Ethiopia',
        url: 'https://github.com/abebek/jobpilot',
      });
    });

    it('reports nothing it could not read', () => {
      expect(draft.warnings).toEqual([]);
    });
  });

  describe('a sparse CV', () => {
    const draft = parseCv(fixture('sparse-cv.txt'));

    it('still finds the person and the one dated job', () => {
      expect(draft.personal.fullName).toBe('SARA TADESSE');
      expect(draft.experiences[0]).toMatchObject({ title: 'Accountant', company: 'Zemen PLC' });
    });

    it('warns instead of inventing missing contact details', () => {
      expect(draft.personal.email).toBeUndefined();
      expect(draft.personal.phone).toBeUndefined();
      expect(draft.warnings).toEqual(
        expect.arrayContaining(['No email address found in the CV.', 'No phone number found in the CV.']),
      );
    });

    it('warns when sections could not be split or matched', () => {
      expect(draft.education).toEqual([]);
      expect(draft.warnings).toEqual(
        expect.arrayContaining([
          'Education section found, but no dated qualifications could be read.',
          'Skills section found, but none matched the skill catalogue — check them before saving.',
        ]),
      );
    });
  });

  it('says so when the text is not a CV at all', () => {
    const draft = parseCv('   ');
    expect(draft.skills).toEqual([]);
    expect(draft.experiences).toEqual([]);
    expect(draft.warnings.join(' ')).toContain('this PDF may be a scan');
  });
});
