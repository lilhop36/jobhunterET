import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DigestService } from './digest.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('digest')
export class DigestController {
  constructor(private readonly digests: DigestService) {}

  /** FR-028: last-run status (drives the Searches page card + dashboard digest card). */
  @Get()
  last(@CurrentUser() user: AuthUser) {
    return this.digests.latestFor(user.id);
  }

  /** Manual trigger — runs the daily digest for the current user right now. */
  @Post('run')
  runNow(@CurrentUser() user: AuthUser) {
    return this.digests.runForUser(user.id);
  }
}
