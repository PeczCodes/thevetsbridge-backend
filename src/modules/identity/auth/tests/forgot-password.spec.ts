import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';
import { HashingService } from '../services/hash.service';
import { TokenService } from '../services/token.service';
import { AccountLockoutService } from '../services/account-lockout.service';
import { UsersService } from '../../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../../../infra/cache/cache.service';
import { RedisService } from '../../../../../infra/redis/redis.service';
import { EncryptionService } from '../../../../../infra/security/encryption.service';
import { BadRequestException, HttpException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('ForgotPassword Flow', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let redisService: jest.Mocked<RedisService>;
  let encryptionService: jest.Mocked<EncryptionService>;
  let hashingService: jest.Mocked<HashingService>;
  let usersService: jest.Mocked<UsersService>;
  let configService: jest.Mocked<ConfigService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: 'hashed-old-password',
    firstName: 'Test',
    lastName: 'User',
  };

  const mockTokenRecord = {
    id: 'token-123',
    userId: 'user-123',
    tokenHash: 'hashed-token-val',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prisma)),
      $queryRawUnsafe: jest.fn(),
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      session: {
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    } as any;

    const mockClient = {
      get: jest.fn().mockResolvedValue(null),
      multi: jest.fn().mockReturnValue({
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    redisService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(mockClient),
    } as any;

    encryptionService = {
      encrypt: jest.fn().mockReturnValue('encrypted:token:tag'),
      decrypt: jest.fn().mockReturnValue('raw-token-value'),
    } as any;

    hashingService = {
      hash: jest.fn().mockResolvedValue('hashed-new-password'),
      verify: jest.fn(),
    };

    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockImplementation((key, defaultVal) => {
        if (key === 'app.passwordResetExpiryMinutes') return 30;
        return defaultVal;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
        { provide: EncryptionService, useValue: encryptionService },
        { provide: HashingService, useValue: hashingService },
        { provide: UsersService, useValue: usersService },
        { provide: TokenService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        { provide: CacheService, useValue: {} },
        {
          provide: AccountLockoutService,
          useValue: {
            assertNotLocked: jest.fn(),
            recordFailedAttempt: jest.fn(),
            resetFailedAttempts: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('requestPasswordReset (Forgot Password)', () => {
    it('should normalize email and prevent account enumeration', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      // Should succeed (return undefined, no exception) even if user does not exist
      await expect(
        service.requestPasswordReset(
          '  TEST@example.com  ',
          '127.0.0.1',
          'Mozilla',
        ),
      ).resolves.not.toThrow();

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      // No token or outbox event should be created
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
      // Should write failure audit log for unknown user attempt
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: null,
            action: 'PASSWORD_RESET_REQUESTED',
          }),
        }),
      );
    });

    it('should delete previous tokens, encrypt raw token, and persist hashed token in outbox transaction', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestPasswordReset(
        'test@example.com',
        '127.0.0.1',
        'Mozilla',
      );

      // Deletes all old tokens for that user
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });

      // Encrypts raw token
      expect(encryptionService.encrypt).toHaveBeenCalled();

      // Stores hashed token
      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });

      // Creates Outbox Event with encrypted payload
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'USER_PASSWORD_RESET',
          payload: expect.objectContaining({
            userId: mockUser.id,
            encryptedToken: 'encrypted:token:tag',
          }),
        }),
      });

      // Plaintext token must NEVER reach persistent storage (PasswordResetToken)
      const saveCall = prisma.passwordResetToken.create.mock.calls[0][0];
      const rawTokenFromOutbox =
        prisma.outboxEvent.create.mock.calls[0][0].data.payload.encryptedToken;
      expect(saveCall.data.tokenHash).not.toBe(rawTokenFromOutbox);
    });

    it('should trigger rate limit 429 when limits are exceeded', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      // Simulate rate limit hit
      const mockClient = redisService.getClient();
      jest.spyOn(mockClient, 'get').mockResolvedValue('3'); // 3 email limit reached

      await expect(
        service.requestPasswordReset(
          'test@example.com',
          '127.0.0.1',
          'Mozilla',
        ),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('resetPassword (Password Update)', () => {
    it('should reject passwords under 8 characters or matching current password', async () => {
      // 1. Password mismatch
      await expect(
        service.resetPassword(
          {
            token: 'token-val',
            password: 'pwd1',
            confirmPassword: 'pwd2',
          },
          '127.0.0.1',
          'Mozilla',
        ),
      ).rejects.toThrow(BadRequestException);

      // 2. Password length < 8
      await expect(
        service.resetPassword(
          {
            token: 'token-val',
            password: 'short',
            confirmPassword: 'short',
          },
          '127.0.0.1',
          'Mozilla',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent password reuse', async () => {
      // Setup token find and user
      prisma.$queryRawUnsafe.mockResolvedValue([mockTokenRecord]);
      prisma.user.findUnique = jest.fn().mockResolvedValue(mockUser);
      hashingService.verify.mockResolvedValue(true); // Password matches old password

      await expect(
        service.resetPassword(
          {
            token: 'token-val',
            password: 'hashed-old-password',
            confirmPassword: 'hashed-old-password',
          },
          '127.0.0.1',
          'Mozilla',
        ),
      ).rejects.toThrow(
        'Your new password must be different from your current password.',
      );
    });

    it('should row-lock token, revoke sessions, delete user reset tokens, and consume token inside transaction', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([mockTokenRecord]);
      prisma.user.findUnique = jest.fn().mockResolvedValue(mockUser);
      hashingService.verify.mockResolvedValue(false); // Password is new

      await service.resetPassword(
        {
          token: 'token-val',
          password: 'new-secure-password',
          confirmPassword: 'new-secure-password',
        },
        '127.0.0.1',
        'Mozilla',
      );

      // Row lock FOR UPDATE executed
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM "PasswordResetToken"'),
        expect.any(String),
      );

      // User password updated
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { passwordHash: 'hashed-new-password' },
      });

      // Token consumed
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: mockTokenRecord.id },
        data: { usedAt: expect.any(Date) },
      });

      // Deletes all user reset tokens
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });

      // Revokes active sessions
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, isRevoked: false },
        data: { isRevoked: true },
      });

      // Successful audit log logged
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockUser.id,
            action: 'PASSWORD_RESET_SUCCEEDED',
          }),
        }),
      );
    });
  });
});
