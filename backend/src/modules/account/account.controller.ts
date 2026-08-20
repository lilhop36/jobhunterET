import { Controller, Post, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Post('deactivate')
  deactivate(@CurrentUser() user: AuthUser) {
    return this.account.deactivate(user.id);
  }

  @Post('delete')
  delete(@CurrentUser() user: AuthUser) {
    return this.account.delete(user.id);
  }
}
