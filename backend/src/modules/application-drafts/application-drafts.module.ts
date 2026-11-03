import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApplicationDraftsController } from './application-drafts.controller';
import { ApplicationDraftsService } from './application-drafts.service';

@Module({
  imports: [PrismaModule],
  controllers: [ApplicationDraftsController],
  providers: [ApplicationDraftsService],
  exports: [ApplicationDraftsService],
})
export class ApplicationDraftsModule {}
