import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';
import { TelemedicineGateway } from '../../gateways/telemedicine.gateway';
import { NotificationsQueueService } from '../../../../../infra/queues/notifications-queue/notifications-queue.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Appointment, AppointmentStatus, ConsultationStatus, LedgerAccountType } from '@prisma/client';
import { LedgerService } from '../../../payments/services/ledger.service';

@Injectable()
export class AppointmentLifecycleService {
  private readonly logger = new Logger(AppointmentLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TelemedicineGateway))
    private readonly telemedicineGateway: TelemedicineGateway,
    private readonly notificationsQueue: NotificationsQueueService,
    @InjectQueue('consultation-lifecycle')
    private readonly lifecycleQueue: Queue,
    private readonly configService: ConfigService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Safe event emission helper for user rooms
   */
  private emitToUser(userId: string, event: string, payload: any) {
    if (this.telemedicineGateway.server) {
      this.logger.log(`Emitting WebSocket event ${event} to user:${userId}`);
      this.telemedicineGateway.server.to(`user:${userId}`).emit(event, payload);
    } else {
      this.logger.warn(`WebSocket server is not initialized. Cannot emit ${event} to user:${userId}`);
    }
  }

  /**
   * Safe event emission helper for consultation rooms
   */
  private emitToRoom(room: string, event: string, payload: any) {
    if (this.telemedicineGateway.server) {
      this.logger.log(`Emitting WebSocket event ${event} to room ${room}`);
      this.telemedicineGateway.server.to(room).emit(event, payload);
    } else {
      this.logger.warn(`WebSocket server is not initialized. Cannot emit ${event} to room ${room}`);
    }
  }

  /**
   * transitionTo transitions an appointment to a target status using a strict state machine.
   * This function is fully idempotent and transactional.
   */
  async transitionTo(
    appointmentId: string,
    targetStatus: AppointmentStatus,
    metadata?: {
      cancelledBy?: string;
      cancelReason?: string;
      noShowParty?: 'CLIENT' | 'VET';
      reschedule?: {
        requestedBy: 'CLIENT' | 'VET';
        oldStart: Date;
        oldEnd: Date;
        newStart: Date;
        newEnd: Date;
      };
    },
    txConnection?: any,
  ): Promise<Appointment> {
    const execute = async (tx: any) => {
      // 1. Fetch appointment & consultation
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          consultation: true,
          vet: { include: { user: true } },
          owner: true,
          animal: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      const currentStatus = appointment.status;

      // Idempotency: If target state matches current state, return successfully
      if (currentStatus === targetStatus) {
        this.logger.log(
          `Appointment ${appointmentId} is already in state ${targetStatus}. Transition is idempotent.`,
        );
        return appointment;
      }

      // 2. Validate state machine transition rules
      const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
        PENDING: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
        CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'],
        IN_PROGRESS: ['COMPLETED'],
        COMPLETED: [],
        CANCELLED: [],
        RESCHEDULED: ['CONFIRMED', 'CANCELLED'],
        NO_SHOW: [],
      };

      const targets = allowedTransitions[currentStatus] || [];
      if (!targets.includes(targetStatus)) {
        throw new BadRequestException(
          `Invalid state transition: Cannot move appointment ${appointmentId} from ${currentStatus} to ${targetStatus}`,
        );
      }

      this.logger.log(
        `Transitioning appointment ${appointmentId} from ${currentStatus} to ${targetStatus}`,
      );

      const updateData: any = { status: targetStatus };
      const consultationUpdateData: any = {};

      // 3. Process transition side effects
      switch (targetStatus) {
        case 'PENDING': {
          // Occurs immediately after Paystack payment webhook success
          consultationUpdateData.status = 'SCHEDULED';
          
          // Notify the Vet immediately via WebSocket & Email
          const clientName = `${appointment.owner.firstName} ${appointment.owner.lastName}`;
          const formattedTime = appointment.scheduledStart.toLocaleString();
          
          this.emitToUser(appointment.vet.userId, 'consultation.requested', {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            clientName,
            animalName: appointment.animal.name,
            scheduledTime: formattedTime,
          });

          await tx.notification.create({
            data: {
              userId: appointment.vet.userId,
              title: 'New Consultation Request',
              body: `Client ${clientName} requested a consultation for ${appointment.animal.name} at ${formattedTime}.`,
              type: 'APPOINTMENT',
            },
          });
          break;
        }

        case 'CONFIRMED': {
          // Occurs when vet accepts the request (or when rescheduling is agreed)
          consultationUpdateData.status = 'CONFIRMED';
          
          // If we had a slot associated, lock it
          if (appointment.slotId) {
            await tx.vetSlot.update({
              where: { id: appointment.slotId },
              data: { status: 'BOOKED' },
            });
          }

          // If transitioning from RESCHEDULED, apply the new time and clear rescheduleRequest
          if (currentStatus === 'RESCHEDULED') {
            const req: any = appointment.rescheduleRequest;
            if (req) {
              updateData.scheduledStart = new Date(req.newStart);
              updateData.scheduledEnd = new Date(req.newEnd);
              consultationUpdateData.scheduledAt = new Date(req.newStart);
              updateData.rescheduleRequest = null;
            }
          }

          // Notify both client and vet
          const vetName = `Dr. ${appointment.vet.user.firstName} ${appointment.vet.user.lastName}`;
          const scheduledTime = (updateData.scheduledStart || appointment.scheduledStart).toLocaleString();
          
          this.emitToUser(appointment.ownerId, 'consultation.confirmed', {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            vetName,
            scheduledTime,
          });
          this.emitToUser(appointment.vet.userId, 'consultation.confirmed', {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            scheduledTime,
          });

          // Create In-App Notifications
          await tx.notification.create({
            data: {
              userId: appointment.ownerId,
              title: 'Consultation Confirmed',
              body: `${vetName} has confirmed your consultation scheduled for ${scheduledTime}.`,
              type: 'APPOINTMENT',
            },
          });

          // Write outbox event to queue email dispatch
          await tx.outboxEvent.create({
            data: {
              type: 'CONSULTATION_SCHEDULED',
              payload: {
                consultationId: appointment.consultation?.id,
                customerId: appointment.ownerId,
                vetId: appointment.vetId,
                animalId: appointment.animalId,
                appointmentId: appointment.id,
              },
            },
          });

          // Schedule reminder jobs & no-show timeout check on BullMQ
          await this.scheduleReminderJobs(
            appointment.consultation?.id || '',
            updateData.scheduledStart || appointment.scheduledStart,
            tx,
          );
          break;
        }

        case 'IN_PROGRESS': {
          // Occurs when the vet starts the call session
          consultationUpdateData.status = 'LIVE';
          consultationUpdateData.startedAt = new Date();

          // Emit global Socket event to client
          const vetName = `Dr. ${appointment.vet.user.firstName} ${appointment.vet.user.lastName}`;
          const payload = {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            vetName,
            startedAt: consultationUpdateData.startedAt.toISOString(),
          };

          this.emitToUser(appointment.ownerId, 'consultation.started', payload);
          this.emitToRoom(`consultation:${appointment.consultation?.id}`, 'consultation.started', payload);

          // Create in-app notification
          await tx.notification.create({
            data: {
              userId: appointment.ownerId,
              title: 'Consultation Started 🟢',
              body: `${vetName} has started your virtual consultation call session. Join now.`,
              type: 'APPOINTMENT',
            },
          });

          await tx.outboxEvent.create({
            data: {
              type: 'CONSULTATION_STARTED',
              payload: { consultationId: appointment.consultation?.id },
            },
          });
          break;
        }

        case 'COMPLETED': {
          // Occurs when the vet ends the session
          consultationUpdateData.status = 'COMPLETED';
          consultationUpdateData.endedAt = new Date();

          // Notify both users
          this.emitToRoom(`consultation:${appointment.consultation?.id}`, 'consultation.completed', {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            endedAt: consultationUpdateData.endedAt.toISOString(),
          });

          await tx.notification.create({
            data: {
              userId: appointment.ownerId,
              title: 'Consultation Completed',
              body: `Your consultation call session has ended. Please rate your experience and download prescriptions if needed.`,
              type: 'APPOINTMENT',
            },
          });

          await tx.outboxEvent.create({
            data: {
              type: 'CONSULTATION_ENDED',
              payload: { consultationId: appointment.consultation?.id },
            },
          });
          break;
        }

        case 'CANCELLED': {
          // Cancel/reject flow
          consultationUpdateData.status = 'CANCELLED';
          consultationUpdateData.cancellationReason = 'ADMIN_CANCELLED';

          const cancelledBy = metadata?.cancelledBy || 'SYSTEM';
          const cancelReason = metadata?.cancelReason || 'Cancelled';

          updateData.cancelledBy = cancelledBy;
          updateData.cancelledAt = new Date();
          updateData.cancellationReason = cancelReason;

          // Free slot
          if (appointment.slotId) {
            await tx.vetSlot.update({
              where: { id: appointment.slotId },
              data: { status: 'AVAILABLE' },
            });
          }

          // Cancel BullMQ scheduled reminder/no-show jobs
          if (appointment.consultation?.id) {
            await this.cancelReminderJobs(appointment.consultation.id);
            await this.refundEscrowTransaction(tx, appointment.consultation.id, cancelReason);
          }

          // Notify both parties
          const cancelPayload = {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            cancelledBy,
            reason: cancelReason,
          };

          this.emitToUser(appointment.ownerId, 'consultation.cancelled', cancelPayload);
          this.emitToUser(appointment.vet.userId, 'consultation.cancelled', cancelPayload);
          this.emitToRoom(`consultation:${appointment.consultation?.id}`, 'consultation.cancelled', cancelPayload);

          await tx.notification.createMany({
            data: [
              {
                userId: appointment.ownerId,
                title: 'Consultation Cancelled',
                body: `The consultation has been cancelled. Reason: ${cancelReason}`,
                type: 'APPOINTMENT',
              },
              {
                userId: appointment.vet.userId,
                title: 'Consultation Cancelled',
                body: `The consultation has been cancelled. Reason: ${cancelReason}`,
                type: 'APPOINTMENT',
              },
            ],
          });
          break;
        }

        case 'RESCHEDULED': {
          const res = metadata?.reschedule;
          if (!res) {
            throw new BadRequestException('Reschedule metadata is required to transition to RESCHEDULED');
          }

          updateData.rescheduleRequest = {
            requestedBy: res.requestedBy,
            oldStart: res.oldStart.toISOString(),
            oldEnd: res.oldEnd.toISOString(),
            newStart: res.newStart.toISOString(),
            newEnd: res.newEnd.toISOString(),
            status: 'PENDING',
          };

          consultationUpdateData.status = 'SCHEDULED'; // Keep consultation in non-live state

          // Free slot
          if (appointment.slotId) {
            await tx.vetSlot.update({
              where: { id: appointment.slotId },
              data: { status: 'AVAILABLE' },
            });
          }

          // Cancel existing scheduled BullMQ reminder/no-show jobs
          if (appointment.consultation?.id) {
            await this.cancelReminderJobs(appointment.consultation.id);
          }

          // Notify the other party
          const targetUserId =
            res.requestedBy === 'CLIENT' ? appointment.vet.userId : appointment.ownerId;
          const requestorName =
            res.requestedBy === 'CLIENT'
              ? `${appointment.owner.firstName} ${appointment.owner.lastName}`
              : `Dr. ${appointment.vet.user.firstName} ${appointment.vet.user.lastName}`;

          this.emitToUser(targetUserId, 'consultation.rescheduled', {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            requestedBy: res.requestedBy,
            newStart: res.newStart.toISOString(),
          });

          await tx.notification.create({
            data: {
              userId: targetUserId,
              title: 'Reschedule Requested',
              body: `${requestorName} has requested to reschedule the appointment to ${res.newStart.toLocaleString()}.`,
              type: 'APPOINTMENT',
            },
          });
          break;
        }

        case 'NO_SHOW': {
          updateData.noShowParty = metadata?.noShowParty || 'CLIENT';
          consultationUpdateData.status = 'CANCELLED';
          consultationUpdateData.cancellationReason =
            updateData.noShowParty === 'CLIENT' ? 'CUSTOMER_NO_SHOW' : 'VET_NO_SHOW';

          // Free slot
          if (appointment.slotId) {
            await tx.vetSlot.update({
              where: { id: appointment.slotId },
              data: { status: 'AVAILABLE' },
            });
          }

          // Notify both parties
          const noShowPayload = {
            appointmentId: appointment.id,
            consultationId: appointment.consultation?.id,
            noShowParty: updateData.noShowParty,
          };

          this.emitToUser(appointment.ownerId, 'consultation.no_show', noShowPayload);
          this.emitToUser(appointment.vet.userId, 'consultation.no_show', noShowPayload);

          // Trigger payouts or refunds based on who was absent
          if (appointment.consultation?.id) {
            if (updateData.noShowParty === 'CLIENT') {
              await this.releaseEscrowTransaction(tx, appointment.consultation.id);
            } else {
              await this.refundEscrowTransaction(tx, appointment.consultation.id, 'VET_NO_SHOW');
            }
          }

          await tx.notification.createMany({
            data: [
              {
                userId: appointment.ownerId,
                title: 'No-Show Recorded',
                body: `A no-show has been logged for this consultation (${updateData.noShowParty} was absent).`,
                type: 'APPOINTMENT',
              },
              {
                userId: appointment.vet.userId,
                title: 'No-Show Recorded',
                body: `A no-show has been logged for this consultation (${updateData.noShowParty} was absent).`,
                type: 'APPOINTMENT',
              },
            ],
          });
          break;
        }
      }

      // 4. Perform database updates
      const updatedAppt = await tx.appointment.update({
        where: { id: appointmentId },
        data: updateData,
      });

      if (appointment.consultation?.id) {
        await tx.consultation.update({
          where: { id: appointment.consultation.id },
          data: consultationUpdateData,
        });
      }

      return updatedAppt;
    };

    if (txConnection) {
      return execute(txConnection);
    } else {
      return this.prisma.$transaction(execute, {
        timeout: 15000,
      });
    }
  }

  /**
   * scheduleReminderJobs schedules automated reminders using BullMQ
   */
  async scheduleReminderJobs(consultationId: string, scheduledAt: Date, tx: any) {
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
        this.logger.log(`Scheduled reminder ${t.label} for Consultation ${consultationId} in ${delay}ms`);
      }
    }

    const graceMinutes =
      this.configService.get<number>('telemedicine.noShowGracePeriodMinutes') ?? 15;
    const noShowDelay = startTime + graceMinutes * 60 * 1000 - now;
    if (noShowDelay > 0) {
      await this.lifecycleQueue.add(
        'consultation-no-show-job',
        { consultationId, type: 'no-show' },
        { delay: noShowDelay, jobId: `no-show-${consultationId}` },
      );
      this.logger.log(`Scheduled no-show check for Consultation ${consultationId} in ${noShowDelay}ms`);
    }
  }

  /**
   * cancelReminderJobs cancels all pending reminder/no-show BullMQ jobs for a consultation
   */
  async cancelReminderJobs(consultationId: string) {
    this.logger.log(`Cancelling scheduled BullMQ reminder jobs for Consultation ${consultationId}`);
    const timings = ['24h', '1h', '15m', '5m'];
    for (const label of timings) {
      const jobId = `reminder-${consultationId}-${label}`;
      try {
        const job = await this.lifecycleQueue.getJob(jobId);
        if (job) {
          await job.remove();
          this.logger.log(`Removed BullMQ job ${jobId}`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to cancel BullMQ job ${jobId}: ${err.message}`);
      }
    }
    const noShowJobId = `no-show-${consultationId}`;
    try {
      const noShowJob = await this.lifecycleQueue.getJob(noShowJobId);
      if (noShowJob) {
        await noShowJob.remove();
        this.logger.log(`Removed BullMQ job ${noShowJobId}`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to cancel BullMQ no-show job ${noShowJobId}: ${err.message}`);
    }
  }

  /**
   * refundEscrowTransaction process escrow refunds when a booking is cancelled
   */
  async refundEscrowTransaction(
    tx: any,
    consultationId: string,
    cancellationReason?: string,
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

    const refundRef = `REFUND-${payment.reference}`;
    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: cancellationReason || 'Refund',
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

  /**
   * releaseEscrowTransaction releases payment from escrow to the vet's balance
   */
  async releaseEscrowTransaction(
    tx: any,
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
}
