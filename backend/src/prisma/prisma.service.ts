import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // In dev we avoid connecting at import time so `prisma generate` works
    // without a running DB. Call connect() explicitly where needed.
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
