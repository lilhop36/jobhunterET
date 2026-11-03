import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplicationDraftsService } from './application-drafts.service';
import { ApproveDraftDto, CreateDraftDto, UpdateDraftDto } from './dto/application-draft.dto';

@UseGuards(JwtAuthGuard)
@Controller('application-drafts')
export class ApplicationDraftsController {
  constructor(private readonly drafts: ApplicationDraftsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDraftDto) {
    return this.drafts.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.drafts.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.drafts.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDraftDto) {
    return this.drafts.update(user.id, id, dto);
  }

  @Post(':id/validate')
  validate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.drafts.validate(user.id, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApproveDraftDto) {
    return this.drafts.approve(user.id, id, dto);
  }

  @Get(':id/audit')
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.drafts.audit(user.id, id);
  }
}
