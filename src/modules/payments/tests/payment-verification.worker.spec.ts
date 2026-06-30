import { Test, TestingModule } from '@nestjs/testing';
import { PaymentVerificationWorker } from '../workers/payment-verification.worker';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PaystackProvider } from '../providers/paystack.provider';
import { LedgerService } from '../services/ledger.service';
import { PaymentStatus, PaymentPurpose, PaymentProvider } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { Job } from 'bullmq';

describe('PaymentVerificationWorker', () => {
  let worker: PaymentVerificationWorker;
  let prismaMock: any;
  let paystackMock: any;
  let ledgerMock: any;
  let txMock: any;

  beforeEach(async () => {
    txMock = {
      $queryRaw: jest.fn(),
      payment: {
        update: jest.fn(),
      },
      paymentEvent: {
        create: jest.fn(),
      },
      order: {
        update: jest.fn(),
      },
      appointment: {
        update: jest.fn(),
      },
      webhookEventLog: {
        update: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
    };

    prismaMock = {
      $transaction: jest.fn((callback) => callback(txMock)),
      webhookEventLog: {
        update: jest.fn(),
      },
    };

    paystackMock = {
      verifyTransaction: jest.fn(),
    };

    ledgerMock = {
      recordPaymentLedgerEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentVerificationWorker,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaystackProvider, useValue: paystackMock },
        { provide: LedgerService, useValue: ledgerMock },
      ],
    }).compile();

    worker = module.get<PaymentVerificationWorker>(PaymentVerificationWorker);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  describe('process', () => {
    const jobMock = {
      data: {
        reference: 'VETS-ORD-123',
        eventId: 'evt-123',
        correlationId: 'corr-123',
      },
    } as Job;

    it('should throw an error if Paystack status is not success (to trigger BullMQ retry)', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'failed',
        amountPaid: new Decimal(0),
        currency: 'NGN',
        gatewayResponse: 'Declined',
      });

      await expect(worker.process(jobMock)).rejects.toThrow('status is: failed');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should process successful payments, record ledger rows, update status, and write outbox events', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(5000),
        currency: 'NGN',
        gatewayResponse: 'Approved',
        rawResponse: { id: 'gateway-1' },
      });

      txMock.$queryRaw.mockResolvedValue([
        {
          id: 'pay-1',
          userId: 'user-1',
          purpose: PaymentPurpose.ORDER,
          status: PaymentStatus.PENDING,
          amount: new Decimal(5000),
          orderId: 'order-1',
          appointmentId: null,
          reference: 'VETS-ORD-123',
        },
      ]);

      const result = await worker.process(jobMock);

      expect(result).toEqual({ success: true, reference: 'VETS-ORD-123' });

      // Verifying status changes inside transaction
      expect(txMock.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: expect.objectContaining({
          status: PaymentStatus.PAID_IN_ESCROW,
        }),
      });

      // Verify audit logs
      expect(txMock.paymentEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'payment.completed',
          toStatus: PaymentStatus.PAID_IN_ESCROW,
        }),
      });

      // Verify double-entry ledger bookkeeping call
      expect(ledgerMock.recordPaymentLedgerEntries).toHaveBeenCalled();

      // Verify business entity update (Order status changes to PAID)
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'PAID' },
      });

      // Verify outbox event record created in PostgreSQL transaction
      expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PAYMENT_COMPLETED',
          payload: expect.objectContaining({
            reference: 'VETS-ORD-123',
            purpose: PaymentPurpose.ORDER,
          }),
        }),
      });

      // Verify webhook processed check completed
      expect(txMock.webhookEventLog.update).toHaveBeenCalledWith({
        where: { eventId: 'evt-123' },
        data: expect.objectContaining({
          status: 'PROCESSED',
        }),
      });
    });

    it('should handle webhook log fail updates on fatal verification errors', async () => {
      paystackMock.verifyTransaction.mockResolvedValue({
        status: 'success',
        amountPaid: new Decimal(5000),
      });

      // Query returns empty, triggering non-existent record exception
      txMock.$queryRaw.mockResolvedValue([]);

      await expect(worker.process(jobMock)).rejects.toThrow('Payment record not found');

      // Verifies that the webhook status in log is set to FAILED with error descriptions
      expect(prismaMock.webhookEventLog.update).toHaveBeenCalledWith({
        where: { eventId: 'evt-123' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Payment record not found for reference: VETS-ORD-123',
        }),
      });
    });
  });
});
