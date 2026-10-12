import { UnauthorizedException } from '@nestjs/common';
import { AccountLockoutService } from '../services/account-lockout.service';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';

describe('AccountLockoutService', () => {
  let service: AccountLockoutService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    service = new AccountLockoutService(prisma);
  });

  describe('assertNotLocked', () => {
    it('should not throw if lockoutUntil is null or undefined', () => {
      expect(() => service.assertNotLocked(null)).not.toThrow();
      expect(() => service.assertNotLocked(undefined)).not.toThrow();
    });

    it('should not throw if lockoutUntil is in the past', () => {
      const past = new Date(Date.now() - 1000 * 60);
      expect(() => service.assertNotLocked(past)).not.toThrow();
    });

    it('should throw UnauthorizedException if lockoutUntil is in the future', () => {
      const future = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes in future
      expect(() => service.assertNotLocked(future)).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertNotLocked(future)).toThrow(
        /Account is temporarily locked due to multiple failed login attempts. Please try again in 10 minutes./,
      );
    });
  });

  describe('recordFailedAttempt', () => {
    it('should increment attempts and not lock when threshold is not reached', async () => {
      prisma.user.update = jest.fn().mockResolvedValue({} as any);

      await expect(
        service.recordFailedAttempt('user-1', 2),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          failedLoginAttempts: 3,
          lockoutUntil: null,
        },
      });
    });

    it('should lock account and set lockoutUntil when threshold is reached (5 attempts)', async () => {
      prisma.user.update = jest.fn().mockResolvedValue({} as any);

      await expect(
        service.recordFailedAttempt('user-1', 4),
      ).rejects.toThrow(
        /Account has been locked for 15 minutes due to multiple failed login attempts./,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          failedLoginAttempts: 5,
          lockoutUntil: expect.any(Date),
        },
      });
    });

    it('should fetch attempts from db if currentAttempts is not provided', async () => {
      prisma.user.findUnique = jest
        .fn()
        .mockResolvedValue({ failedLoginAttempts: 1 } as any);
      prisma.user.update = jest.fn().mockResolvedValue({} as any);

      await expect(service.recordFailedAttempt('user-1')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { failedLoginAttempts: true },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          failedLoginAttempts: 2,
          lockoutUntil: null,
        },
      });
    });
  });

  describe('resetFailedAttempts', () => {
    it('should skip db update if attempts are already 0 and lockoutUntil is null', async () => {
      prisma.user.update = jest.fn();

      await service.resetFailedAttempts('user-1', 0, null);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should reset failedLoginAttempts and clear lockoutUntil in db', async () => {
      prisma.user.update = jest.fn().mockResolvedValue({} as any);

      await service.resetFailedAttempts('user-1', 3, null);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
      });
    });
  });
});
