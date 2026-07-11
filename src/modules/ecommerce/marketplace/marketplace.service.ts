import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { generateSlug, uniqueSlug } from '../../../../common/utils/slug';
import { getOrCreateMediaFromUrl } from '../../../../common/utils/media';
import { CloudinaryService } from '../../../cloudinary/cloudinary.service';
import { CacheService } from '../../../../infra/cache/cache.service';
import { CacheKeys } from '../../../../infra/cache/cache-keys';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cacheService: CacheService,
  ) {}

  async createProduct(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: dto.name,
          description: dto.description,
          requiresPrescription: dto.requiresPrescription || false,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'PRODUCT_CREATED',
          payload: { productId: product.id },
        },
      });

      return product;
    });
  }

  async createListing(vendorProfileId: string, dto: CreateListingDto) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.vendorProduct.create({
        data: {
          vendorId: vendorProfileId,
          productId: dto.productId,
          price: dto.price,
          stock: dto.stock,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VENDOR_LISTING_CREATED',
          payload: {
            listingId: listing.id,
            vendorId: vendorProfileId,
            productId: dto.productId,
          },
        },
      });

      return listing;
    });
  }

  async getListings() {
    return this.cacheService.getOrSet(
      CacheKeys.listings(),
      async () => {
        const listings = await this.prisma.vendorProduct.findMany({
          where: {
            isActive: true,
            vendor: { isActive: true },
          },
          include: {
            product: true,
            vendor: {
              include: {
                avatarMedia: true,
                user: {
                  include: {
                    avatarMedia: true,
                  },
                },
              },
            },
          },
        });

        // Map output to match frontend expected fields (images list, conditions, category, seller ratings)
        return listings.map((listing) => ({
          id: listing.id,
          slug: listing.slug || listing.id,
          title: listing.product.name,
          description: listing.product.description || '',
          price: Number(listing.price),
          category: (listing.attributes as any)?.category || 'OTHER',
          condition: (listing.attributes as any)?.condition || 'NEW',
          stock: listing.stock,
          location: listing.vendor.businessAddress || 'Nigeria',
          shippingFee: Number((listing.attributes as any)?.shippingFee || 0),
          images: (listing.attributes as any)?.images || null,
          seller: {
            name: `${listing.vendor.user.firstName} ${listing.vendor.user.lastName}`,
            image: listing.vendor.avatarMedia?.storageUrl || undefined,
            vendorProfile: {
              businessName: listing.vendor.businessName || '',
              rating: listing.vendor.rating,
              verified: listing.vendor.status === 'APPROVED',
            },
          },
        }));
      },
      1200,
    );
  }

  async getListingDetails(idOrSlug: string) {
    return this.cacheService.getOrSet(
      CacheKeys.listing(idOrSlug),
      async () => {
        const listing = await this.prisma.vendorProduct.findFirst({
          where: {
            OR: [{ id: idOrSlug }, { sku: idOrSlug }, { slug: idOrSlug }],
            isActive: true,
            vendor: { isActive: true },
          },
          include: {
            product: true,
            vendor: {
              include: {
                avatarMedia: true,
                user: {
                  include: {
                    avatarMedia: true,
                  },
                },
              },
            },
          },
        });

        if (!listing) {
          throw new NotFoundException(`Product listing ${idOrSlug} not found`);
        }

        return {
          id: listing.id,
          slug: listing.slug || listing.id,
          title: listing.product.name,
          description: listing.product.description || '',
          price: Number(listing.price),
          category: (listing.attributes as any)?.category || 'OTHER',
          condition: (listing.attributes as any)?.condition || 'NEW',
          stock: listing.stock,
          location: listing.vendor.businessAddress || 'Nigeria',
          shippingFee: Number((listing.attributes as any)?.shippingFee || 0),
          images: (listing.attributes as any)?.images || null,
          seller: {
            name: `${listing.vendor.user.firstName} ${listing.vendor.user.lastName}`,
            image: listing.vendor.avatarMedia?.storageUrl || undefined,
            vendorProfile: {
              businessName: listing.vendor.businessName || '',
              rating: listing.vendor.rating,
              verified: listing.vendor.status === 'APPROVED',
            },
          },
        };
      },
      1200,
    );
  }

  async updateListingStatus(
    vendorProductId: string,
    isActive: boolean,
    vendorProfileId: string,
  ) {
    const listing = await this.prisma.vendorProduct.findUnique({
      where: { id: vendorProductId },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${vendorProductId} not found`);
    }

    if (listing.vendorId !== vendorProfileId) {
      throw new ForbiddenException('You do not own this listing');
    }

    const updated = await this.prisma.vendorProduct.update({
      where: { id: vendorProductId },
      data: { isActive },
    });

    // Evict the catalog and the individual listing so the new status is visible
    await Promise.all([
      this.cacheService.invalidateListings(),
      this.cacheService.del(CacheKeys.listing(vendorProductId)),
      listing.slug
        ? this.cacheService.del(CacheKeys.listing(listing.slug))
        : Promise.resolve(),
    ]);

    return updated;
  }

  async getVendorProducts(vendorProfileId: string) {
    const listings = await this.prisma.vendorProduct.findMany({
      where: { vendorId: vendorProfileId },
      include: { product: true },
    });

    return listings.map((listing) => ({
      id: listing.id,
      title: listing.product.name,
      description: listing.product.description || '',
      price: Number(listing.price),
      category: (listing.attributes as any)?.category || 'OTHER',
      condition: (listing.attributes as any)?.condition || 'NEW',
      stock: listing.stock,
      shippingFee: Number((listing.attributes as any)?.shippingFee || 0),
      tags: (listing.attributes as any)?.tags || [],
      isActive: listing.isActive,
      isFeatured: (listing.attributes as any)?.isFeatured || false,
      images: (listing.attributes as any)?.images || null,
    }));
  }

  async getVendorStats(vendorProfileId: string) {
    const [
      totalProducts,
      activeListings,
      uniqueOrdersAgg,
      pendingOrdersAgg,
      commissionSetting,
    ] = await Promise.all([
      this.prisma.vendorProduct.count({
        where: { vendorId: vendorProfileId },
      }),
      this.prisma.vendorProduct.count({
        where: {
          vendorId: vendorProfileId,
          isActive: true,
        },
      }),
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(DISTINCT oi."orderId")::int AS count
        FROM "OrderItem" oi
        JOIN "VendorProduct" vp ON oi."vendorProductId" = vp."id"
        WHERE vp."vendorId" = ${vendorProfileId}
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(DISTINCT oi."orderId")::int AS count
        FROM "OrderItem" oi
        JOIN "VendorProduct" vp ON oi."vendorProductId" = vp."id"
        JOIN "Order" o ON oi."orderId" = o."id"
        WHERE vp."vendorId" = ${vendorProfileId}
          AND o."status" IN ('PENDING', 'PAID', 'CONFIRMED', 'PROCESSING')
      `,
      this.prisma.systemSetting.findUnique({
        where: { key: 'commission_rate' },
      }),
    ]);

    const totalOrders = uniqueOrdersAgg[0]?.count || 0;
    const pendingOrders = pendingOrdersAgg[0]?.count || 0;
    const commissionPercent = parseFloat(commissionSetting?.value || '5');

    const revenueResult = await this.prisma.$queryRaw<any[]>`
      SELECT SUM(oi."unitPrice" * oi."quantity")::float AS sum
      FROM "OrderItem" oi
      JOIN "VendorProduct" vp ON oi."vendorProductId" = vp."id"
      JOIN "Order" o ON oi."orderId" = o."id"
      WHERE vp."vendorId" = ${vendorProfileId}
        AND o."status" NOT IN ('CANCELLED', 'REFUNDED')
    `;

    const rawRevenue = revenueResult[0]?.sum || 0;
    const totalRevenue = rawRevenue * (1 - commissionPercent / 100);

    return {
      totalProducts,
      activeListings,
      totalOrders,
      totalRevenue,
      pendingOrders,
    };
  }

  async createVendorProduct(vendorProfileId: string, body: any) {
    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorProfileId },
    });
    const vendorPrefix = vendorProfile?.businessName || 'vendor';
    const baseSlug = generateSlug(`${vendorPrefix} ${body.title}`);
    const slug = await uniqueSlug(baseSlug, async (s) => {
      const exists = await this.prisma.vendorProduct.findFirst({
        where: { slug: s },
      });
      return !!exists;
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: body.title,
          description: body.description,
          requiresPrescription: body.category === 'MEDICATION',
        },
      });

      const listing = await tx.vendorProduct.create({
        data: {
          vendorId: vendorProfileId,
          productId: product.id,
          price: body.price,
          stock: body.stock,
          slug,
          attributes: {
            category: body.category,
            condition: body.condition,
            shippingFee: body.shippingFee,
            tags: body.tags,
            images: body.images,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'PRODUCT_CREATED',
          payload: { productId: product.id },
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VENDOR_LISTING_CREATED',
          payload: {
            listingId: listing.id,
            vendorId: vendorProfileId,
            productId: product.id,
          },
        },
      });

      return listing;
    });

    // Evict listings catalog so the new product is visible immediately
    await this.cacheService.invalidateListings();

    return result;
  }

  async updateVendorProduct(
    vendorProfileId: string,
    vendorProductId: string,
    body: any,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const listing = await tx.vendorProduct.findUnique({
        where: { id: vendorProductId },
        include: { product: true },
      });

      if (!listing || listing.vendorId !== vendorProfileId) {
        throw new NotFoundException(`Listing ${vendorProductId} not found`);
      }

      let slug = listing.slug;
      if (body.title && body.title !== listing.product.name) {
        const vendorProfile = await tx.vendorProfile.findUnique({
          where: { id: vendorProfileId },
        });
        const vendorPrefix = vendorProfile?.businessName || 'vendor';
        const baseSlug = generateSlug(`${vendorPrefix} ${body.title}`);
        slug = await uniqueSlug(baseSlug, async (s) => {
          const exists = await tx.vendorProduct.findFirst({
            where: { slug: s, id: { not: vendorProductId } },
          });
          return !!exists;
        });
      }

      await tx.product.update({
        where: { id: listing.productId },
        data: {
          name: body.title,
          description: body.description,
          requiresPrescription: body.category === 'MEDICATION',
        },
      });

      return tx.vendorProduct.update({
        where: { id: vendorProductId },
        data: {
          price: body.price,
          stock: body.stock,
          slug,
          attributes: {
            category: body.category,
            condition: body.condition,
            shippingFee: body.shippingFee,
            tags: body.tags,
            images: body.images,
          },
        },
      });
    });

    // Evict catalog + individual listing key
    await Promise.all([
      this.cacheService.invalidateListings(),
      this.cacheService.del(CacheKeys.listing(vendorProductId)),
    ]);

    return result;
  }

  async updateVendorProfile(
    vendorProfileId: string,
    userId: string,
    body: any,
  ) {
    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorProfileId },
      include: { user: true },
    });

    if (!vendorProfile || vendorProfile.userId !== userId) {
      throw new NotFoundException('Vendor profile not found');
    }

    if (
      vendorProfile.status === 'PENDING' ||
      vendorProfile.status === 'SUSPENDED'
    ) {
      throw new ForbiddenException('Profile is locked for editing');
    }

    const newStatus =
      vendorProfile.status === 'REJECTED' ? 'PENDING' : vendorProfile.status;

    let resolvedMedia: any = null;
    let result: any;

    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Regenerate slug if the business name changed
        let slug = vendorProfile.slug;
        if (
          body.businessName &&
          body.businessName !== vendorProfile.businessName
        ) {
          const baseSlug = generateSlug(body.businessName);
          slug = await uniqueSlug(baseSlug, async (s) => {
            const existing = await tx.vendorProfile.findFirst({
              where: { slug: s, id: { not: vendorProfileId } },
            });
            return !!existing;
          });
        }

        let avatarMediaIdUpdate: any = undefined;
        if (body.avatarUrl !== undefined) {
          if (!body.avatarUrl || body.avatarUrl === '') {
            if (vendorProfile.avatarMediaId) {
              const oldMedia = await tx.media.findUnique({
                where: { id: vendorProfile.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: vendorProfile.avatarMediaId },
                  data: {
                    status: 'DELETED',
                    deletedAt: new Date(),
                  },
                });

                await tx.outboxEvent.create({
                  data: {
                    type: 'MEDIA_DELETED',
                    payload: {
                      mediaId: oldMedia.id,
                      publicId: oldMedia.publicId,
                    },
                  },
                });
              }
            }
            avatarMediaIdUpdate = null;
          } else {
            resolvedMedia = await getOrCreateMediaFromUrl(
              tx,
              body.avatarUrl,
              'VENDOR',
              vendorProfileId,
              'PROFILE_IMAGE',
              userId,
            );
            avatarMediaIdUpdate = resolvedMedia.mediaId;

            // If the vendor already had a profile avatar and it changed, soft-delete the old one
            if (
              vendorProfile.avatarMediaId &&
              vendorProfile.avatarMediaId !== resolvedMedia.mediaId
            ) {
              const oldMedia = await tx.media.findUnique({
                where: { id: vendorProfile.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: vendorProfile.avatarMediaId },
                  data: {
                    status: 'DELETED',
                    deletedAt: new Date(),
                  },
                });

                await tx.outboxEvent.create({
                  data: {
                    type: 'MEDIA_DELETED',
                    payload: {
                      mediaId: oldMedia.id,
                      publicId: oldMedia.publicId,
                    },
                  },
                });
              }
            }
          }
        }

        const updatedProfile = await tx.vendorProfile.update({
          where: { id: vendorProfileId },
          data: {
            businessName: body.businessName,
            businessPhone: body.businessPhone,
            businessAddress: body.businessAddress,
            bio: body.bio,
            ...(avatarMediaIdUpdate !== undefined && {
              avatarMediaId: avatarMediaIdUpdate,
            }),
            status: newStatus,
            rejectionReason: newStatus === 'PENDING' ? null : undefined,
            slug,
          },
        });

        if (vendorProfile.status === 'REJECTED' && newStatus === 'PENDING') {
          await tx.outboxEvent.create({
            data: {
              type: 'VENDOR_PROFILE_RESUBMITTED',
              payload: {
                userId,
                vendorProfileId,
              },
            },
          });
        }

        return updatedProfile;
      });
    } catch (error) {
      if (resolvedMedia?.isNew && resolvedMedia?.publicId) {
        await this.cloudinaryService.deleteAsset(resolvedMedia.publicId);
      }
      throw error;
    }

    // Vendor name/avatar appear in every listing's seller field — evict catalog
    await this.cacheService.invalidateListings();

    return result;
  }

  async getVendorOrders(vendorProfileId: string) {
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        vendorProduct: { vendorId: vendorProfileId },
      },
      include: {
        order: {
          include: {
            user: true,
            shippingAddress: true,
          },
        },
        vendorProduct: {
          include: { product: true },
        },
        shipment: true,
      },
      orderBy: {
        order: {
          createdAt: 'desc',
        },
      },
    });

    const orders = orderItems.map((item: any) => ({
      id: item.id, // using item id so each order item is unique
      quantity: item.quantity,
      totalPrice: Number(item.unitPrice) * item.quantity,
      shippingFee: Number(item.shipment?.shippingFee || 0),
      orderStatus: item.order.status,
      paymentStatus: item.order.status === 'PAID' ? 'PAID' : 'PENDING',
      deliveryAddress: item.order.shippingAddress
        ? `${item.order.shippingAddress.street1}, ${item.order.shippingAddress.city}, ${item.order.shippingAddress.state}`
        : 'N/A',
      phoneNumber: item.order.user.phone || 'N/A',
      createdAt: item.order.createdAt.toISOString(),
      item: {
        title: item.vendorProduct.product.name,
        price: Number(item.unitPrice),
      },
      buyer: {
        name: `${item.order.user.firstName} ${item.order.user.lastName}`,
        email: item.order.user.email,
      },
    }));

    return { orders };
  }

  async getVendorShippingProfile(vendorId: string) {
    let profile = await this.prisma.vendorShippingProfile.findUnique({
      where: { vendorId },
    });

    if (!profile) {
      profile = await this.prisma.vendorShippingProfile.create({
        data: {
          vendorId,
          shippingStrategy: 'FLAT_RATE',
          baseShippingFee: new Prisma.Decimal(1500.0),
          additionalItemFee: new Prisma.Decimal(500.0),
          freeShippingThreshold: new Prisma.Decimal(50000.0),
          supportsPickup: true,
          estimatedDeliveryDays: 3,
        },
      });
    }

    return profile;
  }

  async updateVendorShippingProfile(vendorId: string, dto: any) {
    return this.prisma.vendorShippingProfile.upsert({
      where: { vendorId },
      update: {
        shippingStrategy: dto.shippingStrategy,
        baseShippingFee: new Prisma.Decimal(dto.baseShippingFee || 0),
        additionalItemFee: new Prisma.Decimal(dto.additionalItemFee || 0),
        freeShippingThreshold:
          dto.freeShippingThreshold !== undefined &&
          dto.freeShippingThreshold !== null
            ? new Prisma.Decimal(dto.freeShippingThreshold)
            : null,
        supportsPickup: dto.supportsPickup,
        estimatedDeliveryDays: dto.estimatedDeliveryDays || 3,
      },
      create: {
        vendorId,
        shippingStrategy: dto.shippingStrategy || 'FLAT_RATE',
        baseShippingFee: new Prisma.Decimal(dto.baseShippingFee || 0),
        additionalItemFee: new Prisma.Decimal(dto.additionalItemFee || 0),
        freeShippingThreshold:
          dto.freeShippingThreshold !== undefined &&
          dto.freeShippingThreshold !== null
            ? new Prisma.Decimal(dto.freeShippingThreshold)
            : null,
        supportsPickup: dto.supportsPickup || false,
        estimatedDeliveryDays: dto.estimatedDeliveryDays || 3,
      },
    });
  }
}
