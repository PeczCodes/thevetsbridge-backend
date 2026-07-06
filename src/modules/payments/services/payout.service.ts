import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import {
  RegisterPayoutAccountDto,
  WithdrawRequestDto,
} from '../dto/payout.dto';
import {
  FinancialTxStatus,
  FinancialTxType,
  LedgerAccountType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PayoutService {
  private readonly minWithdrawal = new Decimal(1000.0); // Minimum withdrawal amount: NGN 1,000

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackProvider,
  ) {}

  async getBanks() {
    return this.paystackProvider.listSupportedBanks();
  }

  async resolveAccount(accountNumber: string, bankCode: string) {
    const accountName = await this.paystackProvider.resolveAccountNumber(
      accountNumber,
      bankCode,
    );
    return {
      accountNumber,
      bankCode,
      accountName,
    };
  }

  async getPayoutAccounts(userId: string) {
    return this.prisma.workerPayoutAccount.findMany({
      where: { workerId: userId },
      orderBy: { isDefault: 'desc' },
    });
  }

  async registerPayoutAccount(userId: string, dto: RegisterPayoutAccountDto) {
    // 1. Resolve and verify the account name via Paystack
    const accountName = await this.paystackProvider.resolveAccountNumber(
      dto.accountNumber,
      dto.bankCode,
    );

    // 2. Register recipient on Paystack to get recipient_code
    const recipientCode = await this.paystackProvider.createTransferRecipient(
      dto.accountNumber,
      dto.bankCode,
      accountName,
    );

    // 3. Save to database
    return this.prisma.$transaction(async (tx) => {
      // Check if this account already exists
      const existing = await tx.workerPayoutAccount.findUnique({
        where: {
          workerId_bankCode_accountNumber: {
            workerId: userId,
            bankCode: dto.bankCode,
            accountNumber: dto.accountNumber,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          'This payout account has already been registered.',
        );
      }

      // Check if this is the first payout account for this user
      const count = await tx.workerPayoutAccount.count({
        where: { workerId: userId },
      });

      const isDefault = count === 0;

      return tx.workerPayoutAccount.create({
        data: {
          workerId: userId,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          accountName,
          providerRecipientCode: recipientCode,
          isVerified: true,
          isDefault,
        },
      });
    });
  }

  async deletePayoutAccount(userId: string, accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.workerPayoutAccount.findFirst({
        where: { id: accountId, workerId: userId },
      });

      if (!account) {
        throw new NotFoundException('Payout account not found.');
      }

      // 1. Do not allow deletion if there are active (PENDING/PROCESSING) withdrawals on this account
      const activeWithdrawals = await tx.financialTransaction.count({
        where: {
          payoutAccountId: accountId,
          type: FinancialTxType.WITHDRAWAL,
          status: {
            in: [FinancialTxStatus.PENDING, FinancialTxStatus.PROCESSING],
          },
        },
      });

      if (activeWithdrawals > 0) {
        throw new BadRequestException(
          'Cannot delete payout account. There are pending or processing withdrawals linked to this account.',
        );
      }

      await tx.workerPayoutAccount.delete({
        where: { id: accountId },
      });

      // 2. If we deleted the default account, set another account as default if any exist
      if (account.isDefault) {
        const remaining = await tx.workerPayoutAccount.findFirst({
          where: { workerId: userId },
        });

        if (remaining) {
          await tx.workerPayoutAccount.update({
            where: { id: remaining.id },
            data: { isDefault: true },
          });
        }
      }

      return { success: true };
    });
  }

  async setDefaultPayoutAccount(userId: string, accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.workerPayoutAccount.findFirst({
        where: { id: accountId, workerId: userId },
      });

      if (!account) {
        throw new NotFoundException('Payout account not found.');
      }

      // Clear all defaults
      await tx.workerPayoutAccount.updateMany({
        where: { workerId: userId },
        data: { isDefault: false },
      });

      // Set default
      return tx.workerPayoutAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
      });
    });
  }

  async getBalanceProjection(userId: string) {
    let balance = await this.prisma.userBalance.findUnique({
      where: { userId },
    });

    if (!balance) {
      balance = await this.prisma.userBalance.create({
        data: {
          userId,
          availableBalance: new Decimal(0),
          reservedBalance: new Decimal(0),
          totalEarned: new Decimal(0),
          totalWithdrawn: new Decimal(0),
        },
      });
    }

    return {
      availableBalance: balance.availableBalance,
      reservedBalance: balance.reservedBalance,
      totalEarned: balance.totalEarned,
      totalWithdrawn: balance.totalWithdrawn,
    };
  }

  async requestWithdrawal(userId: string, dto: WithdrawRequestDto) {
    const requestedAmount = new Decimal(dto.amount);

    if (requestedAmount.lt(this.minWithdrawal)) {
      throw new BadRequestException(
        `Withdrawal amount must be at least NGN ${this.minWithdrawal.toLocaleString()}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Concurrency safety: Lock the user record using SELECT FOR UPDATE
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.isActive) {
        throw new BadRequestException(
          'Authenticated user is inactive or suspended.',
        );
      }

      // 2. Idempotency Check
      const existingTx = await tx.financialTransaction.findUnique({
        where: { reference: dto.idempotencyKey },
        include: { statusHistory: true },
      });

      if (existingTx) {
        // Return existing transaction to make it idempotent
        return existingTx;
      }

      // 3. Check for any existing active withdrawals
      const activeCount = await tx.financialTransaction.count({
        where: {
          userId,
          type: FinancialTxType.WITHDRAWAL,
          status: {
            in: [FinancialTxStatus.PENDING, FinancialTxStatus.PROCESSING],
          },
        },
      });

      if (activeCount > 0) {
        throw new BadRequestException(
          'You already have an active withdrawal request in progress. Please wait for it to settle.',
        );
      }

      // 4. Verify Payout Account ownership and defaults
      const payoutAccount = await tx.workerPayoutAccount.findFirst({
        where: { id: dto.payoutAccountId, workerId: userId },
      });

      if (!payoutAccount || !payoutAccount.isVerified) {
        throw new BadRequestException(
          'Invalid or unverified payout account selected.',
        );
      }

      // 5. Verify balance
      let userBalance = await tx.userBalance.findUnique({
        where: { userId },
      });

      if (!userBalance) {
        userBalance = await tx.userBalance.create({
          data: {
            userId,
            availableBalance: new Decimal(0),
            reservedBalance: new Decimal(0),
            totalEarned: new Decimal(0),
            totalWithdrawn: new Decimal(0),
          },
        });
      }

      if (userBalance.availableBalance.lt(requestedAmount)) {
        throw new BadRequestException(
          'Insufficient available balance to complete this withdrawal.',
        );
      }

      // 6. Reserve balance dynamically
      await tx.userBalance.update({
        where: { userId },
        data: {
          availableBalance: { decrement: requestedAmount },
          reservedBalance: { increment: requestedAmount },
        },
      });

      // 7. Create Financial Transaction
      const financialTx = await tx.financialTransaction.create({
        data: {
          userId,
          payoutAccountId: dto.payoutAccountId,
          amount: requestedAmount,
          type: FinancialTxType.WITHDRAWAL,
          status: FinancialTxStatus.PENDING,
          reference: dto.idempotencyKey,
        },
      });

      // 8. Log initial status history
      await tx.financialTxStatusLog.create({
        data: {
          txId: financialTx.id,
          toStatus: FinancialTxStatus.PENDING,
          reason: 'Initial withdrawal request created.',
        },
      });

      // 9. Write to transactional OutboxEvent table
      await tx.outboxEvent.create({
        data: {
          type: 'WITHDRAWAL_REQUESTED',
          payload: {
            transactionId: financialTx.id,
          },
        },
      });

      return financialTx;
    });
  }

  async getWithdrawalsHistory(userId: string) {
    return this.prisma.financialTransaction.findMany({
      where: { userId, type: FinancialTxType.WITHDRAWAL },
      include: { payoutAccount: true, statusHistory: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
