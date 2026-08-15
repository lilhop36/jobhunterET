import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { SourcesController } from './sources.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReliefWebAdapter } from './adapters/reliefweb.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { EthioNgoJobsAdapter } from './adapters/ethiongojobs.adapter';
import { GeezJobsAdapter } from './adapters/geezjobs.adapter';
import { EthiojobsAdapter } from './adapters/ethiojobs.adapter';

@Module({
  imports: [PrismaModule, MatchingModule, NotificationsModule],
  controllers: [SourcesController],
  providers: [
    SourcesService,
    ReliefWebAdapter,
    RemotiveAdapter,
    ArbeitnowAdapter,
    EthioNgoJobsAdapter,
    GeezJobsAdapter,
    EthiojobsAdapter,
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
