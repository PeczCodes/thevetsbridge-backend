import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from '../admin.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { HashingService } from '../../identity/auth/services/hash.service';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../../infra/cache/cache.service';

describe('AdminService', () => {
  let service: AdminService;
  let prismaMock: any;
  let hashingMock: any;
  let txMock: any;
  let jwtMock: any;
  let configMock: any;
  let cacheMock: any;

  beforeEach(async () => {
    txMock = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
    };

    prismaMock = {
      $transaction: jest.fn((callback) => callback(txMock)),
    };

    hashingMock = {
      hash: jest.fn(),
    };

    jwtMock = {
      sign: jest.fn(),
      verify: jest.fn(),
    };

    configMock = {
      get: jest.fn(),
      getOrThrow: jest.fn().mockReturnValue('mock-jwt-secret'),
    };

    cacheMock = {
      getOrSet: jest.fn(),
      invalidateUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: HashingService, useValue: hashingMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
        { provide: CacheService, useValue: cacheMock },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('suspendUser', () => {
    it('should throw NotFoundException if user is not found', async () => {
      txMock.user.findUnique.mockResolvedValue(null);

      await expect(service.suspendUser('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should toggle active status and create status change outbox event inside transaction', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        isActive: true,
      };
      txMock.user.findUnique.mockResolvedValue(mockUser);
      txMock.user.update.mockResolvedValue({ ...mockUser, isActive: false });

      const result = await service.suspendUser('user-1');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
      expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'USER_STATUS_CHANGED',
          payload: {
            userId: 'user-1',
            email: 'test@example.com',
            isActive: false,
          },
        },
      });
      expect(result.isActive).toBe(false);
    });
  });

  describe('resetPassword', () => {
    it('should throw NotFoundException if user is not found', async () => {
      txMock.user.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should sign reset token and create reset outbox event', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'old-hash',
      };
      txMock.user.findUnique.mockResolvedValue(mockUser);
      jwtMock.sign.mockReturnValue('mocked-reset-token');

      const result = await service.resetPassword('user-1');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(jwtMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          email: 'test@example.com',
          currentHash: 'old-hash',
          action: 'reset-password',
        }),
        expect.any(Object),
      );
      expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: 'user-1',
            email: 'test@example.com',
            token: 'mocked-reset-token',
          },
        },
      });
      expect(result).toEqual({
        success: true,
        message: "Password reset link has been sent to the user's email.",
      });
    });
  });
});
