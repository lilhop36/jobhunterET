import { Global, Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service';
import { LifecycleTasks } from './lifecycle.tasks';
import { SourcesModule } from '../sources/sources.module';
import { DigestModule } from '../digest/digest.module';

@Global()
@Module({
  imports: [SourcesModule, DigestModule],
  providers: [LifecycleService, LifecycleTasks],
  exports: [LifecycleService],
})
export class LifecycleModule {}
