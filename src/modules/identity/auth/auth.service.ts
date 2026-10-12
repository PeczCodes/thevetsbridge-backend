import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { HashingService } from './services/hash.service';
import { TokenService } from './services/token.service';
import { generateSlug, uniqueSlug } from '../../../../common/utils/slug';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../../infra/cache/cache.service';
import { RedisService } from '../../../../infra/redis/redis.service';
import { EncryptionService } from '../../../../infra/security/encryption.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { HttpException, HttpStatus, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  AUTH_LOGINS_TOTAL,
  AUTH_REGISTRATIONS_TOTAL,
  AUTH_JWT_REFRESHES_TOTAL,
} from '../../../monitoring/metrics/auth.metrics';

import { AccountLockoutService } from './services/account-lockout.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly hashingService: HashingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly redisService: RedisService,
    private readonly encryptionService: EncryptionService,
    private readonly accountLockoutService: AccountLockoutService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}

  async register(
    registerDto: RegisterDto,
    context?: { ip?: string; ua?: string },
  ) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await this.hashingService.hash(registerDto.password);

    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;
    const baseSlug = generateSlug(fullName);

    // Run within a Prisma transaction
    const user = await this.prisma.$transaction(async (tx) => {
      let vetSlug: string | undefined;
      if (registerDto.vetProfile) {
        const rawLicense = registerDto.vetProfile.licenseNumber?.trim();
        const cleanLicense =
          !rawLicense || rawLicense.toUpperCase() === 'PENDING'
            ? undefined
            : rawLicense;
        registerDto.vetProfile.licenseNumber = cleanLicense;

        if (cleanLicense) {
          const existingVet = await tx.vetProfile.findUnique({
            where: { licenseNumber: cleanLicense },
          });
          if (existingVet) {
            throw new BadRequestException(
              'This license number is already registered.',
            );
          }
        }
        vetSlug = await uniqueSlug(baseSlug, async (s) => {
          const exists = await tx.vetProfile.findUnique({ where: { slug: s } });
          return !!exists;
        });
      }

      let vendorSlug: string | undefined;
      if (registerDto.vendorProfile) {
        vendorSlug = await uniqueSlug(baseSlug, async (s) => {
          const exists = await tx.vendorProfile.findUnique({
            where: { slug: s },
          });
          return !!exists;
        });
      }

      // Create Base User
      const newUser = (await tx.user.create({
        data: {
          email: registerDto.email,
          passwordHash: hashedPassword,
          phone: registerDto.phone,
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          displayName: registerDto.displayName,
          timezone: registerDto.timezone,
          ...(registerDto.vetProfile && {
            vetProfile: {
              create: {
                licenseNumber: registerDto.vetProfile.licenseNumber,
                licenseCountry:
                  registerDto.vetProfile.licenseCountry || 'Nigeria',
                specializations: registerDto.vetProfile.specializations || [
                  'GENERAL_PRACTICE',
                ],
                experience: registerDto.vetProfile.experience,
                bio: registerDto.vetProfile.bio,
                slug: vetSlug,
              },
            },
          }),
          ...(registerDto.vendorProfile && {
            vendorProfile: {
              create: {
                businessName: registerDto.vendorProfile.businessName,
                businessPhone: registerDto.vendorProfile.businessPhone,
                businessAddress: registerDto.vendorProfile.businessAddress,
                bio: registerDto.vendorProfile.bio,
                slug: vendorSlug,
              },
            },
          }),
        },
        include: {
          vetProfile: true,
          vendorProfile: true,
        },
      })) as any;

      // Insert Outbox Event (MANDATORY EVENT-DRIVEN PATTERN)
      await tx.outboxEvent.create({
        data: {
          type: 'USER_REGISTERED',
          payload: {
            userId: newUser.id,
            email: newUser.email,
            hasVetProfile: !!newUser.vetProfile,
            hasVendorProfile: !!newUser.vendorProfile,
          },
        },
      });

      return newUser;
    });

    const { passwordHash, ...result } = user;
    const tokens = await this.tokenService.issueAuthTokens(
      result.id,
      result.email,
      context,
    );

    const roleLabel = registerDto.vetProfile ? 'VET' : registerDto.vendorProfile ? 'VENDOR' : 'CUSTOMER';
    this.monitoringService?.incrementCounter(AUTH_REGISTRATIONS_TOTAL, 1, { role: roleLabel });

    return {
      user: {
        ...result,
        avatarUrl: user.avatarMedia?.storageUrl || null,
        hasPassword: user.passwordHash !== null,
      },
      tokens,
    };
  }

  async login(loginDto: LoginDto, context?: { ip?: string; ua?: string }) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, { status: 'failure', method: 'password' });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, { status: 'deactivated', method: 'password' });
      throw new UnauthorizedException(
        'Account is deactivated. Please contact support.',
      );
    }

    try {
      this.accountLockoutService.assertNotLocked(user.lockoutUntil);
    } catch (err) {
      this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, {
        status: 'locked',
        method: 'password',
      });
      throw err;
    }

    if (!user.passwordHash) {
      this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, {
        status: 'google_only',
        method: 'password',
      });
      throw new UnauthorizedException(
        "This account currently uses Google Sign-In. Add a password from your account security settings if you'd like to sign in with email and password.",
      );
    }

    const isPasswordValid = await this.hashingService.verify(
      user.passwordHash,
      loginDto.password,
    );
    if (!isPasswordValid) {
      this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, {
        status: 'failure',
        method: 'password',
      });
      await this.accountLockoutService.recordFailedAttempt(
        user.id,
        user.failedLoginAttempts,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login tracking if necessary
    await this.accountLockoutService.resetFailedAttempts(
      user.id,
      user.failedLoginAttempts,
      user.lockoutUntil,
    );

    const { passwordHash, ...result } = user;
    const tokens = await this.tokenService.issueAuthTokens(
      result.id,
      result.email,
      context,
    );

    this.monitoringService?.incrementCounter(AUTH_LOGINS_TOTAL, 1, { status: 'success', method: 'password' });

    return {
      user: {
        ...result,
        avatarUrl: user.avatarMedia?.storageUrl || null,
        hasPassword: user.passwordHash !== null,
      },
      tokens,
    };
  }

  async refresh(token: string, context?: { ip?: string; ua?: string }) {
    try {
      const res = await this.tokenService.issueFreshAuthTokens(token, context);
      this.monitoringService?.incrementCounter(AUTH_JWT_REFRESHES_TOTAL, 1, { status: 'success' });
      return res;
    } catch (err) {
      this.monitoringService?.incrementCounter(AUTH_JWT_REFRESHES_TOTAL, 1, { status: 'failure' });
      throw err;
    }
  }

  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    return {
      exists: !!user,
      hasVetProfile: !!user?.vetProfile,
      hasVendorProfile: !!user?.vendorProfile,
      hasPassword: user ? user.passwordHash !== null : false,
    };
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      // No account or Google-only account — reject without touching lockout counter
      return false;
    }
    // Honour lockout state before doing any expensive Argon2 work
    this.accountLockoutService.assertNotLocked(user.lockoutUntil);
    const isValid = await this.hashingService.verify(user.passwordHash, password);
    if (!isValid) {
      // recordFailedAttempt increments the counter and throws with remaining attempts.
      // The throw means we never reach "return false" below.
      await this.accountLockoutService.recordFailedAttempt(user.id, user.failedLoginAttempts);
      return false; // unreachable; satisfies TypeScript
    }
    await this.accountLockoutService.resetFailedAttempts(user.id, user.failedLoginAttempts, user.lockoutUntil);
    return true;
  }

  async logout(token: string) {
    await this.tokenService.revokeSession(token);
  }

  async linkVetProfile(email: string, password: string, vetData: any) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Account is deactivated. Please contact support.',
      );
    }

    // Check lockout before doing any Argon2 work
    this.accountLockoutService.assertNotLocked(user.lockoutUntil);

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "This account uses Google Sign-In. Add a password from your security settings before linking a profile.",
      );
    }

    const isPasswordValid = await this.hashingService.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      // Throws with remaining attempts / lockout message
      await this.accountLockoutService.recordFailedAttempt(user.id, user.failedLoginAttempts);
    }
    await this.accountLockoutService.resetFailedAttempts(user.id, user.failedLoginAttempts, user.lockoutUntil);

    if (user.vetProfile) {
      throw new ConflictException('User already has a veterinarian profile');
    }

    const vetProfile = await this.prisma.$transaction(async (tx) => {
      const rawLicense = vetData.licenseNumber?.trim();
      const cleanLicense =
        !rawLicense || rawLicense.toUpperCase() === 'PENDING'
          ? undefined
          : rawLicense;

      if (cleanLicense) {
        const existingVet = await tx.vetProfile.findUnique({
          where: { licenseNumber: cleanLicense },
        });
        if (existingVet) {
          throw new BadRequestException(
            'This license number is already registered.',
          );
        }
      }
      const createdProfile = await tx.vetProfile.create({
        data: {
          userId: user.id,
          licenseNumber: cleanLicense,
          licenseCountry: vetData.licenseCountry || 'Nigeria',
          specializations: vetData.specializations || ['GENERAL_PRACTICE'],
          experience: vetData.experience,
          bio: vetData.bio,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VET_PROFILE_LINKED',
          payload: {
            userId: user.id,
            email: user.email,
            vetProfileId: createdProfile.id,
            licenseNumber: createdProfile.licenseNumber,
          },
        },
      });

      return createdProfile;
    });

    await this.cacheService.invalidateUser(user.id);

    // Fetch fresh user so the response includes the newly linked vetProfile
    const freshUser = await this.usersService.findById(user.id);
    const { passwordHash, ...userResult } = freshUser as any;
    return {
      vetProfile,
      user: {
        ...userResult,
        avatarUrl: (freshUser as any).avatarMedia?.storageUrl || null,
        hasPassword: passwordHash !== null,
      },
    };
  }

  async linkVendorProfile(email: string, password: string, vendorData?: any) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Account is deactivated. Please contact support.',
      );
    }

    // Check lockout before doing any Argon2 work
    this.accountLockoutService.assertNotLocked(user.lockoutUntil);

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "This account uses Google Sign-In. Add a password from your security settings before linking a profile.",
      );
    }

    const isPasswordValid = await this.hashingService.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      await this.accountLockoutService.recordFailedAttempt(user.id, user.failedLoginAttempts);
    }
    await this.accountLockoutService.resetFailedAttempts(user.id, user.failedLoginAttempts, user.lockoutUntil);

    if (user.vendorProfile) {
      throw new ConflictException('User already has a vendor profile');
    }

    const vendorProfile = await this.prisma.$transaction(async (tx) => {
      const createdProfile = await tx.vendorProfile.create({
        data: {
          userId: user.id,
          businessName: vendorData?.businessName,
          businessPhone: vendorData?.businessPhone,
          businessAddress: vendorData?.businessAddress,
          bio: vendorData?.bio,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VENDOR_PROFILE_LINKED',
          payload: {
            userId: user.id,
            email: user.email,
            vendorProfileId: createdProfile.id,
            businessName: createdProfile.businessName,
          },
        },
      });

      return createdProfile;
    });

    await this.cacheService.invalidateUser(user.id);

    // Fetch fresh user so the response includes the newly linked vendorProfile
    const freshUser = await this.usersService.findById(user.id);
    const { passwordHash, ...userResult } = freshUser as any;
    return {
      vendorProfile,
      user: {
        ...userResult,
        avatarUrl: (freshUser as any).avatarMedia?.storageUrl || null,
        hasPassword: passwordHash !== null,
      },
    };
  }

  async validateOrCreateGoogleUser(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  }) {
    let user = await this.usersService.findByEmail(googleUser.email);

    if (!user) {
      try {
        const displayName = `${googleUser.firstName} ${googleUser.lastName}`;
        user = await this.prisma.$transaction(async (tx) => {
          let avatarMedia: any = null;
          if (googleUser.avatarUrl) {
            avatarMedia = await tx.media.create({
              data: {
                publicId: `google_${randomUUID()}`,
                storageUrl: googleUser.avatarUrl,
                provider: 'EXTERNAL',
                status: 'READY',
                ownerType: 'USER',
                ownerId: 'placeholder',
                resourceType: 'PROFILE_IMAGE',
                uploadedBy: 'system',
              },
            });
          }

          const newUser = await tx.user.create({
            data: {
              email: googleUser.email,
              passwordHash: null,
              firstName: googleUser.firstName,
              lastName: googleUser.lastName,
              displayName: displayName,
              avatarMediaId: avatarMedia?.id,
            },
          });

          if (avatarMedia) {
            await tx.media.update({
              where: { id: avatarMedia.id },
              data: { ownerId: newUser.id },
            });
          }

          // Insert Outbox Event (MANDATORY EVENT-DRIVEN PATTERN)
          await tx.outboxEvent.create({
            data: {
              type: 'USER_REGISTERED',
              payload: {
                userId: newUser.id,
                email: newUser.email,
                hasVetProfile: false,
                hasVendorProfile: false,
              },
            },
          });

          return newUser as any;
        });
      } catch (error: any) {
        // Concurrency safety: catch unique constraint exception P2002
        if (error.code === 'P2002') {
          user = await this.usersService.findByEmail(googleUser.email);
          if (!user) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    return user;
  }

  async issueAuthTokens(
    userId: string,
    email: string,
    context?: { ip?: string; ua?: string },
  ) {
    return this.tokenService.issueAuthTokens(userId, email, context);
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async checkRateLimit(key: string, limit: number, ttlSeconds: number) {
    if (!this.redisService.isAvailable()) {
      return;
    }
    const client = this.redisService.getClient();
    const current = await client.get(key);
    if (current && parseInt(current, 10) >= limit) {
      throw new HttpException(
        'Too many requests. Please try again in a few moments.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const multi = client.multi();
    multi.incr(key);
    if (!current) {
      multi.expire(key, ttlSeconds);
    }
    await multi.exec();
  }

  async requestPasswordReset(email: string, ip: string, ua: string) {
    const normalizedEmail = email.trim().toLowerCase();

    // Apply Redis hourly email rate limit (3/hr) and IP rate limit (20/hr)
    const emailLimitKey = `rate-limit:forgot-password:email:${normalizedEmail}`;
    const ipLimitKey = `rate-limit:forgot-password:ip:${ip}`;
    await this.checkRateLimit(emailLimitKey, 3, 3600);
    await this.checkRateLimit(ipLimitKey, 20, 3600);

    const user = await this.usersService.findByEmail(normalizedEmail);

    if (user) {
      const expiryMinutes = this.configService.get<number>(
        'app.passwordResetExpiryMinutes',
        30,
      );
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);

      // Encrypt raw token before writing it into the Outbox
      const encryptedToken = this.encryptionService.encrypt(rawToken);

      await this.prisma.$transaction(async (tx) => {
        // Delete all existing reset tokens belonging to that user
        await tx.passwordResetToken.deleteMany({
          where: { userId: user.id },
        });

        // Store only the SHA-256 hash in the database
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
          },
        });

        // Insert Outbox Event with encrypted token
        await tx.outboxEvent.create({
          data: {
            type: 'USER_PASSWORD_RESET',
            payload: {
              userId: user.id,
              encryptedToken,
            },
          },
        });

        // Write audit log inside transaction
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'PASSWORD_RESET_REQUESTED',
            entityType: 'USER',
            entityId: user.id,
            ipAddress: ip,
            userAgent: ua,
            metadata: {
              email: normalizedEmail,
            },
          },
        });
      });
    } else {
      // Create audit log for non-existent user attempt
      await this.prisma.auditLog.create({
        data: {
          userId: null,
          action: 'PASSWORD_RESET_REQUESTED',
          entityType: 'USER',
          entityId: 'unknown',
          ipAddress: ip,
          userAgent: ua,
          metadata: {
            email: normalizedEmail,
            error: 'User not found',
          },
        },
      });
    }
  }

  async validateResetToken(token: string): Promise<{ valid: boolean }> {
    if (!token) {
      return { valid: false };
    }
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record) {
      return { valid: false };
    }
    const isValid = !record.usedAt && record.expiresAt > new Date();
    return { valid: isValid };
  }

  async resetPassword(dto: ResetPasswordDto, ip: string, ua: string) {
    const { token, password, confirmPassword } = dto;

    // Apply IP rate limit (10/hr)
    const resetIpLimitKey = `rate-limit:reset-password:ip:${ip}`;
    await this.checkRateLimit(resetIpLimitKey, 10, 3600);

    if (password !== confirmPassword) {
      throw new BadRequestException('Password confirmation does not match.');
    }

    if (password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long.',
      );
    }

    const tokenHash = this.hashToken(token);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Row-level lock on the reset token using FOR UPDATE raw query
        const lockedTokens: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM "PasswordResetToken" WHERE "tokenHash" = $1 FOR UPDATE`,
          tokenHash,
        );
        const record = lockedTokens[0];

        if (!record) {
          throw new BadRequestException('This password reset link is invalid.');
        }

        if (record.usedAt) {
          throw new BadRequestException(
            'This password reset link has already been used.',
          );
        }

        if (new Date() > new Date(record.expiresAt)) {
          throw new BadRequestException(
            'This password reset link has expired.',
          );
        }

        const user = await tx.user.findUnique({
          where: { id: record.userId },
        });

        if (!user) {
          throw new BadRequestException('User not found.');
        }

        // Prevent password reuse
        const isSamePassword = user.passwordHash
          ? await this.hashingService.verify(user.passwordHash, password)
          : false;

        if (isSamePassword) {
          throw new BadRequestException(
            'Your new password must be different from your current password.',
          );
        }

        // Hash new password
        const newHashed = await this.hashingService.hash(password);

        // Update password and consume token
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newHashed },
        });

        await tx.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });

        // Delete all remaining reset tokens for the user
        await tx.passwordResetToken.deleteMany({
          where: { userId: user.id },
        });

        // Revoke all active user sessions
        await tx.session.updateMany({
          where: { userId: user.id, isRevoked: false },
          data: { isRevoked: true },
        });

        // Write success audit log inside transaction
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'PASSWORD_RESET_SUCCEEDED',
            entityType: 'USER',
            entityId: user.id,
            ipAddress: ip,
            userAgent: ua,
          },
        });
      });
    } catch (error: any) {
      // Audit failed attempts
      let userId: string | null = null;
      try {
        const record = await this.prisma.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { userId: true },
        });
        if (record) userId = record.userId;
      } catch {}

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'PASSWORD_RESET_FAILED',
          entityType: 'USER',
          entityId: userId || 'unknown',
          ipAddress: ip,
          userAgent: ua,
          metadata: {
            error: error.message || 'An error occurred during password reset',
          },
        },
      });

      throw error;
    }
  }
}
