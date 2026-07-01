import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { PaymentEventEmitter } from '../../src/modules/payments/events/payment-event.emitter';
import { NotificationsQueueService } from '../queues/notifications-queue/notifications-queue.service';
import { PrismaService } from '../prisma/prisma.service';

@Processor('outbox-events')
export class OutboxWorker extends WorkerHost {
  private readonly logger = new Logger(OutboxWorker.name);

  constructor(
    @Inject(forwardRef(() => PaymentEventEmitter))
    private readonly paymentEventEmitter: PaymentEventEmitter,
    private readonly notificationsQueue: NotificationsQueueService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }
  
  async process(job: Job<{ eventId: string; type: string; payload: any }>): Promise<any> {
    const { eventId, type, payload } = job.data;
    
    this.logger.log(`[Queue Worker] Processing outbox event job ${job.id} | Event ID: ${eventId}`);
    
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
          // 1. Email to Buyer
          const itemsList = order.items.map(item => ({
            name: item.vendorProduct.product.name,
            quantity: item.quantity,
            price: Number(item.unitPrice),
          }));
          
          await this.notificationsQueue.queueEmail(
            order.user.email,
            'Your VetsBridge Order Receipt 📦',
            'ORDER_CONFIRMED_BUYER',
            {
              orderId: order.id,
              buyerName: `${order.user.firstName} ${order.user.lastName}`,
              items: itemsList,
              subtotal: Number(order.subtotal),
              shippingCost: Number(order.shippingCost),
              totalAmount: Number(order.totalAmount),
              shippingAddress: order.shippingAddress 
                ? `${order.shippingAddress.street1}, ${order.shippingAddress.city}, ${order.shippingAddress.state}`
                : 'N/A',
            }
          );

          // 2. Email to Vendors (group items by vendor ID)
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
        this.logger.log(`[Queue Worker] [USER_PASSWORD_RESET] Queuing password reset notification for User ID ${payload.userId}`);
        const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
        if (user) {
          await this.notificationsQueue.queueEmail(
            user.email,
            'VetsBridge Account Password Reset 🔐',
            'USER_PASSWORD_RESET',
            {
              name: `${user.firstName} ${user.lastName}`,
              newPassword: payload.newPassword,
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

      case 'PAYMENT_COMPLETED':
        this.logger.log(`[Queue Worker] [PAYMENT_COMPLETED] Payment verified server-side. Reference: ${payload.reference}, Amount: ${payload.amount}`);
        this.paymentEventEmitter.emit('payment.completed', payload);
        break;
        
      default:
        this.logger.log(`[Queue Worker] [DISPATCH] Event type "${type}" successfully dispatched. Payload: ${JSON.stringify(payload)}`);
    }
    
    return { dispatched: true, eventId };
  }
}
