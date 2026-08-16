import { Global, Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Global()
@Module({
  imports: [NotificationsModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
