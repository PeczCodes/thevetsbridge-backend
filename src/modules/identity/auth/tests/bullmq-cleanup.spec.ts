import { DEFAULT_BULLMQ_OPTIONS } from '../../../../../config/bullmq.config';
import { SessionCleanupProcessor } from '../services/session-cleanup.processor';
import { UnpaidBookingCleanupProcessor } from '../../../telemedicine/consultations/services/unpaid-booking-cleanup.processor';

describe('BullMQ Redis Key Retention & Configs', () => {
  describe('Global Configuration', () => {
    it('should have the correct custom prefix namespace', () => {
      expect(DEFAULT_BULLMQ_OPTIONS.prefix).toBe('vetsbridge:bull');
    });

    it('should configure correct stream trimming limits', () => {
      expect(DEFAULT_BULLMQ_OPTIONS.streams.events.maxLen).toBe(1000);
    });

    it('should configure strict retention rules for completed/failed jobs', () => {
      const { removeOnComplete, removeOnFail, attempts, backoff } =
        DEFAULT_BULLMQ_OPTIONS.defaultJobOptions;

      // Completed jobs: max 100 jobs or 24 hours
      expect(removeOnComplete).toEqual({
        count: 100,
        age: 24 * 3600,
      });

      // Failed jobs: max 500 jobs or 7 days
      expect(removeOnFail).toEqual({
        count: 500,
        age: 7 * 24 * 3600,
      });

      // Retries
      expect(attempts).toBe(3);
      expect(backoff).toEqual({
        type: 'exponential',
        delay: 5000,
      });
    });
  });

  describe('Processors native cleanup and deterministic schedulers', () => {
    let sessionProcessor: SessionCleanupProcessor;
    let unpaidProcessor: UnpaidBookingCleanupProcessor;
    let mockSessionQueue: any;
    let mockUnpaidQueue: any;

    beforeEach(() => {
      mockSessionQueue = {
        upsertJobScheduler: jest.fn(),
        clean: jest.fn(),
      };
      mockUnpaidQueue = {
        upsertJobScheduler: jest.fn(),
        clean: jest.fn(),
      };

      sessionProcessor = new SessionCleanupProcessor(
        {} as any,
        mockSessionQueue,
      );
      unpaidProcessor = new UnpaidBookingCleanupProcessor(
        {} as any,
        mockUnpaidQueue,
      );
    });

    it('should register deterministic scheduler IDs on startup', async () => {
      await sessionProcessor.onApplicationBootstrap();
      expect(mockSessionQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'hourly-session-cleanup-scheduler',
        expect.any(Object),
        expect.any(Object),
      );

      await unpaidProcessor.onApplicationBootstrap();
      expect(mockUnpaidQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'unpaid-booking-cleanup-scheduler',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should clean historical jobs using native clean() API during process execution', async () => {
      const mockJob: any = {
        queueName: 'session-cleanup',
        id: 'job-123',
        attemptsMade: 0,
      };

      // Mock prisma transactions inside process methods
      const mockPrisma = {
        session: { deleteMany: jest.fn().mockResolvedValue({ count: 10 }) },
        passwordResetToken: {
          deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
        },
      };
      (sessionProcessor as any).prisma = mockPrisma;

      await sessionProcessor.process(mockJob);
      expect(mockSessionQueue.clean).toHaveBeenCalledWith(
        24 * 3600 * 1000,
        1000,
        'completed',
      );
      expect(mockSessionQueue.clean).toHaveBeenCalledWith(
        7 * 24 * 3600 * 1000,
        1000,
        'failed',
      );

      // Mock prisma transaction inside unpaid processor
      const mockUnpaidPrisma = {
        $transaction: jest
          .fn()
          .mockResolvedValue({ cancelledCount: 1, consultationsCancelled: 1 }),
      };
      (unpaidProcessor as any).prisma = mockUnpaidPrisma;

      const mockUnpaidJob: any = {
        queueName: 'unpaid-booking-cleanup',
        id: 'job-456',
        attemptsMade: 0,
      };
      await unpaidProcessor.process(mockUnpaidJob);
      expect(mockUnpaidQueue.clean).toHaveBeenCalledWith(
        24 * 3600 * 1000,
        1000,
        'completed',
      );
      expect(mockUnpaidQueue.clean).toHaveBeenCalledWith(
        7 * 24 * 3600 * 1000,
        1000,
        'failed',
      );
    });
  });
});
