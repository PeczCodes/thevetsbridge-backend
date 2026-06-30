import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from './ledger.service';
import { Prisma, PaymentPurpose, PaymentStatus, PaymentProvider } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    private readonly ledgerService: LedgerService
  ) {}

  /**
   * Initiates a payment transaction, verifies no duplicate payments, generates references,
   * registers the transaction record in PostgreSQL, and requests a Paystack authorization checkout URL.
   */
  async initiatePayment(
    userId: string,
    email: string,
    purpose: PaymentPurpose,
    targetId: string,
    callbackUrl: string
  ) {
    const correlationId = crypto.randomUUID();
    this.logger.log(`[Correlation ID: ${correlationId}] Initiating payment process for User: ${userId}, Target: ${targetId}, Purpose: ${purpose}`);

    let parsedAmount: Decimal;

    if (purpose === PaymentPurpose.ORDER) {
      const order = await this.prisma.order.findUnique({
        where: { id: targetId },
      });
      if (!order) {
        throw new NotFoundException(`Order ${targetId} not found`);
      }
      parsedAmount = new Decimal(order.totalAmount);
    } else if (purpose === PaymentPurpose.APPOINTMENT) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: targetId },
        include: {
          vet: true,
        },
      });
      if (!appointment) {
        throw new NotFoundException(`Appointment ${targetId} not found`);
      }
      if (!appointment.vet.consultationFee) {
        throw new BadRequestException(`Consultation fee is not set for veterinarian on appointment ${targetId}`);
      }
      parsedAmount = new Decimal(appointment.vet.consultationFee);
    } else {
      throw new BadRequestException('Invalid payment purpose');
    }

    if (parsedAmount.lte(0)) {
      this.logger.warn(`[Correlation ID: ${correlationId}] Failed to initiate payment: Invalid calculated amount ${parsedAmount.toString()}`);
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    // 1. Double Payment Prevention Check
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { orderId: purpose === PaymentPurpose.ORDER ? targetId : undefined },
          { appointmentId: purpose === PaymentPurpose.APPOINTMENT ? targetId : undefined },
        ].filter(Boolean) as any,
      },
    });

    if (existingPayment) {
      if (
        existingPayment.status === PaymentStatus.SUCCEEDED ||
        existingPayment.status === PaymentStatus.PAID_IN_ESCROW ||
        existingPayment.status === PaymentStatus.RELEASED
      ) {
        this.logger.warn(`[Correlation ID: ${correlationId}] Failed to initiate: Target ${targetId} already paid`);
        throw new BadRequestException('This order or appointment has already been paid for');
      }

      // 1. Verify with Paystack to see if the user actually paid it recently
      this.logger.log(`[Correlation ID: ${correlationId}] Verifying existing payment reference with Paystack...`);
      const verifyResult = await this.paystackProvider.verifyTransaction(existingPayment.reference);
      
      if (verifyResult.status === 'success') {
        this.logger.log(`[Correlation ID: ${correlationId}] Payment was already successful on Paystack! Fulfilling now.`);
        await this.verifyAndFulfillPayment(existingPayment.reference, undefined, correlationId);
        throw new BadRequestException('This order or appointment has already been paid for');
      }

      // 2. Paystack does not allow initializing an existing reference. We must generate a NEW reference
      // but we update the existing Payment record to prevent duplicating DB records.
      const newRandomBytes = crypto.randomBytes(6).toString('hex').toUpperCase();
      const newReference = `VETS-${purpose.substring(0, 3)}-${Date.now()}-${newRandomBytes}`;

      this.logger.log(`[Correlation ID: ${correlationId}] Re-initializing checkout with NEW reference ${newReference} for existing Payment ID: ${existingPayment.id}`);
      
      await this.prisma.payment.update({
        where: { id: existingPayment.id },
        data: { reference: newReference },
      });

      const paystackResult = await this.paystackProvider.initializeTransaction(
        email,
        parsedAmount,
        newReference,
        callbackUrl,
        { userId, purpose, targetId, correlationId }
      );

      return {
        paymentId: existingPayment.id,
        reference: newReference,
        authorizationUrl: paystackResult.authorizationUrl,
      };
    }

    // 2. Generate Unique Payment Reference
    const randomBytes = crypto.randomBytes(6).toString('hex').toUpperCase();
    const reference = `VETS-${purpose.substring(0, 3)}-${Date.now()}-${randomBytes}`;

    // 3. Create initial PENDING payment record in database
    this.logger.log(`[Correlation ID: ${correlationId}] Creating new Payment record with Reference: ${reference}`);
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        purpose,
        amount: parsedAmount,
        currency: 'NGN',
        provider: PaymentProvider.PAYSTACK,
        status: PaymentStatus.PENDING,
        reference,
        orderId: purpose === PaymentPurpose.ORDER ? targetId : null,
        appointmentId: purpose === PaymentPurpose.APPOINTMENT ? targetId : null,
      },
    });

    // 4. Request Checkout link from Paystack API
    try {
      this.logger.log(`[Correlation ID: ${correlationId}] Initializing transaction with Paystack API`);
      const paystackResult = await this.paystackProvider.initializeTransaction(
        email,
        parsedAmount,
        reference,
        callbackUrl,
        { userId, purpose, targetId, correlationId }
      );

      this.logger.log(`[Correlation ID: ${correlationId}] Paystack authorization generated successfully for Reference: ${reference}`);
      return {
        paymentId: payment.id,
        reference: payment.reference,
        authorizationUrl: paystackResult.authorizationUrl,
      };
    } catch (error: any) {
      this.logger.error(`[Correlation ID: ${correlationId}] Paystack transaction initialization failed: ${error.message}`);
      // Revert payment creation in DB if provider request fails
      await this.prisma.payment.delete({
        where: { id: payment.id },
      });
      throw error;
    }
  }

  /**
   * Performs active verification against Paystack API, and if paid, fulfills the payment transactionally in DB.
   */
  async verifyAndFulfillPayment(reference: string, eventId?: string, correlationId = 'UNKNOWN-CORRELATION-ID'): Promise<any> {
    this.logger.log(`[Correlation ID: ${correlationId}] Starting verification for Reference: ${reference}`);

    // 1. Query current state of transaction directly from Paystack API
    const verifyResult = await this.paystackProvider.verifyTransaction(reference);
    if (verifyResult.status !== 'success') {
      throw new Error(`Transaction ${reference} status is: ${verifyResult.status}. Verification not complete.`);
    }

    // 2. Perform transactional update inside PostgreSQL with a SELECT FOR UPDATE row lock
    await this.prisma.$transaction(
      async (tx) => {
        // Query the payment record with a raw SQL query to apply FOR UPDATE lock
        const payments = await tx.$queryRaw<any[]>(
          Prisma.sql`SELECT * FROM "Payment" WHERE "reference" = ${reference} FOR UPDATE`
        );

        if (!payments || payments.length === 0) {
          throw new Error(`Payment record not found for reference: ${reference}`);
        }

        const payment = payments[0];

        // Idempotency check: If already processed, make it a clean no-op
        if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.PAID_IN_ESCROW) {
          this.logger.log(`[Correlation ID: ${correlationId}] Payment ${reference} is already completed. No-op.`);
          return;
        }

        const newStatus = payment.purpose === 'ORDER' ? PaymentStatus.PAID_IN_ESCROW : PaymentStatus.SUCCEEDED;

        // Update Payment status and record paidAt time
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: newStatus,
            paidAt: new Date(),
            providerResponse: verifyResult.rawResponse as any,
          },
        });

        // Write to state audit logs
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventType: 'payment.completed',
            fromStatus: payment.status as PaymentStatus,
            toStatus: newStatus,
            metadata: verifyResult.rawResponse as any,
          },
        });

        // Calculate platform commission fee dynamically from settings (default 5%)
        const commissionSetting = await tx.systemSetting.findUnique({
          where: { key: 'commission_rate' },
        });
        const commissionPercent = parseFloat(commissionSetting?.value || '5');
        const platformFee = verifyResult.amountPaid.mul(commissionPercent / 100);

        let targetUserId = payment.userId;
        let appointmentForEarning: any = null;
        if (payment.purpose === 'APPOINTMENT' && payment.appointmentId) {
          appointmentForEarning = await tx.appointment.findUnique({
            where: { id: payment.appointmentId },
            include: { vet: true },
          });
          if (appointmentForEarning && appointmentForEarning.vet) {
            targetUserId = appointmentForEarning.vet.userId;
          }
        }

        // Record matched ledger entries inside the double-entry bookkeeping ledger
        await this.ledgerService.recordPaymentLedgerEntries(
          tx,
          payment.id,
          verifyResult.amountPaid,
          targetUserId,
          payment.purpose,
          platformFee
        );

        // Update corresponding business module entities
        if (payment.purpose === 'ORDER' && payment.orderId) {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: 'PAID' },
          });
        } else if (payment.purpose === 'APPOINTMENT' && payment.appointmentId) {
          await tx.appointment.update({
            where: { id: payment.appointmentId },
            data: { status: 'CONFIRMED' },
          });

          // Create the corresponding VetEarning record!
          if (appointmentForEarning && appointmentForEarning.vet) {
            await tx.vetEarning.create({
              data: {
                vetId: appointmentForEarning.vetId,
                appointmentId: appointmentForEarning.id,
                grossAmount: verifyResult.amountPaid,
                platformFee: platformFee,
                netAmount: verifyResult.amountPaid.minus(platformFee),
                status: 'PENDING',
              },
            });
          }
        }

        // Mark webhook log as processed if triggered by webhook
        if (eventId) {
          await tx.webhookEventLog.update({
            where: { eventId },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            },
          });
        }

        // Write to transactional OutboxEvent table
        this.logger.log(`[Correlation ID: ${correlationId}] Writing PAYMENT_COMPLETED event to Outbox table`);
        await tx.outboxEvent.create({
          data: {
            type: 'PAYMENT_COMPLETED',
            payload: {
              reference,
              paymentId: payment.id,
              amount: verifyResult.amountPaid.toString(),
              userId: payment.userId,
              purpose: payment.purpose,
              orderId: payment.orderId,
              appointmentId: payment.appointmentId,
              correlationId,
            },
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      }
    );

    this.logger.log(`[Correlation ID: ${correlationId}] Payment verification & fulfillment completed successfully for Reference: ${reference}`);
    return { success: true, reference };
  }

  /**
   * Retrieves payment status.
   * Uses Active Verification fallback: if the status is PENDING in the DB, it queries the Paystack API.
   * If Paystack shows success, it fulfills the transaction directly inside the request thread.
   */
  async getPaymentStatus(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
    });

    if (!payment) {
      throw new NotFoundException(`Payment transaction not found for reference: ${reference}`);
    }

    if (payment.status === PaymentStatus.PENDING) {
      try {
        this.logger.log(`[Active Verification] Checking status directly with Paystack for Reference: ${reference}`);
        const verifyResult = await this.paystackProvider.verifyTransaction(reference);
        if (verifyResult.status === 'success') {
          this.logger.log(`[Active Verification] Payment verified successfully via Paystack API for Reference: ${reference}. Starting fulfillment.`);
          await this.verifyAndFulfillPayment(reference, undefined, 'ACTIVE-POLLING');
          
          // Re-fetch the updated payment details
          const updatedPayment = await this.prisma.payment.findUnique({
            where: { reference },
            select: {
              status: true,
              reference: true,
              amount: true,
              currency: true,
              paidAt: true,
            },
          });
          if (updatedPayment) {
            return updatedPayment;
          }
        }
      } catch (error: any) {
        this.logger.error(`[Active Verification] Active verification failed for Reference: ${reference}: ${error.message}`);
      }
    }

    return {
      status: payment.status,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt,
    };
  }
}
