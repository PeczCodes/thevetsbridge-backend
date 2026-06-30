import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Get,
} from '@nestjs/common';
import { WebhookService } from '../services/webhook.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../identity/auth/decorators/public.decorator';

@ApiTags('Payments')
@Controller('payments/webhook')
@Public()
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  
  @Get('paystack')
  async works(){
    return 'works'
  }
  
  
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paystack Webhook Receiver',
    description: 'Endpoint to receive transaction notifications (e.g. charge.success) from Paystack. Validates payload hashes and enqueues background processing.',
  })
  @ApiResponse({ status: 200, description: 'Webhook enqueued or duplicate ignored.' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature header.' })
  async handlePaystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: any
  ): Promise<string> {
    if (!signature) {
      throw new UnauthorizedException('Missing signature header');
    }

    // In NestJS, when rawBody is enabled in NestFactory, req.rawBody is a Buffer containing the raw request body.
    const rawBodyBuffer = (req as any).rawBody;
    const rawBody = rawBodyBuffer ? rawBodyBuffer.toString('utf8') : JSON.stringify(req.body);

    await this.webhookService.processPaystackWebhook(signature, rawBody, req.body);

    return 'OK';
  }
}

