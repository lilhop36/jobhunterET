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

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
