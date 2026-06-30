import { Controller, Post, Body, Get, UseGuards, Param, Patch, Query, Headers } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { ScheduleConsultationDto } from './dto/schedule-consultation.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';
import { ConsultationStatus } from '@prisma/client';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { PaginationDto } from '../../../core/dto/pagination.dto';
import { Public } from '../../identity/auth/decorators/public.decorator';
import { GetConsultationsDto } from './dto/get-consultations.dto';

@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post()
  @Idempotent()
  async scheduleConsultation(
    @CurrentUser() user: any,
    @Body() dto: ScheduleConsultationDto,
  ) {
    return this.consultationsService.scheduleConsultation(user.id, dto);
  }

  @Get('customer')
  async getCustomerConsultations(
    @CurrentUser() user: any,
    @Query() pagination: GetConsultationsDto,
  ) {
    return this.consultationsService.getCustomerConsultations(
      user.id,
      pagination,
    );
  }

  @Get('vet')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async getVetConsultations(
    @CurrentUser() user: any,
    @Query() pagination: GetConsultationsDto,
  ) {
    return this.consultationsService.getVetConsultations(
      user.vetProfile.id,
      pagination,
    );
  }

  @Patch(':id/status')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('status') status: ConsultationStatus,
  ) {
    return this.consultationsService.updateStatus(
      id,
      status,
      user.vetProfile.id,
    );
  }

  @Post(':id/token')
  async generateToken(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.generateLiveKitToken(user.id, id);
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query() pagination: PaginationDto,
  ) {
    return this.consultationsService.getConsultationMessages(
      user.id,
      id,
      pagination,
    );
  }

  @Get(':id')
  async getConsultation(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.getConsultation(user.id, id);
  }

  @Post(':id/session')
  async handleSession(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('action') action: 'start' | 'join' | 'end',
  ) {
    return this.consultationsService.handleSessionAction(user.id, id, action);
  }

  @Public()
  @Post('webhooks/livekit')
  async handleWebhook(
    @Headers('Authorization') signature: string,
    @Body() body: any,
  ) {
    return this.consultationsService.handleLiveKitWebhook(body, signature);
  }
}
