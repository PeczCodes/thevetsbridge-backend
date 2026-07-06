import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { IssuePrescriptionDto } from './dto/issue-prescription.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';

@Controller('consultations/:consultationId/prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Post()
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async issuePrescription(
    @Param('consultationId') consultationId: string,
    @CurrentUser() user: any,
    @Body() dto: IssuePrescriptionDto,
  ) {
    return this.prescriptionsService.issuePrescription(
      user.vetProfile.id,
      consultationId,
      dto,
    );
  }
}
