import { Global, Module } from '@nestjs/common';
import { MatchingService } from './matching.service';

@Global()
@Module({
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
