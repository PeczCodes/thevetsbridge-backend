import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { VetsService } from './vets.service';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';

@Controller('vet/availability')
@RequireProfile('VET')
@UseGuards(RequireProfileGuard)
export class VetAvailabilityController {
  constructor(private readonly vetsService: VetsService) {}

  @Get()
  async getAvailability(@CurrentUser() user: any) {
    return this.vetsService.getVetAvailability(user.vetProfile.id);
  }

  @Post()
  async updateAvailability(
    @CurrentUser() user: any,
    @Body('slots') slots: any[],
  ) {
    return this.vetsService.updateVetAvailability(user.vetProfile.id, slots);
  }
}
