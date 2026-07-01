import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { generateSlug, uniqueSlug } from '../../../common/utils/slug';

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

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
          payload: { listingId: listing.id, vendorId: vendorProfileId, productId: dto.productId },
        },
      });

      return listing;
    });
  }

  async getListings() {
    const listings = await this.prisma.vendorProduct.findMany({
      include: {
        product: true,
        vendor: { include: { user: true } },
      },
    });

    // Map output to match frontend expected fields (images list, conditions, category, seller ratings)
    return listings.map(listing => ({
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
        image: listing.vendor.avatarUrl || listing.vendor.user.avatarUrl || undefined,
        vendorProfile: {
          businessName: listing.vendor.businessName || '',
          rating: listing.vendor.rating,
          verified: listing.vendor.status === 'APPROVED',
        },
      },
    }));
  }

  async getListingDetails(idOrSlug: string) {
    const listing = await this.prisma.vendorProduct.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { sku: idOrSlug },
          { slug: idOrSlug },
        ],
      },
      include: {
        product: true,
        vendor: { include: { user: true } },
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
        image: listing.vendor.avatarUrl || listing.vendor.user.avatarUrl || undefined,
        vendorProfile: {
          businessName: listing.vendor.businessName || '',
          rating: listing.vendor.rating,
          verified: listing.vendor.status === 'APPROVED',
        },
      },
    };
  }

  async updateListingStatus(vendorProductId: string, isActive: boolean) {
    const listing = await this.prisma.vendorProduct.findUnique({
      where: { id: vendorProductId },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${vendorProductId} not found`);
    }

    return this.prisma.vendorProduct.update({
      where: { id: vendorProductId },
      data: { isActive },
    });
  }

  async getVendorProducts(vendorProfileId: string) {
    const listings = await this.prisma.vendorProduct.findMany({
      where: { vendorId: vendorProfileId },
      include: { product: true },
    });

    return listings.map(listing => ({
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
    const totalProducts = await this.prisma.vendorProduct.count({
      where: { vendorId: vendorProfileId },
    });

    const activeListings = await this.prisma.vendorProduct.count({
      where: {
        vendorId: vendorProfileId,
        isActive: true,
      },
    });

    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        vendorProduct: { vendorId: vendorProfileId },
      },
      include: {
        order: true,
      },
    });

    const uniqueOrderIds = new Set(orderItems.map(item => item.orderId));
    const totalOrders = uniqueOrderIds.size;

    const nonCancelledItems = orderItems.filter(
      item => item.order.status !== 'CANCELLED' && item.order.status !== 'REFUNDED'
    );
    const commissionSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'commission_rate' },
    });
    const commissionPercent = parseFloat(commissionSetting?.value || '5');

    const rawRevenue = nonCancelledItems.reduce(
      (sum, item) => sum + Number(item.unitPrice) * item.quantity,
      0
    );
    const totalRevenue = rawRevenue * (1 - commissionPercent / 100);


    const pendingOrders = new Set(
      orderItems
        .filter(item => ['PENDING', 'PAID', 'CONFIRMED', 'PROCESSING'].includes(item.order.status))
        .map(item => item.orderId)
    ).size;

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
      const exists = await this.prisma.vendorProduct.findFirst({ where: { slug: s } });
      return !!exists;
    });

    return this.prisma.$transaction(async (tx) => {
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
          payload: { listingId: listing.id, vendorId: vendorProfileId, productId: product.id },
        },
      });

      return listing;
    });
  }

  async updateVendorProduct(vendorProfileId: string, vendorProductId: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
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
  }

  async updateVendorProfile(vendorProfileId: string, userId: string, body: any) {
    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorProfileId },
      include: { user: true },
    });

    if (!vendorProfile || vendorProfile.userId !== userId) {
      throw new NotFoundException('Vendor profile not found');
    }

    if (vendorProfile.status === 'PENDING' || vendorProfile.status === 'SUSPENDED') {
      throw new ForbiddenException('Profile is locked for editing');
    }

    const newStatus = vendorProfile.status === 'REJECTED' ? 'PENDING' : vendorProfile.status;

    return this.prisma.$transaction(async (tx) => {
      // Regenerate slug if the business name changed
      let slug = vendorProfile.slug;
      if (body.businessName && body.businessName !== vendorProfile.businessName) {
        const baseSlug = generateSlug(body.businessName);
        slug = await uniqueSlug(baseSlug, async (s) => {
          const existing = await tx.vendorProfile.findFirst({
            where: { slug: s, id: { not: vendorProfileId } },
          });
          return !!existing;
        });
      }

      const updatedProfile = await tx.vendorProfile.update({
        where: { id: vendorProfileId },
        data: {
          businessName: body.businessName,
          businessPhone: body.businessPhone,
          businessAddress: body.businessAddress,
          bio: body.bio,
          avatarUrl: body.avatarUrl,
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
          }
        },
        vendorProduct: {
          include: { product: true }
        }
      },
      orderBy: {
        order: {
          createdAt: 'desc'
        }
      }
    });

    const orders = orderItems.map((item: any) => ({
      id: item.id, // using item id so each order item is unique
      quantity: item.quantity,
      totalPrice: Number(item.unitPrice) * item.quantity,
      shippingFee: Number((item.vendorProduct.attributes as any)?.shippingFee || 0),
      orderStatus: item.order.status,
      paymentStatus: item.order.status === 'PAID' ? 'PAID' : 'PENDING',
      deliveryAddress: item.order.shippingAddress ? `${item.order.shippingAddress.street1}, ${item.order.shippingAddress.city}, ${item.order.shippingAddress.state}` : 'N/A',
      phoneNumber: item.order.user.phone || 'N/A',
      createdAt: item.order.createdAt.toISOString(),
      item: {
        title: item.vendorProduct.product.name,
        price: Number(item.unitPrice),
      },
      buyer: {
        name: `${item.order.user.firstName} ${item.order.user.lastName}`,
        email: item.order.user.email,
      }
    }));

    return { orders };
  }
}
