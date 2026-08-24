import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { getAllTags } from './source-classifier';

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

  /** Enqueue collection for a single source (non-blocking, returns immediately). */
  @Post(':id/collect')
  collect(@Param('id') id: string) {
    return this.sources.enqueueCollect(id);
  }

  /** Source Resilience: per-source health scoring endpoint. */
  @Get('health')
  healthSummary() {
    return this.sources.getSourceHealthSummary();
  }

  // ── New: Config-driven + Queue endpoints ────────────────────────────────

  /** Enqueue collection for ALL active sources. */
  @Post('collect-all')
  collectAll() {
    return this.sources.collectAll();
  }

  /** Get queue statistics (running, pending, completed, failed, history). */
  @Get('queue/stats')
  queueStats() {
    return this.sources.getQueueStats();
  }

  /** Get all source configs (from source-configs.json). */
  @Get('configs')
  configs() {
    return this.sources.getAllSourceConfigs();
  }

  /** Get classification tag definitions (for frontend category filter). */
  @Get('tags')
  tags() {
    return getAllTags();
  }

  /** Get tags with job counts for the category browsing page. */
  @Get('tags/counts')
  tagCounts() {
    return this.sources.getTagCounts();
  }
}
