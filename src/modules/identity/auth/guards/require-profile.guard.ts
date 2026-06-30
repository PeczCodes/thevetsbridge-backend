import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PROFILE_KEY } from '../decorators/require-profile.decorator';

@Injectable()
export class RequireProfileGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredProfile = this.reflector.getAllAndOverride<string>(REQUIRE_PROFILE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredProfile) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (requiredProfile === 'VET') {
      if (!user.vetProfile) {
        throw new ForbiddenException('Vet profile is required to perform this action');
      }
      if (user.vetProfile.status !== 'APPROVED') {
        throw new ForbiddenException('Your vet profile must be approved to perform this action');
      }
    }

    if (requiredProfile === 'VENDOR') {
      if (!user.vendorProfile) {
        throw new ForbiddenException('Vendor profile is required to perform this action');
      }
      if (user.vendorProfile.status !== 'APPROVED') {
        throw new ForbiddenException('Your vendor profile must be approved to perform this action');
      }
    }

    return true;
  }
}
