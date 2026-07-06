import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from '../services/payment.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from '../services/ledger.service';
import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('PaymentService', () => {
  let service: PaymentService;
  let prismaMock: any;
  let paystackMock: any;
  let ledgerMock: any;

  beforeEach(async () => {
    prismaMock = {
      payment: {
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
      },
      appointment: {
        findUnique: jest.fn(),
      },
    };

    paystackMock = {
      initializeTransaction: jest.fn(),
      verifyTransaction: jest.fn(),
    };

    ledgerMock = {
      recordPaymentLedgerEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaystackProvider, useValue: paystackMock },
        { provide: LedgerService, useValue: ledgerMock },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiatePayment', () => {
    const userId = 'user-1';
    const email = 'user@example.com';
    const amount = 5000;
    const purpose = PaymentPurpose.ORDER;
    const targetId = 'order-1';
    const callbackUrl = 'http://localhost/callback';

    beforeEach(() => {
      prismaMock.order.findUnique.mockResolvedValue({
        id: targetId,
        totalAmount: new Decimal(amount),
      });
      prismaMock.appointment.findUnique.mockResolvedValue({
        id: targetId,
        vet: {
          consultationFee: new Decimal(amount),
        },
      });
    });

    it('should throw NotFoundException if order does not exist', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);
      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if calculated amount is less than or equal to 0', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        id: targetId,
        totalAmount: new Decimal(0),
      });
      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a successful payment already exists for target', async () => {
      prismaMock.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.SUCCEEDED,
        reference: 'VETS-ORD-EXISTING',
      });

      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.payment.findFirst).toHaveBeenCalled();
    });

    it('should re-initialize and reuse reference if a pending payment exists', async () => {
      const existingRef = 'VETS-ORD-PENDING';
      prismaMock.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING,
        reference: existingRef,
      });

      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'failed',
        amountPaid: new Decimal(0),
        currency: 'NGN',
        gatewayResponse: 'Not paid yet',
      });

      paystackMock.initializeTransaction.mockImplementation(
        (email, amount, ref) =>
          Promise.resolve({
            authorizationUrl: 'https://checkout.paystack.co/auth',
            reference: ref,
          }),
      );

      const result = await service.initiatePayment(
        userId,
        email,
        purpose,
        targetId,
        callbackUrl,
      );

      expect(result.reference).toContain('VETS-ORD-');
      expect(paystackMock.initializeTransaction).toHaveBeenCalledWith(
        email,
        new Decimal(amount),
        result.reference,
        callbackUrl,
        expect.objectContaining({ userId, purpose, targetId }),
      );
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it('should create new pending payment and call Paystack initialize on new session', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);

      const newRef = 'VETS-ORD-NEW';
      prismaMock.payment.create.mockResolvedValue({
        id: 'pay-new',
        reference: newRef,
        status: PaymentStatus.PENDING,
      });

      paystackMock.initializeTransaction.mockResolvedValue({
        authorizationUrl: 'https://checkout.paystack.co/auth-new',
        reference: newRef,
      });

      const result = await service.initiatePayment(
        userId,
        email,
        purpose,
        targetId,
        callbackUrl,
      );

      expect(result.reference).toBe(newRef);
      expect(prismaMock.payment.create).toHaveBeenCalled();
      expect(paystackMock.initializeTransaction).toHaveBeenCalled();
    });

    it('should delete the created payment record and rethrow if Paystack initialization fails', async () => {
      prismaMock.payment.findFirst.mockResolvedValue(null);
      prismaMock.payment.create.mockResolvedValue({
        id: 'pay-new',
        reference: 'VETS-ORD-NEW',
        status: PaymentStatus.PENDING,
      });

      paystackMock.initializeTransaction.mockRejectedValue(
        new Error('Paystack Gateway Error'),
      );

      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow('Paystack Gateway Error');

      expect(prismaMock.payment.delete).toHaveBeenCalledWith({
        where: { id: 'pay-new' },
      });
    });
  });

  describe('getPaymentStatus', () => {
    it('should return payment status if found', async () => {
      const paymentData = {
        status: PaymentStatus.SUCCEEDED,
        reference: 'VETS-REF',
        amount: new Decimal(5000),
        currency: 'NGN',
        paidAt: new Date(),
      };
      prismaMock.payment.findUnique.mockResolvedValue(paymentData);

      const result = await service.getPaymentStatus('VETS-REF');
      expect(result).toEqual(paymentData);
    });

    it('should throw NotFoundException if payment reference does not exist', async () => {
      prismaMock.payment.findUnique.mockResolvedValue(null);

      await expect(service.getPaymentStatus('INVALID-REF')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
