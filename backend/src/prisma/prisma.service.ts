import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * $0 budget detector: when DATABASE_URL is not set or starts with
   * "file:", the system uses SQLite — no PostgreSQL required for dev.
   */
  readonly isSQLite: boolean;

  constructor() {
    super();
    const url = process.env.DATABASE_URL ?? '';
    this.isSQLite = !url || url.startsWith('file:');
    if (this.isSQLite) {
      this.logger.log('SQLite mode — no PostgreSQL required ($0 budget)');
    }
  }

  /**
   * SEC-010: SQLite stores booleans as Int (0/1). Prisma on SQLite rejects
   * `true`/`false` in where-filters for Int fields. This helper converts
   * booleans to integers when in SQLite mode.
   */
  bool(v: boolean): number | boolean {
    return this.isSQLite ? (v ? 1 : 0) : v;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
