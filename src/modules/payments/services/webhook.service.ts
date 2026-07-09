import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from './ledger.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PaymentProvider,
  PaymentProvider as PrismaPaymentProvider,
  FinancialTxStatus,
  LedgerAccountType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    private readonly ledgerService: LedgerService,
    @InjectQueue('payment-verification-queue')
    private readonly verifyQueue: Queue,
  ) {}

  /**
   * Validates Paystack webhook signature, deduplicates the event, and processes transaction or payout events.
   */
  async processPaystackWebhook(
    signature: string,
    rawBody: string,
    payload: any,
  ): Promise<void> {
    // 1. Signature Verification
    const isValid = this.paystackProvider.verifyWebhookSignature(
      signature,
      rawBody,
    );
    if (!isValid) {
      this.logger.warn('Received webhook with invalid Paystack signature');
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    const event = payload.event;
    const correlationId =
      payload.data?.metadata?.correlationId || 'UNKNOWN-CORRELATION-ID';

    // Handle unhandled event types gracefully by returning 200 OK (no-op)
    const allowedEvents = [
      'charge.success',
      'transfer.success',
      'transfer.failed',
    ];
    if (!allowedEvents.includes(event)) {
      this.logger.log(
        `[Correlation ID: ${correlationId}] Webhook event type "${event}" ignored. Returning 200 OK.`,
      );
      return;
    }

    const eventId = payload.data?.id?.toString() || payload.data?.transfer_code;
    const reference = payload.data?.reference;

    this.logger.log(
      `[Correlation ID: ${correlationId}] Ingested webhook event from Paystack. Event: ${event}, Event ID: ${eventId}, Reference: ${reference}`,
    );

    if (!eventId || !reference) {
      this.logger.warn(
        `[Correlation ID: ${correlationId}] Webhook payload missing event ID or reference`,
      );
      throw new BadRequestException(
        'Invalid webhook structure or missing reference',
      );
    }

    // 2. Webhook Event Deduplication Log
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
      if (error.code === 'P2002') {
        this.logger.log(
          `[Correlation ID: ${correlationId}] Webhook event ID ${eventId} was already received. Ignoring duplicate.`,
        );
        return;
      }
      throw error;
    }

    // 3. Process Event based on type
    if (event === 'charge.success') {
      this.logger.log(
        `[Correlation ID: ${correlationId}] Enqueuing background verification job for reference: ${reference}`,
      );
      await this.verifyQueue.add(
        'verify-payment',
        {
          reference,
          eventId,
          correlationId,
        },
        {
          // BullMQ forbids colons in custom job IDs — sanitize the reference
          jobId: reference.replace(/:/g, '-'),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      );
    } else if (event === 'transfer.success' || event === 'transfer.failed') {
      await this.processTransferWebhook(event, reference, payload);
    }
  }

  private async processTransferWebhook(
    event: string,
    reference: string,
    payload: any,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Lock financial transaction row
      const financialTxs = await tx.$queryRaw<any[]>`
        SELECT * FROM "FinancialTransaction" WHERE "reference" = ${reference} FOR UPDATE
      `;

      if (!financialTxs || financialTxs.length === 0) {
        this.logger.warn(
          `Financial transaction not found for transfer reference: ${reference}`,
        );
        return;
      }

      const financialTx = financialTxs[0];

      // 2. Idempotency Check: Exit if already in a final state
      if (
        financialTx.status === FinancialTxStatus.COMPLETED ||
        financialTx.status === FinancialTxStatus.FAILED
      ) {
        this.logger.log(
          `Financial transaction ${reference} is already in final state: ${financialTx.status}. No-op.`,
        );
        return;
      }

      const amountDecimal = new Decimal(financialTx.amount);

      if (event === 'transfer.success') {
        // Transition to COMPLETED
        await tx.financialTransaction.update({
          where: { id: financialTx.id },
          data: {
            status: FinancialTxStatus.COMPLETED,
            providerRef: payload.data.reference,
            providerTransferCode: payload.data.transfer_code,
          },
        });

        // Log status change
        await tx.financialTxStatusLog.create({
          data: {
            txId: financialTx.id,
            fromStatus: financialTx.status,
            toStatus: FinancialTxStatus.COMPLETED,
            reason: 'Paystack transfer completed successfully (webhook).',
          },
        });

        // Determine user ledger account type
        const user = await tx.user.findUnique({
          where: { id: financialTx.userId },
          include: { vetProfile: true, vendorProfile: true },
        });

        const accountType = user?.vetProfile
          ? LedgerAccountType.VET_BALANCE
          : user?.vendorProfile
            ? LedgerAccountType.VENDOR_BALANCE
            : LedgerAccountType.CUSTOMER_WALLET;

        // Record matching debit in Ledger entries
        await this.ledgerService.recordWithdrawalLedgerEntries(
          tx,
          financialTx.id,
          amountDecimal,
          financialTx.userId,
          accountType,
        );

        this.logger.log(
          `Withdrawal completed successfully for user ${financialTx.userId}. Reference: ${reference}`,
        );
      } else if (event === 'transfer.failed') {
        const failureReason =
          payload.data.failures?.[0]?.message || 'Paystack transfer failed.';

        // Transition to FAILED
        await tx.financialTransaction.update({
          where: { id: financialTx.id },
          data: {
            status: FinancialTxStatus.FAILED,
            failureReason,
            providerRef: payload.data.reference,
            providerTransferCode: payload.data.transfer_code,
          },
        });

        // Log status change
        await tx.financialTxStatusLog.create({
          data: {
            txId: financialTx.id,
            fromStatus: financialTx.status,
            toStatus: FinancialTxStatus.FAILED,
            reason: `Paystack transfer failed: ${failureReason}`,
          },
        });

        // Restore reserved funds to available balance
        await tx.userBalance.update({
          where: { userId: financialTx.userId },
          data: {
            availableBalance: { increment: amountDecimal },
            reservedBalance: { decrement: amountDecimal },
          },
        });

        this.logger.warn(
          `Withdrawal failed and balance restored for user ${financialTx.userId}. Reason: ${failureReason}`,
        );
      }
    });
  }
}
