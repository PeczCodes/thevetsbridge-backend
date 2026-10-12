import { Prisma, ShippingMethod, ShippingStrategy } from '@prisma/client';
import {
  calculateOrderShipments,
  VendorGroup,
} from './shipping-calculator.util';

describe('shipping-calculator.util', () => {
  it('should calculate flat rate shipping correctly', () => {
    const vendorGroups = new Map<string, VendorGroup>();
    vendorGroups.set('vendor-1', {
      vendorName: 'Vendor One',
      shippingProfile: {
        id: 'prof-1',
        vendorId: 'vendor-1',
        shippingStrategy: ShippingStrategy.FLAT_RATE,
        baseShippingFee: new Prisma.Decimal(1500),
        additionalItemFee: new Prisma.Decimal(500),
        freeShippingThreshold: null,
        supportsPickup: false,
        estimatedDeliveryDays: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          vendorProductId: 'vp-1',
          quantity: 2,
          unitPrice: new Prisma.Decimal(2000),
          totalPrice: new Prisma.Decimal(4000),
        },
      ],
    });

    const prefMap = new Map<string, ShippingMethod>();
    const result = calculateOrderShipments(vendorGroups, prefMap);

    expect(result.hasDelivery).toBe(true);
    expect(result.shippingCostAmount.toNumber()).toBe(1500);
    expect(result.calculatedShipments).toHaveLength(1);
    expect(result.calculatedShipments[0].shippingFee.toNumber()).toBe(1500);
    expect(result.calculatedShipments[0].shippingMethod).toBe(
      ShippingMethod.DELIVERY,
    );
  });

  it('should calculate base + additional item fee correctly', () => {
    const vendorGroups = new Map<string, VendorGroup>();
    vendorGroups.set('vendor-1', {
      vendorName: 'Vendor One',
      shippingProfile: {
        id: 'prof-1',
        vendorId: 'vendor-1',
        shippingStrategy: ShippingStrategy.BASE_ADDITIONAL,
        baseShippingFee: new Prisma.Decimal(1000),
        additionalItemFee: new Prisma.Decimal(300),
        freeShippingThreshold: null,
        supportsPickup: false,
        estimatedDeliveryDays: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          vendorProductId: 'vp-1',
          quantity: 3,
          unitPrice: new Prisma.Decimal(1000),
          totalPrice: new Prisma.Decimal(3000),
        },
      ],
    });

    const prefMap = new Map<string, ShippingMethod>();
    const result = calculateOrderShipments(vendorGroups, prefMap);

    // 1000 + 300 * (3 - 1) = 1600
    expect(result.shippingCostAmount.toNumber()).toBe(1600);
    expect(result.calculatedShipments[0].shippingFee.toNumber()).toBe(1600);
  });

  it('should apply free shipping when threshold is met', () => {
    const vendorGroups = new Map<string, VendorGroup>();
    vendorGroups.set('vendor-1', {
      vendorName: 'Vendor One',
      shippingProfile: {
        id: 'prof-1',
        vendorId: 'vendor-1',
        shippingStrategy: ShippingStrategy.FLAT_RATE,
        baseShippingFee: new Prisma.Decimal(1500),
        additionalItemFee: new Prisma.Decimal(500),
        freeShippingThreshold: new Prisma.Decimal(10000),
        supportsPickup: false,
        estimatedDeliveryDays: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          vendorProductId: 'vp-1',
          quantity: 3,
          unitPrice: new Prisma.Decimal(4000),
          totalPrice: new Prisma.Decimal(12000),
        },
      ],
    });

    const prefMap = new Map<string, ShippingMethod>();
    const result = calculateOrderShipments(vendorGroups, prefMap);

    expect(result.shippingCostAmount.toNumber()).toBe(0);
    expect(result.calculatedShipments[0].shippingFee.toNumber()).toBe(0);
  });

  it('should handle pickup correctly when supported', () => {
    const vendorGroups = new Map<string, VendorGroup>();
    vendorGroups.set('vendor-1', {
      vendorName: 'Vendor One',
      shippingProfile: {
        id: 'prof-1',
        vendorId: 'vendor-1',
        shippingStrategy: ShippingStrategy.FLAT_RATE,
        baseShippingFee: new Prisma.Decimal(1500),
        additionalItemFee: new Prisma.Decimal(500),
        freeShippingThreshold: null,
        supportsPickup: true,
        estimatedDeliveryDays: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          vendorProductId: 'vp-1',
          quantity: 1,
          unitPrice: new Prisma.Decimal(2000),
          totalPrice: new Prisma.Decimal(2000),
        },
      ],
    });

    const prefMap = new Map<string, ShippingMethod>();
    prefMap.set('vendor-1', ShippingMethod.PICKUP);

    const result = calculateOrderShipments(vendorGroups, prefMap);

    expect(result.hasDelivery).toBe(false);
    expect(result.shippingCostAmount.toNumber()).toBe(0);
    expect(result.calculatedShipments[0].shippingMethod).toBe(
      ShippingMethod.PICKUP,
    );
  });
});
