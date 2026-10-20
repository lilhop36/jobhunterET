import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';
import { LifecycleTasks } from './lifecycle.tasks';
import { SourcesModule } from '../sources/sources.module';
import { DigestModule } from '../digest/digest.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [SourcesModule, DigestModule, MatchingModule],
  providers: [LifecycleService, LifecycleTasks],
  exports: [LifecycleService],
})
export class LifecycleModule {}
