import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { extractCvText } from './cv/cv-text';
import * as fs from 'fs';

jest.mock('./cv/cv-text', () => ({ extractCvText: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));
const extract = extractCvText as jest.MockedFunction<typeof extractCvText>;
const fsExists = fs.existsSync as jest.Mock;
const fsRead = fs.readFileSync as jest.Mock;

/**
 * Phase 5 — "import from CV, review, then save". The endpoint must be
 * stateless: it returns a draft and never touches the candidate's data.
 */
describe('POST /profile/cv/import (service)', () => {
  const prisma: any = {
    bool: (v: boolean) => (v ? 1 : 0),
    json: JSON.stringify,
    jsonArray: (v: any) => (typeof v === 'string' ? JSON.parse(v) : v ?? []),
    cvFile: { findFirst: jest.fn() },
  };
  const matching: any = { recalculate: jest.fn() };
  const service = new ProfileService(prisma, matching);

  beforeEach(() => {
    prisma.cvFile.findFirst.mockReset();
    extract.mockReset();
    fsExists.mockReset();
    fsRead.mockReset();
  });

  it('turns the active CV into a draft without writing anything', async () => {
    prisma.cvFile.findFirst.mockResolvedValue({
      id: 'cv-1',
      filePath: 'C:/uploads/user-1/cv.pdf',
      originalName: 'cv.pdf',
    });
    fsExists.mockReturnValue(true);
    fsRead.mockReturnValue(Buffer.from('%PDF'));
    extract.mockResolvedValue(`ABEBE KEBEDE
Software Engineer
Addis Ababa, Ethiopia
abebe@example.com
+251 911 234 567

Skills
JavaScript, React

Languages
Amharic - Native
`);

    const result = await service.importCv('user-1');

    expect(result.source).toEqual({ id: 'cv-1', originalName: 'cv.pdf' });
    expect(result.draft.personal).toMatchObject({
      fullName: 'ABEBE KEBEDE',
      email: 'abebe@example.com',
      city: 'Addis Ababa',
    });
    expect(result.draft.skills).toEqual(expect.arrayContaining(['JavaScript', 'React']));
    expect(prisma.cvFile.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', active: 1, kind: 'CV' },
      orderBy: { uploadedAt: 'desc' },
    });
    // Stateless: no profile/section writes were attempted.
    expect(prisma.candidateProfile).toBeUndefined();
  });

  it('asks for an upload when there is no active CV', async () => {
    prisma.cvFile.findFirst.mockResolvedValue(null);
    await expect(service.importCv('user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a CV that disappeared from disk instead of crashing', async () => {
    prisma.cvFile.findFirst.mockResolvedValue({
      id: 'cv-1',
      filePath: 'C:/uploads/user-1/cv.pdf',
      originalName: 'cv.pdf',
    });
    fsExists.mockReturnValue(false);
    await expect(service.importCv('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('documents (service)', () => {
  it('never deletes a document that belongs to someone else', async () => {
    const prisma: any = {
      bool: (v: boolean) => (v ? 1 : 0),
      cvFile: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new ProfileService(prisma, { recalculate: jest.fn() } as any);

    await expect(service.deleteDocument('user-1', 'doc-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.cvFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc-other', userId: 'user-1' },
      data: { active: 0 },
    });
  });
});
