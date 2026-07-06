import { Module, forwardRef } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxProcessor } from './outbox.processor';
import { OutboxWorker } from './outbox.worker';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { NotificationsQueueModule } from '../queues/notifications-queue/notifications-queue.module';
import { MediaModule } from '../../src/modules/media/media.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'outbox-events',
    }),
    forwardRef(() => PaymentsModule),
    NotificationsQueueModule,
    MediaModule,
    RedisModule,
  ],
  providers: [OutboxService, OutboxProcessor, OutboxWorker],
  exports: [OutboxService],
})
export class OutboxModule {}
