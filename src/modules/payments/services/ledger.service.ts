import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import {
  Prisma,
  LedgerAccountType,
  LedgerEntryType,
  PaymentStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to sum Credit entries minus Debit entries for a specific account.
   * Leverages LedgerBalanceSnapshot to avoid scanning full historical ledger tables.
   */
  async getAccountBalance(
    accountId: string,
    accountType: LedgerAccountType,
  ): Promise<Decimal> {
    const latestSnapshot = await this.prisma.ledgerBalanceSnapshot.findFirst({
      where: {
        accountId,
        accountType,
      },
      orderBy: {
        snapshotAt: 'desc',
      },
    });

    const baselineBalance = latestSnapshot
      ? new Decimal(latestSnapshot.balance)
      : new Decimal(0);
    const sinceDate = latestSnapshot?.snapshotAt;

    const aggregations = await this.prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        accountId,
        accountType,
        ...(sinceDate && { createdAt: { gt: sinceDate } }),
      },
      _sum: {
        amount: true,
      },
    });

    let credits = new Decimal(0);
    let debits = new Decimal(0);

    for (const group of aggregations) {
      const sum = group._sum.amount
        ? new Decimal(group._sum.amount)
        : new Decimal(0);
      if (group.type === LedgerEntryType.CREDIT) {
        credits = sum;
      } else if (group.type === LedgerEntryType.DEBIT) {
        debits = sum;
      }
    }

    return baselineBalance.plus(credits).minus(debits);
  }

  /**
   * Creates a point-in-time snapshot of the computed balance for an account.
   * Can be invoked by scheduled cron/workers to keep queries bounded.
   */
  async createBalanceSnapshot(
    accountId: string,
    accountType: LedgerAccountType,
    tx?: Prisma.TransactionClient,
  ): Promise<Decimal> {
    const client = tx || this.prisma;
    const balance = await this.getAccountBalance(accountId, accountType);
    await client.ledgerBalanceSnapshot.create({
      data: {
        accountId,
        accountType,
        balance,
        snapshotAt: new Date(),
      },
    });
    return balance;
  }

  /**
   * Records initial payment ledger records atomically.
   */
  async recordPaymentLedgerEntries(
    tx: Prisma.TransactionClient,
    paymentId: string,
    amount: Decimal,
    userId: string,
    purpose: string,
    platformFee: Decimal,
  ): Promise<void> {
    const ledgerRefBase = `LEDG-${paymentId}`;

    if (purpose === 'ORDER' || purpose === 'APPOINTMENT') {
      // For both orders and appointments, money moves from Paystack (External) to the Platform Escrow account.
      await tx.ledgerEntry.createMany({
        data: [
          {
            paymentId,
            accountType: LedgerAccountType.EXTERNAL_PROVIDER,
            accountId: 'PAYSTACK_GATEWAY',
            amount: amount,
            type: LedgerEntryType.DEBIT, // Debit external gateway increases platform assets
            reference: `${ledgerRefBase}-EXT-DEBIT`,
            description: `Payment for ${purpose}, reference: ${paymentId}`,
          },
          {
            paymentId,
            accountType: LedgerAccountType.ESCROW,
            accountId: 'PLATFORM_ESCROW',
            amount: amount,
            type: LedgerEntryType.CREDIT, // Credit escrow holds the liability
            reference: `${ledgerRefBase}-ESC-CREDIT`,
            description: `Escrow hold for ${purpose}, reference: ${paymentId}`,
          },
        ],
      });
    } else {
      // Direct payments path (fallback)
      const netVetAmount = amount.minus(platformFee);

      await tx.ledgerEntry.createMany({
        data: [
          {
            paymentId,
            accountType: LedgerAccountType.EXTERNAL_PROVIDER,
            accountId: 'PAYSTACK_GATEWAY',
            amount: amount,
            type: LedgerEntryType.DEBIT,
            reference: `${ledgerRefBase}-EXT-DEBIT`,
            description: `Direct payment for Appointment, reference: ${paymentId}`,
          },
          {
            paymentId,
            accountType: LedgerAccountType.VET_BALANCE,
            accountId: userId,
            amount: netVetAmount,
            type: LedgerEntryType.CREDIT,
            reference: `${ledgerRefBase}-VET-CREDIT`,
            description: `Earnings credited for Consultation, paymentId: ${paymentId}`,
          },
          {
            paymentId,
            accountType: LedgerAccountType.PLATFORM_REVENUE,
            accountId: 'PLATFORM',
            amount: platformFee,
            type: LedgerEntryType.CREDIT,
            reference: `${ledgerRefBase}-PLAT-CREDIT`,
            description: `Platform fee for Consultation, paymentId: ${paymentId}`,
          },
        ],
      });

      // Update projection
      await this.updateBalanceProjection(
        tx,
        userId,
        netVetAmount,
        LedgerEntryType.CREDIT,
      );
    }
  }

  /**
   * Releases funds from Escrow (e.g. when order or consultation is completed/delivered)
   */
  async releaseEscrow(
    tx: Prisma.TransactionClient,
    paymentId: string,
    amount: Decimal,
    targetId: string,
    platformFee: Decimal,
    targetAccountType: LedgerAccountType,
    itemIndex?: number | string,
  ): Promise<void> {
    const netAmount = amount.minus(platformFee);
    const suffix = itemIndex !== undefined ? `-${itemIndex}` : '';
    const ledgerRefBase = `ESC-REL-${paymentId}${suffix}`;

    await tx.ledgerEntry.createMany({
      data: [
        {
          paymentId,
          accountType: LedgerAccountType.ESCROW,
          accountId: 'PLATFORM_ESCROW',
          amount: amount,
          type: LedgerEntryType.DEBIT, // Debit Escrow to reduce balance/liability
          reference: `${ledgerRefBase}-ESC-DEBIT`,
          description: `Release Escrow funds for paymentId: ${paymentId}`,
        },
        {
          paymentId,
          accountType: targetAccountType,
          accountId: targetId,
          amount: netAmount,
          type: LedgerEntryType.CREDIT, // Credit Target User (Vendor or Vet)
          reference: `${ledgerRefBase}-${targetAccountType}-CREDIT`,
          description: `Earnings release for paymentId: ${paymentId}`,
        },
        {
          paymentId,
          accountType: LedgerAccountType.PLATFORM_REVENUE,
          accountId: 'PLATFORM',
          amount: platformFee,
          type: LedgerEntryType.CREDIT, // Credit Platform to record fee revenue
          reference: `${ledgerRefBase}-PLAT-CREDIT`,
          description: `Commission fee release for paymentId: ${paymentId}`,
        },
      ],
    });

    // Update user balance projection
    await this.updateBalanceProjection(
      tx,
      targetId,
      netAmount,
      LedgerEntryType.CREDIT,
    );
  }

  /**
   * Records withdrawal completion ledger entries atomically.
   */
  async recordWithdrawalLedgerEntries(
    tx: Prisma.TransactionClient,
    withdrawalId: string,
    amount: Decimal,
    userId: string,
    accountType: LedgerAccountType,
  ): Promise<void> {
    const ledgerRefBase = `WITH-${withdrawalId}`;

    await tx.ledgerEntry.createMany({
      data: [
        {
          paymentId: null,
          accountType: accountType,
          accountId: userId,
          amount: amount,
          type: LedgerEntryType.DEBIT, // Debit User account to reduce balance
          reference: `${ledgerRefBase}-USER-DEBIT`,
          description: `Withdrawal payout completed for withdrawal ID: ${withdrawalId}`,
        },
        {
          paymentId: null,
          accountType: LedgerAccountType.EXTERNAL_PROVIDER,
          accountId: 'PAYSTACK_GATEWAY',
          amount: amount,
          type: LedgerEntryType.CREDIT, // Credit gateway represents funds leaving system
          reference: `${ledgerRefBase}-EXT-CREDIT`,
          description: `Withdrawal payout transfer for withdrawal ID: ${withdrawalId}`,
        },
      ],
    });

    // Update balance projection dynamically (mark as withdrawal debit)
    await this.updateBalanceProjection(
      tx,
      userId,
      amount,
      LedgerEntryType.DEBIT,
      true,
    );
  }

  /**
   * Processes a refund via offsetting credit/debit ledger entries.
   * Guards against double refund and checks payment status to ensure escrow does not go negative.
   */
  async recordRefundLedgerEntries(
    tx: Prisma.TransactionClient,
    refundId: string,
    paymentId: string,
    amount: Decimal,
    userId: string,
    purpose: string,
  ): Promise<void> {
    const ledgerRefBase = `REFUND-${refundId}`;

    // 1. Inspect payment to check whether funds are in escrow or were already released
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            vet: true,
          },
        },
      },
    });

    if (payment) {
      if (payment.status === PaymentStatus.REFUNDED) {
        throw new ConflictException(
          `Payment ${paymentId} has already been refunded`,
        );
      }
      if (
        payment.status !== PaymentStatus.PAID_IN_ESCROW &&
        payment.status !== PaymentStatus.RELEASED
      ) {
        throw new BadRequestException(
          `Cannot refund payment ${paymentId} with status ${payment.status}`,
        );
      }
    }

    // 2. If escrow was ALREADY released, reversing from PLATFORM_ESCROW would cause
    // the escrow account to go negative. We must claw back from provider and platform fees.
    if (payment && payment.status === PaymentStatus.RELEASED) {
      const commissionSetting = await tx.systemSetting.findUnique({
        where: { key: 'commission_rate' },
      });
      const commissionPercent = parseFloat(commissionSetting?.value || '5');
      const platformFee = amount.mul(commissionPercent / 100);
      const netProviderAmount = amount.minus(platformFee);

      // Determine provider user ID and account type
      const isOrder = purpose === 'ORDER';
      const providerAccountType = isOrder
        ? LedgerAccountType.VENDOR_BALANCE
        : LedgerAccountType.VET_BALANCE;
      const providerUserId =
        payment.appointment?.vet?.userId || payment.userId;

      await tx.ledgerEntry.createMany({
        data: [
          {
            refundId,
            accountType: providerAccountType,
            accountId: providerUserId,
            amount: netProviderAmount,
            type: LedgerEntryType.DEBIT, // Debit provider to claw back earnings
            reference: `${ledgerRefBase}-${providerAccountType}-DEBIT`,
            description: `Refund reversal of released earnings, refundId: ${refundId}`,
          },
          {
            refundId,
            accountType: LedgerAccountType.PLATFORM_REVENUE,
            accountId: 'PLATFORM',
            amount: platformFee,
            type: LedgerEntryType.DEBIT, // Debit platform fee
            reference: `${ledgerRefBase}-PLAT-DEBIT`,
            description: `Refund reversal of platform commission, refundId: ${refundId}`,
          },
          {
            refundId,
            accountType: LedgerAccountType.CUSTOMER_WALLET,
            accountId: userId,
            amount: amount,
            type: LedgerEntryType.CREDIT, // Credit customer wallet
            reference: `${ledgerRefBase}-CUST-CREDIT`,
            description: `Refund credit to customer wallet, refundId: ${refundId}`,
          },
        ],
      });

      // Update projections: debit provider, credit customer
      await this.updateBalanceProjection(
        tx,
        providerUserId,
        netProviderAmount,
        LedgerEntryType.DEBIT,
      );
      await this.updateBalanceProjection(
        tx,
        userId,
        amount,
        LedgerEntryType.CREDIT,
      );

      // Mark payment as refunded
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });
      return;
    }

    // 3. Normal Escrow Path (PAID_IN_ESCROW or fallback when purpose matches)
    if (purpose === 'ORDER' || purpose === 'APPOINTMENT') {
      // Reversing escrow: Debit Platform Escrow, Credit Customer Wallet
      await tx.ledgerEntry.createMany({
        data: [
          {
            refundId,
            accountType: LedgerAccountType.ESCROW,
            accountId: 'PLATFORM_ESCROW',
            amount: amount,
            type: LedgerEntryType.DEBIT,
            reference: `${ledgerRefBase}-ESC-DEBIT`,
            description: `Escrow reversal for Refund, refundId: ${refundId}`,
          },
          {
            refundId,
            accountType: LedgerAccountType.CUSTOMER_WALLET,
            accountId: userId,
            amount: amount,
            type: LedgerEntryType.CREDIT,
            reference: `${ledgerRefBase}-CUST-CREDIT`,
            description: `Customer refund wallet credit, refundId: ${refundId}`,
          },
        ],
      });

      // Update projection for customer
      await this.updateBalanceProjection(
        tx,
        userId,
        amount,
        LedgerEntryType.CREDIT,
      );

      // Transition payment status to REFUNDED to prevent double refunds
      if (payment) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      }
    } else {
      // Direct payments path (fallback)
      const commissionSetting = await tx.systemSetting.findUnique({
        where: { key: 'commission_rate' },
      });
      const commissionPercent = parseFloat(commissionSetting?.value || '5');
      const platformFee = amount.mul(commissionPercent / 100);
      const netVetAmount = amount.minus(platformFee);
      const vetUserId = payment?.appointment?.vet?.userId || userId;

      await tx.ledgerEntry.createMany({
        data: [
          {
            refundId,
            accountType: LedgerAccountType.VET_BALANCE,
            accountId: vetUserId,
            amount: netVetAmount,
            type: LedgerEntryType.DEBIT, // Debit Vet to pull back earnings
            reference: `${ledgerRefBase}-VET-DEBIT`,
            description: `Consultation refund earnings debit, refundId: ${refundId}`,
          },
          {
            refundId,
            accountType: LedgerAccountType.PLATFORM_REVENUE,
            accountId: 'PLATFORM',
            amount: platformFee,
            type: LedgerEntryType.DEBIT, // Debit Platform to reverse fee
            reference: `${ledgerRefBase}-PLAT-DEBIT`,
            description: `Consultation platform fee refund, refundId: ${refundId}`,
          },
          {
            refundId,
            accountType: LedgerAccountType.CUSTOMER_WALLET,
            accountId: userId,
            amount: amount,
            type: LedgerEntryType.CREDIT, // Credit Customer Wallet
            reference: `${ledgerRefBase}-CUST-CREDIT`,
            description: `Consultation refund credit, refundId: ${refundId}`,
          },
        ],
      });

      // Update projections
      await this.updateBalanceProjection(
        tx,
        vetUserId,
        netVetAmount,
        LedgerEntryType.DEBIT,
      );
      await this.updateBalanceProjection(
        tx,
        userId,
        amount,
        LedgerEntryType.CREDIT,
      );

      if (payment) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      }
    }
  }

  /**
   * Private helper to update balance projections in database transactionally.
   */
  private async updateBalanceProjection(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: Decimal,
    entryType: LedgerEntryType,
    isWithdrawalDebit = false,
  ): Promise<void> {
    // 1. Get or create UserBalance record
    let balance = await tx.userBalance.findUnique({
      where: { userId },
    });

    if (!balance) {
      balance = await tx.userBalance.create({
        data: {
          userId,
          availableBalance: new Decimal(0),
          reservedBalance: new Decimal(0),
          totalEarned: new Decimal(0),
          totalWithdrawn: new Decimal(0),
        },
      });
    }

    let availableUpdate = new Decimal(0);
    let reservedUpdate = new Decimal(0);
    let earnedUpdate = new Decimal(0);
    let withdrawnUpdate = new Decimal(0);

    if (entryType === LedgerEntryType.CREDIT) {
      // Credit increases the user's assets
      availableUpdate = amount;
      earnedUpdate = amount;
    } else if (entryType === LedgerEntryType.DEBIT) {
      // Debit decreases the user's assets
      if (isWithdrawalDebit) {
        // For completed withdrawals, we permanently deduct from reserved and add to totalWithdrawn
        reservedUpdate = amount.negated();
        withdrawnUpdate = amount;
      } else {
        // For other debits (e.g. refunds/reversals), we deduct from available
        availableUpdate = amount.negated();
      }
    }

    await tx.userBalance.update({
      where: { userId },
      data: {
        availableBalance: { increment: availableUpdate },
        reservedBalance: { increment: reservedUpdate },
        totalEarned: { increment: earnedUpdate },
        totalWithdrawn: { increment: withdrawnUpdate },
      },
    });
  }
}
