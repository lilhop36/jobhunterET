import {
  Body,
  Controller,
  Patch,
  Post,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RateLimiter } from '../../common/utils/rate-limiter';

/**
 * SEC-005: public auth endpoints are throttled per-IP (brute force) and per
 * account (targeted password guessing on a known email). Budgets are
 * configurable via env with sane defaults; in-memory for the single-instance MVP.
 */
@Controller('auth')
export class AuthController {
  private readonly ipLimiter = new RateLimiter(
    Number(process.env.AUTH_RATE_MAX ?? 10),
    Number(process.env.AUTH_RATE_WINDOW_MS ?? 15 * 60_000),
  );
  private readonly emailLimiter = new RateLimiter(
    Number(process.env.AUTH_EMAIL_RATE_MAX ?? 5),
    Number(process.env.AUTH_RATE_WINDOW_MS ?? 15 * 60_000),
  );

  constructor(private readonly auth: AuthService) {}

  private enforceLimits(req: Request, email?: string) {
    const ip = req.ip ?? 'unknown';
    if (!this.ipLimiter.consume(`ip:${ip}`)) {
      throw new HttpException('Too many attempts — please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (email !== undefined && !this.emailLimiter.consume(`email:${email.toLowerCase()}`)) {
      throw new HttpException('Too many attempts for this account — please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Post('register')
  async register(@Req() req: Request, @Body() dto: RegisterDto) {
    this.enforceLimits(req);
    return this.auth.register(dto);
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginDto) {
    this.enforceLimits(req, dto.email);
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  async changePassword(@Req() req: Request, @CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    this.enforceLimits(req);
    return this.auth.changePassword(user.id, dto);
  }
}
