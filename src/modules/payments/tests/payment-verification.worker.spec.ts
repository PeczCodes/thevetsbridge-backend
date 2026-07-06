import { Test, TestingModule } from '@nestjs/testing';
import { PaymentVerificationWorker } from '../workers/payment-verification.worker';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaymentService } from '../services/payment.service';
import { Job } from 'bullmq';

describe('PaymentVerificationWorker', () => {
  let worker: PaymentVerificationWorker;
  let prismaMock: any;
  let paymentServiceMock: any;

  beforeEach(async () => {
    prismaMock = {
      webhookEventLog: {
        update: jest.fn(),
      },
    };

    paymentServiceMock = {
      verifyAndFulfillPayment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentVerificationWorker,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PaymentService, useValue: paymentServiceMock },
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

    it('should verify and fulfill payment successfully', async () => {
      paymentServiceMock.verifyAndFulfillPayment.mockResolvedValue({
        success: true,
        reference: 'VETS-ORD-123',
      });

      const result = await worker.process(jobMock);

      expect(result).toEqual({ success: true, reference: 'VETS-ORD-123' });
      expect(paymentServiceMock.verifyAndFulfillPayment).toHaveBeenCalledWith(
        'VETS-ORD-123',
        'evt-123',
        'corr-123',
      );
      expect(prismaMock.webhookEventLog.update).not.toHaveBeenCalled();
    });

    it('should update webhook log as FAILED and rethrow when paymentService fails', async () => {
      const errorMsg = 'Verification failed';
      paymentServiceMock.verifyAndFulfillPayment.mockRejectedValue(
        new Error(errorMsg),
      );

      await expect(worker.process(jobMock)).rejects.toThrow(errorMsg);

      expect(paymentServiceMock.verifyAndFulfillPayment).toHaveBeenCalledWith(
        'VETS-ORD-123',
        'evt-123',
        'corr-123',
      );
      expect(prismaMock.webhookEventLog.update).toHaveBeenCalledWith({
        where: { eventId: 'evt-123' },
        data: {
          status: 'FAILED',
          errorMessage: errorMsg,
        },
      });
    });

    it('should still rethrow error even if updating webhook log fails', async () => {
      const errorMsg = 'Verification failed';
      paymentServiceMock.verifyAndFulfillPayment.mockRejectedValue(
        new Error(errorMsg),
      );
      prismaMock.webhookEventLog.update.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(worker.process(jobMock)).rejects.toThrow(errorMsg);
    });
  });
});
