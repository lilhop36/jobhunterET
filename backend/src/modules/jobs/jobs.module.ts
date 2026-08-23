import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalaryModule } from '../salary/salary.module';

@Module({
  imports: [PrismaModule, SalaryModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
