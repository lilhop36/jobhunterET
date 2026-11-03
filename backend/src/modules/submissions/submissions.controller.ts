import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmissionsService } from './submissions.service';
import { ConfirmSubmissionDto, SubmitApplicationDto } from './dto/submission.dto';

@UseGuards(JwtAuthGuard)
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.submissions.list(user.id);
  }

  /** Explain what submitting this draft would do, without changing anything. */
  @Get('draft/:draftId/plan')
  plan(@CurrentUser() user: AuthUser, @Param('draftId') draftId: string) {
    return this.submissions.prepare(user.id, draftId);
  }

  /** Submit the exact approved revision of a draft. */
  @Post('draft/:draftId')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('draftId') draftId: string,
    @Body() dto: SubmitApplicationDto,
  ) {
    return this.submissions.submit(user.id, draftId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.submissions.get(user.id, id);
  }

  /** The candidate confirms they sent a prepared manual submission. */
  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConfirmSubmissionDto,
  ) {
    return this.submissions.confirmManual(user.id, id, dto);
  }

  @Get(':id/audit')
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.submissions.audit(user.id, id);
  }
}