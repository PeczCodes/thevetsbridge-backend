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
  OrderStatus,
  ShipmentStatus,
  PaymentStatus,
  VendorShippingProfile,
} from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  MARKETPLACE_ORDERS_PLACED_TOTAL,
  MARKETPLACE_ORDERS_COMPLETED_TOTAL,
  MARKETPLACE_ORDERS_CANCELLED_TOTAL,
} from '../../../monitoring/metrics/business.metrics';
import {
  OrderUserPayload,
  ORDER_ALLOWED_TRANSITIONS,
  SHIPMENT_ALLOWED_TRANSITIONS,
} from './types/order.types';
import {
  calculateOrderShipments,
  VendorGroup,
  VendorGroupItem,
} from './utils/shipping-calculator.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}

  async placeOrder(userId: string, dto: PlaceOrderDto) {
    const createdOrder = await this.prisma.$transaction(async (tx) => {
      let subtotalAmount = new Prisma.Decimal(0);

      // Group products by vendor to perform grouped shipping calculations
      const vendorGroups = new Map<string, VendorGroup>();

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

      // Extract shipping calculation to modular utility
      const { calculatedShipments, shippingCostAmount, hasDelivery } =
        calculateOrderShipments(vendorGroups, prefMap);

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
          status: OrderStatus.PENDING,
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
            status: ShipmentStatus.PENDING,
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

      return tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: true,
          shipments: true,
        },
      });
    });

    // Record monitoring metric safely OUTSIDE the transaction
    this.recordMetric(MARKETPLACE_ORDERS_PLACED_TOTAL, 1);

    return createdOrder;
  }

  async getMyOrders(
    userId: string,
    pagination: PaginationDto,
    status?: string,
  ) {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    let prismaStatus: OrderStatus | undefined = undefined;
    if (status && status !== 'ALL') {
      const normalized = status.toUpperCase();
      if (Object.values(OrderStatus).includes(normalized as OrderStatus)) {
        prismaStatus = normalized as OrderStatus;
      }
    }

    const where: Prisma.OrderWhereInput = {
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
          shipments: true,
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

  /**
   * Updates order or vendor shipment status in a concurrency-safe manner.
   * If a vendor invokes this, it operates strictly on the vendor's shipment,
   * avoiding unauthorized changes to the whole multi-vendor order.
   */
  async updateOrderStatus(
    user: OrderUserPayload,
    targetId: string,
    statusInput?: string,
  ) {
    if (!statusInput) {
      throw new BadRequestException('Status is required');
    }

    const normalizedStatus = statusInput.trim().toUpperCase();

    // 1. Resolve whether targetId is a shipment, orderItem, or order
    const resolution = await this.resolveTargetEntity(targetId, user);

    let metricToRecord: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      if (resolution.type === 'SHIPMENT') {
        const { shipment, order } = resolution;
        const currentShipmentStatus = shipment.status;
        const targetShipmentStatus = normalizedStatus as ShipmentStatus;

        if (!Object.values(ShipmentStatus).includes(targetShipmentStatus)) {
          throw new BadRequestException(
            `Invalid shipment status: ${normalizedStatus}. Valid: ${Object.values(ShipmentStatus).join(', ')}`,
          );
        }

        // Validate allowed shipment transitions
        const allowedTransitions =
          SHIPMENT_ALLOWED_TRANSITIONS[currentShipmentStatus] || [];
        if (!allowedTransitions.includes(targetShipmentStatus)) {
          throw new BadRequestException(
            `Cannot transition shipment from ${currentShipmentStatus} to ${targetShipmentStatus}`,
          );
        }

        // Concurrency-safe conditional update on shipment
        const updatedCount = await tx.shipment.updateMany({
          where: {
            id: shipment.id,
            status: currentShipmentStatus,
          },
          data: {
            status: targetShipmentStatus,
            ...(targetShipmentStatus === ShipmentStatus.SHIPPED && !shipment.shippedAt
              ? { shippedAt: new Date() }
              : {}),
            ...(targetShipmentStatus === ShipmentStatus.DELIVERED &&
            !shipment.deliveredAt
              ? { deliveredAt: new Date() }
              : {}),
          },
        });

        if (updatedCount.count === 0) {
          throw new ConflictException(
            'Shipment status was concurrently modified. Please reload and try again.',
          );
        }

        // Record shipment event
        await tx.shipmentEvent.create({
          data: {
            shipmentId: shipment.id,
            status: targetShipmentStatus,
            description: `Shipment status updated to ${targetShipmentStatus}`,
          },
        });

        // Escrow release: when shipment becomes DELIVERED, settle its items and shipping fee
        if (targetShipmentStatus === ShipmentStatus.DELIVERED) {
          await this.releaseShipmentEscrow(tx, order.id, shipment.id, shipment.vendorId);
        }

        // Recompute parent order status based on all shipments for this order
        const allShipments = await tx.shipment.findMany({
          where: { orderId: order.id },
        });

        const newOrderStatus = this.deriveAggregateOrderStatus(
          order.status,
          allShipments,
        );

        if (newOrderStatus && newOrderStatus !== order.status) {
          const orderUpdated = await tx.order.updateMany({
            where: {
              id: order.id,
              status: order.status,
            },
            data: { status: newOrderStatus },
          });

          if (orderUpdated && orderUpdated.count > 0) {
            if (newOrderStatus === OrderStatus.COMPLETED) {
              metricToRecord = MARKETPLACE_ORDERS_COMPLETED_TOTAL;
            } else if (newOrderStatus === OrderStatus.CANCELLED) {
              metricToRecord = MARKETPLACE_ORDERS_CANCELLED_TOTAL;
            }
          }
        }

        return tx.shipment.findUnique({
          where: { id: shipment.id },
          include: { items: true, events: true },
        });
      } else {
        // Direct Order update (Buyer or Admin)
        const { order } = resolution;
        const currentOrderStatus = order.status;
        const targetOrderStatus = normalizedStatus as OrderStatus;

        if (!Object.values(OrderStatus).includes(targetOrderStatus)) {
          throw new BadRequestException(
            `Invalid order status: ${normalizedStatus}`,
          );
        }

        // Role authorization for direct order update
        if (user.isAdmin) {
          // Admins can perform transitions
        } else if (user.vendorProfile) {
          // Vendors must not directly update the entire order status
          throw new ForbiddenException(
            'Vendors cannot update the overall order status directly. Please update the specific shipment.',
          );
        } else {
          // Buyer authorization
          if (order.userId !== user.id) {
            throw new ForbiddenException(
              'You do not have permission to update this order status',
            );
          }
          if (
            targetOrderStatus !== OrderStatus.CANCELLED &&
            targetOrderStatus !== OrderStatus.COMPLETED
          ) {
            throw new ForbiddenException(
              `Buyers are not authorized to transition order to ${targetOrderStatus}`,
            );
          }
        }

        // Validate allowed order transitions
        const allowedTransitions =
          ORDER_ALLOWED_TRANSITIONS[currentOrderStatus] || [];
        if (!allowedTransitions.includes(targetOrderStatus)) {
          throw new BadRequestException(
            `Cannot transition order from ${currentOrderStatus} to ${targetOrderStatus}`,
          );
        }

        // Concurrency-safe conditional update on order
        const updatedCount = await tx.order.updateMany({
          where: {
            id: order.id,
            status: currentOrderStatus,
          },
          data: { status: targetOrderStatus },
        });

        if (updatedCount.count === 0) {
          throw new ConflictException(
            'Order status was concurrently modified. Please reload and try again.',
          );
        }

        // If order transitioned to CANCELLED, cancel all shipments & restore inventory
        if (targetOrderStatus === OrderStatus.CANCELLED) {
          metricToRecord = MARKETPLACE_ORDERS_CANCELLED_TOTAL;
          await tx.shipment.updateMany({
            where: { orderId: order.id },
            data: { status: ShipmentStatus.CANCELLED },
          });

          for (const item of order.items) {
            await tx.vendorProduct.updateMany({
              where: { id: item.vendorProductId },
              data: {
                stock: { increment: item.quantity },
                version: { increment: 1 },
              },
            });
          }
        }

        // If order transitioned to COMPLETED / DELIVERED, settle any remaining unreleased shipments
        if (
          targetOrderStatus === OrderStatus.COMPLETED ||
          targetOrderStatus === OrderStatus.DELIVERED
        ) {
          metricToRecord = MARKETPLACE_ORDERS_COMPLETED_TOTAL;
          const shipments = await tx.shipment.findMany({
            where: { orderId: order.id },
          });
          for (const s of shipments) {
            if (s.status !== ShipmentStatus.CANCELLED) {
              await this.releaseShipmentEscrow(tx, order.id, s.id, s.vendorId);
            }
          }
        }

        return tx.order.findUnique({
          where: { id: order.id },
          include: { items: true, shipments: true },
        });
      }
    });

    // Record monitoring outside the transaction
    if (metricToRecord) {
      this.recordMetric(metricToRecord, 1);
    }

    return result;
  }

  /**
   * Concurrency-safe cancellation of an order instead of destructive deletion.
   * Restores inventory and marks order & shipments as CANCELLED.
   */
  async cancelOrder(userId: string, orderId: string, reason?: string) {
    const cancelledOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, shipments: true },
      });

      if (!order || order.userId !== userId) {
        throw new NotFoundException('Order not found or access denied');
      }

      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(
          `Only pending orders can be cancelled. Current status: ${order.status}`,
        );
      }

      // Concurrency-safe update to CANCELLED
      const updatedCount = await tx.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.PENDING,
        },
        data: {
          status: OrderStatus.CANCELLED,
          ...(reason ? { notes: `Cancelled: ${reason}` } : {}),
        },
      });

      if (updatedCount.count === 0) {
        throw new ConflictException(
          'Order status was concurrently modified. Please reload.',
        );
      }

      // Cancel associated shipments
      await tx.shipment.updateMany({
        where: { orderId: order.id },
        data: { status: ShipmentStatus.CANCELLED },
      });

      // Restore vendor stock optimistically
      for (const item of order.items) {
        await tx.vendorProduct.updateMany({
          where: { id: item.vendorProductId },
          data: {
            stock: { increment: item.quantity },
            version: { increment: 1 },
          },
        });
      }

      // Outbox event for order cancellation
      await tx.outboxEvent.create({
        data: {
          type: 'ORDER_CANCELLED',
          payload: {
            orderId: order.id,
            userId,
            reason: reason || 'Cancelled by user',
          },
        },
      });

      return tx.order.findUnique({
        where: { id: order.id },
        include: { items: true, shipments: true },
      });
    });

    // Record metric outside the transaction
    this.recordMetric(MARKETPLACE_ORDERS_CANCELLED_TOTAL, 1);

    return cancelledOrder;
  }

  /**
   * Backwards-compatible method that delegates to cancelOrder.
   */
  async deleteOrder(userId: string, orderId: string) {
    return this.cancelOrder(userId, orderId);
  }

  /**
   * Release escrow for a specific delivered shipment and its items.
   * Prevents double release by checking existing unique ledger references.
   */
  private async releaseShipmentEscrow(
    tx: Prisma.TransactionClient,
    orderId: string,
    shipmentId: string,
    vendorId: string,
  ) {
    const payment = await tx.payment.findFirst({
      where: {
        orderId,
        status: PaymentStatus.PAID_IN_ESCROW,
      },
    });

    if (!payment) {
      return;
    }

    const commissionSetting = await tx.systemSetting.findUnique({
      where: { key: 'commission_rate' },
    });
    const commissionPercent = parseFloat(commissionSetting?.value || '5');

    // Resolve vendor's User ID to ensure ledger credits and UserBalance are correctly mapped
    const vendorProfile = await tx.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { userId: true },
    });

    if (!vendorProfile) {
      this.logger.error(
        `Vendor profile ${vendorId} not found for shipment ${shipmentId}. Escrow release skipped.`,
      );
      return;
    }

    const vendorUserId = vendorProfile.userId;

    // Settle items specific to this shipment
    const items = await tx.orderItem.findMany({
      where: { shipmentId },
    });

    for (const item of items) {
      const itemEscrowRef = `ESC-REL-${payment.id}-${item.id}-ESC-DEBIT`;
      const existingEntry = await tx.ledgerEntry.findUnique({
        where: { reference: itemEscrowRef },
      });

      if (!existingEntry) {
        const itemAmount = new Prisma.Decimal(item.totalPrice || 0);
        const itemPlatformFee = itemAmount.mul(commissionPercent / 100);

        await this.ledgerService.releaseEscrow(
          tx,
          payment.id,
          itemAmount,
          vendorUserId,
          itemPlatformFee,
          LedgerAccountType.VENDOR_BALANCE,
          item.id,
        );
      }
    }

    // Settle shipment shipping fee
    const shipment = await tx.shipment.findUnique({
      where: { id: shipmentId },
    });

    if (shipment && new Prisma.Decimal(shipment.shippingFee || 0).gt(0)) {
      const shippingEscrowRef = `ESC-REL-${payment.id}-shipping-${shipment.id}-ESC-DEBIT`;
      const existingEntry = await tx.ledgerEntry.findUnique({
        where: { reference: shippingEscrowRef },
      });

      if (!existingEntry) {
        await this.ledgerService.releaseEscrow(
          tx,
          payment.id,
          new Prisma.Decimal(shipment.shippingFee),
          vendorUserId,
          new Prisma.Decimal(0),
          LedgerAccountType.VENDOR_BALANCE,
          `shipping-${shipment.id}`,
        );
      }
    }

    // Check if all shipments for this order are now DELIVERED or CANCELLED
    const allShipments = await tx.shipment.findMany({
      where: { orderId },
    });

    const activeShipments = allShipments.filter(
      (s) => s.status !== ShipmentStatus.CANCELLED,
    );
    const allActiveDelivered =
      activeShipments.length > 0 &&
      activeShipments.every((s) => s.status === ShipmentStatus.DELIVERED);

    if (allActiveDelivered) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PAID_IN_ESCROW },
        data: { status: PaymentStatus.RELEASED },
      });
    }
  }

  /**
   * Derives overall OrderStatus from active shipment statuses.
   */
  private deriveAggregateOrderStatus(
    currentOrderStatus: OrderStatus,
    shipments: Array<{ status: ShipmentStatus }>,
  ): OrderStatus | null {
    if (shipments.length === 0) {
      return null;
    }

    const nonCancelled = shipments.filter(
      (s) => s.status !== ShipmentStatus.CANCELLED,
    );

    if (nonCancelled.length === 0) {
      return OrderStatus.CANCELLED;
    }

    if (nonCancelled.every((s) => s.status === ShipmentStatus.DELIVERED)) {
      return OrderStatus.DELIVERED;
    }

    if (
      nonCancelled.some(
        (s) =>
          s.status === ShipmentStatus.SHIPPED ||
          s.status === ShipmentStatus.DELIVERED,
      )
    ) {
      return OrderStatus.SHIPPED;
    }

    if (nonCancelled.some((s) => s.status === ShipmentStatus.PROCESSING)) {
      return OrderStatus.PROCESSING;
    }

    return null;
  }

  /**
   * Resolves targetId to either a Shipment or an Order based on ID and user permissions.
   */
  private async resolveTargetEntity(
    targetId: string,
    user: OrderUserPayload,
  ): Promise<
    | {
        type: 'SHIPMENT';
        shipment: {
          id: string;
          orderId: string;
          vendorId: string;
          status: ShipmentStatus;
          shippingFee: Prisma.Decimal;
          shippedAt: Date | null;
          deliveredAt: Date | null;
        };
        order: {
          id: string;
          userId: string;
          status: OrderStatus;
        };
      }
    | {
        type: 'ORDER';
        order: {
          id: string;
          userId: string;
          status: OrderStatus;
          items: Array<{
            id: string;
            vendorProductId: string;
            quantity: number;
          }>;
          shipments: Array<{ id: string; status: ShipmentStatus }>;
        };
      }
  > {
    // 1. Is targetId a Shipment ID?
    const directShipment = await this.prisma.shipment.findUnique({
      where: { id: targetId },
      include: { order: true },
    });

    if (directShipment) {
      if (
        user.vendorProfile &&
        user.vendorProfile.id !== directShipment.vendorId &&
        !user.isAdmin
      ) {
        throw new ForbiddenException(
          'You do not have permission to update this shipment',
        );
      }
      return {
        type: 'SHIPMENT',
        shipment: directShipment,
        order: directShipment.order,
      };
    }

    // 2. Is targetId an OrderItem ID?
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: targetId },
      include: {
        shipment: true,
        order: true,
        vendorProduct: true,
      },
    });

    if (orderItem) {
      if (orderItem.shipment) {
        if (
          user.vendorProfile &&
          user.vendorProfile.id !== orderItem.shipment.vendorId &&
          !user.isAdmin
        ) {
          throw new ForbiddenException(
            'You do not have permission to update this shipment',
          );
        }
        return {
          type: 'SHIPMENT',
          shipment: orderItem.shipment,
          order: orderItem.order,
        };
      }
    }

    // 3. Is targetId an Order ID?
    const order = await this.prisma.order.findUnique({
      where: { id: targetId },
      include: {
        items: true,
        shipments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order or shipment ${targetId} not found`);
    }

    // If caller is a vendor, operate on the vendor's shipment within this order!
    if (user.vendorProfile && !user.isAdmin) {
      const vendorShipment = order.shipments.find(
        (s) => s.vendorId === user.vendorProfile!.id,
      );

      if (!vendorShipment) {
        throw new ForbiddenException(
          'You do not have items or shipments in this order',
        );
      }

      const fullShipment = await this.prisma.shipment.findUnique({
        where: { id: vendorShipment.id },
      });

      return {
        type: 'SHIPMENT',
        shipment: fullShipment!,
        order: {
          id: order.id,
          userId: order.userId,
          status: order.status,
        },
      };
    }

    return {
      type: 'ORDER',
      order,
    };
  }

  /**
   * Safely records business metrics outside transaction blocks.
   */
  private recordMetric(metricName: string, value: number) {
    try {
      this.monitoringService?.incrementCounter(metricName, value);
    } catch (error) {
      this.logger.warn(
        `Failed to record metric ${metricName}: ${(error as Error).message}`,
      );
    }
  }
}
