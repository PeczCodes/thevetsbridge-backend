import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { WebhookService } from '../services/webhook.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../identity/auth/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Payments')
@Controller('payments/webhook')
@Public()
@SkipThrottle()
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paystack Webhook Receiver',
    description:
      'Endpoint to receive transaction notifications (e.g. charge.success) from Paystack. Validates payload hashes and enqueues background processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook enqueued or duplicate ignored.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing signature header.',
  })
  
  
  async handlePaystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: any,
  ): Promise<string> {
    if (!signature) {
      throw new UnauthorizedException('Missing signature header');
    }

    // rawBody is enabled via NestFactory { rawBody: true } in main.ts.
    // We MUST use the raw bytes for HMAC verification — JSON.stringify can produce a different
    // byte sequence than what Paystack signed.
    const rawBodyBuffer = req.rawBody;
    if (!rawBodyBuffer) {
      throw new BadRequestException(
        'Raw request body is required for webhook signature verification',
      );
    }
    const rawBody = rawBodyBuffer.toString('utf8');

    await this.webhookService.processPaystackWebhook(
      signature,
      rawBody,
      req.body,
    );

    return 'OK';
  }
}
