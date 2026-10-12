import { Test, TestingModule } from '@nestjs/testing';
import { ConsultationsService } from './consultations.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { AnimalsService } from '../../animals/animals.service';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from '../../payments/services/ledger.service';
import { RedisService } from '../../../../infra/redis/redis.service';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { AppointmentLifecycleService } from './services/appointment-lifecycle.service';

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let prisma: any;
  let animalsService: jest.Mocked<AnimalsService>;
  let configService: jest.Mocked<ConfigService>;
  let ledgerService: jest.Mocked<LedgerService>;
  let redisService: any;
  let queue: jest.Mocked<Queue>;

  const mockRedisClient = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    prisma = {
      vetProfile: {
        findUnique: jest.fn(),
      },
      vetSlot: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      appointment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      consultation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      consultationPresence: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      consultationSession: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      consultationDispute: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      paymentRefund: {
        create: jest.fn(),
      },
      medicalRecord: {
        create: jest.fn(),
      },
      systemSetting: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ key: 'commission_rate', value: '5' }),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
      $queryRaw: jest.fn(),
    };

    animalsService = {
      isOwner: jest.fn().mockResolvedValue(true),
    } as any;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'telemedicine.noShowGracePeriodMinutes') return 15;
        if (key === 'telemedicine.heartbeatTimeoutSeconds') return 30;
        if (key === 'telemedicine.reconnectTimeoutSeconds') return 300;
        if (key === 'telemedicine.disputeWindowHours') return 24;
        if (key === 'livekit.apiKey') return 'api-key';
        if (key === 'livekit.apiSecret') return 'api-secret';
        if (key === 'livekit.url') return 'ws://livekit-server';
        return null;
      }),
    } as any;

    ledgerService = {
      releaseEscrow: jest.fn().mockResolvedValue(undefined),
      recordRefundLedgerEntries: jest.fn().mockResolvedValue(undefined),
    } as any;

    redisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    } as any;

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-id' }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsultationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnimalsService, useValue: animalsService },
        { provide: ConfigService, useValue: configService },
        { provide: LedgerService, useValue: ledgerService },
        { provide: RedisService, useValue: redisService },
        { provide: getQueueToken('consultation-lifecycle'), useValue: queue },
        {
          provide: AppointmentLifecycleService,
          useValue: {
            transitionTo: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ConsultationsService>(ConsultationsService);
  });

  describe('scheduleConsultation', () => {
    it('should throw BadRequestException if slot is not AVAILABLE', async () => {
      prisma.vetProfile.findUnique.mockResolvedValue({ userId: 'vet-user-id' });
      prisma.vetSlot.findUnique.mockResolvedValue({
        id: 'slot-123',
        status: 'BOOKED',
      });

      await expect(
        service.scheduleConsultation('cust-123', {
          animalId: 'animal-123',
          vetId: 'vet-123',
          mode: 'VIDEO',
          slotId: 'slot-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reserve slot as BLOCKED and create consultation', async () => {
      prisma.vetProfile.findUnique.mockResolvedValue({ userId: 'vet-user-id' });
      prisma.vetSlot.findUnique.mockResolvedValue({
        id: 'slot-123',
        status: 'AVAILABLE',
      });
      prisma.appointment.create.mockResolvedValue({
        id: 'appt-123',
        status: 'PENDING',
      });
      prisma.consultation.create.mockResolvedValue({
        id: 'cons-123',
        status: 'SCHEDULED',
      });

      const result = await service.scheduleConsultation('cust-123', {
        animalId: 'animal-123',
        vetId: 'vet-123',
        mode: 'VIDEO',
        slotId: 'slot-123',
      });

      expect(prisma.vetSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-123' },
        data: { status: 'BLOCKED' },
      });
      expect(prisma.consultation.create).toHaveBeenCalled();
    });
  });

  describe('registerPresence', () => {
    it('should transition status to LIVE and create session when both join', async () => {
      const mockConsultation = {
        id: 'cons-123',
        customerId: 'cust-123',
        vetId: 'vet-123',
        status: 'CONFIRMED',
        customerJoinedAt: new Date(),
        vetJoinedAt: null,
      };

      prisma.consultation.findUnique.mockResolvedValue(mockConsultation);
      prisma.consultation.findFirst.mockResolvedValue(mockConsultation);
      prisma.$queryRaw.mockResolvedValue([mockConsultation]);
      prisma.vetProfile.findUnique.mockResolvedValue({
        id: 'vet-123',
        userId: 'vet-user-123',
      });
      prisma.consultationPresence.findFirst.mockResolvedValue(null);
      prisma.consultationPresence.create.mockResolvedValue({ id: 'pres-123' });
      prisma.consultationSession.findUnique.mockResolvedValue(null);
      prisma.consultation.update.mockResolvedValue({
        ...mockConsultation,
        status: 'LIVE',
      });

      // Vet joins (now both present)
      await service.registerPresence('vet-user-123', 'cons-123', {
        ip: '127.0.0.1',
        ua: 'Jest',
      });

      expect(prisma.consultation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cons-123' },
          data: expect.objectContaining({
            status: 'LIVE',
            startedAt: expect.any(Date),
            vetJoinedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.consultationSession.create).toHaveBeenCalled();
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CONSULTATION_STARTED',
          }),
        }),
      );
    });
  });

  describe('handleReconnectTimeout', () => {
    it('should refund customer if vet disconnects permanently', async () => {
      const mockConsultation = {
        id: 'cons-123',
        customerId: 'cust-123',
        vetId: 'vet-123',
        appointmentId: 'appt-123',
        status: 'LIVE',
      };

      prisma.$queryRaw.mockResolvedValue([mockConsultation]);
      prisma.consultationPresence.findFirst.mockResolvedValue({
        online: false,
      });
      prisma.vetProfile.findUnique.mockResolvedValue({
        id: 'vet-123',
        userId: 'vet-user-123',
      });
      prisma.consultation.findUnique.mockResolvedValue(mockConsultation);
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-123',
        amount: new Decimal('100.00'),
        reference: 'VETS-123',
      });
      prisma.paymentRefund.create.mockResolvedValue({ id: 'ref-123' });

      const result = await service.handleReconnectTimeout(
        'cons-123',
        'vet-user-123',
      );

      expect(result.action).toBe('vet_offline_refunded');
      expect(prisma.consultation.update).toHaveBeenCalledWith({
        where: { id: 'cons-123' },
        data: { status: 'CANCELLED', cancellationReason: 'VET_CANCELLED' },
      });
      expect(ledgerService.recordRefundLedgerEntries).toHaveBeenCalled();
    });
  });

  describe('submitSummary', () => {
    it('should record medical record and schedule escrow payout', async () => {
      const mockConsultation = {
        id: 'cons-123',
        customerId: 'cust-123',
        vetId: 'vet-123',
        status: 'LIVE',
      };

      prisma.$queryRaw.mockResolvedValue([mockConsultation]);
      prisma.vetProfile.findUnique.mockResolvedValue({
        id: 'vet-123',
        userId: 'vet-user-123',
      });
      prisma.medicalRecord.create.mockResolvedValue({ id: 'rec-123' });

      await service.submitSummary('vet-user-123', 'cons-123', {
        diagnosis: 'Flu',
        findings: 'Cold',
        treatment: 'Rest',
        recommendations: 'Drink water',
      });

      expect(prisma.medicalRecord.create).toHaveBeenCalled();
      expect(prisma.consultation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cons-123' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            summarySubmittedAt: expect.any(Date),
            disputeWindowExpiresAt: expect.any(Date),
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'escrow-release-job',
        { consultationId: 'cons-123', type: 'escrow-release' },
        expect.any(Object),
      );
    });
  });

  describe('openDispute', () => {
    it('should throw BadRequestException if dispute window has expired', async () => {
      const expiredDate = new Date(Date.now() - 3600 * 1000);
      const mockConsultation = {
        id: 'cons-123',
        customerId: 'cust-123',
        status: 'COMPLETED',
        disputeWindowExpiresAt: expiredDate,
      };

      prisma.$queryRaw.mockResolvedValue([mockConsultation]);

      await expect(
        service.openDispute('cust-123', 'cons-123', {
          reason: 'Service bad',
          details: 'Vet did not listen',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
