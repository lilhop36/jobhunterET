import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationDocsService } from './application-docs.service';

@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationDocsController {
  constructor(private readonly docs: ApplicationDocsService) {}

  @Post(':jobId/package')
  generate(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.docs.generate(user.id, jobId);
  }

  @Get(':jobId/packages')
  list(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.docs.list(user.id, jobId);
  }

  @Get(':jobId/packages/:version')
  get(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Param('version') version: string,
  ) {
    return this.docs.get(user.id, jobId, Number(version));
  }
}
