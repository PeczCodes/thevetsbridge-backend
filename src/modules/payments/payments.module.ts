import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentController } from './controllers/payment.controller';
import { WebhookController } from './controllers/webhook.controller';
import { PaymentService } from './services/payment.service';
import { WebhookService } from './services/webhook.service';
import { LedgerService } from './services/ledger.service';
import { PaystackProvider } from './providers/paystack.provider';
import { PaymentEventEmitter } from './events/payment-event.emitter';
import { PaymentVerificationWorker } from './workers/payment-verification.worker';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'payment-verification-queue',
    }),
  ],
  controllers: [PaymentController, WebhookController],
  providers: [
    PaymentService,
    WebhookService,
    LedgerService,
    PaystackProvider,
    PaymentEventEmitter,
    PaymentVerificationWorker,
  ],
  exports: [PaymentService, LedgerService, PaymentEventEmitter],
})
export class PaymentsModule {}
