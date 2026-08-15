import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.notifications.listInbox(user.id);
  }

  @Patch('inbox/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('inbox/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Get('notifications')
  all(@CurrentUser() user: AuthUser) {
    return this.notifications.listInbox(user.id);
  }

  @Get('settings/notifications-preview')
  preview(@CurrentUser() user: AuthUser, @Query('threshold') threshold: string) {
    return this.notifications.preview(user.id, Number(threshold) || 70);
  }

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUnique({
      where: { id: user.id },
      select: { matchThreshold: true, notificationsPaused: true, digestEnabled: true },
    });
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: { matchThreshold?: number; notificationsPaused?: boolean; digestEnabled?: boolean },
  ) {
    const data: any = {};
    if (body.matchThreshold !== undefined) data.matchThreshold = body.matchThreshold;
    if (body.notificationsPaused !== undefined) data.notificationsPaused = body.notificationsPaused;
    if (body.digestEnabled !== undefined) data.digestEnabled = body.digestEnabled;
    return this.prisma.user.update({ where: { id: user.id }, data });
  }
}
