import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../services/payout.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('PayoutService', () => {
  let service: PayoutService;
  let prismaMock: any;
  let paystackMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((callback) => callback(prismaMock)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn(),
      },
      financialTransaction: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      workerPayoutAccount: {
        findFirst: jest.fn(),
      },
      userBalance: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      financialTxStatusLog: {
        create: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
    };

    paystackMock = {
      listSupportedBanks: jest.fn(),
      resolveAccountNumber: jest.fn(),
      createTransferRecipient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaystackProvider, useValue: paystackMock },
      ],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
  });

  describe('requestWithdrawal (Security Hardening)', () => {
    const userId = 'user-123';
    const validDto = {
      amount: 5000,
      payoutAccountId: 'acc-1',
      idempotencyKey: 'idemp-key-1',
    };

    it('should reject withdrawal with more than 2 decimal places (fractional precision leak)', async () => {
      await expect(
        service.requestWithdrawal(userId, {
          ...validDto,
          amount: 5000.005,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-positive amounts', async () => {
      await expect(
        service.requestWithdrawal(userId, {
          ...validDto,
          amount: -500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject withdrawal below minimum threshold (1000 NGN)', async () => {
      await expect(
        service.requestWithdrawal(userId, {
          ...validDto,
          amount: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if another user used the same idempotency key (Cross-User Idempotency Leak)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: userId, isActive: true });
      prismaMock.financialTransaction.findFirst.mockResolvedValue(null);
      prismaMock.financialTransaction.findUnique.mockResolvedValue({
        id: 'tx-other',
        userId: 'other-user-999', // Different user!
        reference: validDto.idempotencyKey,
      });

      await expect(
        service.requestWithdrawal(userId, validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should return existing transaction idempotently for the same user', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: userId, isActive: true });
      const existing = {
        id: 'tx-1',
        userId,
        amount: new Decimal(5000),
      };
      prismaMock.financialTransaction.findFirst.mockResolvedValue(existing);

      const result = await service.requestWithdrawal(userId, validDto);
      expect(result).toEqual(existing);
      expect(prismaMock.financialTransaction.create).not.toHaveBeenCalled();
    });

    it('should create withdrawal with unique system reference and lock user balance', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: userId, isActive: true });
      prismaMock.financialTransaction.findFirst.mockResolvedValue(null);
      prismaMock.financialTransaction.findUnique.mockResolvedValue(null);
      prismaMock.financialTransaction.count.mockResolvedValue(0);
      prismaMock.workerPayoutAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workerId: userId,
        isVerified: true,
      });
      prismaMock.userBalance.findUnique.mockResolvedValue({
        userId,
        availableBalance: new Decimal(20000),
        reservedBalance: new Decimal(0),
      });

      prismaMock.financialTransaction.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'tx-created', ...data }),
      );

      const result = await service.requestWithdrawal(userId, validDto);

      expect(result.id).toBe('tx-created');
      expect(result.reference).toContain(`WTH-${userId.slice(-6)}-`);
      expect(result.metadata.idempotencyKey).toBe(validDto.idempotencyKey);
      expect(prismaMock.userBalance.update).toHaveBeenCalledWith({
        where: { userId },
        data: {
          availableBalance: { decrement: new Decimal(5000) },
          reservedBalance: { increment: new Decimal(5000) },
        },
      });
    });
  });
});
