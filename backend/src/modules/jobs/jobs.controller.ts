import { Controller, Get, Param, Query } from '@nestjs/common';
import { JobsService, JobFilter } from './jobs.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    const filter: JobFilter = {
      q: q.q,
      tier: q.tier || 'ALL',
      type: q.type,
      workplace: q.workplace,
      source: q.source,
      sort: (q.sort as any) || 'score',
      showDead: q.showDead === 'true',
      userId: user.id,
    };
    return this.jobs.list(filter);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.detail(id, user.id);
  }
}
