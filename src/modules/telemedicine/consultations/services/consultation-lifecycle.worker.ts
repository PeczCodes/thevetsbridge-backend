import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConsultationsService } from '../consultations.service';

@Processor('consultation-lifecycle')
@Injectable()
export class ConsultationLifecycleWorker extends WorkerHost {
  private readonly logger = new Logger(ConsultationLifecycleWorker.name);

  constructor(private readonly consultationsService: ConsultationsService) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { consultationId, type, userId, timing } = job.data;
    const logMetadata = { jobId: job.id, consultationId, type };

    this.logger.log(
      `[Lifecycle Worker] Starting job process for type "${type}" on consultation "${consultationId}"`,
    );

    try {
      switch (type) {
        case 'reminder':
          await this.consultationsService.sendReminderNotification(
            consultationId,
            timing,
          );
          this.logger.log(
            `[Lifecycle Worker] Reminder "${timing}" dispatched successfully`,
          );
          return { success: true, timing };

        case 'no-show':
          const noShowResult =
            await this.consultationsService.handleNoShow(consultationId);
          this.logger.log(
            `[Lifecycle Worker] No-show processed: ${JSON.stringify(noShowResult)}`,
          );
          return noShowResult;

        case 'reconnect-timeout':
          const reconnectResult =
            await this.consultationsService.handleReconnectTimeout(
              consultationId,
              userId,
            );
          this.logger.log(
            `[Lifecycle Worker] Reconnection timeout processed: ${JSON.stringify(reconnectResult)}`,
          );
          return reconnectResult;

        case 'escrow-release':
          const releaseResult =
            await this.consultationsService.processEscrowReleaseTimeout(
              consultationId,
            );
          this.logger.log(
            `[Lifecycle Worker] Escrow release timeout processed: ${JSON.stringify(releaseResult)}`,
          );
          return releaseResult;

        default:
          this.logger.warn(`[Lifecycle Worker] Unhandled job type: ${type}`);
          return { error: 'Unknown job type' };
      }
    } catch (err: any) {
      this.logger.error(
        `[Lifecycle Worker] Job processing failed: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
