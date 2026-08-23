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
import { JobicyAdapter } from './adapters/jobicy.adapter';
import { RemoteOKAdapter } from './adapters/remoteok.adapter';
import { LandingJobsAdapter } from './adapters/landingjobs.adapter';
import { EtcareersAdapter } from './adapters/etcareers.adapter';
import { TelegramChannelAdapter } from './adapters/telegram-channel.adapter';
import { TELEGRAM_CHANNELS } from './adapters/telegram-channels.config';
import { JobSourceAdapter } from './adapters/job-source.adapter';
import { TELEGRAM_ADAPTERS } from './adapters/telegram-tokens';

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
    JobicyAdapter,
    RemoteOKAdapter,
    LandingJobsAdapter,
    EtcareersAdapter,
    // FR-008: Telegram channel adapters — parameterized, one per channel
    {
      provide: TELEGRAM_ADAPTERS,
      useFactory: (): JobSourceAdapter[] =>
        TELEGRAM_CHANNELS.map(
          (ch) => new TelegramChannelAdapter(ch.sourceId, ch.channelUsername),
        ),
    },
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
