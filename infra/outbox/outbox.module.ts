import { Module, forwardRef } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxPoller } from './outbox.poller';
import { OutboxProcessor } from './outbox.processor';
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
  providers: [OutboxService, OutboxPoller, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
