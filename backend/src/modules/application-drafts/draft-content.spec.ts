import { draftHash, editedFields, isEdited, normalizeContent } from './draft-content';

const base = { cv: 'CV', coverLetter: 'Letter', screeningAnswers: [{ question: 'Q', answer: 'A', basis: 'B' }] };

describe('normalizeContent', () => {
  it('coerces missing fields to safe defaults', () => {
    expect(normalizeContent(null)).toEqual({ cv: '', coverLetter: '', screeningAnswers: [] });
    expect(normalizeContent({ cv: 5, screeningAnswers: 'nope' })).toEqual({
      cv: '',
      coverLetter: '',
      screeningAnswers: [],
    });
  });

  it('keeps well-formed answers and drops the rest of their shape', () => {
    const out = normalizeContent({
      cv: 'a',
      screeningAnswers: [{ question: 'q', answer: 1, basis: null, extra: 'x' }],
    });
    expect(out.screeningAnswers).toEqual([{ question: 'q', answer: '', basis: '' }]);
  });
});

describe('draftHash', () => {
  it('is stable for identical inputs', () => {
    const a = draftHash({ packageId: 'p1', content: base, documentIds: ['d1', 'd2'] });
    const b = draftHash({ packageId: 'p1', content: { ...base }, documentIds: ['d2', 'd1'] });
    expect(a).toBe(b); // document order does not matter
  });

  it('changes when any content byte changes', () => {
    const before = draftHash({ packageId: 'p1', content: base, documentIds: [] });
    const after = draftHash({
      packageId: 'p1',
      content: { ...base, coverLetter: 'Letter!' },
      documentIds: [],
    });
    expect(after).not.toBe(before);
  });

  it('changes when the attached documents change', () => {
    const before = draftHash({ packageId: 'p1', content: base, documentIds: ['d1'] });
    const after = draftHash({ packageId: 'p1', content: base, documentIds: ['d1', 'd2'] });
    expect(after).not.toBe(before);
  });

  it('changes when the source package changes', () => {
    const before = draftHash({ packageId: 'p1', content: base, documentIds: [] });
    const after = draftHash({ packageId: 'p2', content: base, documentIds: [] });
    expect(after).not.toBe(before);
  });
});

describe('editedFields', () => {
  it('reports exactly which parts changed', () => {
    const current = { ...base, cv: 'CV2' };
    expect(editedFields(base, current)).toEqual(['cv']);
    expect(isEdited(base, current)).toBe(true);
    expect(isEdited(base, { ...base })).toBe(false);
  });
});
