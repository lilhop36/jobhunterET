import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MatchesModule } from './modules/matches/matches.module';
import { SavedJobsModule } from './modules/saved-jobs/saved-jobs.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchesModule } from './modules/searches/searches.module';
import { SourcesModule } from './modules/sources/sources.module';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module';
import { MatchingModule } from './modules/matching/matching.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    MatchingModule,
    LifecycleModule,
    AuthModule,
    ProfileModule,
    TelegramModule,
    JobsModule,
    MatchesModule,
    SavedJobsModule,
    ApplicationsModule,
    NotificationsModule,
    SearchesModule,
    SourcesModule,
    DashboardModule,
    AccountModule,
    AdminModule,
  ],
})
export class AppModule {}
