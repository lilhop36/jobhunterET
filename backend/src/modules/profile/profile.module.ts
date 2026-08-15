import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [PrismaModule, MatchingModule, MulterModule.register({})],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
