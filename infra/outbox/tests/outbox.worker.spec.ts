import { Test, TestingModule } from '@nestjs/testing';
import { OutboxProcessor } from '../outbox.processor';
import { PaymentEventEmitter } from '../../../src/modules/payments/events/payment-event.emitter';
import { NotificationsQueueService } from '../../queues/notifications-queue/notifications-queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Job } from 'bullmq';

describe('OutboxProcessor', () => {
  let worker: OutboxProcessor;
  let paymentEventEmitterMock: any;
  let notificationsQueueMock: any;
  let prismaMock: any;

  beforeEach(async () => {
    paymentEventEmitterMock = {
      emit: jest.fn(),
    };
    notificationsQueueMock = {
      queueEmail: jest.fn(),
    };
    prismaMock = {
      user: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxProcessor,
        { provide: PaymentEventEmitter, useValue: paymentEventEmitterMock },
        { provide: NotificationsQueueService, useValue: notificationsQueueMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    worker = module.get<OutboxProcessor>(OutboxProcessor);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  describe('process', () => {
    it('should queue password reset email when USER_PASSWORD_RESET event is processed', async () => {
      const job = {
        id: 'job-1',
        data: {
          eventId: 'evt-1',
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: 'user-123',
            email: 'test@example.com',
            newPassword: 'TempPassword123!',
          },
        },
      } as Job;

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });

      const result = await worker.process(job);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(notificationsQueueMock.queueEmail).toHaveBeenCalledWith(
        'test@example.com',
        'VetsBridge Account Password Reset 🔐',
        'USER_PASSWORD_RESET',
        {
          name: 'John Doe',
          newPassword: 'TempPassword123!',
        }
      );
      expect(result).toEqual({ dispatched: true, eventId: 'evt-1' });
    });

    it('should queue account suspension status email when USER_STATUS_CHANGED is processed with isActive=false', async () => {
      const job = {
        id: 'job-2',
        data: {
          eventId: 'evt-2',
          type: 'USER_STATUS_CHANGED',
          payload: {
            userId: 'user-123',
            email: 'test@example.com',
            isActive: false,
          },
        },
      } as Job;

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });

      const result = await worker.process(job);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(notificationsQueueMock.queueEmail).toHaveBeenCalledWith(
        'test@example.com',
        'VetsBridge Account Suspended ⚠️',
        'USER_STATUS_CHANGED',
        {
          name: 'John Doe',
          isActive: false,
        }
      );
      expect(result).toEqual({ dispatched: true, eventId: 'evt-2' });
    });

    it('should queue account reactivation status email when USER_STATUS_CHANGED is processed with isActive=true', async () => {
      const job = {
        id: 'job-3',
        data: {
          eventId: 'evt-3',
          type: 'USER_STATUS_CHANGED',
          payload: {
            userId: 'user-123',
            email: 'test@example.com',
            isActive: true,
          },
        },
      } as Job;

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });

      const result = await worker.process(job);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(notificationsQueueMock.queueEmail).toHaveBeenCalledWith(
        'test@example.com',
        'VetsBridge Account Re-activated! 🎉',
        'USER_STATUS_CHANGED',
        {
          name: 'John Doe',
          isActive: true,
        }
      );
      expect(result).toEqual({ dispatched: true, eventId: 'evt-3' });
    });
  });
});
