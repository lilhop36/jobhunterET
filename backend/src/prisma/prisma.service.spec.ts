import { PrismaService } from './prisma.service';

/**
 * SEC-010 — SQLite encoding boundary.
 *
 * SQLite has no boolean or JSON column type: they are stored as Int 0/1 and text. A filter that
 * hands Prisma `true` for an Int column, or an object for a text column, fails at query time —
 * which is a data-access error, not a security hole, until the same helper is asked to do the
 * opposite thing on PostgreSQL. These tests pin the boundary in both directions.
 */
function serviceFor(url: string | undefined): PrismaService {
  const previous = process.env.DATABASE_URL;
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
  try {
    return new PrismaService();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

describe('SEC-010 — SQLite boolean and JSON coercion', () => {
  const sqlite = serviceFor('file:./dev.db');
  const postgres = serviceFor('postgresql://jobhunter:secret@localhost:5432/jobhunter');
  const unset = serviceFor(undefined);

  afterAll(async () => {
    await Promise.all([sqlite.$disconnect(), postgres.$disconnect(), unset.$disconnect()]);
  });

  it('treats an unset or file: connection string as SQLite, which is the $0 default', () => {
    expect(sqlite.isSQLite).toBe(true);
    expect(unset.isSQLite).toBe(true);
    expect(postgres.isSQLite).toBe(false);
  });

  it('encodes booleans as 0/1 on SQLite, where an Int column rejects true/false', () => {
    expect(sqlite.bool(true)).toBe(1);
    expect(sqlite.bool(false)).toBe(0);
  });

  it('leaves booleans native on PostgreSQL, where 0/1 would be the wrong filter', () => {
    expect(postgres.bool(true)).toBe(true);
    expect(postgres.bool(false)).toBe(false);
  });

  it('serialises JSON for SQLite and reads it back unchanged', () => {
    const value = { skills: ['Go', 'SQL'], primary: true };
    const stored = sqlite.json(value);
    expect(typeof stored).toBe('string');
    expect(sqlite.parseJson(stored)).toEqual(value);
  });

  it('passes JSON through untouched on PostgreSQL', () => {
    const value = { skills: ['Go'] };
    expect(postgres.json(value)).toEqual(value);
  });

  it('returns an empty array rather than throwing when a stored JSON column is not parseable', () => {
    expect(sqlite.jsonArray('["a","b"]')).toEqual(['a', 'b']);
    expect(sqlite.jsonArray('not json')).toEqual([]);
    expect(sqlite.jsonArray(['already', 'a', 'list'])).toEqual(['already', 'a', 'list']);
    expect(sqlite.parseJson('not json')).toBeNull();
  });
});
