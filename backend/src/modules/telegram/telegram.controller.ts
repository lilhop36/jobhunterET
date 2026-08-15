import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';

@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('link-code')
  createCode(@CurrentUser() user: AuthUser) {
    return this.telegram.createCode(user.id);
  }

  /** FR-003b: linking completes inside the bot — the web app only validates the code. */
  @Post('link')
  link(@CurrentUser() user: AuthUser, @Body('code') code: string) {
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
