import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from '../services/ledger.service';
import { FinancialTxStatus, LedgerAccountType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ExternalServiceException } from '../../../../infra/circuit-breaker/exceptions/external-service.exception';

@Processor('payout-queue')
@Injectable()
export class PayoutWorker extends WorkerHost {
  private readonly logger = new Logger(PayoutWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
    private readonly ledgerService: LedgerService,
  ) {
    super();
  }

  async process(job: Job<{ transactionId: string }>): Promise<any> {
    const { transactionId } = job.data;
    const startTime = Date.now();

    const metadata = {
      queueName: job.queueName,
      workerName: this.constructor.name,
      jobId: job.id,
      transactionId,
      attempts: job.attemptsMade,
    };

    this.logger.log({ ...metadata }, 'Starting withdrawal payout processing');

    try {
      // 1. Transactional State Guard & Lock
      const result = await this.prisma.$transaction(async (tx) => {
        const financialTxs = await tx.$queryRaw<any[]>`
          SELECT * FROM "FinancialTransaction" WHERE "id" = ${transactionId} FOR UPDATE
        `;

        if (!financialTxs || financialTxs.length === 0) {
          throw new Error(
            `Financial transaction not found for ID: ${transactionId}`,
          );
        }

        const financialTx = financialTxs[0];

        // Idempotency: skip if already completed, failed, or currently processing
        if (
          financialTx.status === FinancialTxStatus.COMPLETED ||
          financialTx.status === FinancialTxStatus.FAILED
        ) {
          this.logger.log(
            { ...metadata },
            `Transaction is already in a final state (${financialTx.status}). Skipping.`,
          );
          return { status: financialTx.status, skipped: true };
        }

        // If it's already in PROCESSING and has a transfer code, it means we already triggered Paystack.
        // DO NOT trigger again to avoid duplicate transfers!
        if (
          financialTx.status === FinancialTxStatus.PROCESSING &&
          financialTx.providerTransferCode
        ) {
          this.logger.log(
            { ...metadata },
            `Transaction is already marked PROCESSING with provider code. Waiting for webhook.`,
          );
          return { status: financialTx.status, skipped: true };
        }

        const fromStatus = financialTx.status;

        // Transition status to PROCESSING
        await tx.financialTransaction.update({
          where: { id: transactionId },
          data: { status: FinancialTxStatus.PROCESSING },
        });

        // Log state transition
        await tx.financialTxStatusLog.create({
          data: {
            txId: transactionId,
            fromStatus,
            toStatus: FinancialTxStatus.PROCESSING,
            reason: 'Background worker lock. Transfer processing initiated.',
          },
        });

        // Load payout account
        const account = await tx.workerPayoutAccount.findUnique({
          where: { id: financialTx.payoutAccountId },
        });

        if (!account || !account.isVerified) {
          throw new Error(
            'Payout destination account is missing or unverified.',
          );
        }

        return {
          financialTx,
          account,
        };
      });

      // If execution was skipped, return early
      if ('skipped' in result) {
        return result;
      }

      const { financialTx, account } = result;

      // 2. Execute Transfer via Paystack API outside the locks to avoid long-held DB transactions
      let paystackResult: { transferCode: string; status: string };
      try {
        paystackResult = await this.paystackProvider.initiateTransfer(
          new Decimal(financialTx.amount),
          account.providerRecipientCode,
          financialTx.reference,
          `Withdrawal payout for Tx ID: ${financialTx.id}`,
        );
      } catch (paystackError: any) {
        // Log immediate API failure
        this.logger.error(
          { ...metadata, err: paystackError },
          'Paystack Transfer API call failed',
        );

        // Prevent double-payout / infinite withdrawal glitch:
        // NEVER mark transaction FAILED or refund balance on network timeouts / transient errors!
        // Only mark FAILED if Paystack explicitly returned a non-retryable 4xx client rejection.
        const isDefinitiveFailure =
          paystackError instanceof ExternalServiceException &&
          !paystackError.retryable &&
          (paystackError.getStatus() === 400 || paystackError.getStatus() === 422);

        if (isDefinitiveFailure) {
          await this.handleImmediateFailure(
            transactionId,
            paystackError.message || 'API rejected transfer',
          );
        } else {
          this.logger.warn(
            { ...metadata, err: paystackError },
            'Transfer attempt failed with transient/unknown error. Transaction left in PROCESSING to prevent double-payout. BullMQ will retry.',
          );
        }

        throw paystackError;
      }

      // 3. Process Paystack response status
      await this.prisma.$transaction(async (tx) => {
        // Refetch to prevent race transitions
        const currentTx = await tx.financialTransaction.findUnique({
          where: { id: transactionId },
        });

        if (!currentTx || currentTx.status !== FinancialTxStatus.PROCESSING) {
          return;
        }

        const amountDecimal = new Decimal(currentTx.amount);

        if (paystackResult.status === 'failed') {
          // Failure response: Transition to FAILED and release balance holds
          await tx.financialTransaction.update({
            where: { id: transactionId },
            data: {
              status: FinancialTxStatus.FAILED,
              failureReason: 'Transfer rejected immediately by provider.',
              providerTransferCode: paystackResult.transferCode,
            },
          });

          await tx.financialTxStatusLog.create({
            data: {
              txId: transactionId,
              fromStatus: FinancialTxStatus.PROCESSING,
              toStatus: FinancialTxStatus.FAILED,
              reason: 'Paystack rejected transfer immediately.',
            },
          });

          // Restore balance
          await tx.userBalance.update({
            where: { userId: currentTx.userId },
            data: {
              availableBalance: { increment: amountDecimal },
              reservedBalance: { decrement: amountDecimal },
            },
          });

          this.logger.warn(
            { ...metadata },
            'Transfer failed immediately. Balance restored.',
          );
        } else if (paystackResult.status === 'success') {
          // Sandbox success response: Transition to COMPLETED and commit ledger
          await tx.financialTransaction.update({
            where: { id: transactionId },
            data: {
              status: FinancialTxStatus.COMPLETED,
              providerTransferCode: paystackResult.transferCode,
            },
          });

          await tx.financialTxStatusLog.create({
            data: {
              txId: transactionId,
              fromStatus: FinancialTxStatus.PROCESSING,
              toStatus: FinancialTxStatus.COMPLETED,
              reason: 'Paystack transfer completed immediately.',
            },
          });

          const user = await tx.user.findUnique({
            where: { id: currentTx.userId },
            include: { vetProfile: true, vendorProfile: true },
          });

          const accountType = user?.vetProfile
            ? LedgerAccountType.VET_BALANCE
            : user?.vendorProfile
              ? LedgerAccountType.VENDOR_BALANCE
              : LedgerAccountType.CUSTOMER_WALLET;

          // Write ledger debit entries
          await this.ledgerService.recordWithdrawalLedgerEntries(
            tx,
            transactionId,
            amountDecimal,
            currentTx.userId,
            accountType,
          );

          this.logger.log(
            { ...metadata },
            'Transfer completed immediately (success response). Ledger updated.',
          );
        } else {
          // Queued or pending: Store references, remain in PROCESSING, wait for webhook
          await tx.financialTransaction.update({
            where: { id: transactionId },
            data: {
              providerTransferCode: paystackResult.transferCode,
            },
          });

          this.logger.log(
            { ...metadata, transferCode: paystackResult.transferCode },
            'Transfer queued/pending with Paystack. Waiting for webhook callback.',
          );
        }
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        { ...metadata, duration },
        'Withdrawal payout job execution complete',
      );
      return { success: true };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(
        { ...metadata, duration, err: error },
        'Withdrawal payout job processing failed',
      );
      throw error;
    }
  }

  private async handleImmediateFailure(
    transactionId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const financialTx = await tx.financialTransaction.findUnique({
          where: { id: transactionId },
        });

        if (
          !financialTx ||
          financialTx.status !== FinancialTxStatus.PROCESSING
        ) {
          return;
        }

        const amountDecimal = new Decimal(financialTx.amount);

        // Fail transaction
        await tx.financialTransaction.update({
          where: { id: transactionId },
          data: {
            status: FinancialTxStatus.FAILED,
            failureReason: `Paystack API failure: ${reason}`,
          },
        });

        await tx.financialTxStatusLog.create({
          data: {
            txId: transactionId,
            fromStatus: FinancialTxStatus.PROCESSING,
            toStatus: FinancialTxStatus.FAILED,
            reason: `Paystack API initiation failed: ${reason}`,
          },
        });

        // Restore balance holds
        await tx.userBalance.update({
          where: { userId: financialTx.userId },
          data: {
            availableBalance: { increment: amountDecimal },
            reservedBalance: { decrement: amountDecimal },
          },
        });
      });
    } catch (err: any) {
      this.logger.error(
        { transactionId, err },
        'Failed to rollback/fail withdrawal record after API call failure',
      );
    }
  }
}
