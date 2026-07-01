import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { Prisma, LedgerAccountType, LedgerEntryType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to sum Credit entries minus Debit entries for a specific account.
   * This derives the wallet or earnings balance safely from historical ledger rows.
   */
  async getAccountBalance(
    accountId: string,
    accountType: LedgerAccountType
  ): Promise<Decimal> {
    const aggregations = await this.prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        accountId,
        accountType,
      },
      _sum: {
        amount: true,
      },
    });

    let credits = new Decimal(0);
    let debits = new Decimal(0);

    for (const group of aggregations) {
      const sum = group._sum.amount ? new Decimal(group._sum.amount) : new Decimal(0);
      if (group.type === LedgerEntryType.CREDIT) {
        credits = sum;
      } else if (group.type === LedgerEntryType.DEBIT) {
        debits = sum;
      }
    }

    return credits.minus(debits);
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
    platformFee: Decimal
  ): Promise<void> {
    const ledgerRefBase = `LEDG-${paymentId}`;

    if (purpose === 'ORDER') {
      // For orders, money moves from Paystack (External) to the Platform Escrow account.
      await tx.ledgerEntry.createMany({
        data: [
          {
            paymentId,
            accountType: LedgerAccountType.EXTERNAL_PROVIDER,
            accountId: 'PAYSTACK_GATEWAY',
            amount: amount,
            type: LedgerEntryType.DEBIT, // Debit external gateway increases platform assets
            reference: `${ledgerRefBase}-EXT-DEBIT`,
            description: `Payment for Order, reference: ${paymentId}`,
          },
          {
            paymentId,
            accountType: LedgerAccountType.ESCROW,
            accountId: 'PLATFORM_ESCROW',
            amount: amount,
            type: LedgerEntryType.CREDIT, // Credit escrow holds the liability
            reference: `${ledgerRefBase}-ESC-CREDIT`,
            description: `Escrow hold for Order, reference: ${paymentId}`,
          },
        ],
      });
    } else {
      // For direct consultation payments, funds go straight to Vet and Platform Revenue
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
            accountId: userId, // In a consultation, money goes directly to Vet's ledger profile
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
    }
  }

  /**
   * Releases funds from Escrow (e.g. when order is completed/delivered)
   */
  async releaseEscrow(
    tx: Prisma.TransactionClient,
    paymentId: string,
    amount: Decimal,
    vendorId: string,
    platformFee: Decimal
  ): Promise<void> {
    const netVendorAmount = amount.minus(platformFee);
    const ledgerRefBase = `ESC-REL-${paymentId}`;

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
          accountType: LedgerAccountType.VENDOR_BALANCE,
          accountId: vendorId,
          amount: netVendorAmount,
          type: LedgerEntryType.CREDIT, // Credit Vendor to increase vendor payout balance
          reference: `${ledgerRefBase}-VENDOR-CREDIT`,
          description: `Vendor earnings release for paymentId: ${paymentId}`,
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
  }

  /**
   * Processes a refund via offsetting credit/debit ledger entries.
   */
  async recordRefundLedgerEntries(
    tx: Prisma.TransactionClient,
    refundId: string,
    paymentId: string,
    amount: Decimal,
    userId: string,
    purpose: string
  ): Promise<void> {
    const ledgerRefBase = `REFUND-${refundId}`;

    if (purpose === 'ORDER') {
      // Reversing escrow: Debit Platform Escrow, Credit Customer Wallet (or External refund path)
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
    } else {
      // Reversing consultation fee: Debit Vet Balance and Platform Revenue, Credit Customer
      // Assuming a simple full reversal where Vet yields earnings back
      const platformFee = amount.mul(0.05); // 5% fee reversal
      const netVetAmount = amount.minus(platformFee);

      await tx.ledgerEntry.createMany({
        data: [
          {
            refundId,
            accountType: LedgerAccountType.VET_BALANCE,
            accountId: userId,
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
    }
  }
}
