import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PROFILE_KEY = 'requireProfile';
export const RequireProfile = (profile: 'VET' | 'VENDOR') =>
  SetMetadata(REQUIRE_PROFILE_KEY, profile);
