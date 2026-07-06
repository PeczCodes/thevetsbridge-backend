import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Patch,
  Body,
} from '@nestjs/common';
import { Public } from '../../identity/auth/decorators/public.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { VetsService } from './vets.service';

@Controller('vets')
export class VetsController {
  constructor(private readonly vetsService: VetsService) {}

  @Get('stats')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async getStats(@CurrentUser() user: any) {
    return this.vetsService.getVetStats(user.vetProfile.id);
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    return this.vetsService.getProfile(user);
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: any, @Body() dto: any) {
    return this.vetsService.updateVetProfile(user.vetProfile.id, user.id, dto);
  }

  @Get()
  @Public()
  async listVets(
    @CurrentUser() user: any,
    @Query('specialization') specialization?: string,
    @Query('minRating') minRating?: string,
    @Query('maxFee') maxFee?: string,
    @Query('availableOnly') availableOnly?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
  ) {
    // If the requesting user is a vet, exclude their own profile from the directory
    const excludeVetProfileId: string | undefined = user?.vetProfile?.id;
    return this.vetsService.listVets(
      specialization,
      minRating,
      maxFee,
      availableOnly,
      verifiedOnly,
      excludeVetProfileId,
    );
  }

  @Get(':idOrSlug')
  @Public()
  async getVetProfile(@Param('idOrSlug') idOrSlug: string) {
    return this.vetsService.getVetProfile(idOrSlug);
  }

  @Get(':idOrSlug/availability/month')
  @Public()
  async getMonthAvailability(
    @Param('idOrSlug') idOrSlug: string,
    @Query('year') yearStr: string,
    @Query('month') monthStr: string,
  ) {
    return this.vetsService.getMonthAvailability(idOrSlug, yearStr, monthStr);
  }

  @Get(':idOrSlug/availability')
  @Public()
  async getDailyAvailability(
    @Param('idOrSlug') idOrSlug: string,
    @Query('date') dateStr: string,
  ) {
    return this.vetsService.getDailyAvailability(idOrSlug, dateStr);
  }
}
