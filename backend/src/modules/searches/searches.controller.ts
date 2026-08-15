import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SearchesService } from './searches.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('searches')
export class SearchesController {
  constructor(private readonly searches: SearchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.searches.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: { name: string; q?: string; tier?: string; remote?: boolean }) {
    return this.searches.create(user.id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.searches.remove(user.id, id);
  }
}
