import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';

@Processor('session-cleanup')
@Injectable()
export class SessionCleanupProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('session-cleanup') private readonly cleanupQueue: Queue
  ) {
    super();
  }

  async onApplicationBootstrap() {
    this.logger.log('Scheduling daily database session cleanup job...');
    try {
      const cronPattern = '0 0 * * *';
      const repeatableJobs = await this.cleanupQueue.getRepeatableJobs();
      
      const isAlreadyScheduled = repeatableJobs.some(
        (job) => job.name === 'prune-sessions' && job.pattern === cronPattern
      );

      if (isAlreadyScheduled) {
        this.logger.log('Daily database session cleanup job is already scheduled with correct cron pattern. Skipping setup.');
        return;
      }

      // Configuration has changed or is not present, clean up existing repeatable configurations in Redis
      for (const job of repeatableJobs) {
        await this.cleanupQueue.removeRepeatableByKey(job.key);
      }

      // Add a repeatable job running every 24 hours (every day at midnight)
      await this.cleanupQueue.add(
        'prune-sessions',
        {},
        {
          repeat: {
            pattern: cronPattern, // Run once every day at midnight (24h)
          },
          jobId: 'daily-session-cleanup',
        },
      );
      this.logger.log('Daily database session cleanup job scheduled successfully (Cron: "0 0 * * *").');
    } catch (error: any) {
      this.logger.error(`Failed to schedule daily session cleanup job: ${error.message}`);
    }
  }

  /**
   * BullMQ worker process handler. This runs inside the queue context.
   * In a clustered/multi-instance deployment, only one instance will pick up and execute this daily block.
   */
  async process(job: Job): Promise<any> {
    this.logger.log(`[Queue Worker] Starting database session cleanup | Job ID: ${job.id}`);
    try {
      const deleteResult = await this.prisma.session.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      this.logger.log(`[Queue Worker] Pruning completed. Removed ${deleteResult.count} expired session records.`);
      return { prunedCount: deleteResult.count };
    } catch (error: any) {
      this.logger.error(`[Queue Worker] Pruning expired sessions failed: ${error.message}`);
      throw error;
    }
  }
}
