import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.matches.list(user.id, filter, limit, cursor);
  }

  @Post('recalculate')
  recalculate(@CurrentUser() user: AuthUser) {
    return this.matches.recalculate(user.id);
  }
}
