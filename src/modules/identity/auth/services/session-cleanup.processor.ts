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
    @InjectQueue('session-cleanup') private readonly cleanupQueue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    try {
      const cronPattern = '0 * * * *'; // Run hourly

      // Use native BullMQ v5 upsertJobScheduler for repeatability
      await this.cleanupQueue.upsertJobScheduler(
        'hourly-session-cleanup-scheduler', // stable scheduler ID
        {
          pattern: cronPattern,
        },
        {
          name: 'prune-sessions',
          data: {},
        },
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to schedule hourly session and token cleanup job: ${error.message}`,
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

    this.logger.log(
      { ...metadata },
      'Starting hourly session and token cleanup',
    );

    try {
      const deleteSessionsResult = await this.prisma.session.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { isRevoked: true }],
        },
      });

      // Prune expired or used password reset tokens older than 7 days
      const usedRetentionDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const deleteTokensResult =
        await this.prisma.passwordResetToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              { usedAt: { lt: usedRetentionDate } },
            ],
          },
        });

      // Native queue cleanup for session-cleanup queue
      // Clean completed jobs older than 24 hours
      await this.cleanupQueue.clean(24 * 3600 * 1000, 1000, 'completed');
      // Clean failed jobs older than 7 days
      await this.cleanupQueue.clean(7 * 24 * 3600 * 1000, 1000, 'failed');

      const duration = Date.now() - startTime;
      this.logger.log(
        {
          ...metadata,
          duration,
          prunedSessionsCount: deleteSessionsResult.count,
          prunedTokensCount: deleteTokensResult.count,
        },
        'Hourly session and token cleanup completed',
      );
      return {
        prunedSessionsCount: deleteSessionsResult.count,
        prunedTokensCount: deleteTokensResult.count,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        { ...metadata, duration, err: error },
        'Pruning expired sessions and tokens failed',
      );
      throw error;
    }
  }
}
