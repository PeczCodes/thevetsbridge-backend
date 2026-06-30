import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsQueueWorker } from './notifications-queue.worker';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
    }),
    PrismaModule,
  ],
  providers: [NotificationsQueueService, NotificationsQueueWorker],
  exports: [NotificationsQueueService],
})
export class NotificationsQueueModule {}
