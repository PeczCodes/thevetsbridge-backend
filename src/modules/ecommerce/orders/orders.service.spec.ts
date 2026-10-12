import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { LedgerService } from '../../payments/services/ledger.service';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  ShipmentStatus,
  PaymentStatus,
  Prisma,
  LedgerAccountType,
} from '@prisma/client';
import {
  MARKETPLACE_ORDERS_PLACED_TOTAL,
  MARKETPLACE_ORDERS_CANCELLED_TOTAL,
} from '../../../monitoring/metrics/business.metrics';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let ledgerService: any;
  let monitoringService: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((callback) => {
        if (Array.isArray(callback)) {
          return Promise.all(callback);
        }
        return callback(prisma);
      }),
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shipment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      shipmentEvent: {
        create: jest.fn(),
      },
      orderItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      vendorProduct: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      vendorProfile: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'user-vendor-1' }),
      },
      address: {
        findFirst: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      payment: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      systemSetting: {
        findUnique: jest.fn(),
      },
      ledgerEntry: {
        findUnique: jest.fn(),
      },
    };

    ledgerService = {
      releaseEscrow: jest.fn(),
    };

    monitoringService = {
      incrementCounter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledgerService },
        { provide: MonitoringService, useValue: monitoringService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('Vendor Status Updates (Fix 1)', () => {
    it('should allow vendor to update only their own shipment, not other vendor shipments', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const shipmentBelongingToVendor = {
        id: 'shipment-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        status: ShipmentStatus.PENDING,
        shippingFee: new Prisma.Decimal(1000),
        shippedAt: null,
        deliveredAt: null,
        order: {
          id: 'order-1',
          userId: 'buyer-1',
          status: OrderStatus.PAID,
        },
      };

      prisma.shipment.findUnique.mockResolvedValue(shipmentBelongingToVendor);
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'shipment-1', status: ShipmentStatus.PROCESSING },
        { id: 'shipment-2', status: ShipmentStatus.PENDING },
      ]);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.updateOrderStatus(vendorUser, 'shipment-1', 'PROCESSING');

      expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
        where: { id: 'shipment-1', status: ShipmentStatus.PENDING },
        data: expect.objectContaining({ status: ShipmentStatus.PROCESSING }),
      });
      expect(prisma.shipmentEvent.create).toHaveBeenCalled();
    });

    it('should reject a vendor trying to update another vendor shipment', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const shipmentBelongingToOther = {
        id: 'shipment-2',
        orderId: 'order-1',
        vendorId: 'vendor-2', // Different vendor!
        status: ShipmentStatus.PENDING,
        order: { id: 'order-1', userId: 'buyer-1', status: OrderStatus.PAID },
      };

      prisma.shipment.findUnique.mockResolvedValue(shipmentBelongingToOther);

      await expect(
        service.updateOrderStatus(vendorUser, 'shipment-2', 'PROCESSING'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a vendor updating order directly if they have no shipments in it', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const orderWithoutVendor = {
        id: 'order-1',
        userId: 'buyer-1',
        status: OrderStatus.PAID,
        items: [],
        shipments: [{ id: 'shipment-99', vendorId: 'vendor-99' }],
      };

      prisma.shipment.findUnique.mockResolvedValue(null);
      prisma.orderItem.findUnique.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(orderWithoutVendor);

      await expect(
        service.updateOrderStatus(vendorUser, 'order-1', 'PROCESSING'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Concurrency-Safe Status Transitions (Fix 2)', () => {
    it('should throw ConflictException if shipment was modified concurrently (count === 0)', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const shipment = {
        id: 'shipment-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        status: ShipmentStatus.PENDING,
        shippingFee: new Prisma.Decimal(1000),
        shippedAt: null,
        deliveredAt: null,
        order: { id: 'order-1', userId: 'buyer-1', status: OrderStatus.PAID },
      };

      prisma.shipment.findUnique.mockResolvedValue(shipment);
      // Concurrency race: count 0 affected rows
      prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateOrderStatus(vendorUser, 'shipment-1', 'PROCESSING'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if direct order update encounters concurrent change', async () => {
      const adminUser = {
        id: 'admin-1',
        isAdmin: true,
      };

      const order = {
        id: 'order-1',
        userId: 'buyer-1',
        status: OrderStatus.PAID,
        items: [],
        shipments: [],
      };

      prisma.shipment.findUnique.mockResolvedValue(null);
      prisma.orderItem.findUnique.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(order);
      // Concurrency race: count 0 affected rows
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateOrderStatus(adminUser, 'order-1', 'CONFIRMED'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Per-Shipment Escrow Release (Fix 3)', () => {
    it('should release escrow ONLY for delivered shipment items and fee', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const shipment = {
        id: 'shipment-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        status: ShipmentStatus.SHIPPED,
        shippingFee: new Prisma.Decimal(1500),
        shippedAt: new Date(),
        deliveredAt: null,
        order: { id: 'order-1', userId: 'buyer-1', status: OrderStatus.SHIPPED },
      };

      prisma.shipment.findUnique
        .mockResolvedValueOnce(shipment) // in resolveTargetEntity
        .mockResolvedValueOnce(shipment) // in releaseShipmentEscrow for shippingFee check
        .mockResolvedValueOnce(shipment); // in final findUnique

      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.shipmentEvent.create.mockResolvedValue({});

      // Payment in escrow
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PAID_IN_ESCROW,
        orderId: 'order-1',
      });
      prisma.systemSetting.findUnique.mockResolvedValue({ value: '10' }); // 10% commission

      // Shipment 1 items
      prisma.orderItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          shipmentId: 'shipment-1',
          totalPrice: new Prisma.Decimal(5000),
        },
      ]);

      // Ledger entry check (not yet released)
      prisma.ledgerEntry.findUnique.mockResolvedValue(null);

      // Shipments state: shipment-1 delivered, shipment-2 still shipped
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'shipment-1', status: ShipmentStatus.DELIVERED },
        { id: 'shipment-2', status: ShipmentStatus.SHIPPED },
      ]);

      await service.updateOrderStatus(vendorUser, 'shipment-1', 'DELIVERED');

      // Escrow release called for item-1
      expect(ledgerService.releaseEscrow).toHaveBeenCalledWith(
        expect.anything(),
        'payment-1',
        new Prisma.Decimal(5000),
        'user-vendor-1',
        new Prisma.Decimal(500), // 10% of 5000
        LedgerAccountType.VENDOR_BALANCE,
        'item-1',
      );

      // Escrow release called for shipment fee
      expect(ledgerService.releaseEscrow).toHaveBeenCalledWith(
        expect.anything(),
        'payment-1',
        new Prisma.Decimal(1500),
        'user-vendor-1',
        new Prisma.Decimal(0),
        LedgerAccountType.VENDOR_BALANCE,
        'shipping-shipment-1',
      );

      // Payment status should NOT yet be RELEASED because shipment-2 is not delivered
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('should transition payment to RELEASED when all shipments are delivered', async () => {
      const vendorUser = {
        id: 'user-vendor-1',
        vendorProfile: { id: 'vendor-1' },
      };

      const shipment = {
        id: 'shipment-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        status: ShipmentStatus.SHIPPED,
        shippingFee: new Prisma.Decimal(0),
        shippedAt: new Date(),
        deliveredAt: null,
        order: { id: 'order-1', userId: 'buyer-1', status: OrderStatus.SHIPPED },
      };

      prisma.shipment.findUnique.mockResolvedValue(shipment);
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: PaymentStatus.PAID_IN_ESCROW,
      });
      prisma.systemSetting.findUnique.mockResolvedValue({ value: '5' });
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'shipment-1', status: ShipmentStatus.DELIVERED },
      ]);

      await service.updateOrderStatus(vendorUser, 'shipment-1', 'DELIVERED');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: PaymentStatus.PAID_IN_ESCROW },
        data: { status: PaymentStatus.RELEASED },
      });
    });
  });

  describe('Cancellation instead of hard deleting (Fix 7)', () => {
    it('should cancel pending order, cancel shipments, and restore stock without deleting', async () => {
      const order = {
        id: 'order-1',
        userId: 'buyer-1',
        status: OrderStatus.PENDING,
        items: [
          { vendorProductId: 'vp-1', quantity: 2 },
          { vendorProductId: 'vp-2', quantity: 3 },
        ],
        shipments: [{ id: 'shipment-1' }],
      };

      prisma.order.findUnique.mockResolvedValue(order);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendorProduct.updateMany.mockResolvedValue({ count: 1 });
      prisma.outboxEvent.create.mockResolvedValue({});

      await service.cancelOrder('buyer-1', 'order-1', 'Changed mind');

      // Order updated to CANCELLED
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.PENDING },
        data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
      });

      // Shipments updated to CANCELLED
      expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        data: { status: ShipmentStatus.CANCELLED },
      });

      // Stock restored for both items
      expect(prisma.vendorProduct.updateMany).toHaveBeenCalledTimes(2);

      // No delete calls made
      expect(prisma.order.delete).toBeUndefined();

      // Metric recorded outside transaction
      expect(monitoringService.incrementCounter).toHaveBeenCalledWith(
        MARKETPLACE_ORDERS_CANCELLED_TOTAL,
        1,
      );
    });

    it('deleteOrder should delegate to cancelOrder', async () => {
      jest.spyOn(service, 'cancelOrder').mockResolvedValue({} as any);

      await service.deleteOrder('buyer-1', 'order-1');

      expect(service.cancelOrder).toHaveBeenCalledWith('buyer-1', 'order-1');
    });
  });

  describe('Monitoring outside transaction (Fix 6)', () => {
    it('should call incrementCounter for placed orders after transaction commit', async () => {
      prisma.vendorProduct.findUnique.mockResolvedValue({
        id: 'vp-1',
        price: new Prisma.Decimal(1000),
        stock: 5,
        version: 1,
        vendorId: 'vendor-1',
        vendor: {
          businessName: 'Vendor 1',
          shippingProfile: null,
        },
      });
      prisma.vendorProduct.updateMany.mockResolvedValue({ count: 1 });
      prisma.address.findFirst.mockResolvedValue({ id: 'addr-1' });
      prisma.order.create.mockResolvedValue({ id: 'order-new' });
      prisma.shipment.create.mockResolvedValue({ id: 'shipment-new' });
      prisma.orderItem.create.mockResolvedValue({ id: 'item-new' });
      prisma.outboxEvent.create.mockResolvedValue({});
      prisma.order.findUnique.mockResolvedValue({ id: 'order-new' });

      await service.placeOrder('buyer-1', {
        shippingAddressId: 'addr-1',
        items: [{ vendorProductId: 'vp-1', quantity: 1 }],
      });

      expect(monitoringService.incrementCounter).toHaveBeenCalledWith(
        MARKETPLACE_ORDERS_PLACED_TOTAL,
        1,
      );
    });
  });

  describe('Get My Orders without status hacks (Fix 4 & 5)', () => {
    it('should query with OrderStatus directly without arbitrary aliasing', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await service.getMyOrders('buyer-1', { page: 1, limit: 10 }, 'PAID');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'buyer-1',
            status: OrderStatus.PAID,
          },
        }),
      );
    });
  });
});
