import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { PayoutService } from '../services/payout.service';
import {
  RegisterPayoutAccountDto,
  ResolveAccountDto,
  WithdrawRequestDto,
} from '../dto/payout.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Payouts')
@ApiBearerAuth('Bearer')
@Controller('payments/payout')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Get('banks')
  @ApiOperation({ summary: 'List supported banks for payout' })
  async getBanks() {
    return this.payoutService.getBanks();
  }

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify account number details with bank code' })
  async resolveAccount(@Body() dto: ResolveAccountDto) {
    return this.payoutService.resolveAccount(dto.accountNumber, dto.bankCode);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'Get registered payout bank accounts' })
  async getPayoutAccounts(@CurrentUser() user: any) {
    return this.payoutService.getPayoutAccounts(user.id);
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Register verified payout bank account' })
  async registerPayoutAccount(
    @CurrentUser() user: any,
    @Body() dto: RegisterPayoutAccountDto,
  ) {
    return this.payoutService.registerPayoutAccount(user.id, dto);
  }

  @Delete('accounts/:id')
  @ApiOperation({ summary: 'Delete payout bank account' })
  async deletePayoutAccount(
    @CurrentUser() user: any,
    @Param('id') accountId: string,
  ) {
    return this.payoutService.deletePayoutAccount(user.id, accountId);
  }

  @Patch('accounts/:id/default')
  @ApiOperation({ summary: 'Set default payout account' })
  async setDefaultPayoutAccount(
    @CurrentUser() user: any,
    @Param('id') accountId: string,
  ) {
    return this.payoutService.setDefaultPayoutAccount(user.id, accountId);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Get worker available and pending earnings balance',
  })
  async getBalanceProjection(@CurrentUser() user: any) {
    return this.payoutService.getBalanceProjection(user.id);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Idempotently request payout withdrawal' })
  async requestWithdrawal(
    @CurrentUser() user: any,
    @Body() dto: WithdrawRequestDto,
  ) {
    return this.payoutService.requestWithdrawal(user.id, dto);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Get withdrawal request history log' })
  async getWithdrawalsHistory(@CurrentUser() user: any) {
    return this.payoutService.getWithdrawalsHistory(user.id);
  }
}
