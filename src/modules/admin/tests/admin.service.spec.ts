import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from '../admin.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { HashingService } from '../../identity/auth/services/hash.service';
import { NotFoundException } from '@nestjs/common';

describe('AdminService', () => {
  let service: AdminService;
  let prismaMock: any;
  let hashingMock: any;
  let txMock: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: HashingService, useValue: hashingMock },
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

      await expect(service.suspendUser('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should toggle active status and create status change outbox event inside transaction', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com', isActive: true };
      txMock.user.findUnique.mockResolvedValue(mockUser);
      txMock.user.update.mockResolvedValue({ ...mockUser, isActive: false });

      const result = await service.suspendUser('user-1');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
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

      await expect(service.resetPassword('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should reset user password to custom password, hash it, and create reset outbox event', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      txMock.user.findUnique.mockResolvedValue(mockUser);
      hashingMock.hash.mockResolvedValue('hashed-custom-pwd');

      const result = await service.resetPassword('user-1', 'MyCustomPwd123!');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(hashingMock.hash).toHaveBeenCalledWith('MyCustomPwd123!');
      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed-custom-pwd' },
      });
      expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: 'user-1',
            email: 'test@example.com',
            newPassword: 'MyCustomPwd123!',
          },
        },
      });
      expect(result).toEqual({ success: true, message: 'Password reset successfully to: MyCustomPwd123!' });
    });

    it('should reset user password to default Password123! if none provided, hash it, and create reset outbox event', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      txMock.user.findUnique.mockResolvedValue(mockUser);
      hashingMock.hash.mockResolvedValue('hashed-default-pwd');

      const result = await service.resetPassword('user-1');

      expect(txMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(hashingMock.hash).toHaveBeenCalledWith('Password123!');
      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed-default-pwd' },
      });
      expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: 'user-1',
            email: 'test@example.com',
            newPassword: 'Password123!',
          },
        },
      });
      expect(result).toEqual({ success: true, message: 'Password reset successfully to: Password123!' });
    });
  });
});
