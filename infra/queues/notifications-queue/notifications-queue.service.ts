import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationsQueueService {
  private readonly logger = new Logger(NotificationsQueueService.name);

  constructor(@InjectQueue('notifications') private readonly notificationsQueue: Queue) {}

  async queuePushNotification(userId: string, title: string, body: string, data?: any) {
    this.logger.log(`Queueing push notification for User ID ${userId}`);
    await this.notificationsQueue.add(
      'send-push',
      {
        userId,
        title,
        body,
        data,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    );
  }

  async queueEmail(to: string, subject: string, template: string, context?: any, options?: any) {
    this.logger.log(`Queueing email dispatch for recipient ${to}`);
    await this.notificationsQueue.add(
      'send-email',
      {
        to,
        subject,
        template,
        context,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        ...options,
      },
    );
  }
}
