import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as throttler from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomThrottlerGuard extends throttler.ThrottlerGuard {
  constructor(
    @throttler.InjectThrottlerOptions() options: throttler.ThrottlerModuleOptions,
    @throttler.InjectThrottlerStorage() storageService: throttler.ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Prioritize password attempts lockout error over rate limits for logins
    if (request.method === 'POST' && request.url.includes('/auth/login')) {
      const email = request.body?.email;
      if (email) {
        const user = await this.prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { lockoutUntil: true },
        });

        if (user && user.lockoutUntil && user.lockoutUntil > new Date()) {
          const remainingTime = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60000);
          throw new UnauthorizedException(
            `Account is temporarily locked due to multiple failed login attempts. Please try again in ${remainingTime} minutes.`
          );
        }
      }
    }

    return super.canActivate(context);
  }
}
