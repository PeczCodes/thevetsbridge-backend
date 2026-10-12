import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Param,
  Patch,
  Query,
  Headers,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { ScheduleConsultationDto } from './dto/schedule-consultation.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';
import { AdminGuard } from '../../identity/auth/guards/admin.guard';
import { Idempotent } from '../../../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../../common/interceptors/idempotency.interceptor';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { Public } from '../../identity/auth/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { GetConsultationsDto } from './dto/get-consultations.dto';
import {
  SubmitSummaryDto,
  SubmitReviewDto,
  SubmitFeedbackDto,
  OpenDisputeDto,
  ResolveDisputeDto,
} from './dto/consultation-lifecycle.dto';

@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
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

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('content') content: string,
  ) {
    return this.consultationsService.sendConsultationMessage(
      user.id,
      id,
      content,
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
  @SkipThrottle()
  @Post('webhooks/livekit')
  async handleWebhook(
    @Headers('Authorization') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const rawBodyBuffer = req.rawBody;
    const rawBody = rawBodyBuffer
      ? rawBodyBuffer.toString('utf8')
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
    return this.consultationsService.handleLiveKitWebhook(rawBody, signature);
  }

  // Lifecycle APIs
  @Post(':id/waiting-room')
  async joinWaitingRoom(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.joinWaitingRoom(user.id, id);
  }

  @Post(':id/presence')
  async registerPresence(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('ip') ip?: string,
    @Body('ua') ua?: string,
  ) {
    return this.consultationsService.registerPresence(user.id, id, { ip, ua });
  }

  @Post(':id/heartbeat')
  async heartbeat(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultationsService.heartbeat(user.id, id);
  }

  @Post(':id/disconnect')
  async registerDisconnect(@Param('id') id: string, @CurrentUser() user: any) {
    await this.consultationsService.registerDisconnect(user.id, id);
    return { success: true };
  }

  @Post(':id/summary')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async submitSummary(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitSummaryDto,
  ) {
    return this.consultationsService.submitSummary(user.id, id, dto);
  }

  @Post(':id/dispute')
  async openDispute(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.consultationsService.openDispute(user.id, id, dto);
  }

  @Post('disputes/:disputeId/resolve')
  @UseGuards(AdminGuard)
  async resolveDispute(
    @Param('disputeId') disputeId: string,
    @CurrentUser() user: any,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.consultationsService.resolveDispute(user.id, disputeId, dto);
  }

  @Patch(':id/status')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('status') status: string,
  ) {
    return this.consultationsService.updateStatus(user.id, id, status);
  }

  @Post(':id/review')
  async submitReview(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitReviewDto,
  ) {
    return this.consultationsService.submitReview(user.id, id, dto);
  }
}
