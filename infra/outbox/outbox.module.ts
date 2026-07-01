import { Module, forwardRef } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxProcessor } from './outbox.processor';
import { OutboxWorker } from './outbox.worker';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { NotificationsQueueModule } from '../queues/notifications-queue/notifications-queue.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'outbox-events',
    }),
    forwardRef(() => PaymentsModule),
    NotificationsQueueModule,
  ],
  providers: [OutboxService, OutboxProcessor, OutboxWorker],
  exports: [OutboxService],
})
export class OutboxModule {}
