import { Prisma, ShippingMethod, ShippingStrategy, VendorShippingProfile } from '@prisma/client';

export interface VendorGroupItem {
  vendorProductId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
}

export interface VendorGroup {
  vendorName: string;
  shippingProfile?: VendorShippingProfile | null;
  items: VendorGroupItem[];
}

export interface CalculatedShipment {
  vendorId: string;
  shippingFee: Prisma.Decimal;
  shippingMethod: ShippingMethod;
  estimatedDeliveryDays: number;
  items: VendorGroupItem[];
}

export interface ShippingCalculationResult {
  calculatedShipments: CalculatedShipment[];
  shippingCostAmount: Prisma.Decimal;
  hasDelivery: boolean;
}

/**
 * Calculates shipping fees, methods, and delivery expectations per vendor group.
 */
export function calculateOrderShipments(
  vendorGroups: Map<string, VendorGroup>,
  prefMap: Map<string, ShippingMethod>,
): ShippingCalculationResult {
  const calculatedShipments: CalculatedShipment[] = [];
  let shippingCostAmount = new Prisma.Decimal(0);
  let hasDelivery = false;

  for (const [vendorId, group] of vendorGroups.entries()) {
    const profile = group.shippingProfile;
    const totalQty = group.items.reduce((sum, i) => sum + i.quantity, 0);
    const groupSubtotal = group.items.reduce(
      (sum, i) => sum.add(i.totalPrice),
      new Prisma.Decimal(0),
    );

    let method = prefMap.get(vendorId) || ShippingMethod.DELIVERY;
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
        shippingFee = baseFee.add(
          additionalFee.mul(Math.max(0, totalQty - 1)),
        );
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

  return {
    calculatedShipments,
    shippingCostAmount,
    hasDelivery,
  };
}
