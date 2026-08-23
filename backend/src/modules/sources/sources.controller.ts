import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list() {
    return this.sources.list();
  }

  @Post()
  create(@Body() body: any) {
    return this.sources.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.sources.update(id, body);
  }

  @Post(':id/collect')
  collect(@Param('id') id: string) {
    return this.sources.collectWithFallback(id);
  }

  /** Source Resilience: per-source health scoring endpoint. */
  @Get('health')
  healthSummary() {
    return this.sources.getSourceHealthSummary();
  }
}
