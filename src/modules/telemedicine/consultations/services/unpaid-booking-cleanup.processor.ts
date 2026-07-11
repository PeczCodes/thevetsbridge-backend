import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';

@Processor('unpaid-booking-cleanup')
@Injectable()
export class UnpaidBookingCleanupProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(UnpaidBookingCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('unpaid-booking-cleanup') private readonly cleanupQueue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    try {
      const cronPattern = '*/15 * * * *'; // Run every 15 minutes

      // Use native BullMQ v5 upsertJobScheduler for repeatability
      await this.cleanupQueue.upsertJobScheduler(
        'unpaid-booking-cleanup-scheduler', // stable scheduler ID
        {
          pattern: cronPattern,
        },
        {
          name: 'prune-unpaid-bookings',
          data: {},
        },
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to schedule unpaid booking cleanup job: ${error.message}`,
      );
    }
  }

  async process(job: Job): Promise<any> {
    const startTime = Date.now();
    const metadata = {
      queueName: job.queueName,
      workerName: this.constructor.name,
      jobId: job.id,
      retryCount: job.attemptsMade,
    };

    this.logger.log({ ...metadata }, 'Starting unpaid booking cleanup');

    // Unpaid bookings older than 30 minutes
    const threshold = new Date(Date.now() - 30 * 60 * 1000);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Find unpaid appointments
        const unpaidAppointments = await tx.appointment.findMany({
          where: {
            status: 'PENDING',
            createdAt: { lt: threshold },
          },
          select: { id: true },
        });

        if (unpaidAppointments.length === 0) {
          return { cancelledCount: 0, consultationsCancelled: 0 };
        }

        const appointmentIds = unpaidAppointments.map((a) => a.id);

        // Cancel associated consultations
        const consultationsResult = await tx.consultation.updateMany({
          where: {
            appointmentId: { in: appointmentIds },
          },
          data: {
            status: 'CANCELLED',
          },
        });

        // Cancel appointments
        const appointmentsResult = await tx.appointment.updateMany({
          where: {
            id: { in: appointmentIds },
          },
          data: {
            status: 'CANCELLED',
            cancellationReason: 'Payment timeout (30 minutes)',
          },
        });

        return {
          cancelledCount: appointmentsResult.count,
          consultationsCancelled: consultationsResult.count,
        };
      });

      // Native queue cleanup for unpaid-booking-cleanup queue
      // Clean completed jobs older than 24 hours
      await this.cleanupQueue.clean(24 * 3600 * 1000, 1000, 'completed');
      // Clean failed jobs older than 7 days
      await this.cleanupQueue.clean(7 * 24 * 3600 * 1000, 1000, 'failed');

      const duration = Date.now() - startTime;
      this.logger.log(
        { ...metadata, duration, ...result },
        'Unpaid booking cleanup completed',
      );
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        { ...metadata, duration, err: error },
        'Unpaid booking pruning failed',
      );
      throw error;
    }
  }
}
