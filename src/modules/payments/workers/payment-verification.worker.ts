import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaymentService } from '../services/payment.service';

@Processor('payment-verification-queue')
@Injectable()
export class PaymentVerificationWorker extends WorkerHost {
  private readonly logger = new Logger(PaymentVerificationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {
    super();
  }

  async process(job: Job<{ reference: string; eventId: string; correlationId: string }>): Promise<any> {
    const { reference, eventId, correlationId = 'UNKNOWN-CORRELATION-ID'} = job.data;
    const startTime = Date.now();
    const metadata = {
      queueName: job.queueName,
      workerName: this.constructor.name,
      jobId: job.id,
      retryCount: job.attemptsMade,
      correlationId,
      reference,
      eventId,
    };

    this.logger.log(
      { ...metadata },
      `Starting payment verification for Reference: ${reference}`,
    );

    try {
      const result = await this.paymentService.verifyAndFulfillPayment(
        reference,
        eventId,
        correlationId,
      );
      const duration = Date.now() - startTime;
      this.logger.log(
        { ...metadata, duration },
        `Payment processed successfully for reference: ${reference}`,
      );
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        { ...metadata, duration, err: error },
        `Failed processing reference ${reference}`,
      );

      if (eventId) {
        try {
          await this.prisma.webhookEventLog.update({
            where: { eventId },
            data: {
              status: 'FAILED',
              errorMessage: error.message,
            },
          });
        } catch (dbErr: any) {
          this.logger.error(
            { ...metadata, duration, err: dbErr },
            `Failed to update WebhookEventLog with failure details`,
          );
        }
      }

      throw error; 
    }
  }
}
