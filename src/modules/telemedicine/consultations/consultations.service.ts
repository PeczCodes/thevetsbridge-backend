import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { ScheduleConsultationDto } from './dto/schedule-consultation.dto';
import { ConsultationStatus } from '@prisma/client';
import { AnimalsService } from '../../animals/animals.service';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { ConfigService } from '@nestjs/config';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { GetConsultationsDto } from './dto/get-consultations.dto';

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly animalsService: AnimalsService,
    private readonly configService: ConfigService,
  ) {}

  async scheduleConsultation(customerId: string, dto: ScheduleConsultationDto) {
    // Verify animal ownership
    const isOwner = await this.animalsService.isOwner(customerId, dto.animalId);

    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    // Guard against self-booking: a vet cannot book a consultation with themselves
    const targetVet = await this.prisma.vetProfile.findUnique({
      where: { id: dto.vetId },
      select: { userId: true },
    });

    if (!targetVet) {
      throw new NotFoundException('The selected veterinarian could not be found');
    }

    if (targetVet.userId === customerId) {
      throw new ForbiddenException('You cannot book a consultation with yourself');
    }

    return this.prisma.$transaction(async (tx) => {
      const scheduledStart = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();
      const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000); // 1 hour duration default

      // 1. Create the base Appointment record in PENDING_PAYMENT status
      const appointment = await tx.appointment.create({
        data: {
          animalId: dto.animalId,
          ownerId: customerId,
          vetId: dto.vetId,
          type: 'CONSULTATION',
          status: 'PENDING_PAYMENT',
          scheduledStart,
          scheduledEnd,
        },
      });

      // 2. Create the Consultation linked to the Appointment
      const consultation = await tx.consultation.create({
        data: {
          animalId: dto.animalId,
          vetId: dto.vetId,
          customerId,
          mode: dto.mode,
          scheduledAt: scheduledStart,
          status: 'SCHEDULED',
          appointmentId: appointment.id,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'CONSULTATION_SCHEDULED',
          payload: {
            consultationId: consultation.id,
            customerId,
            vetId: dto.vetId,
            animalId: dto.animalId,
            appointmentId: appointment.id,
          },
        },
      });

      return {
        ...consultation,
        appointment,
      };
    });
  }

  async getCustomerConsultations(customerId: string, pagination: GetConsultationsDto) {
    const { page = 1, limit = 10, status } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { customerId };
    if (status && status !== 'ALL') {
      if (status === 'PENDING') {
        where.status = 'SCHEDULED';
        where.appointment = { status: 'PENDING_PAYMENT' };
      } else if (status === 'APPROVED') {
        where.status = 'SCHEDULED';
        where.appointment = { status: 'CONFIRMED' };
      } else if (status === 'SCHEDULED') {
        where.status = 'SCHEDULED';
      } else if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'ONGOING') {
        where.status = 'ACTIVE';
      } else if (status === 'COMPLETED') {
        where.status = 'COMPLETED';
      } else if (status === 'CANCELLED') {
        where.status = 'CANCELLED';
      }
    }

    return this.prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        vet: { include: { user: true } },
        animal: true,
        appointment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVetConsultations(vetProfileId: string, pagination: GetConsultationsDto) {
    const { page = 1, limit = 10, status } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { vetId: vetProfileId };
    if (status && status !== 'ALL') {
      if (status === 'PENDING') {
        where.status = 'SCHEDULED';
        where.appointment = { status: 'PENDING_PAYMENT' };
      } else if (status === 'APPROVED') {
        where.status = 'SCHEDULED';
        where.appointment = { status: 'CONFIRMED' };
      } else if (status === 'SCHEDULED') {
        where.status = 'SCHEDULED';
      } else if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'ONGOING') {
        where.status = 'ACTIVE';
      } else if (status === 'COMPLETED') {
        where.status = 'COMPLETED';
      } else if (status === 'CANCELLED') {
        where.status = 'CANCELLED';
      }
    }

    return this.prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        customer: true,
        animal: true,
        appointment: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(consultationId: string, status: ConsultationStatus, vetProfileId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
    });

    if (!consultation || consultation.vetId !== vetProfileId) {
      throw new ForbiddenException('Not authorized to update this consultation');
    }

    const updates: any = { status };
    if (status === 'ACTIVE') updates.startedAt = new Date();
    if (status === 'COMPLETED') updates.endedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.consultation.update({
        where: { id: consultationId },
        data: updates,
      });

      if (status === 'COMPLETED' && updated.appointmentId) {
        await tx.vetEarning.updateMany({
          where: { appointmentId: updated.appointmentId },
          data: {
            status: 'SETTLED',
            settledAt: new Date(),
          },
        });
      }

      await tx.outboxEvent.create({
        data: {
          type: 'CONSULTATION_STATUS_UPDATED',
          payload: {
            consultationId,
            status,
          },
        },
      });

      return updated;
    });
  }

  async isParticipant(userId: string, consultationId: string): Promise<boolean> {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { vet: true },
    });

    if (!consultation) return false;

    return consultation.customerId === userId || consultation.vet.userId === userId;
  }

  async sendConsultationMessage(userId: string, consultationId: string, content: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { vet: true },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException('You are not a participant in this consultation');
    }

    const now = new Date();

    // 1. Scheduled active consultation layer
    if (consultation.status === 'ACTIVE') {
      return this.prisma.chatMessage.create({
        data: {
          consultationId,
          senderId: userId,
          content,
          isFollowUp: false,
        },
        include: { sender: true },
      });
    }

    // 2. Follow-up post-consultation support layer (completed and within 7 days)
    if (consultation.status === 'COMPLETED') {
      const endedAt = consultation.endedAt || consultation.createdAt;
      const diffMs = now.getTime() - endedAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays > 7) {
        throw new ForbiddenException('The 7-day post-consultation follow-up window has expired');
      }

      return this.prisma.chatMessage.create({
        data: {
          consultationId,
          senderId: userId,
          content,
          isFollowUp: true,
        },
        include: { sender: true },
      });
    }

    throw new ForbiddenException('Consultation is not active and follow-up is not allowed yet');
  }

  async getConsultationMessages(userId: string, consultationId: string, pagination: PaginationDto) {
    const isParticipant = await this.isParticipant(userId, consultationId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this consultation');
    }

    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    return this.prisma.chatMessage.findMany({
      where: { consultationId },
      skip,
      take: limit,
      include: { sender: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async generateLiveKitToken(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { vet: true },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException('You are not a participant in this consultation');
    }

    if (consultation.status !== 'ACTIVE' && consultation.status !== 'SCHEDULED') {
      throw new ForbiddenException('Video calls are only allowed for scheduled or active consultations');
    }

    const apiKey = this.configService.getOrThrow<string>('livekit.apiKey');
    const apiSecret = this.configService.getOrThrow<string>('livekit.apiSecret');
    const livekitUrl = this.configService.getOrThrow<string>('livekit.url');

    const roomName = `consultation:${consultationId}`;
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
    return { token, url: livekitUrl };
  }

  async handleLiveKitWebhook(body: any, signature: string) {
    const apiKey = this.configService.getOrThrow<string>('livekit.apiKey');
    const apiSecret = this.configService.getOrThrow<string>('livekit.apiSecret');

    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      const event = await receiver.receive(body, signature);

      this.logger.log(`Received verified LiveKit webhook event: ${event.event}`);

      if (event.event === 'room_finished' && event.room?.name) {
        const roomName = event.room.name;
        if (roomName.startsWith('consultation:')) {
          const consultationId = roomName.split(':')[1];
          const consultation = await this.prisma.consultation.findUnique({
            where: { id: consultationId },
          });

          if (consultation && consultation.status !== 'COMPLETED') {
            this.logger.log(`Webhook: auto-completing consultation ${consultationId}`);
            
            await this.prisma.$transaction(async (tx) => {
              await tx.consultation.update({
                where: { id: consultationId },
                data: {
                  status: 'COMPLETED',
                  endedAt: new Date(),
                },
              });

              if (consultation.appointmentId) {
                await tx.vetEarning.updateMany({
                  where: { appointmentId: consultation.appointmentId },
                  data: {
                    status: 'SETTLED',
                    settledAt: new Date(),
                  },
                });
              }

              await tx.outboxEvent.create({
                data: {
                  type: 'CONSULTATION_STATUS_UPDATED',
                  payload: {
                    consultationId,
                    status: 'COMPLETED',
                  },
                },
              });
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse or verify LiveKit Webhook signature:', error);
    }
  }

  async getConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        vet: { include: { user: true } },
        customer: true,
        animal: true,
        appointment: true,
      },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException('You are not a participant in this consultation');
    }

    return consultation;
  }

  async handleSessionAction(userId: string, consultationId: string, action: 'start' | 'join' | 'end') {
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
      include: { vet: true },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    const isCustomer = consultation.customerId === userId;
    const isVet = consultation.vet.userId === userId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException('You are not a participant in this consultation');
    }

    if (action === 'start') {
      if (!isVet) {
        throw new ForbiddenException('Only the veterinarian can start the session');
      }
      if (consultation.status !== 'ACTIVE') {
        await this.updateStatus(consultationId, 'ACTIVE', consultation.vetId);
      }
      return this.generateLiveKitToken(userId, consultationId);
    }

    if (action === 'join') {
      return this.generateLiveKitToken(userId, consultationId);
    }

    if (action === 'end') {
      if (!isVet) {
        throw new ForbiddenException('Only the veterinarian can end the session');
      }
      if (consultation.status !== 'COMPLETED') {
        await this.updateStatus(consultationId, 'COMPLETED', consultation.vetId);
      }
      return { success: true };
    }

    throw new BadRequestException('Invalid session action');
  }
}

