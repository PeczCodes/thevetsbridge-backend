import { Controller, Post, Get, Body, Query, UseGuards, Headers } from '@nestjs/common';
import { PaymentService } from '../services/payment.service';
import { InitiatePaymentDto } from '../dto/initiate-payment.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../identity/auth/decorators/public.decorator';

@ApiTags('Payments')
@ApiBearerAuth('Bearer')
@Controller('payments')
@UseGuards(RequireProfileGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Endpoint to initiate a checkout transaction. Returns Paystack authorization URL.
   */
  @Post('initiate')
  @ApiOperation({
    summary: 'Initiate a checkout session',
    description: 'Initializes a transaction on the gateway (e.g. Paystack) and returns the authorization URL for payment redirection.',
  })
  @ApiResponse({ status: 201, description: 'Redirect URL and payment reference generated successfully.' })
  @ApiResponse({ status: 400, description: 'Payment already completed or invalid request inputs.' })
  async initiate(
    @CurrentUser() user: any,
    @Body() dto: InitiatePaymentDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentService.initiatePayment(
      user.id,
      user.email,
      dto.purpose,
      dto.targetId,
      dto.callbackUrl,
      idempotencyKey,
    );
  }

  /**
   * Endpoint to query current payment status in DB (polling target).
   */
  @Get('status')
  @ApiOperation({
    summary: 'Query transaction status',
    description: 'Retrieves current status (PENDING, PAID_IN_ESCROW, SUCCEEDED, FAILED) of a transaction by reference (polling target).',
  })
  @ApiResponse({ status: 200, description: 'Payment status retrieved.' })
  @ApiResponse({ status: 404, description: 'Payment reference not found.' })
  async getStatus(@Query('reference') reference: string) {
    return this.paymentService.getPaymentStatus(reference);
  }
}
