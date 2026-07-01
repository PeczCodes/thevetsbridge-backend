import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';

@Processor('unpaid-booking-cleanup')
@Injectable()
export class UnpaidBookingCleanupProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnpaidBookingCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('unpaid-booking-cleanup') private readonly cleanupQueue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap() {
    this.logger.log('Scheduling unpaid telemedicine bookings cleanup job...');
    try {
      const cronPattern = '*/15 * * * *'; // Run every 15 minutes
      const repeatableJobs = await this.cleanupQueue.getRepeatableJobs();

      const isAlreadyScheduled = repeatableJobs.some(
        (job) => job.name === 'prune-unpaid-bookings' && job.pattern === cronPattern
      );

      if (isAlreadyScheduled) {
        this.logger.log('Unpaid booking cleanup job is already scheduled with correct cron pattern. Skipping setup.');
        return;
      }

      // Clean up previous configurations if any
      for (const job of repeatableJobs) {
        await this.cleanupQueue.removeRepeatableByKey(job.key);
      }

      await this.cleanupQueue.add(
        'prune-unpaid-bookings',
        {},
        {
          repeat: {
            pattern: cronPattern,
          },
          jobId: 'unpaid-booking-cleanup-job',
        }
      );
      this.logger.log('Unpaid booking cleanup job scheduled successfully (Cron: "*/15 * * * *").');
    } catch (error: any) {
      this.logger.error(`Failed to schedule unpaid booking cleanup job: ${error.message}`);
    }
  }

  /**
   * BullMQ worker process handler.
   */
  async process(job: Job): Promise<any> {
    this.logger.log(`[Queue Worker] Starting unpaid booking cleanup | Job ID: ${job.id}`);
    
    // Unpaid bookings older than 30 minutes
    const threshold = new Date(Date.now() - 30 * 60 * 1000);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Find unpaid appointments
        const unpaidAppointments = await tx.appointment.findMany({
          where: {
            status: 'PENDING_PAYMENT',
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

      this.logger.log(
        `[Queue Worker] Unpaid booking pruning completed. Cancelled ${result.cancelledCount} appointments and ${result.consultationsCancelled} consultations.`
      );
      return result;
    } catch (error: any) {
      this.logger.error(`[Queue Worker] Unpaid booking pruning failed: ${error.message}`);
      throw error;
    }
  }
}
