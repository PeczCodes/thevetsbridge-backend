import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PaymentService } from '../services/payment.service';

@Processor('payment-verification-queue')
@Injectable()
export class PaymentVerificationWorker extends WorkerHost {
  private readonly logger = new Logger(PaymentVerificationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService
  ) {
    super();
  }

  async process(job: Job<{ reference: string; eventId: string; correlationId: string }>): Promise<any> {
    const { reference, eventId, correlationId = 'UNKNOWN-CORRELATION-ID' } = job.data;
    this.logger.log(`[Correlation ID: ${correlationId}] [Payment Worker] Starting verification for Reference: ${reference}`);

    try {
      const result = await this.paymentService.verifyAndFulfillPayment(reference, eventId, correlationId);
      this.logger.log(`[Correlation ID: ${correlationId}] [Payment Worker] Payment processed successfully for reference: ${reference}`);
      return result;
    } catch (error: any) {
      this.logger.error(`[Correlation ID: ${correlationId}] [Payment Worker] Failed processing reference ${reference}: ${error.message}`);
      
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
          this.logger.error(`[Correlation ID: ${correlationId}] [Payment Worker] Failed to update WebhookEventLog with failure details: ${dbErr.message}`);
        }
      }

      throw error; // Re-throw to trigger BullMQ retries
    }
  }
}
