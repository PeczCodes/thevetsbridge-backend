import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PaymentProvider } from '@prisma/client';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    @InjectQueue('payment-verification-queue') private readonly verifyQueue: Queue
  ) {}

  /**
   * Validates Paystack webhook signature, deduplicates the event, and enqueues verification.
   */
  async processPaystackWebhook(signature: string, rawBody: string, payload: any): Promise<void> {
    // 1. Signature Verification
    const isValid = this.paystackProvider.verifyWebhookSignature(signature, rawBody);
    if (!isValid) {
      this.logger.warn('Received webhook with invalid Paystack signature');
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    const correlationId = payload.data?.metadata?.correlationId || 'UNKNOWN-CORRELATION-ID';

    // Handle unhandled event types gracefully by returning 200 OK (no-op)
    if (payload.event !== 'charge.success') {
      this.logger.log(
        `[Correlation ID: ${correlationId}] Webhook event type "${payload.event}" ignored. Returning 200 OK.`
      );
      return;
    }

    const eventId = payload.data?.id?.toString();
    const reference = payload.data?.reference;

    this.logger.log(`[Correlation ID: ${correlationId}] Ingested webhook event from Paystack. Event ID: ${eventId}, Reference: ${reference}`);

    if (!eventId || !reference) {
      this.logger.warn(`[Correlation ID: ${correlationId}] Webhook payload missing event ID or reference`);
      throw new BadRequestException('Invalid webhook structure or missing reference');
    }

    // 2. Webhook Event Deduplication Log (PostgreSQL unique index constraint)
    try {
      await this.prisma.webhookEventLog.create({
        data: {
          provider: PaymentProvider.PAYSTACK,
          eventId: eventId,
          status: 'RECEIVED',
          payload: payload,
        },
      });
    } catch (error: any) {
      // P2002 is Prisma unique constraint violation code
      if (error.code === 'P2002') {
        this.logger.log(`[Correlation ID: ${correlationId}] Webhook event ID ${eventId} was already received. Ignoring duplicate.`);
        return;
      }
      throw error;
    }

    // 3. Push to BullMQ for robust, retriable processing
    this.logger.log(`[Correlation ID: ${correlationId}] Enqueuing background verification job for reference: ${reference}`);
    await this.verifyQueue.add(
      'verify-payment',
      {
        reference,
        eventId,
        correlationId,
      },
      {
        jobId: reference, // Enforce queue deduplication on payment reference
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000, // Retries: 1s, 2s, 4s, 8s, 16s
        },
      }
    );
  }
}
