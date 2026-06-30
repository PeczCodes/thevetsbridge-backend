import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { LedgerService } from '../../payments/services/ledger.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { Prisma } from '@prisma/client';
import { PaginationDto } from '../../../core/dto/pagination.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async placeOrder(userId: string, dto: PlaceOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      let subtotalAmount = new Prisma.Decimal(0);
      let shippingCostAmount = new Prisma.Decimal(0);
      const orderItemsData: any[] = [];

      for (const item of dto.items) {
        // Find the vendor product
        const vendorProduct = await tx.vendorProduct.findUnique({
          where: { id: item.vendorProductId },
        });

        if (!vendorProduct) {
          throw new BadRequestException(`Vendor product ${item.vendorProductId} not found`);
        }

        if (vendorProduct.stock < item.quantity) {
          throw new BadRequestException(`Insufficient stock for product listing ${item.vendorProductId}`);
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

        // Item subtotal: unit price × quantity
        const itemSubtotal = vendorProduct.price.mul(item.quantity);

        // Shipping fee is charged once per product line (not per unit), mirroring the
        // frontend cart calculation: shippingTotal = Σ item.shippingFee (not × quantity)
        const itemShipping = new Prisma.Decimal(
          Number((vendorProduct.attributes as any)?.shippingFee || 0),
        );

        subtotalAmount = subtotalAmount.add(itemSubtotal);
        shippingCostAmount = shippingCostAmount.add(itemShipping);

        orderItemsData.push({
          vendorProductId: vendorProduct.id,
          quantity: item.quantity,
          unitPrice: vendorProduct.price,
          totalPrice: itemSubtotal, // snapshot of line total at time of order
        });
      }

      // totalAmount = subtotal + shipping — this is what Paystack will charge
      const totalAmount = subtotalAmount.add(shippingCostAmount);

      if (dto.shippingAddressId) {
        const address = await tx.address.findFirst({
          where: { id: dto.shippingAddressId, userId, deletedAt: null },
        });
        if (!address) {
          throw new BadRequestException('Invalid shipping address');
        }
      }

      // Create Order
      const order = await tx.order.create({
        data: {
          userId,
          totalAmount,
          subtotal: subtotalAmount,
          shippingCost: shippingCostAmount,
          status: 'PENDING',
          shippingAddressId: dto.shippingAddressId,
          items: {
            create: orderItemsData,
          },
        },
        include: { items: true },
      });

      // Outbox event
      await tx.outboxEvent.create({
        data: {
          type: 'ORDER_PLACED',
          payload: {
            orderId: order.id,
            userId,
            totalAmount: order.totalAmount.toString(),
            subtotal: subtotalAmount.toString(),
            shippingCost: shippingCostAmount.toString(),
          },
        },
      });

      return order;
    });
  }


  async getMyOrders(userId: string, pagination: PaginationDto, status?: string) {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const dbStatus = status === 'ALL' || !status ? undefined : status.toUpperCase();
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
                include: { product: true }
              }
            }
          }
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

  async updateOrderStatus(orderId: string, status: any) {
    // If orderId is orderItem id, let's find the orderId first!
    // Wait! In getVendorOrders, we set "id: item.id" (OrderItem ID) for orders returned to vendor dashboard.
    // So when the vendor calls updateOrderStatus, they pass the OrderItem ID as orderId!
    // Let's handle both Order ID and OrderItem ID to be extremely safe.
    let targetOrderId = orderId;
    let order = await this.prisma.order.findUnique({
      where: { id: targetOrderId }
    });

    if (!order) {
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: orderId }
      });
      if (orderItem) {
        targetOrderId = orderItem.orderId;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: targetOrderId },
        include: {
          items: {
            include: {
              vendorProduct: true
            }
          }
        }
      });

      if (!currentOrder) {
        throw new NotFoundException(`Order ${targetOrderId} not found`);
      }

      const updated = await tx.order.update({
        where: { id: targetOrderId },
        data: { status },
      });

      // If status transitions to DELIVERED or COMPLETED, release escrow
      if (status === 'DELIVERED' || status === 'COMPLETED') {
        const payment = await tx.payment.findFirst({
          where: {
            orderId: currentOrder.id,
            status: 'PAID_IN_ESCROW',
          },
        });

        if (payment) {
          const commissionSetting = await tx.systemSetting.findUnique({
            where: { key: 'commission_rate' },
          });
          const commissionPercent = parseFloat(commissionSetting?.value || '5');

          for (const item of currentOrder.items) {
            const itemAmount = new Prisma.Decimal(item.totalPrice || 0);
            const itemPlatformFee = itemAmount.mul(commissionPercent / 100);

            await this.ledgerService.releaseEscrow(
              tx,
              payment.id,
              itemAmount,
              item.vendorProduct.vendorId,
              itemPlatformFee
            );
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

      if (!order) throw new BadRequestException('Order not found or access denied');
      if (order.status !== 'PENDING') throw new BadRequestException('Only pending orders can be deleted');

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
