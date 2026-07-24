import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { LedgerService } from '../../payments/services/ledger.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import {
  Prisma,
  LedgerAccountType,
  ShippingMethod,
  ShippingStrategy,
} from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  MARKETPLACE_ORDERS_PLACED_TOTAL,
  MARKETPLACE_ORDERS_COMPLETED_TOTAL,
  MARKETPLACE_ORDERS_CANCELLED_TOTAL,
} from '../../../monitoring/metrics/business.metrics';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}

  async placeOrder(userId: string, dto: PlaceOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      let subtotalAmount = new Prisma.Decimal(0);
      let shippingCostAmount = new Prisma.Decimal(0);

      // Group products by vendor to perform grouped shipping calculations
      const vendorGroups = new Map<
        string,
        {
          vendorName: string;
          shippingProfile?: any;
          items: Array<{
            vendorProductId: string;
            quantity: number;
            unitPrice: Prisma.Decimal;
            totalPrice: Prisma.Decimal;
          }>;
        }
      >();

      for (const item of dto.items) {
        const vendorProduct = await tx.vendorProduct.findUnique({
          where: { id: item.vendorProductId },
          include: {
            product: true,
            vendor: {
              include: {
                shippingProfile: true,
              },
            },
          },
        });

        if (!vendorProduct) {
          throw new BadRequestException(
            `Vendor product ${item.vendorProductId} not found`,
          );
        }

        if (vendorProduct.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product listing ${item.vendorProductId}`,
          );
        }

        // Deduct stock with optimistic concurrency control
        const updated = await tx.vendorProduct.updateMany({
          where: {
            id: vendorProduct.id,
            version: vendorProduct.version,
          },
          data: {
            stock: vendorProduct.stock - item.quantity,
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            `Product stock has changed. Please try placing your order again.`,
          );
        }

        const itemSubtotal = vendorProduct.price.mul(item.quantity);
        subtotalAmount = subtotalAmount.add(itemSubtotal);

        const vendorId = vendorProduct.vendorId;
        if (!vendorGroups.has(vendorId)) {
          vendorGroups.set(vendorId, {
            vendorName: vendorProduct.vendor.businessName || 'Unnamed Vendor',
            shippingProfile: vendorProduct.vendor.shippingProfile,
            items: [],
          });
        }

        vendorGroups.get(vendorId)!.items.push({
          vendorProductId: vendorProduct.id,
          quantity: item.quantity,
          unitPrice: vendorProduct.price,
          totalPrice: itemSubtotal,
        });
      }

      // Read shipment preferences mapping
      const prefMap = new Map<string, ShippingMethod>();
      if (dto.shipmentPreferences) {
        for (const pref of dto.shipmentPreferences) {
          prefMap.set(pref.vendorId, pref.method);
        }
      }

      const calculatedShipments: Array<{
        vendorId: string;
        shippingFee: Prisma.Decimal;
        shippingMethod: ShippingMethod;
        estimatedDeliveryDays: number;
        items: any[];
      }> = [];

      let hasDelivery = false;

      for (const [vendorId, group] of vendorGroups.entries()) {
        const profile = group.shippingProfile;
        const totalQty = group.items.reduce((sum, i) => sum + i.quantity, 0);
        const groupSubtotal = group.items.reduce(
          (sum, i) => sum.add(i.totalPrice),
          new Prisma.Decimal(0),
        );

        let method = prefMap.get(vendorId) || ShippingMethod.DELIVERY;
        // Verify if vendor shipping profile supports pickup. Default to DELIVERY if not.
        if (
          method === ShippingMethod.PICKUP &&
          (!profile || !profile.supportsPickup)
        ) {
          method = ShippingMethod.DELIVERY;
        }

        if (method === ShippingMethod.DELIVERY) {
          hasDelivery = true;
        }

        let shippingFee = new Prisma.Decimal(0);
        let deliveryDays = 3;

        if (method === ShippingMethod.DELIVERY && profile) {
          deliveryDays = profile.estimatedDeliveryDays;
          const baseFee = new Prisma.Decimal(profile.baseShippingFee);
          const additionalFee = new Prisma.Decimal(profile.additionalItemFee);
          const threshold = profile.freeShippingThreshold
            ? new Prisma.Decimal(profile.freeShippingThreshold)
            : null;

          if (threshold !== null && groupSubtotal.gte(threshold)) {
            shippingFee = new Prisma.Decimal(0); // Free shipping threshold met
          } else if (profile.shippingStrategy === ShippingStrategy.FLAT_RATE) {
            shippingFee = baseFee;
          } else if (
            profile.shippingStrategy === ShippingStrategy.BASE_ADDITIONAL
          ) {
            shippingFee = baseFee.add(additionalFee.mul(totalQty - 1));
          }
        }

        shippingCostAmount = shippingCostAmount.add(shippingFee);

        calculatedShipments.push({
          vendorId,
          shippingFee,
          shippingMethod: method,
          estimatedDeliveryDays: deliveryDays,
          items: group.items,
        });
      }

      // Authoritative validation of shipping address requirements
      if (hasDelivery) {
        if (!dto.shippingAddressId) {
          throw new BadRequestException(
            'Shipping address is required for items requiring delivery',
          );
        }

        const address = await tx.address.findFirst({
          where: { id: dto.shippingAddressId, userId, deletedAt: null },
        });

        if (!address) {
          throw new BadRequestException('Invalid shipping address');
        }
      }

      const totalAmount = subtotalAmount.add(shippingCostAmount);

      // Create Order record
      const order = await tx.order.create({
        data: {
          userId,
          totalAmount,
          subtotal: subtotalAmount,
          shippingCost: shippingCostAmount,
          status: 'PENDING',
          shippingAddressId: hasDelivery ? dto.shippingAddressId : null,
        },
      });

      // Create Shipment records and OrderItems mapping relationally
      for (const cs of calculatedShipments) {
        const estDelivery =
          cs.shippingMethod === ShippingMethod.PICKUP
            ? null
            : new Date(
                Date.now() + cs.estimatedDeliveryDays * 24 * 60 * 60 * 1000,
              );

        const shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            vendorId: cs.vendorId,
            status: 'PENDING',
            shippingFee: cs.shippingFee,
            shippingMethod: cs.shippingMethod,
            estimatedDeliveryDays: cs.estimatedDeliveryDays,
            estimatedDelivery: estDelivery,
          },
        });

        for (const item of cs.items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              vendorProductId: item.vendorProductId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              shipmentId: shipment.id,
            },
          });
        }
      }

      // Outbox event
      await tx.outboxEvent.create({
        data: {
          type: 'ORDER_PLACED',
          payload: {
            orderId: order.id,
            userId,
            totalAmount: totalAmount.toString(),
            subtotal: subtotalAmount.toString(),
            shippingCost: shippingCostAmount.toString(),
          },
        },
      });

      this.monitoringService?.incrementCounter(MARKETPLACE_ORDERS_PLACED_TOTAL, 1);

      return tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: true,
          shipments: true,
        },
      });
    });
  }

  async getMyOrders(
    userId: string,
    pagination: PaginationDto,
    status?: string,
  ) {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const dbStatus =
      status === 'ALL' || !status ? undefined : status.toUpperCase();
    let prismaStatus: any = undefined;
    if (dbStatus) {
      if (dbStatus === 'PROCESSING') prismaStatus = 'PAID';
      else if (dbStatus === 'DELIVERED') prismaStatus = 'COMPLETED';
      else prismaStatus = dbStatus;
    }

    const where = {
      userId,
      ...(prismaStatus && { status: prismaStatus }),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          shippingAddress: true,
          items: {
            include: {
              vendorProduct: {
                include: { product: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({
        where,
      }),
    ]);

    return {
      orders,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async updateOrderStatus(user: any, orderId: string, status: any) {
    const validStatuses = [
      'PENDING',
      'PAID',
      'CONFIRMED',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid order status: ${status}`);
    }

    const ALLOWED_TRANSITIONS: Record<string, string[]> = {
      PENDING: ['PAID', 'CANCELLED'],
      PAID: ['CONFIRMED', 'PROCESSING', 'CANCELLED', 'REFUNDED'],
      CONFIRMED: ['PROCESSING', 'SHIPPED', 'CANCELLED', 'REFUNDED'],
      PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
      SHIPPED: ['DELIVERED', 'REFUNDED'],
      DELIVERED: ['COMPLETED', 'REFUNDED'],
      COMPLETED: [],
      CANCELLED: [],
      REFUNDED: [],
    };

    let targetOrderId = orderId;
    let order = await this.prisma.order.findUnique({
      where: { id: targetOrderId },
      include: {
        items: {
          include: {
            vendorProduct: true,
          },
        },
      },
    });

    if (!order) {
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: orderId },
        include: {
          order: {
            include: {
              items: {
                include: {
                  vendorProduct: true,
                },
              },
            },
          },
        },
      });
      if (orderItem) {
        order = orderItem.order;
        targetOrderId = orderItem.orderId;
      }
    }

    if (!order) {
      throw new NotFoundException(`Order ${targetOrderId} not found`);
    }

    // Role check and authorization
    if (user.isAdmin) {
      // Admins are allowed to perform any transition
    } else if (user.vendorProfile) {
      // Vendor authorization
      const vendorId = user.vendorProfile.id;
      const ownsItem = order.items.some(
        (item) => item.vendorProduct.vendorId === vendorId,
      );
      if (!ownsItem) {
        throw new ForbiddenException(
          'You do not have permission to update this order status',
        );
      }

      // Vendors cannot change status to PAID, REFUNDED, or CANCELLED
      if (['PAID', 'REFUNDED', 'CANCELLED'].includes(status)) {
        throw new ForbiddenException(
          `Vendors are not authorized to transition order to ${status}`,
        );
      }
    } else {
      // Buyer authorization
      if (order.userId !== user.id) {
        throw new ForbiddenException(
          'You do not have permission to update this order status',
        );
      }
      // Buyers can only cancel or mark as completed
      if (status !== 'CANCELLED' && status !== 'COMPLETED') {
        throw new ForbiddenException(
          `Buyers are not authorized to transition order to ${status}`,
        );
      }
    }

    // Enforce state transitions
    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: targetOrderId },
        data: { status },
      });

      // If status transitions to DELIVERED or COMPLETED, release escrow
      if (status === 'DELIVERED' || status === 'COMPLETED') {
        const payment = await tx.payment.findFirst({
          where: {
            orderId: order.id,
            status: 'PAID_IN_ESCROW',
          },
        });

        if (payment) {
          const commissionSetting = await tx.systemSetting.findUnique({
            where: { key: 'commission_rate' },
          });
          const commissionPercent = parseFloat(commissionSetting?.value || '5');

          for (const item of order.items) {
            const itemAmount = new Prisma.Decimal(item.totalPrice || 0);
            const itemPlatformFee = itemAmount.mul(commissionPercent / 100);

            // Pass the item's unique id to prevent reference collisions in multi-item orders
            await this.ledgerService.releaseEscrow(
              tx,
              payment.id,
              itemAmount,
              item.vendorProduct.vendorId,
              itemPlatformFee,
              LedgerAccountType.VENDOR_BALANCE,
              item.id,
            );
          }

          // Fetch shipments for this order to release shipping costs
          const shipments = await tx.shipment.findMany({
            where: { orderId: order.id },
          });

          for (const shipment of shipments) {
            const shipmentFee = new Prisma.Decimal(shipment.shippingFee || 0);
            if (shipmentFee.gt(0)) {
              // Settle shipment fee snapshot at 0% platform commission!
              await this.ledgerService.releaseEscrow(
                tx,
                payment.id,
                shipmentFee,
                shipment.vendorId,
                new Prisma.Decimal(0),
                LedgerAccountType.VENDOR_BALANCE,
                `shipping-${shipment.id}`,
              );
            }
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'RELEASED' },
          });
        }
      }

      return updated;
    });
  }

  async deleteOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId, userId },
        include: { items: true },
      });

      if (!order)
        throw new BadRequestException('Order not found or access denied');
      if (order.status !== 'PENDING')
        throw new BadRequestException('Only pending orders can be deleted');

      // Restore stock optimistically
      for (const item of order.items) {
        await tx.vendorProduct.updateMany({
          where: { id: item.vendorProductId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.orderItem.deleteMany({
        where: { orderId },
      });

      return tx.order.delete({
        where: { id: orderId },
      });
    });
  }
}
