import {
  Injectable,
  OnModuleInit,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { CalculateShippingDto } from './shipping.dto';
import { ShippingMethod, ShippingStrategy } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ShippingService implements OnModuleInit {
  private readonly logger = new Logger(ShippingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('Verifying shipping profiles for all vendors...');
    try {
      const vendors = await this.prisma.vendorProfile.findMany({
        include: { shippingProfile: true },
      });

      let createdCount = 0;
      for (const vendor of vendors) {
        if (!vendor.shippingProfile) {
          await this.prisma.vendorShippingProfile.create({
            data: {
              vendorId: vendor.id,
              shippingStrategy: ShippingStrategy.FLAT_RATE,
              baseShippingFee: new Decimal(1500.0), // default NGN 1500 flat rate
              additionalItemFee: new Decimal(500.0),
              freeShippingThreshold: new Decimal(50000.0),
              supportsPickup: true,
              estimatedDeliveryDays: 3,
            },
          });
          createdCount++;
        }
      }

      if (createdCount > 0) {
        this.logger.log(
          `Initialized default shipping profiles for ${createdCount} vendors.`,
        );
      } else {
        this.logger.log('All vendors have shipping profiles initialized.');
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize shipping profiles seed: ${error.message}`,
      );
    }
  }

  async calculateShipping(dto: CalculateShippingDto) {
    if (!dto.items || dto.items.length === 0) {
      return {
        shipments: [],
        subtotal: 0,
        shippingTotal: 0,
        total: 0,
      };
    }

    const vendorProductIds = dto.items.map((i) => i.vendorProductId);

    // 1. Fetch vendor products and associated vendor profiles
    const vendorProducts = await this.prisma.vendorProduct.findMany({
      where: { id: { in: vendorProductIds } },
      include: {
        product: true,
        vendor: {
          include: {
            shippingProfile: true,
          },
        },
      },
    });

    if (vendorProducts.length !== vendorProductIds.length) {
      throw new BadRequestException(
        'One or more invalid product listings in items list.',
      );
    }

    // Map quantities by vendorProductId
    const qtyMap = new Map<string, number>();
    for (const item of dto.items) {
      qtyMap.set(item.vendorProductId, item.quantity);
    }

    // Group items by vendorId
    const vendorGroups = new Map<
      string,
      {
        vendorName: string;
        shippingProfile?: any;
        items: Array<{
          vendorProductId: string;
          title: string;
          price: number;
          quantity: number;
        }>;
      }
    >();

    for (const vp of vendorProducts) {
      const vendorId = vp.vendorId;
      const quantity = qtyMap.get(vp.id) || 1;
      const price = vp.price.toNumber();

      if (!vendorGroups.has(vendorId)) {
        vendorGroups.set(vendorId, {
          vendorName: vp.vendor.businessName || 'Unnamed Vendor',
          shippingProfile: vp.vendor.shippingProfile,
          items: [],
        });
      }

      vendorGroups.get(vendorId)!.items.push({
        vendorProductId: vp.id,
        title: vp.product.name,
        price,
        quantity,
      });
    }

    const preferences = dto.preferences || [];
    const prefMap = new Map<string, ShippingMethod>();
    for (const pref of preferences) {
      prefMap.set(pref.vendorId, pref.method);
    }

    let grandSubtotal = 0;
    let grandShippingTotal = 0;
    const shipmentsBreakdown: any[] = [];

    // 2. Perform Shipping Calculations once per vendor
    for (const [vendorId, group] of vendorGroups.entries()) {
      const itemsSubtotal = group.items.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      );
      const totalQty = group.items.reduce((sum, i) => sum + i.quantity, 0);

      // Default shipping profile properties if missing
      const profile = group.shippingProfile || {
        shippingStrategy: ShippingStrategy.FLAT_RATE,
        baseShippingFee: new Decimal(0),
        additionalItemFee: new Decimal(0),
        freeShippingThreshold: null,
        supportsPickup: false,
        estimatedDeliveryDays: 3,
      };

      // Determine method: defaults to DELIVERY if pickup is not supported or not chosen
      let method = prefMap.get(vendorId) || ShippingMethod.DELIVERY;
      if (method === ShippingMethod.PICKUP && !profile.supportsPickup) {
        method = ShippingMethod.DELIVERY; // Override preference if pickup not supported
      }

      let shippingFee = 0.0;
      if (method !== ShippingMethod.PICKUP) {
        const baseFee = new Decimal(profile.baseShippingFee).toNumber();
        const additionalFee = new Decimal(profile.additionalItemFee).toNumber();
        const threshold = profile.freeShippingThreshold
          ? new Decimal(profile.freeShippingThreshold).toNumber()
          : null;

        if (threshold !== null && itemsSubtotal >= threshold) {
          shippingFee = 0.0; // Free shipping threshold met
        } else if (profile.shippingStrategy === ShippingStrategy.FLAT_RATE) {
          shippingFee = baseFee;
        } else if (
          profile.shippingStrategy === ShippingStrategy.BASE_ADDITIONAL
        ) {
          shippingFee = baseFee + additionalFee * (totalQty - 1);
        }
      }

      grandSubtotal += itemsSubtotal;
      grandShippingTotal += shippingFee;

      shipmentsBreakdown.push({
        vendorId,
        vendorName: group.vendorName,
        shippingFee,
        shippingMethod: method,
        estimatedDeliveryDays: profile.estimatedDeliveryDays,
        supportsPickup: profile.supportsPickup,
        subtotal: itemsSubtotal,
        items: group.items,
      });
    }

    return {
      shipments: shipmentsBreakdown,
      subtotal: grandSubtotal,
      shippingTotal: grandShippingTotal,
      total: grandSubtotal + grandShippingTotal,
    };
  }
}
