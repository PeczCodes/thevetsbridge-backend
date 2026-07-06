import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PaymentEventEmitter } from '../../src/modules/payments/events/payment-event.emitter';
import { NotificationsQueueService } from '../queues/notifications-queue/notifications-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_ADAPTER, StorageAdapter } from '../../src/modules/media/ports/storage-adapter.interface';
import { RedisService } from '../redis/redis.service';
import { EncryptionService } from '../security/encryption.service';

@Processor('outbox-events')
export class OutboxWorker extends WorkerHost {
  private readonly logger = new Logger(OutboxWorker.name);

  constructor(
    @Inject(forwardRef(() => PaymentEventEmitter))
    private readonly paymentEventEmitter: PaymentEventEmitter,
    private readonly notificationsQueue: NotificationsQueueService,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: any,
    private readonly redisService: RedisService,
    @InjectQueue('payout-queue') private readonly payoutQueue: Queue,
    private readonly encryptionService: EncryptionService,
  ) {
    super();
  }
  
  async process(job: Job<{ eventId: string; type: string; payload: any }>): Promise<any> {
    const { eventId, type, payload } = job.data;
    
    this.logger.log(`[Queue Worker] Processing outbox event job ${job.id} | Event ID: ${eventId}`);

    const redisKey = `outbox:processed:${eventId}`;
    if (this.redisService.isAvailable()) {
      const isProcessed = await this.redisService.getClient().get(redisKey);
      if (isProcessed) {
        this.logger.log(`[Queue Worker] Event ${eventId} has already been processed (idempotency check). Skipping.`);
        return { skipped: true, reason: 'Already processed' };
      }
    }
    
    switch (type) {
      case 'USER_REGISTERED': {
        this.logger.log(`[Queue Worker] [USER_REGISTERED] Queuing onboarding welcome email to ${payload.email}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'Welcome to VetsBridge! 🐾',
            'WELCOME',
            {
              name: `${user.firstName} ${user.lastName}`,
              role: payload.hasVetProfile ? 'VET' : (payload.hasVendorProfile ? 'VENDOR' : 'CUSTOMER'),
            }
          );
        }
        break;
      }
        
      case 'ORDER_PLACED': {
        // NOTE: We do NOT send the buyer a confirmation email here — payment has not been made yet.
        // The ORDER_CONFIRMED_BUYER email is sent in PAYMENT_COMPLETED, after Paystack verifies the payment.
        this.logger.log(`[Queue Worker] [ORDER_PLACED] Querying details for Order ID: ${payload.orderId}`);
        const order = await this.prisma.order.findUnique({
          where: { id: payload.orderId },
          include: {
            user: true,
            shippingAddress: true,
            items: {
              include: {
                vendorProduct: {
                  include: {
                    product: true,
                    vendor: { include: { user: true } }
                  }
                }
              }
            }
          }
        });
        
        if (order) {
          // Email to Vendors only (group items by vendor ID)
          const vendorMap = new Map<string, typeof order.items>();
          for (const item of order.items) {
            const vendorId = item.vendorProduct.vendorId;
            if (!vendorMap.has(vendorId)) {
              vendorMap.set(vendorId, []);
            }
            vendorMap.get(vendorId)!.push(item);
          }

          for (const [vendorId, vendorItems] of vendorMap.entries()) {
            const vendor = vendorItems[0].vendorProduct.vendor;
            const vendorEmail = vendor.user.email;
            const vendorItemsList = vendorItems.map(item => ({
              name: item.vendorProduct.product.name,
              quantity: item.quantity,
              price: Number(item.unitPrice),
            }));

            await this.notificationsQueue.queueEmail(
              vendorEmail,
              'New Customer Order Received! 🎉',
              'ORDER_RECEIVED_VENDOR',
              {
                orderId: order.id,
                vendorBusinessName: vendor.businessName || 'Your Business',
                items: vendorItemsList,
                shippingAddress: order.shippingAddress 
                  ? `${order.shippingAddress.street1}, ${order.shippingAddress.city}, ${order.shippingAddress.state}`
                  : 'N/A',
              }
            );
          }
        }
        break;
      }
        
      case 'CONSULTATION_SCHEDULED': {
        this.logger.log(`[Queue Worker] [CONSULTATION_SCHEDULED] Scheduling calendar slot and sending email reminders for Consultation ID: ${payload.consultationId}`);
        const consultation = await this.prisma.consultation.findUnique({
          where: { id: payload.consultationId },
          include: {
            customer: true,
            vet: { include: { user: true } },
            animal: true,
          }
        });
        
        if (consultation) {
          const scheduledTime = consultation.scheduledAt ? new Date(consultation.scheduledAt).toLocaleString() : 'N/A';
          // 1. Email to Customer
          await this.notificationsQueue.queueEmail(
            consultation.customer.email,
            'Your Consultation is Scheduled! 🗓️',
            'CONSULTATION_SCHEDULED_CUSTOMER',
            {
              customerName: `${consultation.customer.firstName} ${consultation.customer.lastName}`,
              vetName: `${consultation.vet.user.firstName} ${consultation.vet.user.lastName}`,
              animalName: consultation.animal?.name || 'Your Animal',
              scheduledTime,
              mode: consultation.mode,
            }
          );

          // 2. Email to Vet
          await this.notificationsQueue.queueEmail(
            consultation.vet.user.email,
            'New Consultation Booking Scheduled! 🗓️',
            'CONSULTATION_SCHEDULED_VET',
            {
              vetName: `${consultation.vet.user.firstName} ${consultation.vet.user.lastName}`,
              customerName: `${consultation.customer.firstName} ${consultation.customer.lastName}`,
              animalName: consultation.animal?.name || 'Patient',
              scheduledTime,
              mode: consultation.mode,
            }
          );

          // 3. 1-Hour Reminder Emails (delayed BullMQ jobs)
          const scheduledDate = consultation.scheduledAt ? new Date(consultation.scheduledAt) : null;
          if (scheduledDate) {
            const oneHourInMs = 60 * 60 * 1000;
            const timeDifference = scheduledDate.getTime() - Date.now();
            
            // Only schedule if the session is scheduled at least 1 hour and 5 minutes from now
            // to avoid sending duplicate emails back-to-back.
            if (timeDifference > oneHourInMs + 5 * 60 * 1000) {
              const delay = timeDifference - oneHourInMs;

              await this.notificationsQueue.queueEmail(
                consultation.customer.email,
                'Reminder: Your Consultation starts in 1 hour! 🐾',
                'CONSULTATION_REMINDER_CUSTOMER',
                {
                  consultationId: consultation.id,
                  customerName: `${consultation.customer.firstName} ${consultation.customer.lastName}`,
                  vetName: `${consultation.vet.user.firstName} ${consultation.vet.user.lastName}`,
                  animalName: consultation.animal?.name || 'Your Animal',
                  scheduledTime,
                  mode: consultation.mode,
                },
                { delay }
              );

              await this.notificationsQueue.queueEmail(
                consultation.vet.user.email,
                'Reminder: Patient Consultation starts in 1 hour! 🗓️',
                'CONSULTATION_REMINDER_VET',
                {
                  consultationId: consultation.id,
                  vetName: `${consultation.vet.user.firstName} ${consultation.vet.user.lastName}`,
                  customerName: `${consultation.customer.firstName} ${consultation.customer.lastName}`,
                  animalName: consultation.animal?.name || 'Patient',
                  scheduledTime,
                  mode: consultation.mode,
                },
                { delay }
              );
            }
          }
        }
        break;
      }

      case 'VET_PROFILE_APPROVED': {
        this.logger.log(`[Queue Worker] [VET_PROFILE_APPROVED] Queuing approval notification for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'Your Veterinarian Profile is Approved! 🎉',
            'PROFILE_APPROVED',
            {
              name: `${user.firstName} ${user.lastName}`,
              profileType: 'Veterinarian',
            }
          );
        }
        break;
      }

      case 'VET_PROFILE_REJECTED': {
        this.logger.log(`[Queue Worker] [VET_PROFILE_REJECTED] Queuing rejection notification for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'Action Required: Profile Application Update ⚠️',
            'PROFILE_REJECTED',
            {
              name: `${user.firstName} ${user.lastName}`,
              profileType: 'Veterinarian',
              rejectionReason: payload.rejectionReason,
            }
          );
        }
        break;
      }

      case 'VENDOR_PROFILE_APPROVED': {
        this.logger.log(`[Queue Worker] [VENDOR_PROFILE_APPROVED] Queuing approval notification for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'Your Vendor Profile is Approved! 🎉',
            'PROFILE_APPROVED',
            {
              name: `${user.firstName} ${user.lastName}`,
              profileType: 'Vendor',
            }
          );
        }
        break;
      }

      case 'VENDOR_PROFILE_REJECTED': {
        this.logger.log(`[Queue Worker] [VENDOR_PROFILE_REJECTED] Queuing rejection notification for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'Action Required: Profile Application Update ⚠️',
            'PROFILE_REJECTED',
            {
              name: `${user.firstName} ${user.lastName}`,
              profileType: 'Vendor',
              rejectionReason: payload.rejectionReason,
            }
          );
        }
        break;
      }

      case 'USER_PASSWORD_RESET': {
        this.logger.log(`[Queue Worker] [USER_PASSWORD_RESET] Decrypting token and queuing password reset email for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          const rawToken = payload.encryptedToken 
            ? this.encryptionService.decrypt(payload.encryptedToken) 
            : payload.token; // Fallback to plain token if admin-initiated / legacy
          await this.notificationsQueue.queueEmail(
            user.email,
            'VetsBridge Account Password Reset 🔐',
            'USER_PASSWORD_RESET',
            {
              name: `${user.firstName} ${user.lastName}`,
              token: rawToken,
            }
          );
        }
        break;
      }

      case 'USER_STATUS_CHANGED': {
        this.logger.log(`[Queue Worker] [USER_STATUS_CHANGED] Queuing account status change notification for User ID ${payload.userId} (Active: ${payload.isActive})`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            payload.isActive ? 'VetsBridge Account Re-activated! 🎉' : 'VetsBridge Account Suspended ⚠️',
            'USER_STATUS_CHANGED',
            {
              name: `${user.firstName} ${user.lastName}`,
              isActive: payload.isActive,
            }
          );
        }
        break;
      }

      case 'PRESCRIPTION_CREATED':
        this.logger.log(`[Queue Worker] [PRESCRIPTION_CREATED] Generating digital prescription download link for Animal ID: ${payload.animalId}`);
        break;

      case 'PAYMENT_COMPLETED': {
        this.logger.log(`[Queue Worker] [PAYMENT_COMPLETED] Payment verified server-side. Reference: ${payload.reference}, Amount: ${payload.amount}`);
        this.paymentEventEmitter.emit('payment.completed', payload);

        // Send ORDER_CONFIRMED_BUYER email now that payment is verified
        if (payload.purpose === 'ORDER' && payload.orderId) {
          this.logger.log(`[Queue Worker] [PAYMENT_COMPLETED] Queuing order confirmation email for Order ID: ${payload.orderId}`);
          const paidOrder = await this.prisma.order.findUnique({
            where: { id: payload.orderId },
            include: {
              user: true,
              shippingAddress: true,
              items: {
                include: {
                  vendorProduct: {
                    include: { product: true }
                  }
                }
              }
            }
          });

          if (paidOrder) {
            const itemsList = paidOrder.items.map(item => ({
              name: item.vendorProduct.product.name,
              quantity: item.quantity,
              price: Number(item.unitPrice),
            }));

            await this.notificationsQueue.queueEmail(
              paidOrder.user.email,
              'Your VetsBridge Order is Confirmed! 📦',
              'ORDER_CONFIRMED_BUYER',
              {
                orderId: paidOrder.id,
                buyerName: `${paidOrder.user.firstName} ${paidOrder.user.lastName}`,
                items: itemsList,
                subtotal: Number(paidOrder.subtotal),
                shippingCost: Number(paidOrder.shippingCost),
                totalAmount: Number(paidOrder.totalAmount),
                shippingAddress: paidOrder.shippingAddress
                  ? `${paidOrder.shippingAddress.street1}, ${paidOrder.shippingAddress.city}, ${paidOrder.shippingAddress.state}`
                  : 'N/A',
              }
            );
          }
        }
        break;
      }

      case 'WITHDRAWAL_REQUESTED': {
        this.logger.log(`[Queue Worker] [WITHDRAWAL_REQUESTED] Queueing background payout for Transaction ID: ${payload.transactionId}`);
        await this.payoutQueue.add(
          'process-payout',
          {
            transactionId: payload.transactionId,
          },
          {
            jobId: payload.transactionId, // Deduplicate queue jobs
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          }
        );
        break;
      }

      case 'MEDIA_DELETED':
        this.logger.log(`[Queue Worker] [MEDIA_DELETED] Deleting asset from storage: ${payload.publicId}`);
        try {
          await this.storageAdapter.deleteAsset(payload.publicId);
        } catch (err: any) {
          this.logger.error(`Failed to delete asset ${payload.publicId}: ${err.message}`);
        }
        break;
        
      default:
        this.logger.log(`[Queue Worker] [DISPATCH] Event type "${type}" successfully dispatched. Payload: ${JSON.stringify(payload)}`);
    }
    
    if (this.redisService.isAvailable()) {
      await this.redisService.getClient().set(redisKey, 'true', 'EX', 7 * 24 * 60 * 60); // 7 days TTL
    }
    
    return { dispatched: true, eventId };
  }
}
