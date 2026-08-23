import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, TelegramModule, EventsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
