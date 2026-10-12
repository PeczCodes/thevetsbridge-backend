import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from '../services/payment.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from '../services/ledger.service';
import { AppointmentLifecycleService } from '../../telemedicine/consultations/services/appointment-lifecycle.service';
import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('PaymentService', () => {
  let service: PaymentService;
  let prismaMock: any;
  let paystackMock: any;
  let ledgerMock: any;
  let appointmentLifecycleMock: any;

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
        update: jest.fn(),
      },
      appointment: {
        findUnique: jest.fn(),
      },
      systemSetting: {
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      notification: {
        create: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      webhookEventLog: {
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback) => {
        if (typeof callback === 'function') {
          return callback(prismaMock);
        }
        return Promise.all(callback);
      }),
    };

    paystackMock = {
      initializeTransaction: jest.fn(),
      verifyTransaction: jest.fn(),
    };

    ledgerMock = {
      recordPaymentLedgerEntries: jest.fn(),
    };

    appointmentLifecycleMock = {
      transitionTo: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaystackProvider, useValue: paystackMock },
        { provide: LedgerService, useValue: ledgerMock },
        {
          provide: AppointmentLifecycleService,
          useValue: appointmentLifecycleMock,
        },
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
        userId,
        status: 'PENDING',
        totalAmount: new Decimal(amount),
      });
      prismaMock.appointment.findUnique.mockResolvedValue({
        id: targetId,
        ownerId: userId,
        status: 'PENDING',
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

    it('should throw ForbiddenException if user does not own the order', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        id: targetId,
        userId: 'other-user-99',
        status: 'PENDING',
        totalAmount: new Decimal(amount),
      });

      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if order is not PENDING', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        id: targetId,
        userId,
        status: 'CANCELLED',
        totalAmount: new Decimal(amount),
      });

      await expect(
        service.initiatePayment(userId, email, purpose, targetId, callbackUrl),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if calculated amount is less than or equal to 0', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        id: targetId,
        userId,
        status: 'PENDING',
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
  });

  describe('verifyAndFulfillPayment (Security & Theft-Proofing)', () => {
    const reference = 'VETS-ORD-12345';
    const correlationId = 'test-correlation-id';

    beforeEach(() => {
      prismaMock.systemSetting.findUnique.mockResolvedValue({ value: '5' });
    });

    it('should reject payment if gateway amountPaid is less than expected amount (Underpayment Attack)', async () => {
      // Gateway reports only 100 paid for a 50,000 payment
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(100),
        currency: 'NGN',
        rawResponse: {},
      });

      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 'pay-1',
          userId: 'user-1',
          reference,
          amount: new Decimal(50000), // Expected 50,000!
          currency: 'NGN',
          purpose: PaymentPurpose.ORDER,
          orderId: 'order-1',
          status: PaymentStatus.PENDING,
        },
      ]);

      await expect(
        service.verifyAndFulfillPayment(reference, undefined, correlationId),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.payment.update).not.toHaveBeenCalled();
      expect(prismaMock.order.update).not.toHaveBeenCalled();
    });

    it('should reject payment if gateway currency does not match expected currency', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(5000),
        currency: 'USD', // Mismatch!
        rawResponse: {},
      });

      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 'pay-1',
          userId: 'user-1',
          reference,
          amount: new Decimal(5000),
          currency: 'NGN',
          purpose: PaymentPurpose.ORDER,
          orderId: 'order-1',
          status: PaymentStatus.PENDING,
        },
      ]);

      await expect(
        service.verifyAndFulfillPayment(reference, undefined, correlationId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fulfill order when amount and currency match exactly', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(5000),
        currency: 'NGN',
        rawResponse: {},
      });

      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 'pay-1',
          userId: 'user-1',
          reference,
          amount: new Decimal(5000),
          currency: 'NGN',
          purpose: PaymentPurpose.ORDER,
          orderId: 'order-1',
          status: PaymentStatus.PENDING,
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PENDING',
      });

      const result = await service.verifyAndFulfillPayment(
        reference,
        'event-123',
        correlationId,
      );

      expect(result.success).toBe(true);
      expect(prismaMock.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1' },
          data: expect.objectContaining({ status: PaymentStatus.PAID_IN_ESCROW }),
        }),
      );
      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'PAID' },
      });
      expect(prismaMock.webhookEventLog.update).toHaveBeenCalledWith({
        where: { eventId: 'event-123' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      });
    });

    it('should not resurrect a cancelled order into PAID', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(5000),
        currency: 'NGN',
        rawResponse: {},
      });

      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 'pay-1',
          userId: 'user-1',
          reference,
          amount: new Decimal(5000),
          currency: 'NGN',
          purpose: PaymentPurpose.ORDER,
          orderId: 'order-1',
          status: PaymentStatus.PENDING,
        },
      ]);

      prismaMock.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'CANCELLED', // Cancelled!
      });

      await service.verifyAndFulfillPayment(reference, undefined, correlationId);

      // Order must NOT be updated to PAID
      expect(prismaMock.order.update).not.toHaveBeenCalled();
      // Audit log created for cancelled order hold
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYMENT_CANCELLED_ORDER_HOLD',
          }),
        }),
      );
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
