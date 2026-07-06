import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentController } from './controllers/payment.controller';
import { WebhookController } from './controllers/webhook.controller';
import { PayoutController } from './controllers/payout.controller';
import { PaymentService } from './services/payment.service';
import { WebhookService } from './services/webhook.service';
import { LedgerService } from './services/ledger.service';
import { PayoutService } from './services/payout.service';
import { PaystackProvider } from './providers/paystack.provider';
import { PaymentEventEmitter } from './events/payment-event.emitter';
import { PaymentVerificationWorker } from './workers/payment-verification.worker';
import { PayoutWorker } from './workers/payout.worker';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'payment-verification-queue',
    }),
    BullModule.registerQueue({
      name: 'payout-queue',
    }),
  ],
  controllers: [PaymentController, WebhookController, PayoutController],
  providers: [
    PaymentService,
    WebhookService,
    LedgerService,
    PayoutService,
    PaystackProvider,
    PaymentEventEmitter,
    PaymentVerificationWorker,
    PayoutWorker,
  ],
  exports: [
    PaymentService,
    LedgerService,
    PayoutService,
    PaymentEventEmitter,
    BullModule,
  ],
})
export class PaymentsModule {}
