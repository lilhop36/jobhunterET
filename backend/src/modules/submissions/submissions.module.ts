import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApplicationDraftsModule } from '../application-drafts/application-drafts.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SUBMISSION_TRANSPORT } from './submission-transport';

@Module({
  imports: [PrismaModule, ApplicationDraftsModule],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    // No production transport: every real submission is prepared for the
    // candidate to send and confirm themselves. Tests can override this token.
    { provide: SUBMISSION_TRANSPORT, useValue: null },
  ],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}