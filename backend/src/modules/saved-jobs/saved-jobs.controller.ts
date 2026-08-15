import { Controller, Get, Param, Post } from '@nestjs/common';
import { SavedJobsService } from './saved-jobs.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('saved-jobs')
export class SavedJobsController {
  constructor(private readonly saved: SavedJobsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.saved.list(user.id);
  }

  @Post(':jobId')
  toggle(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.saved.toggle(user.id, jobId);
  }
}
