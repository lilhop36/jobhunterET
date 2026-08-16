import { Body, Controller, Delete, Get, Post, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { TelegramService } from './telegram.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { RateLimiter } from '../../common/utils/rate-limiter';

@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  /** SEC-005: a logged-in user can only probe a bounded number of codes per window. */
  private readonly linkLimiter = new RateLimiter(Number(process.env.LINK_RATE_MAX ?? 20), 15 * 60_000);

  constructor(private readonly telegram: TelegramService) {}

  @Post('link-code')
  createCode(@CurrentUser() user: AuthUser) {
    return this.telegram.createCode(user.id);
  }

  /** FR-003b: linking completes inside the bot — the web app only validates the code. */
  @Post('link')
  link(@Req() req: Request, @CurrentUser() user: AuthUser, @Body('code') code: string) {
    if (!this.linkLimiter.consume(`user:${user.id}`)) {
      throw new HttpException('Too many attempts — please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    const claimed = this.telegram.validateCode(code);
    if (!claimed || claimed.userId !== user.id) {
      return { valid: false, message: 'Invalid or expired code' };
    }
    return { valid: true, message: 'Now open the bot and send /start <code> to complete linking.' };
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.telegram.status(user.id);
  }

  @Delete('link')
  unlink(@CurrentUser() user: AuthUser) {
    return this.telegram.unlink(user.id);
  }
}
