import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfileModule } from '../profile/profile.module';
import { ApplicationDocsController } from './application-docs.controller';
import { ApplicationDocsService } from './application-docs.service';

@Module({
  imports: [PrismaModule, ProfileModule],
  controllers: [ApplicationDocsController],
  providers: [ApplicationDocsService],
  exports: [ApplicationDocsService],
})
export class ApplicationDocsModule {}
