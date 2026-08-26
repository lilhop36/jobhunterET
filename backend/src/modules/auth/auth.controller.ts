import {
  Body,
  Controller,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
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

  private setAuthCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('jh_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

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
  async register(@Req() req: Request, @Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    this.enforceLimits(req);
    const result = await this.auth.register(dto);
    this.setAuthCookie(res, result.accessToken);
    return result;
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    this.enforceLimits(req, dto.email);
    const result = await this.auth.login(dto);
    this.setAuthCookie(res, result.accessToken);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  async changePassword(@Req() req: Request, @CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    this.enforceLimits(req);
    await this.auth.changePassword(user.id, dto);
    this.setAuthCookie(res, ''); // clear cookie on password change
    return { ok: true };
  }
}
