import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AppointmentLifecycleService } from './services/appointment-lifecycle.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { ScheduleConsultationDto } from './dto/schedule-consultation.dto';
import {
  Prisma,
  ConsultationStatus,
  LedgerAccountType,
  CancellationReason,
  DisputeStatus,
  ConsultationMode,
} from '@prisma/client';
import { AnimalsService } from '../../animals/animals.service';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { ConfigService } from '@nestjs/config';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { GetConsultationsDto } from './dto/get-consultations.dto';
import { LedgerService } from '../../payments/services/ledger.service';
import { RedisService } from '../../../../infra/redis/redis.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  SubmitSummaryDto,
  OpenDisputeDto,
  ResolveDisputeDto,
  SubmitReviewDto,
  SubmitFeedbackDto,
} from './dto/consultation-lifecycle.dto';

import { Optional } from '@nestjs/common';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  TELEMEDICINE_CONSULTATIONS_CREATED_TOTAL,
  TELEMEDICINE_CONSULTATIONS_STARTED_TOTAL,
  TELEMEDICINE_CONSULTATIONS_COMPLETED_TOTAL,
  TELEMEDICINE_CONSULTATIONS_CANCELLED_TOTAL,
} from '../../../monitoring/metrics/business.metrics';

@Injectable()
export class ConsultationsService implements OnModuleInit {
  private readonly logger = new Logger(ConsultationsService.name);

  async onModuleInit() {
    const livekitUrl = this.configService.get<string>('livekit.url');
    if (!livekitUrl) {
      this.logger.warn(
        'LiveKit URL is not configured. Video calls will be temporarily unavailable.',
      );
      return;
    }

    try {
      const apiKey = this.configService.get<string>('livekit.apiKey');
      const apiSecret = this.configService.get<string>('livekit.apiSecret');
      if (!apiKey || !apiSecret) {
        throw new Error('LiveKit credentials missing');
      }

      const httpUrl = livekitUrl.replace(/^ws/, 'http');
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);

      await fetch(httpUrl, {
        method: 'HEAD',
        signal: controller.signal,
      }).catch((err) => {
        throw new Error(`Connection check failed: ${err.message}`);
      });
      clearTimeout(id);
      this.logger.log('LiveKit connected.');
    } catch (err: any) {
      this.logger.warn(
        `LiveKit unavailable. Video calls will be temporarily unavailable. Error: ${err.message}`,
      );
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly animalsService: AnimalsService,
    private readonly configService: ConfigService,
    private readonly ledgerService: LedgerService,
    private readonly redisService: RedisService,
    @InjectQueue('consultation-lifecycle')
    private readonly lifecycleQueue: Queue,
    @Inject(forwardRef(() => AppointmentLifecycleService))
    private readonly appointmentLifecycleService: AppointmentLifecycleService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}

  async scheduleConsultation(customerId: string, dto: ScheduleConsultationDto) {
    const isOwner = await this.animalsService.isOwner(customerId, dto.animalId);

    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    const targetVet = await this.prisma.vetProfile.findUnique({
      where: { id: dto.vetId },
      select: { userId: true },
    });

    if (!targetVet) {
      throw new NotFoundException(
        'The selected veterinarian could not be found',
      );
    }

    if (targetVet.userId === customerId) {
      throw new ForbiddenException(
        'You cannot book a consultation with yourself',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const scheduledStart = dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : new Date();
      const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000); // 1 hour duration default

      if (dto.slotId) {
        const slot = await tx.vetSlot.findUnique({
          where: { id: dto.slotId },
        });
        if (!slot || slot.status !== 'AVAILABLE') {
          throw new BadRequestException(
            'The selected slot is no longer available',
          );
        }

        await tx.vetSlot.update({
          where: { id: dto.slotId },
          data: { status: 'BLOCKED' },
        });
      }

      const appointment = await tx.appointment.create({
        data: {
          animalId: dto.animalId,
          ownerId: customerId,
          vetId: dto.vetId,
          type: 'CONSULTATION',
          status: 'PENDING',
          scheduledStart,
          scheduledEnd,
          notes: dto.notes || null,
          slotId: dto.slotId || null,
        },
      });

      const consultation = await tx.consultation.create({
        data: {
          animalId: dto.animalId,
          vetId: dto.vetId,
          customerId,
          mode: dto.mode,
          scheduledAt: scheduledStart,
          status: 'SCHEDULED',
          appointmentId: appointment.id,
          reason: dto.reason || null,
          symptoms: dto.symptoms || null,
          files: dto.files ? (dto.files as any) : Prisma.JsonNull,
        },
      });

      this.monitoringService?.incrementCounter(TELEMEDICINE_CONSULTATIONS_CREATED_TOTAL, 1, { type: dto.mode });

      return {
        ...consultation,
        appointment,
      };
    });
  }

  async scheduleReminderJobs(consultationId: string, scheduledAt: Date) {
    const timings = [
      { label: '24h', offsetMs: 24 * 60 * 60 * 1000 },
      { label: '1h', offsetMs: 1 * 60 * 60 * 1000 },
      { label: '15m', offsetMs: 15 * 60 * 1000 },
      { label: '5m', offsetMs: 5 * 60 * 1000 },
    ];

    const now = Date.now();
    const startTime = scheduledAt.getTime();

    for (const t of timings) {
      const triggerTime = startTime - t.offsetMs;
      const delay = triggerTime - now;

      if (delay > 0) {
        await this.lifecycleQueue.add(
          'consultation-reminder-job',
          { consultationId, type: 'reminder', timing: t.label },
          { delay, jobId: `reminder-${consultationId}-${t.label}` },
        );
      }
    }

    const graceMinutes =
      this.configService.get<number>('telemedicine.noShowGracePeriodMinutes') ??
      15;
    const noShowDelay = startTime + graceMinutes * 60 * 1000 - now;
    if (noShowDelay > 0) {
      await this.lifecycleQueue.add(
        'consultation-no-show-job',
        { consultationId, type: 'no-show' },
        { delay: noShowDelay, jobId: `no-show-${consultationId}` },
      );
    }
  }

  async sendReminderNotification(consultationId: string, timing: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
    });

    if (
      !consultation ||
      consultation.status === 'CANCELLED' ||
      consultation.status === 'RESOLVED'
    ) {
      return;
    }

    await this.prisma.outboxEvent.create({
      data: {
        type: 'CONSULTATION_REMINDER_DUE',
        payload: {
          consultationId,
          timing,
          customerId: consultation.customerId,
          vetId: consultation.vetId,
        },
      },
    });
  }

  async getCustomerConsultations(
    customerId: string,
    pagination: GetConsultationsDto,
  ) {
    const { page = 1, limit = 10, status } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { customerId };
    if (status && status !== 'ALL') {
      where.status = status as ConsultationStatus;
    }

    const consultations = await this.prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        vet: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                firstName: true,
                lastName: true,
                displayName: true,
                avatarMediaId: true,
                isAdmin: true,
                isActive: true,
                timezone: true,
                createdAt: true,
                updatedAt: true,
                avatarMedia: true,
              },
            },
          },
        },
        animal: true,
        appointment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return consultations.map((c) => ({
      ...c,
      vet: c.vet
        ? {
            ...c.vet,
            specialization: c.vet.specializations[0] || 'GENERAL_PRACTICE',
          }
        : null,
    }));
  }

  async getVetConsultations(
    vetProfileId: string,
    pagination: GetConsultationsDto,
  ) {
    const { page = 1, limit = 10, status } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { vetId: vetProfileId };
    if (status && status !== 'ALL') {
      where.status = status as ConsultationStatus;
    }

    return this.prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            displayName: true,
            avatarMediaId: true,
            isAdmin: true,
            isActive: true,
            timezone: true,
            createdAt: true,
            updatedAt: true,
            avatarMedia: true,
          },
        },
        animal: true,
        appointment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findConsultationByIdOrAppt<T extends Prisma.ConsultationInclude>(
    idOrApptId: string,
    include?: T,
  ): Promise<Prisma.ConsultationGetPayload<{ include: T }> | null> {
    let consultation = await this.prisma.consultation.findUnique({
      where: { id: idOrApptId },
      include,
    });

    if (!consultation) {
      consultation = await this.prisma.consultation.findFirst({
        where: { appointmentId: idOrApptId },
        include,
      });
    }

    return consultation as any;
  }

  async isParticipant(
    userId: string,
    idOrApptId: string,
  ): Promise<boolean> {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId, {
      vet: true,
    });

    if (!consultation) return false;

    return (
      consultation.customerId === userId || consultation.vet?.userId === userId
    );
  }

  async sendConsultationMessage(
    userId: string,
    idOrApptId: string,
    content: string,
  ) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId, {
      vet: true,
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet?.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException(
        'You are not a participant in this consultation',
      );
    }

    const now = new Date();
    const statusStr = consultation.status as string;

    if (
      statusStr === 'LIVE' ||
      statusStr === 'CONFIRMED' ||
      statusStr === 'SCHEDULED' ||
      statusStr === 'IN_PROGRESS' ||
      statusStr === 'ACTIVE'
    ) {
      return this.prisma.chatMessage.create({
        data: {
          consultationId: consultation.id,
          senderId: userId,
          content,
          isFollowUp: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
              avatarMediaId: true,
              avatarMedia: true,
            },
          },
        },
      });
    }

    if (
      consultation.status === 'COMPLETED' ||
      consultation.status === 'RESOLVED'
    ) {
      const endedAt = consultation.endedAt || consultation.createdAt;
      const diffMs = now.getTime() - endedAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays > 7) {
        throw new ForbiddenException(
          'The 7-day post-consultation follow-up window has expired',
        );
      }

      return this.prisma.chatMessage.create({
        data: {
          consultationId: consultation.id,
          senderId: userId,
          content,
          isFollowUp: true,
        },
        include: {
          sender: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
              avatarMediaId: true,
              avatarMedia: true,
            },
          },
        },
      });
    }

    throw new ForbiddenException(
      'Consultation is not active and follow-up is not allowed yet',
    );
  }

  async getConsultationMessages(
    userId: string,
    idOrApptId: string,
    pagination: PaginationDto,
  ) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId);

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isParticipant = await this.isParticipant(userId, consultation.id);
    if (!isParticipant) {
      throw new ForbiddenException(
        'You are not a participant in this consultation',
      );
    }

    const page = pagination.page || 1;
    const limit = pagination.limit || 50;
    const skip = (page - 1) * limit;

    return this.prisma.chatMessage.findMany({
      where: { consultationId: consultation.id },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
            avatarMediaId: true,
            avatarMedia: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: limit,
    });
  }

  async generateLiveKitToken(userId: string, idOrApptId: string) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId, {
      vet: true,
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet?.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException(
        'You are not a participant in this consultation',
      );
    }

    if (consultation.status !== 'LIVE' && consultation.status !== 'CONFIRMED') {
      throw new ForbiddenException(
        'Video calls are only allowed for active or confirmed consultations',
      );
    }

    const apiKey = this.configService.get<string>('livekit.apiKey');
    const apiSecret = this.configService.get<string>('livekit.apiSecret');
    const livekitUrl = this.configService.get<string>('livekit.url');

    if (!apiKey || !apiSecret || !livekitUrl) {
      throw new InternalServerErrorException(
        'LiveKit video calls are temporarily unavailable.',
      );
    }

    const roomName = `consultation:${consultation.id}`;
    const participantName = isVet ? 'Doctor' : 'Client';

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: participantName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return { token, url: livekitUrl, consultationId: consultation.id };
  }

  async handleLiveKitWebhook(body: any, signature: string) {
    const apiKey = this.configService.get<string>('livekit.apiKey');
    const apiSecret = this.configService.get<string>('livekit.apiSecret');

    if (!apiKey || !apiSecret) {
      this.logger.warn('LiveKit webhook skipped: LiveKit is not configured.');
      return;
    }

    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      const event = await receiver.receive(body, signature);

      this.logger.log(
        `Received verified LiveKit webhook event: ${event.event}`,
      );

      if (event.event === 'room_finished' && event.room?.name) {
        const roomName = event.room.name;
        if (roomName.startsWith('consultation:')) {
          const consultationId = roomName.split(':')[1];
          await this.endCallSession(consultationId);
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to parse or verify LiveKit Webhook signature:',
        error,
      );
    }
  }

  async getConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: {
        OR: [
          { id: consultationId },
          { appointmentId: consultationId },
        ],
      },
      include: {
        vet: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                firstName: true,
                lastName: true,
                displayName: true,
                avatarMediaId: true,
                isAdmin: true,
                isActive: true,
                timezone: true,
                createdAt: true,
                updatedAt: true,
                avatarMedia: true,
              },
            },
          },
        },
        customer: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            displayName: true,
            avatarMediaId: true,
            isAdmin: true,
            isActive: true,
            timezone: true,
            createdAt: true,
            updatedAt: true,
            avatarMedia: true,
          },
        },
        animal: {
          include: {
            photoMedia: true,
          },
        },
        appointment: true,
        session: true,
        dispute: true,
        medicalRecord: true,
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException(
        'You are not a participant in this consultation',
      );
    }

    if (consultation.vet) {
      (consultation as any).vet.specialization =
        consultation.vet.specializations[0] || 'GENERAL_PRACTICE';
    }

    return consultation;
  }

  // Ephemeral Presence Heartbeats and Waiting Room Transitions
  async joinWaitingRoom(userId: string, idOrApptId: string) {
    return this.prisma.$transaction(async (tx) => {
      let consultation = await tx.consultation.findUnique({
        where: { id: idOrApptId },
        include: { vet: true },
      });

      if (!consultation) {
        consultation = await tx.consultation.findFirst({
          where: { appointmentId: idOrApptId },
          include: { vet: true },
        });
      }

      if (!consultation) {
        throw new NotFoundException('Consultation not found');
      }

      const isCustomer = consultation.customerId === userId;
      const isVet = consultation.vet?.userId === userId;

      if (!isCustomer && !isVet) {
        throw new ForbiddenException(
          'You are not a participant in this consultation',
        );
      }

      if (
        consultation.status !== 'CONFIRMED' &&
        consultation.status !== 'LIVE'
      ) {
        throw new BadRequestException(
          'Consultation session is not confirmed or active',
        );
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'ROOM_ENTERED',
          entityType: 'CONSULTATION',
          entityId: consultation.id,
          metadata: { role: isVet ? 'VET' : 'CUSTOMER' },
        },
      });

      return this.generateLiveKitToken(userId, consultation.id);
    });
  }

  async registerPresence(
    userId: string,
    idOrApptId: string,
    presenceInfo: { ip?: string; ua?: string },
  ) {
    const consultationRecord = await this.findConsultationByIdOrAppt(idOrApptId);
    if (!consultationRecord) {
      throw new NotFoundException('Consultation not found');
    }
    const consultationId = consultationRecord.id;

    const redisClient = this.redisService.getClient();
    const presenceKey = `presence:consultation:${consultationId}:${userId}`;
    const timeout =
      this.configService.get<number>('telemedicine.heartbeatTimeoutSeconds') ??
      30;

    await redisClient.set(presenceKey, 'online', 'EX', timeout);

    return this.prisma.$transaction(async (tx) => {
      // row-level lock
      const consultations = await tx.$queryRaw<any[]>`SELECT * FROM "Consultation" WHERE "id" = ${consultationId} FOR UPDATE`;
      if (!consultations || consultations.length === 0) {
        throw new NotFoundException('Consultation not found');
      }
      const consultation = consultations[0];

      const isCustomer = consultation.customerId === userId;
      const isVet = consultation.vetId
        ? (
            await tx.vetProfile.findUnique({
              where: { id: consultation.vetId },
            })
          )?.userId === userId
        : false;
      const role = isVet ? 'VET' : 'CUSTOMER';

      let presence = await tx.consultationPresence.findFirst({
        where: { consultationId, userId },
      });

      if (!presence) {
        presence = await tx.consultationPresence.create({
          data: {
            consultationId,
            userId,
            role,
            joinedAt: new Date(),
            online: true,
          },
        });
      } else {
        await tx.consultationPresence.update({
          where: { id: presence.id },
          data: { online: true, lastHeartbeatAt: new Date() },
        });
      }

      const updateData: any = {};
      if (isCustomer && !consultation.customerJoinedAt) {
        updateData.customerJoinedAt = new Date();
      }
      if (isVet && !consultation.vetJoinedAt) {
        updateData.vetJoinedAt = new Date();
      }

      const hasBothJoined =
        (consultation.customerJoinedAt || updateData.customerJoinedAt) &&
        (consultation.vetJoinedAt || updateData.vetJoinedAt);

      if (hasBothJoined && consultation.status === 'CONFIRMED') {
        updateData.status = 'LIVE';
        updateData.startedAt = new Date();

        await tx.outboxEvent.create({
          data: {
            type: 'CONSULTATION_STARTED',
            payload: { consultationId },
          },
        });

        const session = await tx.consultationSession.findUnique({
          where: { consultationId },
        });

        if (!session) {
          await tx.consultationSession.create({
            data: {
              consultationId,
              provider: 'LIVEKIT',
              roomId: `room_${consultationId}`,
              meetingId: `meet_${consultationId}`,
              startedAt: new Date(),
            },
          });
        }
      }

      let updatedStatus = consultation.status;
      if (Object.keys(updateData).length > 0) {
        const res = await tx.consultation.update({
          where: { id: consultationId },
          data: updateData,
        });
        updatedStatus = res.status;
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'PARTICIPANT_JOINED',
          entityType: 'CONSULTATION',
          entityId: consultationId,
          metadata: {
            role,
            ipAddress: presenceInfo.ip,
            userAgent: presenceInfo.ua,
            status: updatedStatus,
          },
        },
      });

      return { status: updatedStatus, presence };
    });
  }

  async heartbeat(userId: string, idOrApptId: string) {
    const consultationRecord = await this.findConsultationByIdOrAppt(idOrApptId);
    if (!consultationRecord) {
      throw new NotFoundException('Consultation not found');
    }
    const consultationId = consultationRecord.id;

    const redisClient = this.redisService.getClient();
    const presenceKey = `presence:consultation:${consultationId}:${userId}`;
    const timeout =
      this.configService.get<number>('telemedicine.heartbeatTimeoutSeconds') ??
      30;

    await redisClient.set(presenceKey, 'online', 'EX', timeout);

    await this.prisma.consultationPresence.updateMany({
      where: { consultationId, userId },
      data: { lastHeartbeatAt: new Date(), online: true },
    });

    return { success: true };
  }

  async registerDisconnect(userId: string, idOrApptId: string) {
    const consultationRecord = await this.findConsultationByIdOrAppt(idOrApptId);
    if (!consultationRecord) return;
    const consultationId = consultationRecord.id;

    const redisClient = this.redisService.getClient();
    const presenceKey = `presence:consultation:${consultationId}:${userId}`;
    await redisClient.del(presenceKey);

    await this.prisma.consultationPresence.updateMany({
      where: { consultationId, userId },
      data: { leftAt: new Date(), online: false },
    });

    const reconnectWindow =
      this.configService.get<number>('telemedicine.reconnectTimeoutSeconds') ??
      300;
    await this.lifecycleQueue.add(
      'reconnect-timeout-job',
      { consultationId, userId, type: 'reconnect-timeout' },
      {
        delay: reconnectWindow * 1000,
        jobId: `reconnect-${consultationId}-${userId}`,
      },
    );

    await this.prisma.outboxEvent.create({
      data: {
        type: 'PARTICIPANT_LEFT',
        payload: { consultationId, userId },
      },
    });
  }

  async handleReconnectTimeout(consultationId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const consultations = await tx.$queryRaw<any[]>`SELECT * FROM "Consultation" WHERE "id" = ${consultationId} FOR UPDATE`;
      if (!consultations || consultations.length === 0)
        return { success: false, reason: 'Consultation not found' };
      const consultation = consultations[0];

      if (consultation.status !== 'LIVE')
        return { success: false, reason: 'Not in live state' };

      const presence = await tx.consultationPresence.findFirst({
        where: { consultationId, userId },
      });

      if (!presence || presence.online)
        return { success: false, reason: 'Participant reconnected' };

      const isVet =
        (await tx.vetProfile.findUnique({ where: { id: consultation.vetId } }))
          ?.userId === userId;

      if (isVet) {
        await tx.consultation.update({
          where: { id: consultationId },
          data: { status: 'CANCELLED', cancellationReason: 'VET_CANCELLED' },
        });

        await this.refundEscrowTransaction(tx, consultationId);
        return { success: true, action: 'vet_offline_refunded' };
      } else {
        const liveDurationMs =
          Date.now() - (consultation.startedAt?.getTime() || Date.now());
        const fifteenMinutes = 15 * 60 * 1000;

        if (liveDurationMs > fifteenMinutes) {
          return { success: true, action: 'allowed_completion' };
        } else {
          await tx.consultation.update({
            where: { id: consultationId },
            data: {
              status: 'CANCELLED',
              cancellationReason: 'CUSTOMER_CANCELLED',
            },
          });
          await this.refundEscrowTransaction(tx, consultationId);
          return { success: true, action: 'customer_offline_refunded' };
        }
      }
    });
  }

  // Veterinarian Medical Record Summaries & Completion
  async submitSummary(
    userId: string,
    idOrApptId: string,
    dto: SubmitSummaryDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const consultations = await tx.$queryRaw<any[]>`SELECT * FROM "Consultation" WHERE "id" = ${idOrApptId} OR "appointmentId" = ${idOrApptId} FOR UPDATE`;
      if (!consultations || consultations.length === 0)
        throw new NotFoundException('Consultation not found');
      const consultation = consultations[0];

      const vet = await tx.vetProfile.findUnique({
        where: { id: consultation.vetId },
      });

      if (!vet || vet.userId !== userId) {
        throw new ForbiddenException(
          'Only the assigned veterinarian can submit the summary',
        );
      }

      if (consultation.summarySubmittedAt) {
        throw new BadRequestException(
          'A summary has already been submitted for this consultation',
        );
      }

      // 1. Create permanent Medical Record (preventing duplicate inputs)
      const record = await tx.medicalRecord.create({
        data: {
          animalId: consultation.animalId,
          recordedByVetId: consultation.vetId,
          title: `Consultation Summary - ${new Date().toLocaleDateString()}`,
          diagnosis: dto.diagnosis,
          treatment: dto.treatment,
          notes: dto.findings,
          attachments: dto.files ? dto.files : Prisma.JsonNull,
          consultationId: consultation.id,
        },
      });

      // 2. Schedule Escrow Automatic Payout (24 hours window)
      const disputeHours =
        this.configService.get<number>('telemedicine.disputeWindowHours') ?? 24;
      const disputeExpiry = new Date(
        Date.now() + disputeHours * 60 * 60 * 1000,
      );

      const updated = await tx.consultation.update({
        where: { id: consultation.id },
        data: {
          status: 'COMPLETED',
          summarySubmittedAt: new Date(),
          disputeWindowExpiresAt: disputeExpiry,
        },
      });

      // Enqueue BullMQ delayed job
      await this.lifecycleQueue.add(
        'escrow-release-job',
        { consultationId: consultation.id, type: 'escrow-release' },
        {
          delay: disputeHours * 60 * 60 * 1000,
          jobId: `escrow-release-${consultation.id}`,
        },
      );

      await tx.outboxEvent.create({
        data: {
          type: 'MEDICAL_RECORD_CREATED',
          payload: {
            consultationId: consultation.id,
            medicalRecordId: record.id,
            disputeWindowExpiresAt: disputeExpiry,
          },
        },
      });

      return {
        consultation: updated,
        medicalRecord: record,
      };
    });
  }

  // Dispute Management
  async openDispute(
    userId: string,
    idOrApptId: string,
    dto: OpenDisputeDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const consultations = await tx.$queryRaw<any[]>`SELECT * FROM "Consultation" WHERE "id" = ${idOrApptId} OR "appointmentId" = ${idOrApptId} FOR UPDATE`;
      if (!consultations || consultations.length === 0)
        throw new NotFoundException('Consultation not found');
      const consultation = consultations[0];

      if (consultation.customerId !== userId) {
        throw new ForbiddenException('Only the customer can open a dispute');
      }

      if (consultation.status !== 'COMPLETED') {
        throw new BadRequestException(
          'Disputes can only be opened for completed sessions',
        );
      }

      if (
        consultation.disputeWindowExpiresAt &&
        consultation.disputeWindowExpiresAt < new Date()
      ) {
        throw new BadRequestException(
          'The 24-hour dispute resolution window has expired',
        );
      }

      const dispute = await tx.consultationDispute.create({
        data: {
          consultationId: consultation.id,
          raisedById: userId,
          reason: dto.reason,
          details: dto.details || null,
          status: 'OPEN',
        },
      });

      await tx.consultation.update({
        where: { id: consultation.id },
        data: { status: 'DISPUTED' },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'DISPUTE_OPENED',
          payload: { consultationId: consultation.id, disputeId: dispute.id },
        },
      });

      return dispute;
    });
  }

  async resolveDispute(
    adminId: string,
    disputeId: string,
    dto: ResolveDisputeDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.consultationDispute.findUnique({
        where: { id: disputeId },
        include: { consultation: true },
      });

      if (!dispute || dispute.status !== 'OPEN') {
        throw new BadRequestException('Dispute is not open or not found');
      }

      if (dto.action === 'RELEASE') {
        await tx.consultationDispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED_RELEASED',
            resolvedById: adminId,
            resolvedAt: new Date(),
            resolution: dto.resolutionNotes,
          },
        });

        await tx.consultation.update({
          where: { id: dispute.consultationId },
          data: { status: 'RESOLVED' },
        });

        await this.releaseEscrowTransaction(tx, dispute.consultationId);
      } else {
        await tx.consultationDispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED_REFUNDED',
            resolvedById: adminId,
            resolvedAt: new Date(),
            resolution: dto.resolutionNotes,
          },
        });

        await tx.consultation.update({
          where: { id: dispute.consultationId },
          data: { status: 'RESOLVED', cancellationReason: 'ADMIN_CANCELLED' },
        });

        await this.refundEscrowTransaction(tx, dispute.consultationId);
      }

      return { success: true };
    });
  }

  // Ephemeral automatic payouts
  async processEscrowReleaseTimeout(consultationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const consultations = await tx.$queryRaw<any[]>`SELECT * FROM "Consultation" WHERE "id" = ${consultationId} FOR UPDATE`;
      if (!consultations || consultations.length === 0)
        return { success: false, reason: 'Not found' };
      const consultation = consultations[0];

      if (consultation.status !== 'COMPLETED') {
        return {
          success: false,
          reason: 'Consultation is not in completed state',
        };
      }

      await tx.consultation.update({
        where: { id: consultationId },
        data: { status: 'RESOLVED' },
      });

      await this.releaseEscrowTransaction(tx, consultationId);
      return { success: true };
    });
  }

  // Ephemeral automatic no-show
  async handleNoShow(consultationId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { appointment: true },
    });

    if (!consultation || !consultation.appointmentId) {
      return { success: false, reason: 'Consultation or appointment not found' };
    }

    if (consultation.status !== 'CONFIRMED') {
      return {
        success: false,
        reason: 'Already transitioned out of Confirmed status',
      };
    }

    const hasVetJoined = consultation.vetJoinedAt !== null;
    const hasCustomerJoined = consultation.customerJoinedAt !== null;

    if (!hasVetJoined && !hasCustomerJoined) {
      // Both never joined - transition to CANCELLED
      await this.appointmentLifecycleService.transitionTo(consultation.appointmentId, 'CANCELLED', {
        cancelledBy: 'SYSTEM',
        cancelReason: 'PAYMENT_TIMEOUT',
      });
      return { success: true, outcome: 'both_no_show' };
    }

    if (hasVetJoined && !hasCustomerJoined) {
      // Vet joined, customer did not
      await this.appointmentLifecycleService.transitionTo(consultation.appointmentId, 'NO_SHOW', {
        noShowParty: 'CLIENT',
      });
      return { success: true, outcome: 'customer_no_show' };
    }

    if (!hasVetJoined && hasCustomerJoined) {
      // Customer joined, vet did not
      await this.appointmentLifecycleService.transitionTo(consultation.appointmentId, 'NO_SHOW', {
        noShowParty: 'VET',
      });
      return { success: true, outcome: 'vet_no_show' };
    }

    return { success: false };
  }

  // Helpers for financial integrity
  async releaseEscrowTransaction(
    tx: Prisma.TransactionClient,
    consultationId: string,
  ) {
    const consultation = await tx.consultation.findUnique({
      where: { id: consultationId },
      include: { appointment: true },
    });

    if (!consultation || !consultation.appointmentId) return;

    const payment = await tx.payment.findFirst({
      where: {
        appointmentId: consultation.appointmentId,
        status: 'PAID_IN_ESCROW',
      },
    });

    if (!payment) return;

    const commissionSetting = await tx.systemSetting.findUnique({
      where: { key: 'commission_rate' },
    });
    const commissionPercent = parseFloat(commissionSetting?.value || '5');
    const platformFee = payment.amount.mul(commissionPercent / 100);

    const appointment = await tx.appointment.findUnique({
      where: { id: consultation.appointmentId },
      include: { vet: true },
    });

    if (appointment && appointment.vet) {
      await this.ledgerService.releaseEscrow(
        tx,
        payment.id,
        payment.amount,
        appointment.vet.userId,
        platformFee,
        LedgerAccountType.VET_BALANCE,
      );

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'RELEASED' },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'ESCROW_RELEASED',
          payload: {
            consultationId,
            paymentId: payment.id,
            amount: payment.amount.toString(),
          },
        },
      });
    }
  }

  async refundEscrowTransaction(
    tx: Prisma.TransactionClient,
    consultationId: string,
  ) {
    const consultation = await tx.consultation.findUnique({
      where: { id: consultationId },
      include: { appointment: true },
    });

    if (!consultation || !consultation.appointmentId) return;

    const payment = await tx.payment.findFirst({
      where: {
        appointmentId: consultation.appointmentId,
        status: { in: ['PAID_IN_ESCROW', 'RELEASED'] },
      },
    });

    if (!payment) return;

    const refundRef = `REFUND-${payment.reference}`;
    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: consultation.cancellationReason?.toString() || 'Refund',
        status: 'SUCCEEDED',
        reference: refundRef,
      },
    });

    await this.ledgerService.recordRefundLedgerEntries(
      tx,
      refund.id,
      payment.id,
      payment.amount,
      consultation.customerId,
      'APPOINTMENT',
    );

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED' },
    });

    await tx.outboxEvent.create({
      data: {
        type: 'REFUND_ISSUED',
        payload: {
          consultationId,
          refundId: refund.id,
          amount: payment.amount.toString(),
        },
      },
    });
  }

  async endCallSession(consultationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const consultation = await tx.consultation.findUnique({
        where: { id: consultationId },
      });

      if (consultation && consultation.status === 'LIVE') {
        const updated = await tx.consultation.update({
          where: { id: consultationId },
          data: {
            status: 'COMPLETED',
            endedAt: new Date(),
          },
        });

        await tx.outboxEvent.create({
          data: {
            type: 'CONSULTATION_ENDED',
            payload: { consultationId },
          },
        });

        return updated;
      }
    });
  }

  async handleSessionAction(
    userId: string,
    idOrApptId: string,
    action: 'start' | 'join' | 'end',
  ) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId, {
      vet: true,
      appointment: true,
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet?.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException(
        'You are not a participant in this consultation',
      );
    }

    if (action === 'start') {
      if (!isVet) {
        throw new ForbiddenException('Only the veterinarian can start the session');
      }
      if (!consultation.appointmentId) {
        throw new BadRequestException('Consultation is not linked to an appointment');
      }
      await this.appointmentLifecycleService.transitionTo(
        consultation.appointmentId,
        'IN_PROGRESS',
      );
      this.monitoringService?.incrementCounter(TELEMEDICINE_CONSULTATIONS_STARTED_TOTAL, 1, { type: consultation.mode });
      return this.generateLiveKitToken(userId, consultation.id);
    }

    if (action === 'join') {
      return this.generateLiveKitToken(userId, consultation.id);
    }

    if (action === 'end') {
      if (!isVet) {
        throw new ForbiddenException(
          'Only the veterinarian can end the session',
        );
      }
      if (!consultation.appointmentId) {
        throw new BadRequestException('Consultation is not linked to an appointment');
      }
      await this.appointmentLifecycleService.transitionTo(
        consultation.appointmentId,
        'COMPLETED',
      );
      this.monitoringService?.incrementCounter(TELEMEDICINE_CONSULTATIONS_COMPLETED_TOTAL, 1, { type: consultation.mode });
      return { success: true };
    }

    throw new BadRequestException('Invalid session action');
  }

  async submitReview(
    userId: string,
    idOrApptId: string,
    dto: SubmitReviewDto,
  ) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId);

    if (!consultation || consultation.customerId !== userId) {
      throw new ForbiddenException('Only the client can leave a review');
    }

    return this.prisma.vetReview.create({
      data: {
        reviewerId: userId,
        vetId: consultation.vetId,
        consultationId: consultation.id,
        rating: dto.rating,
        comment: dto.comment || null,
        isVerified: true,
      },
    });
  }

  async updateStatus(userId: string, idOrApptId: string, status: string) {
    const consultation = await this.findConsultationByIdOrAppt(idOrApptId, {
      appointment: true,
      vet: true,
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (consultation.vet?.userId !== userId) {
      throw new ForbiddenException('Not authorized to update this consultation');
    }

    if (!consultation.appointmentId) {
      throw new BadRequestException('Consultation is not linked to an appointment');
    }

    if (status === 'APPROVED') {
      await this.appointmentLifecycleService.transitionTo(consultation.appointmentId, 'CONFIRMED');
    } else if (status === 'CANCELLED') {
      await this.appointmentLifecycleService.transitionTo(consultation.appointmentId, 'CANCELLED', {
        cancelledBy: userId,
        cancelReason: 'VET_CANCELLED',
      });
    } else {
      throw new BadRequestException(`Invalid status transition to ${status}`);
    }

    return this.prisma.consultation.findUnique({
      where: { id: consultation.id },
      include: { appointment: true },
    });
  }
}
