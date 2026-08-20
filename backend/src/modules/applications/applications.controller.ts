import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  @Get()
  board(@CurrentUser() user: AuthUser) {
    return this.apps.board(user.id);
  }

  @Post(':jobId')
  apply(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.apps.apply(user.id, jobId);
  }

  @Post(':jobId/stage')
  setStage(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body('stage') stage: string,
  ) {
    return this.apps.setStage(user.id, jobId, stage as any);
  }
}
