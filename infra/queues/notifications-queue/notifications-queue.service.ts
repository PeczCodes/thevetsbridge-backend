import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MonitoringService } from '../../../src/monitoring/monitoring.service';
import {
  NOTIFICATIONS_CREATED_TOTAL,
  EMAILS_QUEUED_TOTAL,
} from '../../../src/monitoring/metrics/business.metrics';

@Injectable()
export class NotificationsQueueService {
  private readonly logger = new Logger(NotificationsQueueService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}

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
    // Track notification creation metric after successful queuing
    const role = data?.targetRole || 'unknown';
    this.monitoringService?.incrementCounter(NOTIFICATIONS_CREATED_TOTAL, 1, { role });
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
    // Track email queued metric after successful queuing
    this.monitoringService?.incrementCounter(EMAILS_QUEUED_TOTAL, 1, { template: template || 'unknown' });
  }
}
