/**
 * Local Role type — mirrors the PostgreSQL Prisma enum so code can
 * use a typed Role even when the active schema is SQLite (which has
 * no enums).
 */
export type Role = 'USER' | 'ADMIN';
