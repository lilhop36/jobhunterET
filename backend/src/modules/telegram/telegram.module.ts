import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApplicationsModule } from '../applications/applications.module';

@Module({
  imports: [PrismaModule, ApplicationsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
