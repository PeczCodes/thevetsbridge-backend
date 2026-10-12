import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';

@Injectable()
export class AccountLockoutService {
  private readonly maxFailedAttempts = 5;
  private readonly lockoutDurationMs = 15 * 60 * 1000; // 15 minutes

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asserts that an account is not currently locked out.
   * Performs an in-memory date check on the provided lockout timestamp with zero extra DB roundtrips.
   */
  assertNotLocked(lockoutUntil?: Date | null): void {
    if (!lockoutUntil) {
      return;
    }

    const now = Date.now();
    const lockoutTime = new Date(lockoutUntil).getTime();

    if (lockoutTime <= now) {
      return;
    }

    const remainingMinutes = Math.ceil((lockoutTime - now) / 60_000);

    throw new UnauthorizedException(
      `Account is temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minutes.`,
    );
  }

  /**
   * Records a failed login attempt for a user, increments the counter, and locks the account
   * if the threshold is reached. Throws an UnauthorizedException with details.
   */
  async recordFailedAttempt(
    userId: string,
    currentAttempts?: number,
  ): Promise<void> {
    let attempts = currentAttempts;

    if (attempts === undefined) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { failedLoginAttempts: true },
      });
      attempts = user?.failedLoginAttempts ?? 0;
    }

    const failedAttempts = attempts + 1;
    const isLocked = failedAttempts >= this.maxFailedAttempts;
    const lockoutUntil = isLocked
      ? new Date(Date.now() + this.lockoutDurationMs)
      : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: failedAttempts,
        lockoutUntil,
      },
    });

    if (isLocked) {
      const lockoutMinutes = Math.round(this.lockoutDurationMs / 60_000);
      throw new UnauthorizedException(
        `Account has been locked for ${lockoutMinutes} minutes due to multiple failed login attempts.`,
      );
    }

    const remainingRetries = this.maxFailedAttempts - failedAttempts;
    throw new UnauthorizedException(
      `Invalid credentials. ${remainingRetries} attempts remaining.`,
    );
  }

  /**
   * Alias for recordFailedAttempt
   */
  async recordFailure(
    userId: string,
    currentAttempts?: number,
  ): Promise<void> {
    return this.recordFailedAttempt(userId, currentAttempts);
  }

  /**
   * Resets the failed login attempts counter and clears any lockout timestamp.
   * Avoids unnecessary database writes if the counter is already 0 and lockoutUntil is null.
   */
  async resetFailedAttempts(
    userId: string,
    currentAttempts?: number,
    lockoutUntil?: Date | null,
  ): Promise<void> {
    if (currentAttempts === 0 && !lockoutUntil) {
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    });
  }

  /**
   * Alias for resetFailedAttempts
   */
  async reset(
    userId: string,
    currentAttempts?: number,
    lockoutUntil?: Date | null,
  ): Promise<void> {
    return this.resetFailedAttempts(userId, currentAttempts, lockoutUntil);
  }
}
