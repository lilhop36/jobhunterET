import { Module } from '@nestjs/common';
import { SavedJobsService } from './saved-jobs.service';
import { SavedJobsController } from './saved-jobs.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApplicationsModule } from '../applications/applications.module';

@Module({
  imports: [PrismaModule, ApplicationsModule],
  controllers: [SavedJobsController],
  providers: [SavedJobsService],
  exports: [SavedJobsService],
})
export class SavedJobsModule {}
